// 飲食店向けの「地図・一覧・スワイプ」用の検索と、出品の詳細。
// 出すのは、承認済みの生産者・確認済みで地図への公開を許可された拠点・公開中で在庫があり、これから受け取れる回がある出品だけ。
// 受取エリア（都道府県。市区町村は任意）は必須。距離は直線距離（Haversine）。
// 地図上で近いことを理由に、仕入れ案の受渡条件が成立するとは判定しない。
// 検索の中心（現在地など）は計算に使うだけで、DB にもログにも残さない。
import type { ListingDetail, MarketDiagnostics, MarketLocation, MarketSearchResponse, MarketStageKey, MarketWider, PublicContact } from '../../shared/dto.js'
import { distanceKm, RADIUS_OPTIONS, withinRadius } from '../../shared/geo.js'
import { availableOn } from '../../shared/schedule.js'
import { marketSearchSchema, type MarketSearchInput } from '../../shared/schemas.js'
import type { Prisma } from '../../generated/prisma/client.js'
import { requireActor } from '../_lib/auth.js'
import { handle, HttpError, json, readBody } from '../_lib/http.js'
import { stillAvailable, toMarketListing, windowOf } from '../_lib/market-listing.js'
import { getPrisma } from '../_lib/prisma.js'
import { requireAllowed } from '../_lib/throttle.js'

const include = { item: true, producer: { include: { user: true } }, pickupLocation: true } satisfies Prisma.ListingInclude
type Row = Prisma.ListingGetPayload<{ include: typeof include }>

/** 検索の土台：公開中・在庫あり・最後の回が過ぎていない出品（デモと実データは混ぜない） */
const baseWhere = (nowMs: number, demo: boolean): Prisma.ListingWhereInput => ({
  isPublished: true,
  adminSuspended: false,
  isDemo: demo,
  quantity: { gt: 0 },
  pickupEnd: { gt: new Date(nowMs) },
})

const point = (row: Row) => ({ lat: row.pickupLocation.latitude!, lng: row.pickupLocation.longitude! })

/**
 * 検索の条件を、上から順に1つずつ当てはめる。各段階で残った件数は「0件の理由」の表示に使う。
 * 地図・一覧の結果は、最後の段階まで残った出品そのもの（同じ判定を2か所に書かない）。
 */
function runStages(rows: Row[], body: MarketSearchInput, nowMs: number) {
  const demo = body.demo ?? false
  const steps: { key: MarketStageKey; label: string; keep: (r: Row) => boolean }[] = [
    { key: 'PUBLISHED', label: '公開中・在庫あり・これから受け取れる出品', keep: (r) => stillAvailable(r, nowMs) },
    { key: 'PRODUCER', label: '＋生産者が運営者の承認済み', keep: (r) => r.producer.approvalStatus === 'APPROVED' && r.producer.isDemo === demo && !r.producer.user.suspended },
    { key: 'LOCATION', label: '＋受渡拠点が運営者の確認済み', keep: (r) => r.pickupLocation.status === 'APPROVED' && r.pickupLocation.isDemo === demo },
    {
      key: 'MAP',
      label: '＋受渡拠点が地図に公開され、位置が登録済み',
      keep: (r) => r.pickupLocation.showOnMap && r.pickupLocation.latitude !== null && r.pickupLocation.longitude !== null,
    },
    {
      key: 'AREA',
      label: `＋受取エリア（${body.prefecture}${body.municipality ? ` ${body.municipality}` : ''}）`,
      keep: (r) => r.pickupLocation.prefecture === body.prefecture && (!body.municipality || r.pickupLocation.municipality === body.municipality),
    },
    {
      key: 'FILTER',
      label: '＋品目・単価・在庫・規格外品の絞り込み',
      keep: (r) =>
        (!body.itemId || r.itemId === body.itemId) &&
        (!body.maxPriceYen || r.unitPriceTaxIncl <= body.maxPriceYen) &&
        (!body.minQuantity || Number(r.quantity) >= body.minQuantity) &&
        (body.irregular !== 'exclude' || r.grade === 'REGULAR') &&
        (body.irregular !== 'only' || r.grade === 'IRREGULAR'),
    },
  ]
  if (body.date) {
    const date = body.date
    steps.push({ key: 'DATE', label: `＋受け取りたい日（${date.slice(5).replace('-', '/')}）に受け取れる`, keep: (r) => availableOn(windowOf(r), date, nowMs) })
  }
  if (body.center && body.radiusKm !== null) {
    const center = body.center
    const radius = body.radiusKm
    steps.push({ key: 'RADIUS', label: `＋検索範囲（${radius}km以内）`, keep: (r) => withinRadius(center, point(r), radius) })
  }
  let left = rows
  const stages: MarketDiagnostics['stages'] = []
  for (const step of steps) {
    left = left.filter(step.keep)
    stages.push({ key: step.key, label: step.label, count: left.length })
  }
  return { stages, rows: left }
}

