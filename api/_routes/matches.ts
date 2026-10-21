// 取引（マッチング）：飲食店からも生産者からも提案でき、提案を受けた側が承認するとマッチング成立。
// 提案した時点からチャットで相談でき、条件の合意 → 双方の取引完了の確認 → 相互レビュー、と進む。
// どの段階でも、在庫の確保・注文の確定・決済・配送の手配はしない。
import { randomUUID } from 'node:crypto'
import type { MatchCreateInput, ProducerProposalInput } from '../../shared/schemas.js'
import { matchCreateSchema, matchRespondSchema, producerProposalSchema } from '../../shared/schemas.js'
import { nextOccurrence, occurrenceOn } from '../../shared/schedule.js'
import { jstDateString } from '../../shared/time.js'
import type { Prisma } from '../../generated/prisma/client.js'
import { requireActor, type Actor } from '../_lib/auth.js'
import { handle, HttpError, json, readBody } from '../_lib/http.js'
import { scheduleOf } from '../_lib/listings.js'
import { loadMatchFor, matchInclude, partnerUserId, responderOf, toMatchDto } from '../_lib/matches.js'
import { notify, systemMessage } from '../_lib/notify.js'
import { getPrisma } from '../_lib/prisma.js'
import { requireAllowed } from '../_lib/throttle.js'

const ROLE_NAME = { RESTAURANT: '飲食店', PRODUCER: '生産者' } as const
const chatLink = (id: string) => `/matches/${id}`

// 自分の取引の一覧（飲食店・生産者は自分が関わる取引／運営者はすべて）。?id= で1件
export const GET = handle(async (request) => {
  const actor = await requireActor(request)
  const id = new URL(request.url).searchParams.get('id')
  if (id) {
    const { row, viewer } = await loadMatchFor(actor, id)
    return json({ match: await toMatchDto(row, viewer) })
  }
  const where = actor.restaurantId ? { restaurantId: actor.restaurantId } : actor.producerId ? { producerId: actor.producerId } : actor.user.role === 'ADMIN' ? {} : null
  if (!where) throw new HttpError(403, 'FORBIDDEN', 'この画面は利用できません。')
  const viewer = actor.restaurantId ? 'RESTAURANT' : actor.producerId ? 'PRODUCER' : 'ADMIN'
  const rows = await getPrisma().matchRequest.findMany({ where, include: matchInclude, orderBy: { createdAt: 'desc' }, take: 200 })
  const matches = await Promise.all(rows.map((r) => toMatchDto(r, viewer)))
  // 「返事が必要」：相談中で、自分が提案を受けた側のもの
  const pendingTotal = viewer === 'ADMIN' ? 0 : matches.filter((m) => m.status === 'PENDING' && m.initiator !== viewer).length
  return json({ matches, unreadTotal: matches.reduce((n, m) => n + m.unread, 0), pendingTotal })
})

/** 出品を読み、受け取りの回を決める（指定があれば、その出品で実際に受け取れる回かを確かめる） */
function windowFor(row: { pickupStart: Date; pickupEnd: Date; pickupWeekdays: number | null; pickupStartMin: number | null; pickupEndMin: number | null }, line: { pickupStartMs?: number; pickupEndMs?: number }, nowMs: number) {
  const w = { pickupStartMs: row.pickupStart.getTime(), pickupEndMs: row.pickupEnd.getTime(), schedule: scheduleOf(row) }
  let window = nextOccurrence(w, nowMs)
  if (line.pickupStartMs !== undefined && line.pickupEndMs !== undefined) {
    const o = occurrenceOn(w, jstDateString(line.pickupStartMs))
    if (!o || o.startMs !== line.pickupStartMs || o.endMs !== line.pickupEndMs) {
      throw new HttpError(400, 'VALIDATION', '受け取りの日時が、この出品の受渡日時と合いません。計算し直してください。')
    }
    window = o
  }
  if (!window || window.endMs <= nowMs) throw new HttpError(409, 'UNAVAILABLE', 'この出品の受渡日時は過ぎています。')
  return window
}

const listingInclude = { item: true, pickupLocation: true, producer: true } satisfies Prisma.ListingInclude

/** 受渡方法・場所・送料（指定がなければ、生産者の指定場所で受け取る） */
function deliveryData(body: { deliveryMethod?: 'PICKUP' | 'DELIVERY' | 'DISCUSS'; deliveryPlace?: string; shippingFeeYen?: number | null; shippingPayer?: 'UNDECIDED' | 'RESTAURANT' | 'PRODUCER' }, locationName: string) {
  const method = body.deliveryMethod ?? 'PICKUP'
  return {
    deliveryMethod: method,
    deliveryPlace: body.deliveryPlace || (method === 'PICKUP' ? locationName : ''),
    shippingFeeYen: body.shippingFeeYen ?? null,
    shippingPayer: body.shippingPayer ?? 'UNDECIDED',
  }
}

