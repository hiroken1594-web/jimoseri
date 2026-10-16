// 飲食店向けの「地図・一覧・スワイプ」用の検索と、出品の詳細。
// 出すのは、承認済みの生産者・確認済みで地図への公開を許可された拠点・公開中で在庫があり期限内の出品だけ。
// 距離は直線距離（Haversine）。地図上で近いことを理由に、仕入れ案の受渡条件が成立するとは判定しない。
// 検索の中心（現在地など）は計算に使うだけで、DB にもログにも残さない。
import { toMilli } from '../../shared/allocate.js'
import type { ListingDetail, MarketDiagnostics, MarketListing, MarketLocation, MarketSearchResponse, PublicContact } from '../../shared/dto.js'
import { distanceKm, withinRadius } from '../../shared/geo.js'
import { marketSearchSchema, type MarketSearchInput } from '../../shared/schemas.js'
import type { Prisma } from '../../generated/prisma/client.js'
import { requireActor } from '../_lib/auth.js'
import { handle, HttpError, json, readBody } from '../_lib/http.js'
import { getPrisma } from '../_lib/prisma.js'
import { requireAllowed } from '../_lib/throttle.js'

/** 地図・一覧に出してよい出品の条件（仕入れ案と同じ審査条件＋地図への公開） */
export function marketWhere(nowMs: number, demo = false): Prisma.ListingWhereInput {
  return {
    isPublished: true,
    adminSuspended: false,
    // デモモードのときはデモデータだけ、通常は実際のデータだけ（混ぜない）
    isDemo: demo,
    quantity: { gt: 0 },
    pickupEnd: { gt: new Date(nowMs) },
    producer: { approvalStatus: 'APPROVED', isDemo: demo, user: { suspended: false } },
    pickupLocation: { status: 'APPROVED', isDemo: demo, showOnMap: true, latitude: { not: null }, longitude: { not: null } },
  }
}

/**
 * 0件のときに「どの条件で絞り込まれたか」を示すための件数。
 * 公開中の出品から順に条件を足していき、各段階で何件残るかを数える（検索条件そのものは変えない）。
 */
async function diagnose(body: MarketSearchInput, nowMs: number, outsideListings: number): Promise<MarketDiagnostics> {
  const prisma = getPrisma()
  const demo = body.demo ?? false
  const base: Prisma.ListingWhereInput = { isPublished: true, adminSuspended: false, isDemo: demo, quantity: { gt: 0 }, pickupEnd: { gt: new Date(nowMs) } }
  const approved: Prisma.ListingWhereInput = { ...base, producer: { approvalStatus: 'APPROVED', isDemo: demo, user: { suspended: false } } }
  const located: Prisma.ListingWhereInput = { ...approved, pickupLocation: { status: 'APPROVED', isDemo: demo } }
  const onMap = marketWhere(nowMs, demo)
  const filtered = applyFilters({ ...onMap }, body)
  const [a, b, c, d, e] = await Promise.all([base, approved, located, onMap, filtered].map((where) => prisma.listing.count({ where })))
  const stages = [
    { label: '公開中・在庫あり・受渡日時が過ぎていない出品', count: a },
    { label: '＋生産者が運営者の承認済み', count: b },
    { label: '＋受渡拠点が運営者の確認済み', count: c },
    { label: '＋受渡拠点が地図に公開され、位置が登録済み', count: d },
    { label: '＋品目・単価・在庫・規格外品・エリアの絞り込み', count: e },
  ]
  if (body.center && body.radiusKm !== null) stages.push({ label: `＋検索範囲（${body.radiusKm}km以内）`, count: Math.max(0, e - outsideListings) })
  // 通常の検索で0件のとき、デモモードなら試せるかどうかも伝える
  const demoAvailable = demo ? 0 : await prisma.listing.count({ where: marketWhere(nowMs, true) })
  return { stages, demoAvailable }
}

function applyFilters(where: Prisma.ListingWhereInput, body: MarketSearchInput): Prisma.ListingWhereInput {
  if (body.itemId) where.itemId = body.itemId
  if (body.maxPriceYen) where.unitPriceTaxIncl = { lte: body.maxPriceYen }
  if (body.minQuantity) where.quantity = { gte: body.minQuantity }
  if (body.irregular === 'exclude') where.grade = 'REGULAR'
  if (body.irregular === 'only') where.grade = 'IRREGULAR'
  if (body.municipality) where.pickupLocation = { ...(where.pickupLocation as object), municipality: body.municipality }
  return where
}

const include = { item: true, producer: true, pickupLocation: true } satisfies Prisma.ListingInclude
type Row = Prisma.ListingGetPayload<{ include: typeof include }>

function toMarketListing(row: Row, favorites: Set<string>): MarketListing {
  return {
    id: row.id,
    itemId: row.itemId,
    itemName: row.item.name,
    variety: row.variety,
    grade: row.grade,
    irregularReason: row.irregularReason,
    quantityMilli: toMilli(Number(row.quantity)),
    unit: row.unit,
    unitPriceYen: row.unitPriceTaxIncl,
    minMilli: toMilli(Number(row.minQuantity)),
    stepMilli: toMilli(Number(row.stepQuantity)),
    pickupStartMs: row.pickupStart.getTime(),
    pickupEndMs: row.pickupEnd.getTime(),
    producerId: row.producerId,
    producerName: row.producer.farmName,
    updatedAtMs: row.updatedAt.getTime(),
    isFavorite: favorites.has(row.id),
    isDemo: row.isDemo,
  }
}

