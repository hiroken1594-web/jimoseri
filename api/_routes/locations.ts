import { formatZip, normalizeZip } from '../../shared/geo.js'
import { locationCreateSchema, type LocationCreateInput } from '../../shared/schemas.js'
import { requireActor } from '../_lib/auth.js'
import { handle, HttpError, json, readBody } from '../_lib/http.js'
import { toLocationDto } from '../_lib/places.js'
import { getPrisma } from '../_lib/prisma.js'
import { requireAllowed } from '../_lib/throttle.js'

const MAX_PENDING_PER_PRODUCER = 5

function toData(body: LocationCreateInput) {
  const zip = body.postalCode ? normalizeZip(body.postalCode) : null
  return {
    name: body.name,
    municipality: body.municipality,
    address: body.address,
    note: body.note,
    postalCode: zip ? formatZip(zip) : null,
    prefecture: body.prefecture || null,
    town: body.town || null,
    latitude: body.latitude ?? null,
    longitude: body.longitude ?? null,
    showOnMap: body.showOnMap ?? false,
    hours: body.hours ?? '',
  }
}

/** 自分が登録した拠点だけを取り出す。他の生産者の拠点は「存在しない」ものとして扱う。 */
async function findOwn(request: Request, producerId: string) {
  const id = new URL(request.url).searchParams.get('id')
  if (!id) throw new HttpError(400, 'BAD_REQUEST', '受渡場所が指定されていません。')
  const row = await getPrisma().pickupLocation.findFirst({ where: { id, createdById: producerId } })
  if (!row) throw new HttpError(404, 'NOT_FOUND', '受渡場所が見つかりません。一覧を読み込み直してください。')
  return row
}

// 自分が登録した受渡拠点の一覧（位置・郵便番号を含む。本人にだけ返す）
export const GET = handle(async (request) => {
  const actor = await requireActor(request, 'PRODUCER')
  const rows = await getPrisma().pickupLocation.findMany({
    where: { createdById: actor.producerId! },
    include: { _count: { select: { listings: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return json({ locations: rows.map((r) => toLocationDto(r, actor.producerId, r._count.listings)) })
})

// 生産者が受渡場所を新しく登録する。運営者が確認するまでは「確認待ち」で、仕入れ案・地図には使われない。
export const POST = handle(async (request) => {
  const actor = await requireActor(request, 'PRODUCER')
  const body = await readBody(request, locationCreateSchema)
  const prisma = getPrisma()
  await requireAllowed('location-create', actor.user.id, 20, 24 * 60 * 60)

  const pending = await prisma.pickupLocation.count({ where: { createdById: actor.producerId!, status: 'PENDING' } })
  if (pending >= MAX_PENDING_PER_PRODUCER) {
    throw new HttpError(400, 'TOO_MANY', '確認待ちの受渡場所が多すぎます。運営者の確認をお待ちください。')
  }
  const row = await prisma.pickupLocation.create({
    data: { ...toData(body), createdById: actor.producerId!, isDemo: actor.user.producer?.isDemo ?? false },
  })
  return json({ location: toLocationDto(row, actor.producerId, 0) }, 201)
})

// 自分の受渡場所の編集。名称・住所・位置を変えた場合は、運営者の確認を受け直す（確認待ちに戻す）。
export const PUT = handle(async (request) => {
  const actor = await requireActor(request, 'PRODUCER')
  const existing = await findOwn(request, actor.producerId!)
  const body = await readBody(request, locationCreateSchema)
  const prisma = getPrisma()
  const data = toData(body)

  const moved =
    data.name !== existing.name ||
    data.municipality !== existing.municipality ||
    data.address !== existing.address ||
    data.latitude !== existing.latitude ||
    data.longitude !== existing.longitude ||
    (data.showOnMap && !existing.showOnMap)
  if (moved) {
    // 他の生産者もこの場所を使っている場合、勝手に場所を変えると相手の出品の受渡場所まで変わってしまう
    const othersUsing = await prisma.listing.count({ where: { pickupLocationId: existing.id, producerId: { not: actor.producerId! } } })
    if (othersUsing > 0) {
      throw new HttpError(400, 'IN_USE', 'この受渡場所は他の生産者も使っているため、名称・住所・位置は変更できません。新しい受渡場所として登録してください。')
    }
  }
  const row = await prisma.pickupLocation.update({
    where: { id: existing.id },
    // 停止中の場所は、編集しても停止のまま（運営者が解除する）
    data: { ...data, status: moved && existing.status === 'APPROVED' ? 'PENDING' : existing.status },
  })
  const count = await prisma.listing.count({ where: { pickupLocationId: row.id } })
  return json({ location: toLocationDto(row, actor.producerId, count), reviewAgain: moved && existing.status === 'APPROVED' })
})

// 自分の受渡場所の削除（出品に使われていない場合だけ）
export const DELETE = handle(async (request) => {
  const actor = await requireActor(request, 'PRODUCER')
  const existing = await findOwn(request, actor.producerId!)
  const prisma = getPrisma()
  const used = await prisma.listing.count({ where: { pickupLocationId: existing.id } })
  if (used > 0) throw new HttpError(400, 'IN_USE', `この受渡場所は出品${used}件で使われているため削除できません。先に出品の受渡場所を変えるか、出品を削除してください。`)
  await prisma.pickupLocation.delete({ where: { id: existing.id } })
  return json({ ok: true })
})