/** 飲食店 → 生産者への依頼（仕入れ案の農家ごと、または出品の詳細から） */
async function createFromRestaurant(actor: Actor, body: MatchCreateInput) {
  const prisma = getPrisma()
  const demo = body.demoMode ?? false
  const nowMs = Date.now()
  if (new Set(body.lines.map((l) => l.listingId)).size !== body.lines.length) throw new HttpError(400, 'VALIDATION', '同じ出品が重複しています。')
  const rows = await prisma.listing.findMany({
    where: {
      id: { in: body.lines.map((l) => l.listingId) },
      isPublished: true,
      adminSuspended: false,
      // デモデータと実際のデータは混ぜない（デモモードの依頼はデモの出品だけ）
      isDemo: demo,
      producer: { approvalStatus: 'APPROVED', isDemo: demo, user: { suspended: false } },
      pickupLocation: { status: 'APPROVED', isDemo: demo },
    },
    include: listingInclude,
  })
  const existing = await prisma.matchRequest.findMany({
    where: { restaurantId: actor.restaurantId!, listingId: { in: body.lines.map((l) => l.listingId) }, status: { in: ['PENDING', 'ACCEPTED', 'AGREED'] } },
    select: { listingId: true },
  })
  const already = new Set(existing.map((e) => e.listingId))
  const data = body.lines.map((line) => {
    const row = rows.find((r) => r.id === line.listingId)
    if (!row || Number(row.quantity) <= 0) throw new HttpError(409, 'UNAVAILABLE', 'この出品は現在、依頼できません。公開が止められたか、在庫がなくなった可能性があります。')
    if (already.has(row.id)) throw new HttpError(409, 'DUPLICATE', `${row.item.name}（この生産者）には、既に依頼しています。「やりとり」で状況を確認できます。`)
    if (line.quantity > Number(row.quantity)) throw new HttpError(400, 'VALIDATION', `${row.item.name}の数量は、いまの在庫（${Number(row.quantity)}）以下にしてください。`)
    const window = windowFor(row, line, nowMs)
    return {
      restaurantId: actor.restaurantId!,
      producerId: row.producerId,
      listingId: row.id,
      initiator: 'RESTAURANT' as const,
      itemName: row.item.name,
      variety: row.variety,
      quantity: line.quantity,
      unit: row.unit,
      unitPriceTaxIncl: row.unitPriceTaxIncl,
      pickupStart: new Date(window.startMs),
      pickupEnd: new Date(window.endMs),
      locationName: row.pickupLocation.name,
      message: body.message ?? '',
      isDemo: row.isDemo,
      ...deliveryData(body, row.pickupLocation.name),
    }
  })
  const groupId = data.length > 1 ? randomUUID() : null
  return prisma.$transaction(data.map((d) => prisma.matchRequest.create({ data: { ...d, groupId }, include: matchInclude })))
}

/** 生産者 → 飲食店への取引提案（提案の受け取りを許可していて、ブロックしていない飲食店にだけ） */
async function createFromProducer(actor: Actor, body: ProducerProposalInput) {
  const prisma = getPrisma()
  const producer = await prisma.producer.findUniqueOrThrow({ where: { id: actor.producerId! } })
  if (producer.approvalStatus !== 'APPROVED') throw new HttpError(403, 'NOT_APPROVED', '運営者の確認が済むまで、取引の提案はできません。')
  // 迷惑な営業を防ぐため、1日に送れる提案の数を制限する
  await requireAllowed('producer-proposal', actor.user.id, 10, 24 * 60 * 60)
  const restaurant = await prisma.restaurant.findFirst({
    where: { id: body.restaurantId, acceptProposals: true, isDemo: producer.isDemo, user: { suspended: false }, blocks: { none: { producerId: producer.id } } },
  })
  if (!restaurant) throw new HttpError(404, 'NOT_FOUND', 'この飲食店には提案できません（提案の受け取りを止めている可能性があります）。')
  const row = await prisma.listing.findFirst({
    where: { id: body.listingId, producerId: producer.id, isPublished: true, adminSuspended: false, pickupLocation: { status: 'APPROVED' } },
    include: listingInclude,
  })
  if (!row || Number(row.quantity) <= 0) throw new HttpError(409, 'UNAVAILABLE', 'この出品は提案に使えません（公開中で在庫があり、受渡場所が確認済みの出品を選んでください）。')
  if (body.quantity > Number(row.quantity)) throw new HttpError(400, 'VALIDATION', `数量は、いまの在庫（${Number(row.quantity)}）以下にしてください。`)
  const duplicate = await prisma.matchRequest.findFirst({ where: { restaurantId: restaurant.id, listingId: row.id, status: { in: ['PENDING', 'ACCEPTED', 'AGREED'] } } })
  if (duplicate) throw new HttpError(409, 'DUPLICATE', 'この飲食店には、この出品で既に取引を進めています。')
  const window = windowFor(row, body, Date.now())
  const created = await prisma.matchRequest.create({
    data: {
      restaurantId: restaurant.id,
      producerId: producer.id,
      listingId: row.id,
      initiator: 'PRODUCER',
      itemName: row.item.name,
      variety: row.variety,
      quantity: body.quantity,
      unit: row.unit,
      unitPriceTaxIncl: row.unitPriceTaxIncl,
      pickupStart: new Date(window.startMs),
      pickupEnd: new Date(window.endMs),
      locationName: row.pickupLocation.name,
      message: body.message ?? '',
      isDemo: row.isDemo,
      ...deliveryData(body, row.pickupLocation.name),
    },
    include: matchInclude,
  })
  return [created]
}

