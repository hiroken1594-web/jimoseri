// 取引条件の提案（マッチング成立後に、飲食店・生産者のどちらからでも）。
// 相手が承諾すると、その条件が取引条件になり、双方の合意（取引条件に合意）になる。
import { formatYen } from '../../shared/labels.js'
import { proposalRespondSchema, termsProposalSchema } from '../../shared/schemas.js'
import { formatWindow, jstToMs } from '../../shared/time.js'
import { DELIVERY_LABEL, tradeTotals } from '../../shared/trade.js'
import { requireActor } from '../_lib/auth.js'
import { handle, HttpError, json, readBody } from '../_lib/http.js'
import { loadMatchFor, partnerUserId, toMatchDto } from '../_lib/matches.js'
import { notify, systemMessage } from '../_lib/notify.js'
import { getPrisma } from '../_lib/prisma.js'
import { toProposalDto } from '../_lib/proposals.js'
import { requireAllowed } from '../_lib/throttle.js'

// 条件を提案する
export const POST = handle(async (request) => {
  const actor = await requireActor(request)
  const body = await readBody(request, termsProposalSchema)
  const { row, viewer } = await loadMatchFor(actor, body.matchId)
  if (viewer === 'ADMIN') throw new HttpError(403, 'FORBIDDEN', '運営者は条件を提案できません（閲覧のみ）。')
  if (row.status !== 'ACCEPTED' && row.status !== 'AGREED') {
    throw new HttpError(409, 'STATE', row.status === 'PENDING' ? '条件の提案は、マッチング成立（承認）の後にできます。それまではメッセージで相談してください。' : 'この取引では、条件の提案はできません。')
  }
  if (row.restaurantCompletedAt || row.producerCompletedAt) throw new HttpError(409, 'STATE', '取引完了の確認が始まっているため、条件は変更できません。')
  await requireAllowed('terms-proposal', actor.user.id, 30, 24 * 60 * 60)
  const pickupStart = jstToMs(body.date, body.startTime)
  const pickupEnd = jstToMs(body.date, body.endTime)
  if (Number.isNaN(pickupStart) || Number.isNaN(pickupEnd)) throw new HttpError(400, 'VALIDATION', '受渡の日時を確認してください。', { date: '受渡の日時を確認してください。' })
  const prisma = getPrisma()
  // 返事待ちの古い提案は、新しい提案に置き換える
  await prisma.termsProposal.updateMany({ where: { matchId: row.id, status: 'PENDING' }, data: { status: 'SUPERSEDED', respondedAt: new Date() } })
  const proposal = await prisma.termsProposal.create({
    data: {
      matchId: row.id,
      proposerRole: viewer,
      quantity: body.quantity,
      unitPriceTaxIncl: body.unitPriceYen,
      deliveryMethod: body.deliveryMethod,
      deliveryPlace: body.deliveryPlace,
      pickupStart: new Date(pickupStart),
      pickupEnd: new Date(pickupEnd),
      shippingFeeYen: body.shippingFeeYen,
      shippingPayer: body.shippingPayer,
      note: body.note ?? '',
    },
  })
  const myName = viewer === 'RESTAURANT' ? row.restaurant.name : row.producer.farmName
  const t = tradeTotals({ quantityMilli: body.quantity * 1000, unitPriceYen: body.unitPriceYen, deliveryMethod: body.deliveryMethod, shippingFeeYen: body.shippingFeeYen })
  await systemMessage(row.id, viewer, `${myName}が取引条件を提案しました。`, proposal.id)
  await notify(
    partnerUserId(row, viewer),
    'TERMS_PROPOSED',
    `${myName}から取引条件の提案が届きました`,
    `${DELIVERY_LABEL[body.deliveryMethod]}・${formatWindow(pickupStart, pickupEnd)}・合計 ${t.totalYen === null ? `${formatYen(t.subtotalYen)}＋送料（未確定）` : formatYen(t.totalYen)}`,
    `/matches/${row.id}`,
    row.id,
  )
  return json({ proposal: toProposalDto(proposal) }, 201)
})

// 提案への返事（/api/proposals?id=...）：提案を受けた側だけが承諾・見送りできる
export const PATCH = handle(async (request) => {
  const actor = await requireActor(request)
  const id = new URL(request.url).searchParams.get('id')
  const prisma = getPrisma()
  const proposal = id ? await prisma.termsProposal.findUnique({ where: { id } }) : null
  if (!proposal) throw new HttpError(404, 'NOT_FOUND', 'この提案は見つかりません。')
  // 取引の当事者かを確かめる（他人の取引の提案は「存在しない」として扱う）
  const { row, viewer } = await loadMatchFor(actor, proposal.matchId)
  const body = await readBody(request, proposalRespondSchema)
  if (viewer === 'ADMIN' || viewer === proposal.proposerRole) throw new HttpError(403, 'FORBIDDEN', '提案への返事は、提案を受けた側だけができます。')
  if (proposal.status !== 'PENDING') throw new HttpError(409, 'ALREADY', 'この提案には、既に返事が済んでいるか、新しい提案に置き換わっています。')
  if (row.status !== 'ACCEPTED' && row.status !== 'AGREED') throw new HttpError(409, 'STATE', 'この取引では、条件を変更できません。')
  const now = new Date()
  const myName = viewer === 'RESTAURANT' ? row.restaurant.name : row.producer.farmName
  if (body.action === 'reject') {
    await prisma.termsProposal.update({ where: { id: proposal.id }, data: { status: 'REJECTED', respondedAt: now } })
    await systemMessage(row.id, viewer, `${myName}がこの条件の提案を見送りました。メッセージで相談しましょう。`)
  } else {
    // 承諾：提案の内容を取引条件にし、提案した人と承諾した人の双方が合意したことにする
    const updated = await prisma.termsProposal.updateMany({ where: { id: proposal.id, status: 'PENDING' }, data: { status: 'ACCEPTED', respondedAt: now } })
    if (updated.count === 0) throw new HttpError(409, 'ALREADY', 'この提案には、既に返事が済んでいます。')
    await prisma.matchRequest.update({
      where: { id: row.id },
      data: {
        quantity: proposal.quantity,
        unitPriceTaxIncl: proposal.unitPriceTaxIncl,
        deliveryMethod: proposal.deliveryMethod,
        deliveryPlace: proposal.deliveryPlace,
        pickupStart: proposal.pickupStart,
        pickupEnd: proposal.pickupEnd,
        shippingFeeYen: proposal.shippingFeeYen,
        shippingPayer: proposal.shippingPayer,
        termsNote: proposal.note,
        restaurantAgreedAt: now,
        producerAgreedAt: now,
        status: 'AGREED',
      },
    })
    await systemMessage(row.id, viewer, `${myName}が条件の提案を承諾しました。双方がこの条件に合意しました。支払い方法と受渡を確認して、取引を進めてください。`)
    await notify(partnerUserId(row, viewer), 'TERMS_AGREED', `${myName}が条件の提案を承諾しました`, '取引条件に合意しました', `/matches/${row.id}`, row.id)
  }
  const { row: next } = await loadMatchFor(actor, row.id)
  return json({ match: await toMatchDto(next, viewer) })
})