const loadRows = (nowMs: number, demo: boolean) =>
  getPrisma().listing.findMany({ where: baseWhere(nowMs, demo), include, orderBy: { unitPriceTaxIncl: 'asc' }, take: 5000 })

/** 0件のとき、条件を少し広げた場合に見つかる件数（参考。元の条件には一致しない） */
function widerOptions(rows: Row[], body: MarketSearchInput, nowMs: number): MarketWider[] {
  const out: MarketWider[] = []
  const count = (patch: Partial<MarketSearchInput>) => runStages(rows, { ...body, ...patch }, nowMs).rows.length
  if (body.center && body.radiusKm !== null) {
    const next = RADIUS_OPTIONS.find((r) => r !== null && r > body.radiusKm!) ?? null
    if (next !== null) out.push({ key: 'RADIUS', label: `検索範囲を${next}kmに広げる`, count: count({ radiusKm: next as MarketSearchInput['radiusKm'] }), patch: { radiusKm: next } })
    out.push({ key: 'NO_RADIUS', label: '距離で絞り込まない（受取エリア内すべて）', count: count({ radiusKm: null }), patch: { radiusKm: null } })
  }
  if (body.date) out.push({ key: 'DATE', label: '受け取りたい日を指定しない', count: count({ date: null }), patch: { date: null } })
  if (body.municipality) out.push({ key: 'MUNICIPALITY', label: `市区町村を指定しない（${body.prefecture}全体）`, count: count({ municipality: null }), patch: { municipality: null } })
  return out.filter((w) => w.count > 0)
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
  const demo = body.demo ?? false
  const all = await loadRows(nowMs, demo)
  const { stages, rows } = runStages(all, body, nowMs)
  const favorites = await favoriteIds(actor.restaurantId!)

  const byLocation = new Map<string, MarketLocation>()
  for (const row of rows) {
    const loc = row.pickupLocation
    let entry = byLocation.get(loc.id)
    if (!entry) {
      const p = point(row)
      entry = {
        id: loc.id,
        name: loc.name,
        municipality: loc.municipality,
        address: loc.address,
        note: loc.note,
        hours: loc.hours,
        latitude: p.lat,
        longitude: p.lng,
        isDemo: loc.isDemo,
        distanceKm: body.center ? Math.round(distanceKm(body.center, p) * 100) / 100 : null,
        listings: [],
      }
      byLocation.set(loc.id, entry)
    }
    entry.listings.push(toMarketListing(row, favorites, nowMs, body.date))
  }
  const locations = [...byLocation.values()].sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0) || a.name.localeCompare(b.name, 'ja'))

  // 半径の外にある拠点の数（範囲を広げる提案用）
  let outsideCount = 0
  if (body.center && body.radiusKm !== null) {
    const withoutRadius = runStages(all, { ...body, radiusKm: null }, nowMs).rows
    outsideCount = new Set(withoutRadius.map((r) => r.pickupLocationId).filter((id) => !byLocation.has(id))).size
  }

  let diagnostics: MarketDiagnostics | null = null
  if (locations.length === 0) {
    // 通常の検索で0件のとき、同じ条件のデモデータの数も伝える（デモモードの案内用）
    const demoAvailable = demo ? 0 : runStages(await loadRows(nowMs, true), { ...body, demo: true }, nowMs).rows.length
    diagnostics = { stages, demoAvailable, wider: widerOptions(all, body, nowMs) }
  }
  const response: MarketSearchResponse = { locations, outsideCount, searchedAtMs: nowMs, demo, diagnostics }
  return json(response)
})

// 出品の詳細（/api/market?id=...）。飲食店に見せられない出品は「見つからない」として扱う。
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
      ...baseWhere(nowMs, demo),
      producer: { approvalStatus: 'APPROVED', isDemo: demo, user: { suspended: false } },
      pickupLocation: { status: 'APPROVED', isDemo: demo },
    },
    include,
  })
  if (!row || !stillAvailable(row, nowMs)) {
    throw new HttpError(404, 'NOT_FOUND', 'この出品は現在表示できません。公開が止められたか、受渡の期間が終わった可能性があります。')
  }
  const p = row.producer
  const contact: PublicContact = {}
  if (p.showPhone && p.publicPhone) contact.phone = p.publicPhone
  if (p.showEmail && p.publicEmail) contact.email = p.publicEmail
  if ((contact.phone || contact.email) && p.contactNote) contact.note = p.contactNote
  const loc = row.pickupLocation
  const detail: ListingDetail = {
    ...toMarketListing(row, await favoriteIds(actor.restaurantId!), nowMs),
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