// 取引を提案する（飲食店：生産者への依頼／生産者：飲食店への提案）。提案した時点からチャットで相談できる
export const POST = handle(async (request) => {
  const actor = await requireActor(request)
  let created
  if (actor.user.role === 'RESTAURANT' && actor.restaurantId) {
    const body = await readBody(request, matchCreateSchema)
    await requireAllowed('match-create', actor.user.id, 30, 24 * 60 * 60)
    created = await createFromRestaurant(actor, body)
  } else if (actor.user.role === 'PRODUCER' && actor.producerId) {
    created = await createFromProducer(actor, await readBody(request, producerProposalSchema))
  } else {
    throw new HttpError(403, 'FORBIDDEN', '取引の提案は、飲食店・生産者のアカウントで行ってください。')
  }
  const from = created[0].initiator === 'PRODUCER' ? 'PRODUCER' : 'RESTAURANT'
  for (const m of created) {
    await systemMessage(m.id, from, `${ROLE_NAME[from]}から取引の提案がありました。承認されるとマッチング成立です（それまでもチャットで相談できます）。`)
    const fromName = from === 'PRODUCER' ? m.producer.farmName : m.restaurant.name
    await notify(partnerUserId(m, from), 'PROPOSAL_RECEIVED', `${fromName}から取引の提案が届きました`, `${m.itemName} ${Number(m.quantity)}`, chatLink(m.id), m.id)
  }
  return json({ matches: await Promise.all(created.map((r) => toMatchDto(r, from))) }, 201)
})

