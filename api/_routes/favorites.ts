// 飲食店の「気になる」（お気に入り）。保存しても注文・予約・在庫の確保にはならず、生産者への通知もしない。
import { toMilli } from '../../shared/allocate.js'
import type { FavoriteItem } from '../../shared/dto.js'
import { favoriteSchema } from '../../shared/schemas.js'
import { requireActor } from '../_lib/auth.js'
import { handle, HttpError, json, readBody } from '../_lib/http.js'
import { getPrisma } from '../_lib/prisma.js'
import { requireAllowed } from '../_lib/throttle.js'

/** 飲食店に見せてよい出品か（地図に出していない拠点の出品も含む。仕入れ案と同じ審査条件） */
function visible(row: {
  isPublished: boolean
  adminSuspended: boolean
  isDemo: boolean
  quantity: unknown
  pickupEnd: Date
  producer: { approvalStatus: string; isDemo: boolean; user: { suspended: boolean } }
  pickupLocation: { status: string; isDemo: boolean }
}): boolean {
  return (
    row.isPublished &&
    !row.adminSuspended &&
    !row.isDemo &&
    Number(row.quantity) > 0 &&
    row.pickupEnd.getTime() > Date.now() &&
    row.producer.approvalStatus === 'APPROVED' &&
    !row.producer.isDemo &&
    !row.producer.user.suspended &&
    row.pickupLocation.status === 'APPROVED' &&
    !row.pickupLocation.isDemo
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
  const favorites: FavoriteItem[] = rows.map((f) => {
    const l = f.listing
    const ok = visible(l)
    return {
      listingId: l.id,
      savedAtMs: f.createdAt.getTime(),
      itemName: l.item.name,
      producerName: l.producer.farmName,
      available: ok,
      locationName: ok ? l.pickupLocation.name : null,
      listing: ok
        ? {
            id: l.id,
            itemId: l.itemId,
            itemName: l.item.name,
            variety: l.variety,
            grade: l.grade,
            irregularReason: l.irregularReason,
            quantityMilli: toMilli(Number(l.quantity)),
            unit: l.unit,
            unitPriceYen: l.unitPriceTaxIncl,
            minMilli: toMilli(Number(l.minQuantity)),
            stepMilli: toMilli(Number(l.stepQuantity)),
            pickupStartMs: l.pickupStart.getTime(),
            pickupEndMs: l.pickupEnd.getTime(),
            producerId: l.producerId,
            producerName: l.producer.farmName,
            updatedAtMs: l.updatedAt.getTime(),
            isFavorite: true,
          }
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
    include: { producer: { include: { user: true } }, pickupLocation: true },
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
