// マッチング（依頼）とチャットの共通処理：見てよい人の判定と、画面に返す形への変換
import { toMilli } from '../../shared/allocate.js'
import type { MatchDto } from '../../shared/dto.js'
import type { Prisma } from '../../generated/prisma/client.js'
import type { Actor } from './auth.js'
import { HttpError } from './http.js'
import { getPrisma } from './prisma.js'
import { ratingSummary } from './reviews.js'

export const matchInclude = { restaurant: true, producer: true } satisfies Prisma.MatchRequestInclude
export type MatchRow = Prisma.MatchRequestGetPayload<{ include: typeof matchInclude }>

/** その依頼の当事者としての立場。当事者でなければ null（運営者は ADMIN として閲覧だけできる） */
export function viewerOf(actor: Actor, row: { restaurantId: string; producerId: string }): MatchDto['viewer'] | null {
  if (actor.restaurantId && actor.restaurantId === row.restaurantId) return 'RESTAURANT'
  if (actor.producerId && actor.producerId === row.producerId) return 'PRODUCER'
  if (actor.user.role === 'ADMIN') return 'ADMIN'
  return null
}

/**
 * 依頼を1件読み、見てよい人かを確かめる。
 * 他人の依頼は「存在しない」ものとして扱う（ID を推測しても中身が分からないように）。
 */
export async function loadMatchFor(actor: Actor, id: string | null): Promise<{ row: MatchRow; viewer: MatchDto['viewer'] }> {
  if (!id) throw new HttpError(400, 'BAD_REQUEST', '依頼が指定されていません。')
  const row = await getPrisma().matchRequest.findUnique({ where: { id }, include: matchInclude })
  const viewer = row ? viewerOf(actor, row) : null
  if (!row || !viewer) throw new HttpError(404, 'NOT_FOUND', 'この依頼は見つかりません。')
  return { row, viewer }
}

/** 相手からの未読の数と、最後のメッセージ */
async function chatSummary(row: MatchRow, viewer: MatchDto['viewer']) {
  const prisma = getPrisma()
  const readAt = viewer === 'RESTAURANT' ? row.restaurantReadAt : viewer === 'PRODUCER' ? row.producerReadAt : new Date()
  const otherRole = viewer === 'RESTAURANT' ? 'PRODUCER' : 'RESTAURANT'
  const [unread, last] = await Promise.all([
    viewer === 'ADMIN'
      ? Promise.resolve(0)
      : prisma.chatMessage.count({ where: { matchId: row.id, senderRole: otherRole, kind: { in: ['TEXT', 'PROPOSAL'] }, ...(readAt ? { createdAt: { gt: readAt } } : {}) } }),
    prisma.chatMessage.findFirst({ where: { matchId: row.id }, orderBy: { createdAt: 'desc' } }),
  ])
  return {
    unread,
    lastMessage: last ? { body: last.body.slice(0, 80), atMs: last.createdAt.getTime(), mine: last.senderRole === viewer } : null,
  }
}

export async function toMatchDto(row: MatchRow, viewer: MatchDto['viewer']): Promise<MatchDto> {
  return {
    id: row.id,
    status: row.status,
    createdAtMs: row.createdAt.getTime(),
    respondedAtMs: row.respondedAt?.getTime() ?? null,
    listingId: row.listingId,
    itemName: row.itemName,
    variety: row.variety,
    quantityMilli: toMilli(Number(row.quantity)),
    unit: row.unit,
    unitPriceYen: row.unitPriceTaxIncl,
    pickupStartMs: row.pickupStart.getTime(),
    pickupEndMs: row.pickupEnd.getTime(),
    locationName: row.locationName,
    message: row.message,
    declineReason: row.declineReason,
    restaurantName: row.restaurant.name,
    producerName: row.producer.farmName,
    groupId: row.groupId,
    isDemo: row.isDemo,
    viewer,
    initiator: row.initiator === 'PRODUCER' ? 'PRODUCER' : 'RESTAURANT',
    deliveryMethod: row.deliveryMethod,
    deliveryPlace: row.deliveryPlace || row.locationName,
    shippingFeeYen: row.shippingFeeYen,
    shippingPayer: row.shippingPayer,
    termsNote: row.termsNote,
    agreed: { restaurant: Boolean(row.restaurantAgreedAt), producer: Boolean(row.producerAgreedAt) },
    completed: { restaurant: Boolean(row.restaurantCompletedAt), producer: Boolean(row.producerCompletedAt) },
    // 相手の評価（運営者には出さない）
    partnerRating:
      viewer === 'RESTAURANT' ? await ratingSummary('PRODUCER', row.producerId) : viewer === 'PRODUCER' ? await ratingSummary('RESTAURANT', row.restaurantId) : null,
    ...(await chatSummary(row, viewer)),
  }
}

/** 提案を受けた側（返事をする側） */
export const responderOf = (row: { initiator: string }): 'RESTAURANT' | 'PRODUCER' => (row.initiator === 'PRODUCER' ? 'RESTAURANT' : 'PRODUCER')

/** 取引相手の利用者 ID（通知の宛先） */
export function partnerUserId(row: MatchRow, viewer: 'RESTAURANT' | 'PRODUCER'): string {
  return viewer === 'RESTAURANT' ? row.producer.userId : row.restaurant.userId
}

/** チャットを開けるか（辞退・取り下げの後は読むだけ） */
export const chatWritable = (status: string) => status === 'PENDING' || status === 'ACCEPTED' || status === 'AGREED' || status === 'COMPLETED'