// 状態の変更（/api/matches?id=...）
//  accept・decline：提案を受けた側（相談中のときだけ）／cancel：提案した側（相談中のときだけ）
//  agree：マッチング成立後に、いまの条件に合意（双方が合意すると「取引条件に合意」）
//  complete：取引条件の合意後に、取引完了を確認（双方が確認すると「取引完了」）
//  block：飲食店が、この生産者からの提案を今後受け取らない
export const PATCH = handle(async (request) => {
  const actor = await requireActor(request)
  const { row, viewer } = await loadMatchFor(actor, new URL(request.url).searchParams.get('id'))
  const body = await readBody(request, matchRespondSchema)
  if (viewer === 'ADMIN') throw new HttpError(403, 'FORBIDDEN', '運営者は取引の操作をできません（閲覧のみ）。')
  const prisma = getPrisma()
  const myName = viewer === 'RESTAURANT' ? row.restaurant.name : row.producer.farmName
  const toPartner = partnerUserId(row, viewer)
  const now = new Date()
  // 同時に2回押されても、想定した状態のときだけ更新する
  const guarded = async (status: Prisma.MatchRequestWhereInput['status'], data: Prisma.MatchRequestUpdateManyMutationInput) => {
    const updated = await prisma.matchRequest.updateMany({ where: { id: row.id, status }, data })
    if (updated.count === 0) throw new HttpError(409, 'ALREADY', 'この取引の状態が変わっています。画面を読み込み直してください。')
  }

  switch (body.action) {
    case 'accept':
    case 'decline': {
      if (row.status !== 'PENDING') throw new HttpError(409, 'ALREADY', 'この提案には、既に返事が済んでいます。画面を読み込み直してください。')
      if (viewer !== responderOf(row)) throw new HttpError(403, 'FORBIDDEN', '提案への返事は、提案を受けた側だけができます。')
      const accept = body.action === 'accept'
      await guarded('PENDING', { status: accept ? 'ACCEPTED' : 'DECLINED', respondedAt: now, declineReason: accept ? null : body.reason || null })
      await systemMessage(row.id, viewer, accept ? `${myName}が承認しました。マッチング成立です。取引条件を確認しましょう。` : `${myName}が今回は辞退しました。${body.reason ? `（理由：${body.reason}）` : ''}`)
      await notify(toPartner, accept ? 'PROPOSAL_ACCEPTED' : 'PROPOSAL_DECLINED', accept ? `${myName}が取引の提案を承認しました` : `${myName}が取引の提案を辞退しました`, `${row.itemName}`, chatLink(row.id), row.id)
      break
    }
    case 'cancel': {
      if (row.status !== 'PENDING') throw new HttpError(409, 'ALREADY', '相談中の提案だけを取り下げられます。')
      if (viewer === responderOf(row)) throw new HttpError(403, 'FORBIDDEN', '取り下げは、提案した側だけができます。')
      await guarded('PENDING', { status: 'CANCELLED', respondedAt: now })
      await systemMessage(row.id, viewer, `${myName}が提案を取り下げました。`)
      break
    }
    case 'agree': {
      if (row.status !== 'ACCEPTED') throw new HttpError(409, 'STATE', '条件への合意は、マッチング成立後（合意の前）にできます。')
      const pending = await prisma.termsProposal.count({ where: { matchId: row.id, status: 'PENDING' } })
      if (pending > 0) throw new HttpError(409, 'PENDING_PROPOSAL', '返事待ちの条件の提案があります。先に提案に返事をしてください。')
      const mineField = viewer === 'RESTAURANT' ? 'restaurantAgreedAt' : 'producerAgreedAt'
      const partnerAgreed = viewer === 'RESTAURANT' ? row.producerAgreedAt : row.restaurantAgreedAt
      await guarded('ACCEPTED', { [mineField]: now, ...(partnerAgreed ? { status: 'AGREED' } : {}) })
      await systemMessage(row.id, viewer, partnerAgreed ? '双方がいまの条件に合意しました。支払い方法と受渡を確認して、取引を進めてください。' : `${myName}がいまの条件に合意しました（相手の合意待ち）。`)
      await notify(toPartner, 'TERMS_AGREED', partnerAgreed ? '取引条件に合意しました' : `${myName}が取引条件に合意しました`, partnerAgreed ? '支払い方法と受渡を確認しましょう' : 'あなたの合意を待っています', chatLink(row.id), row.id)
      break
    }
    case 'complete': {
      if (row.status !== 'AGREED') throw new HttpError(409, 'STATE', '取引完了の確認は、取引条件に合意した後にできます。')
      const mineField = viewer === 'RESTAURANT' ? 'restaurantCompletedAt' : 'producerCompletedAt'
      if (row[mineField]) throw new HttpError(409, 'ALREADY', 'すでに取引完了を確認しています。相手の確認をお待ちください。')
      const partnerDone = viewer === 'RESTAURANT' ? row.producerCompletedAt : row.restaurantCompletedAt
      await guarded('AGREED', { [mineField]: now, ...(partnerDone ? { status: 'COMPLETED' } : {}) })
      if (partnerDone) {
        await systemMessage(row.id, viewer, '双方が取引完了を確認しました。取引完了です。お互いのレビューを投稿しましょう。')
        await notify(toPartner, 'COMPLETED', `${myName}も取引完了を確認しました`, '取引完了です', chatLink(row.id), row.id)
        const restaurantUser = row.restaurant.userId
        const producerUser = row.producer.userId
        await notify(restaurantUser, 'REVIEW_REQUESTED', `${row.producer.farmName}のレビューを投稿しましょう`, row.itemName, chatLink(row.id), row.id)
        await notify(producerUser, 'REVIEW_REQUESTED', `${row.restaurant.name}のレビューを投稿しましょう`, row.itemName, chatLink(row.id), row.id)
      } else {
        await systemMessage(row.id, viewer, `${myName}が取引完了を確認しました（相手の確認待ち）。`)
        await notify(toPartner, 'COMPLETION_REQUESTED', `${myName}が取引完了を確認しました`, '受渡が済んでいれば、あなたも取引完了を確認してください', chatLink(row.id), row.id)
      }
      break
    }
    case 'block': {
      if (viewer !== 'RESTAURANT' || row.initiator !== 'PRODUCER') throw new HttpError(403, 'FORBIDDEN', 'この操作は、生産者から提案を受けた飲食店だけができます。')
      await prisma.proposalBlock.upsert({ where: { restaurantId_producerId: { restaurantId: row.restaurantId, producerId: row.producerId } }, update: {}, create: { restaurantId: row.restaurantId, producerId: row.producerId } })
      if (row.status === 'PENDING') {
        await guarded('PENDING', { status: 'DECLINED', respondedAt: now })
        await systemMessage(row.id, viewer, `${myName}が今回は辞退しました。`)
        await notify(toPartner, 'PROPOSAL_DECLINED', `${myName}が取引の提案を辞退しました`, row.itemName, chatLink(row.id), row.id)
      }
      break
    }
  }
  const { row: next } = await loadMatchFor(actor, row.id)
  return json({ match: await toMatchDto(next, viewer) })
})
