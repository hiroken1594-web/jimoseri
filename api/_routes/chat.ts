// 取引チャット。提案した時点から使え、取引の記録（承認・合意・完了）と条件の提案カードも同じ流れに並ぶ。
// 使えるのは、その取引の飲食店と生産者だけ（運営者は閲覧のみ）。送った人はサーバーがログイン中の利用者から決める。
import type { ChatMessageDto, ChatResponse } from '../../shared/dto.js'
import { formatPhone } from '../../shared/phone.js'
import { chatSendSchema } from '../../shared/schemas.js'
import { requireActor } from '../_lib/auth.js'
import { handle, HttpError, json, readBody } from '../_lib/http.js'
import { chatWritable, loadMatchFor, partnerUserId, toMatchDto, type MatchRow } from '../_lib/matches.js'
import { notify } from '../_lib/notify.js'
import { toProposalDto } from '../_lib/proposals.js'
import { getPrisma } from '../_lib/prisma.js'
import { completedAtMs, isPublished, toReviewDto } from '../_lib/reviews.js'
import { requireAllowed } from '../_lib/throttle.js'

const MAX_MESSAGES = 300

/**
 * 相手の電話番号を見せてよいか。相手本人が「取引相手に見せる」ことに同意していて、
 * その範囲（マッチング成立後だけ／相談中から）に今の状態が入っている場合だけ見せる。
 */
async function partnerPhone(row: MatchRow, viewer: 'RESTAURANT' | 'PRODUCER'): Promise<{ phone: string | null; note: string }> {
  const partner = await getPrisma().user.findUnique({ where: { id: partnerUserId(row, viewer) }, select: { phone: true, phoneShare: true } })
  if (!partner?.phone) return { phone: null, note: '相手は電話番号を登録していません。メッセージで連絡してください。' }
  if (partner.phoneShare === 'NONE') return { phone: null, note: '相手は電話番号を取引相手に表示しない設定にしています。メッセージで連絡してください。' }
  const matched = row.status === 'ACCEPTED' || row.status === 'AGREED' || row.status === 'COMPLETED'
  if (row.status === 'PENDING' && partner.phoneShare === 'MATCHED') return { phone: null, note: '相手の電話番号は、マッチング成立（承認）後に表示されます。' }
  if (!matched && row.status !== 'PENDING') return { phone: null, note: 'この取引は終了しているため、電話番号は表示しません。' }
  return { phone: formatPhone(partner.phone), note: '' }
}

// メッセージの一覧（/api/chat?matchId=...）。開いた人の「最後に読んだ日時」を更新する
export const GET = handle(async (request) => {
  const actor = await requireActor(request)
  const { row, viewer } = await loadMatchFor(actor, new URL(request.url).searchParams.get('matchId'))
  const prisma = getPrisma()
  const [rows, proposals, reviews] = await Promise.all([
    prisma.chatMessage.findMany({ where: { matchId: row.id }, orderBy: { createdAt: 'desc' }, take: MAX_MESSAGES }),
    prisma.termsProposal.findMany({ where: { matchId: row.id } }),
    prisma.review.findMany({ where: { matchId: row.id }, include: { match: { include: { restaurant: true, producer: true } } } }),
  ])
  if (viewer !== 'ADMIN') {
    await prisma.matchRequest.update({ where: { id: row.id }, data: viewer === 'RESTAURANT' ? { restaurantReadAt: new Date() } : { producerReadAt: new Date() } })
    // このチャットの新着メッセージの通知は、開いた時点で既読にする
    await prisma.notification.updateMany({ where: { userId: actor.user.id, matchId: row.id, kind: 'NEW_MESSAGE', readAt: null }, data: { readAt: new Date() } })
  }
  const { row: fresh } = await loadMatchFor(actor, row.id)
  const byId = new Map(proposals.map((p) => [p.id, toProposalDto(p)]))
  const messages: ChatMessageDto[] = rows.reverse().map((m) => ({
    id: m.id,
    clientId: m.clientId,
    body: m.body,
    createdAtMs: m.createdAt.getTime(),
    senderRole: m.senderRole,
    mine: m.senderRole === viewer,
    kind: m.kind,
    proposal: m.proposalId ? (byId.get(m.proposalId) ?? null) : null,
  }))
  // レビュー：自分の投稿は自分に見える。相手の投稿は、公開の条件（双方が投稿・一定期間の経過）を満たしたときだけ
  const mine = viewer === 'ADMIN' ? null : reviews.find((r) => r.reviewerRole === viewer)
  const theirs = viewer === 'ADMIN' ? null : reviews.find((r) => r.reviewerRole !== viewer)
  const doneAt = completedAtMs(fresh)
  const phone = viewer === 'ADMIN' ? { phone: null, note: '' } : await partnerPhone(fresh, viewer)
  const response: ChatResponse = {
    match: await toMatchDto(fresh, viewer),
    messages,
    partnerPhone: phone.phone,
    phoneNote: phone.note,
    reviews: {
      mine: mine ? toReviewDto(mine) : null,
      partner: theirs && isPublished(theirs, Boolean(mine), doneAt) ? toReviewDto(theirs) : null,
      partnerSubmitted: Boolean(theirs),
    },
  }
  return json(response)
})

// メッセージを送る（当事者だけ）。同じ clientId の再送は、1件として扱う
export const POST = handle(async (request) => {
  const actor = await requireActor(request)
  const body = await readBody(request, chatSendSchema)
  const { row, viewer } = await loadMatchFor(actor, body.matchId)
  if (viewer === 'ADMIN') throw new HttpError(403, 'FORBIDDEN', '運営者はメッセージを送れません（閲覧のみ）。')
  if (!chatWritable(row.status)) throw new HttpError(403, 'CLOSED', 'この取引は辞退・取り下げで終了したため、メッセージは送れません。')
  await requireAllowed('chat-send', actor.user.id, 60, 10 * 60)
  const prisma = getPrisma()
  const before = await prisma.chatMessage.findUnique({ where: { matchId_clientId: { matchId: row.id, clientId: body.clientId } } })
  const message =
    before ??
    (await prisma.chatMessage.create({ data: { matchId: row.id, senderUserId: actor.user.id, senderRole: viewer, body: body.body, clientId: body.clientId } }))
  // 送った人は、そのメッセージまで読んだことにする
  await prisma.matchRequest.update({ where: { id: row.id }, data: viewer === 'RESTAURANT' ? { restaurantReadAt: new Date() } : { producerReadAt: new Date() } })
  if (!before) {
    const myName = viewer === 'RESTAURANT' ? row.restaurant.name : row.producer.farmName
    await notify(partnerUserId(row, viewer), 'NEW_MESSAGE', `${myName}から新しいメッセージ`, body.body, `/matches/${row.id}`, row.id)
  }
  const dto: ChatMessageDto = {
    id: message.id,
    clientId: message.clientId,
    body: message.body,
    createdAtMs: message.createdAt.getTime(),
    senderRole: message.senderRole,
    mine: true,
    kind: 'TEXT',
    proposal: null,
  }
  return json({ message: dto }, 201)
})
