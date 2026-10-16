// 飲食店の「気になる」（お気に入り）。保存しても注文・予約・在庫の確保にはならず、生産者への通知もしない。
import type { FavoriteItem } from '../../shared/dto.js'
import { favoriteSchema } from '../../shared/schemas.js'
import { requireActor } from '../_lib/auth.js'
import { handle, HttpError, json, readBody } from '../_lib/http.js'
import { stillAvailable, toMarketListing, type MarketRow } from '../_lib/market-listing.js'
import { getPrisma } from '../_lib/prisma.js'
import { requireAllowed } from '../_lib/throttle.js'

/** 飲食店に見せてよい出品か（地図に出していない拠点の出品も含む。仕入れ案と同じ審査条件） */
function visible(row: MarketRow & {
  isPublished: boolean
  adminSuspended: boolean
  producer: { approvalStatus: string; isDemo: boolean; user: { suspended: boolean } }
  pickupLocation: { status: string; isDemo: boolean }
}): boolean {
  return (
    row.isPublished &&
    !row.adminSuspended &&
    // デモの出品（デモモードで保存したもの）も、デモの生産者・拠点の組み合わせなら表示する
    row.isDemo === row.producer.isDemo &&
    row.isDemo === row.pickupLocation.isDemo &&
    Number(row.quantity) > 0 &&
    stillAvailable(row, Date.now()) &&
    row.producer.approvalStatus === 'APPROVED' &&
    !row.producer.user.suspended &&
    row.pickupLocation.status === 'APPROVED'
  )
}

// 保存した一覧。開くたびに最新の在庫・価格を表示する。掲載が止まったものは「掲載されていません」とだけ示す。
export const GET = handle(async (request) => {
  const actor = await requireActor(request, 'RESTAURANT')
  const rows = await getPrisma().favorite.findMany({
    where: { restaurantId: actor.restaurantId! },
    include: { listing: { include: { item: true, producer: { include: { user: true } }, pickupLocation: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  const nowMs = Date.now()
  const favorites: FavoriteItem[] = rows.map((f) => {
    const l = f.listing
    const ok = visible(l)
    return {
      listingId: l.id,
      savedAtMs: f.createdAt.getTime(),
      itemName: l.item.name,
      producerName: l.producer.farmName,
      available: ok,
      isDemo: l.isDemo,
      locationName: ok ? l.pickupLocation.name : null,
      listing: ok
        ? toMarketListing(l, new Set([l.id]), nowMs)
        : null,
    }
  })
  return json({ favorites })
})

// 保存（掲載中の出品だけ）
export const POST = handle(async (request) => {
  const actor = await requireActor(request, 'RESTAURANT')
  const body = await readBody(request, favoriteSchema)
  await requireAllowed('favorite-add', actor.user.id, 300, 24 * 60 * 60)
  const prisma = getPrisma()
  const listing = await prisma.listing.findUnique({
    where: { id: body.listingId },
    include: { item: true, producer: { include: { user: true } }, pickupLocation: true },
  })
  if (!listing || !visible(listing)) throw new HttpError(404, 'NOT_FOUND', 'この出品は現在保存できません。公開が止められたか、受渡日を過ぎた可能性があります。')
  await prisma.favorite.upsert({
    where: { restaurantId_listingId: { restaurantId: actor.restaurantId!, listingId: listing.id } },
    update: {},
    create: { restaurantId: actor.restaurantId!, listingId: listing.id },
  })
  return json({ ok: true }, 201)
})

// 保存の解除（/api/favorites?listingId=...）。自分の保存だけを消す。
export const DELETE = handle(async (request) => {
  const actor = await requireActor(request, 'RESTAURANT')
  const listingId = new URL(request.url).searchParams.get('listingId')
  if (!listingId) throw new HttpError(400, 'BAD_REQUEST', '出品が指定されていません。')
  await getPrisma().favorite.deleteMany({ where: { restaurantId: actor.restaurantId!, listingId } })
  return json({ ok: true })
})