async function favoriteIds(restaurantId: string): Promise<Set<string>> {
  const rows = await getPrisma().favorite.findMany({ where: { restaurantId }, select: { listingId: true } })
  return new Set(rows.map((r) => r.listingId))
}

// 検索（POST にするのは、検索の中心の位置を URL＝アクセスログに残さないため）
export const POST = handle(async (request) => {
  const actor = await requireActor(request, 'RESTAURANT')
  const body = await readBody(request, marketSearchSchema)
  await requireAllowed('market-search', actor.user.id, 300, 60 * 60)
  if (body.radiusKm !== null && !body.center) {
    throw new HttpError(400, 'VALIDATION', '距離で絞り込むには、検索の中心（現在地・地図・地名）を指定してください。')
  }
  const nowMs = Date.now()
  const where = applyFilters({ ...marketWhere(nowMs, body.demo ?? false) }, body)

  const rows = await getPrisma().listing.findMany({ where, include, orderBy: { unitPriceTaxIncl: 'asc' }, take: 3000 })
  const favorites = await favoriteIds(actor.restaurantId!)

  const byLocation = new Map<string, MarketLocation>()
  let outside = new Set<string>()
  for (const row of rows) {
    const loc = row.pickupLocation
    const point = { lat: loc.latitude!, lng: loc.longitude! }
    // 距離と公開範囲はサーバー側で判定する（画面の表示だけに頼らない）
    if (body.center && !withinRadius(body.center, point, body.radiusKm)) {
      outside.add(loc.id)
      continue
    }
    let entry = byLocation.get(loc.id)
    if (!entry) {
      entry = {
        id: loc.id,
        name: loc.name,
        municipality: loc.municipality,
        address: loc.address,
        note: loc.note,
        hours: loc.hours,
        latitude: point.lat,
        longitude: point.lng,
        isDemo: loc.isDemo,
        distanceKm: body.center ? Math.round(distanceKm(body.center, point) * 100) / 100 : null,
        listings: [],
      }
      byLocation.set(loc.id, entry)
    }
    entry.listings.push(toMarketListing(row, favorites))
  }
  outside = new Set([...outside].filter((id) => !byLocation.has(id)))
  const locations = [...byLocation.values()].sort(
    (a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0) || a.name.localeCompare(b.name, 'ja'),
  )
  const response: MarketSearchResponse = {
    locations,
    outsideCount: outside.size,
    searchedAtMs: nowMs,
    demo: body.demo ?? false,
    diagnostics: locations.length === 0 ? await diagnose(body, nowMs, rows.length) : null,
  }
  return json(response)
})

// 出品の詳細（/api/market?id=...）。地図・一覧に出せない出品は「見つからない」として扱う。
export const GET = handle(async (request) => {
  const actor = await requireActor(request, 'RESTAURANT')
  const url = new URL(request.url)
  const id = url.searchParams.get('id')
  if (!id) throw new HttpError(400, 'BAD_REQUEST', '出品が指定されていません。')
  // デモの出品は、デモモードから開いた場合（demo=1）だけ表示する
  const demo = url.searchParams.get('demo') === '1'
  const nowMs = Date.now()
  // 詳細は、地図に出していない拠点の出品（仕入れ案には出るもの）も見られるようにする。位置は公開を許可した場合だけ返す。
  const row = await getPrisma().listing.findFirst({
    where: {
      id,
      isPublished: true,
      adminSuspended: false,
      isDemo: demo,
      quantity: { gt: 0 },
      pickupEnd: { gt: new Date(nowMs) },
      producer: { approvalStatus: 'APPROVED', isDemo: demo, user: { suspended: false } },
      pickupLocation: { status: 'APPROVED', isDemo: demo },
    },
    include,
  })
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'この出品は現在表示できません。公開が止められたか、受渡日を過ぎた可能性があります。')
  const p = row.producer
  const contact: PublicContact = {}
  if (p.showPhone && p.publicPhone) contact.phone = p.publicPhone
  if (p.showEmail && p.publicEmail) contact.email = p.publicEmail
  if ((contact.phone || contact.email) && p.contactNote) contact.note = p.contactNote
  const loc = row.pickupLocation
  const detail: ListingDetail = {
    ...toMarketListing(row, await favoriteIds(actor.restaurantId!)),
    producerArea: p.area,
    contact: contact.phone || contact.email ? contact : null,
    location: {
      id: loc.id,
      name: loc.name,
      municipality: loc.municipality,
      address: loc.address,
      note: loc.note,
      hours: loc.hours,
      latitude: loc.showOnMap ? loc.latitude : null,
      longitude: loc.showOnMap ? loc.longitude : null,
    },
  }
  return json({ listing: detail })
})
