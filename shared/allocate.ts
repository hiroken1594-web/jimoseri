// 仕入れ案の配分ロジック（仕様 11-3）。
// AI・DB に依存しない純粋な関数。数量は丸め誤差を避けるため 1/1000 単位の整数（ミリ）で扱う。
import type { PickupSchedule } from './schedule.js'

export type Unit = 'KG' | 'PIECE' | 'BUNCH' | 'BAG'
export type Grade = 'REGULAR' | 'IRREGULAR'
export type IrregularReason = 'SHAPE' | 'SIZE' | 'SURPLUS' | 'OTHER'
export type TimeMode = 'DEADLINE' | 'EXACT'

export const toMilli = (n: number): number => Math.round(n * 1000)
export const fromMilli = (m: number): number => m / 1000

export interface ListingCandidate {
  id: string
  producerId: string
  producerName: string
  itemId: string
  variety: string | null
  unit: Unit
  grade: Grade
  irregularReason: IrregularReason | null
  quantityMilli: number
  minMilli: number
  stepMilli: number
  unitPriceYen: number
  /** 受渡場所の ID。同じ ID の出品どうしを「同じ場所」と判定する。 */
  pickupPointId: string
  pickupPointName: string
  /** 受渡場所の市区町村（受取エリアでの絞り込みに使う） */
  area?: string
  /** 受渡場所の都道府県（受取エリアでの絞り込みに使う） */
  prefecture?: string | null
  pickupStartMs: number
  pickupEndMs: number
  /** 受渡の期間（曜日・時間帯）。null・未指定は1日だけの出品。期間の出品は allocateScheduled で日ごとの回に直してから計算する。 */
  schedule?: PickupSchedule | null
  isPublished: boolean
  updatedAtMs: number
}

export interface DemandSpec {
  itemId: string
  unit: Unit
  quantityMilli: number
  timeMode: TimeMode
  /** DEADLINE: 期限日の終わり（その時刻より前に受け取り開始できること）／EXACT: 指定日時 */
  targetMs: number
  pickupPointId: string | null
  /** 受取エリア（市区町村）。指定した場合、そのエリアの受渡場所だけを対象にする。 */
  area?: string | null
  /** 受取エリア（都道府県）。指定した場合、その都道府県の受渡場所だけを対象にする。 */
  prefecture?: string | null
  /** 検索地点からの半径の内側にある受渡場所の ID。null・未指定は距離で絞り込まない。 */
  allowedPointIds?: string[] | null
  budgetMaxYen: number | null
  allowIrregular: boolean
  /** 複数の場所での受け取りを許可するか。未指定はオフ。 */
  allowMultiLocation?: boolean
}

export interface SearchLimits {
  maxProducers: number
  /** 1拠点あたり探索に使う出品数の上限 */
  maxCandidates: number
  /** 探索する分岐数の上限 */
  maxNodes: number
  /** 探索時間の上限（ミリ秒） */
  maxMillis: number
}

export const DEFAULT_LIMITS: SearchLimits = {
  maxProducers: 3,
  maxCandidates: 40,
  maxNodes: 200_000,
  maxMillis: 800,
}

export interface AllocationLine {
  listingId: string
  producerId: string
  producerName: string
  variety: string | null
  grade: Grade
  irregularReason: IrregularReason | null
  quantityMilli: number
  unitPriceYen: number
  subtotalYen: number
  pickupPointId: string
  pickupPointName: string
}

export interface Plan {
  lines: AllocationLine[]
  totalMilli: number
  totalYen: number
  producerCount: number
  /** 採用した出品すべてに共通する受渡可能時間帯 */
  windowStartMs: number
  windowEndMs: number
}

export type PlanStatus =
  | 'MATCHED' // 条件達成
  | 'OVER_BUDGET' // 数量は満たすが予算超過
  | 'SHORTAGE' // 一部のみ（不足）
  | 'MISMATCH' // 同じ品目の出品はあるが条件に合うものがない
  | 'NONE' // 同じ品目の出品がない

export type ExclusionReason = 'UNIT' | 'IRREGULAR' | 'POINT' | 'TIME' | 'MIN_LOT'

export interface Exclusion {
  reason: ExclusionReason
  count: number
  /** 除外した登録数量の合計。UNIT は単位が異なるため合算しない（0）。 */
  quantityMilli: number
}

export interface PointResult {
  pickupPointId: string
  pickupPointName: string
  status: 'MATCHED' | 'OVER_BUDGET' | 'SHORTAGE'
  plan: Plan
  /** この拠点で条件に合う登録数量の合計 */
  eligibleMilli: number
  shortageMilli: number
  /** 数量はあるが、共通の受渡時間帯がないために組めなかった */
  windowConflict: boolean
}

/** 複数の場所で受け取る案の、1か所分 */
export interface PickupStop {
  pickupPointId: string
  pickupPointName: string
  windowStartMs: number
  windowEndMs: number
  lines: AllocationLine[]
  totalMilli: number
  totalYen: number
}

/** 複数の場所で受け取る案（受取調整が必要な参考案）。場所の間の移動時間は考慮していない。 */
export interface MultiLocationResult {
  status: 'MATCHED' | 'OVER_BUDGET' | 'SHORTAGE'
  stops: PickupStop[]
  totalMilli: number
  totalYen: number
  producerCount: number
  shortageMilli: number
}

export interface AllocationResult {
  status: PlanStatus
  demandMilli: number
  best: PointResult | null
  alternatives: PointResult[]
  /** 1か所では希望量を満たせず、許可がある場合だけ作る参考案 */
  multi: MultiLocationResult | null
  exclusions: Exclusion[]
  /** 条件に合う登録数量の合計（拠点指定なしの場合は全拠点の合計） */
  eligibleMilli: number
  /** 計算時点で販売可能だった同一品目の出品（在庫変動の差分表示に使う） */
  snapshot: { listingId: string; producerName: string; quantityMilli: number; unit: Unit }[]
  /** 探索上限に達したため、最適な案であることを保証できない */
  searchTruncated: boolean
}

/** 最低販売量・販売刻みを守ったうえで cap 以下の最大数量。割り当て不能なら 0。 */
export function maxLatticeAtMost(l: Pick<ListingCandidate, 'minMilli' | 'stepMilli'>, cap: number): number {
  if (l.minMilli <= 0 || l.stepMilli <= 0 || cap < l.minMilli) return 0
  return l.minMilli + Math.floor((cap - l.minMilli) / l.stepMilli) * l.stepMilli
}

/** 数量が最低販売量・販売刻みに合っているか */
export function isOnLattice(l: Pick<ListingCandidate, 'minMilli' | 'stepMilli'>, qty: number): boolean {
  return qty >= l.minMilli && (qty - l.minMilli) % l.stepMilli === 0
}

export function lineSubtotalYen(unitPriceYen: number, quantityMilli: number): number {
  return Math.round((unitPriceYen * quantityMilli) / 1000)
}

function windowOk(start: number, end: number, demand: DemandSpec, nowMs: number): boolean {
  if (!(start < end)) return false
  if (demand.timeMode === 'EXACT') {
    return demand.targetMs >= nowMs && start <= demand.targetMs && demand.targetMs < end
  }
  const effectiveStart = Math.max(start, nowMs)
  return effectiveStart < end && effectiveStart < demand.targetMs
}

interface Found {
  qty: number
  cost: number
  producers: number
  locations: number
  allocs: number[]
}

interface SearchOutcome {
  budgetFull: Found | null
  cheapestFull: Found | null
  partial: Found | null
  truncated: boolean
}

/** (受取場所の数, 生産者数, 金額) の順に比べて、b より良いか */
function ranksBefore(locations: number, producers: number, cost: number, b: Found): boolean {
  if (locations !== b.locations) return locations < b.locations
  if (producers !== b.producers) return producers < b.producers
  return cost < b.cost
}

/**
 * 最大 maxProducers 農家の組み合わせを探索する。
 * 同じ受渡場所の出品どうしは共通の受渡時間帯が必要。異なる場所どうしは時間帯の重なりを求めず、
 * 場所ごとに希望日の条件を確認する。maxLocations=1 なら、1か所で受け取れる案だけを探す。
 */
function searchPoint(
  listings: ListingCandidate[],
  demand: DemandSpec,
  nowMs: number,
  limits: SearchLimits,
  ignoreWindows: boolean,
  maxLocations = 1,
): SearchOutcome {
  const n = listings.length
  const target = demand.quantityMilli
  const budget = demand.budgetMaxYen
  const maxAlloc = listings.map((l) => maxLatticeAtMost(l, Math.min(l.quantityMilli, target)))
  const suffixCap = new Array<number>(n + 1).fill(0)
  const suffixMinPrice = new Array<number>(n + 1).fill(Infinity)
  for (let i = n - 1; i >= 0; i--) {
    suffixCap[i] = suffixCap[i + 1] + maxAlloc[i]
    suffixMinPrice[i] = Math.min(suffixMinPrice[i + 1], listings[i].unitPriceYen)
  }

  const out: SearchOutcome = { budgetFull: null, cheapestFull: null, partial: null, truncated: false }
  const allocs = new Array<number>(n).fill(0)
  const used: string[] = []
  // 使っている受渡場所と、場所ごとの共通時間帯
  const locIds: string[] = []
  const locStart: number[] = []
  const locEnd: number[] = []
  const startedAt = Date.now()
  let nodes = 0

  const evaluate = (remaining: number, cost: number) => {
    const qty = target - remaining
    if (qty <= 0) return
    const producers = used.length
    const locations = locIds.length
    const found = (): Found => ({ qty, cost, producers, locations, allocs: allocs.slice() })
    if (remaining === 0) {
      const c = out.cheapestFull
      if (!c || cost < c.cost || (cost === c.cost && ranksBefore(locations, producers, cost, c))) out.cheapestFull = found()
      if (budget === null || cost <= budget) {
        const b = out.budgetFull
        if (!b || ranksBefore(locations, producers, cost, b)) out.budgetFull = found()
      }
      return
    }
    const p = out.partial
    if (!p || qty > p.qty || (qty === p.qty && ranksBefore(locations, producers, cost, p))) {
      out.partial = found()
    }
  }

  const dfs = (i: number, remaining: number, cost: number) => {
    if (out.truncated) return
    nodes++
    if (nodes > limits.maxNodes || ((nodes & 1023) === 0 && Date.now() - startedAt > limits.maxMillis)) {
      out.truncated = true
      return
    }
    if (remaining === 0 || i === n) {
      evaluate(remaining, cost)
      return
    }

    // 枝刈り：これ以上探しても、今ある案より良くならない分岐は打ち切る。
    if (out.cheapestFull) {
      if (suffixCap[i] < remaining) return
      const lowerBound = cost + Math.floor((remaining * suffixMinPrice[i]) / 1000) - (n - i)
      const b = out.budgetFull
      const canImproveBudgetFull =
        (budget === null || lowerBound <= budget) && (!b || ranksBefore(locIds.length, used.length, lowerBound, b))
      const canImproveCheapest = !b && lowerBound <= out.cheapestFull.cost
      if (!canImproveBudgetFull && !canImproveCheapest) return
    } else if (out.partial && target - remaining + Math.min(remaining, suffixCap[i]) < out.partial.qty) {
      return
    }

    const l = listings[i]
    const isNewProducer = !used.includes(l.producerId)
    const loc = locIds.indexOf(l.pickupPointId)
    const isNewLocation = loc === -1
    if ((!isNewProducer || used.length < limits.maxProducers) && (!isNewLocation || locIds.length < maxLocations)) {
      // この出品を使う場合の、その受渡場所での共通時間帯
      const prevStart = isNewLocation ? -Infinity : locStart[loc]
      const prevEnd = isNewLocation ? Infinity : locEnd[loc]
      const nStart = Math.max(prevStart, l.pickupStartMs)
      const nEnd = Math.min(prevEnd, l.pickupEndMs)
      if (ignoreWindows || windowOk(nStart, nEnd, demand, nowMs)) {
        const at = isNewLocation ? locIds.length : loc
        if (isNewLocation) locIds.push(l.pickupPointId)
        locStart[at] = nStart
        locEnd[at] = nEnd
        if (isNewProducer) used.push(l.producerId)
        for (let v = maxLatticeAtMost(l, Math.min(l.quantityMilli, remaining)); v >= l.minMilli && v > 0; v -= l.stepMilli) {
          allocs[i] = v
          dfs(i + 1, remaining - v, cost + lineSubtotalYen(l.unitPriceYen, v))
          if (out.truncated) break
        }
        allocs[i] = 0
        if (isNewProducer) used.pop()
        if (isNewLocation) {
          locIds.pop()
          locStart.pop()
          locEnd.pop()
        } else {
          locStart[at] = prevStart
          locEnd[at] = prevEnd
        }
      }
    }
    dfs(i + 1, remaining, cost)
  }

  dfs(0, target, 0)
  return out
}

function buildPlan(listings: ListingCandidate[], found: Found, demand: DemandSpec, nowMs: number): Plan {
  const lines: AllocationLine[] = []
  let windowStartMs = -Infinity
  let windowEndMs = Infinity
  listings.forEach((l, i) => {
    const q = found.allocs[i]
    if (q <= 0) return
    windowStartMs = Math.max(windowStartMs, l.pickupStartMs)
    windowEndMs = Math.min(windowEndMs, l.pickupEndMs)
    lines.push({
      listingId: l.id,
      producerId: l.producerId,
      producerName: l.producerName,
      variety: l.variety,
      grade: l.grade,
      irregularReason: l.irregularReason,
      quantityMilli: q,
      unitPriceYen: l.unitPriceYen,
      subtotalYen: lineSubtotalYen(l.unitPriceYen, q),
      pickupPointId: l.pickupPointId,
      pickupPointName: l.pickupPointName,
    })
  })
  // 配分量の多い順に表示する（同量なら生産者名順）。
  lines.sort((a, b) => b.quantityMilli - a.quantityMilli || a.producerName.localeCompare(b.producerName, 'ja'))
  // 表示用に、既に過ぎた時間と期限より後の時間を切り落とす。
  windowStartMs = Math.max(windowStartMs, nowMs)
  if (demand.timeMode === 'DEADLINE') windowEndMs = Math.min(windowEndMs, demand.targetMs)
  return {
    lines,
    totalMilli: found.qty,
    totalYen: found.cost,
    producerCount: found.producers,
    windowStartMs,
    windowEndMs,
  }
}

/** 複数の場所にまたがる案を、受け取る場所ごとにまとめる。 */
function buildMultiResult(
  listings: ListingCandidate[],
  found: Found,
  status: MultiLocationResult['status'],
  demand: DemandSpec,
  nowMs: number,
): MultiLocationResult {
  const stops: PickupStop[] = []
  const pointIds = [...new Set(listings.filter((_, i) => found.allocs[i] > 0).map((l) => l.pickupPointId))]
  for (const pointId of pointIds) {
    // その場所の出品だけを取り出して、1か所分として組み立てる
    const allocs = found.allocs.map((q, i) => (listings[i].pickupPointId === pointId ? q : 0))
    const qty = allocs.reduce((sum, q) => sum + q, 0)
    const plan = buildPlan(listings, { ...found, qty, allocs }, demand, nowMs)
    stops.push({
      pickupPointId: pointId,
      pickupPointName: plan.lines[0].pickupPointName,
      windowStartMs: plan.windowStartMs,
      windowEndMs: plan.windowEndMs,
      lines: plan.lines,
      totalMilli: qty,
      totalYen: plan.lines.reduce((sum, l) => sum + l.subtotalYen, 0),
    })
  }
  stops.sort((a, b) => a.windowStartMs - b.windowStartMs || b.totalMilli - a.totalMilli)
  return {
    status,
    stops,
    totalMilli: found.qty,
    totalYen: found.cost,
    producerCount: found.producers,
    shortageMilli: demand.quantityMilli - found.qty,
  }
}

const STATUS_RANK = { MATCHED: 0, OVER_BUDGET: 1, SHORTAGE: 2 } as const

function comparePointResults(a: PointResult, b: PointResult): number {
  if (a.status !== b.status) return STATUS_RANK[a.status] - STATUS_RANK[b.status]
  if (a.status === 'SHORTAGE' && a.plan.totalMilli !== b.plan.totalMilli) return b.plan.totalMilli - a.plan.totalMilli
  if (a.status === 'OVER_BUDGET' && a.plan.totalYen !== b.plan.totalYen) return a.plan.totalYen - b.plan.totalYen
  if (a.plan.producerCount !== b.plan.producerCount) return a.plan.producerCount - b.plan.producerCount
  if (a.plan.totalYen !== b.plan.totalYen) return a.plan.totalYen - b.plan.totalYen
  return a.pickupPointName.localeCompare(b.pickupPointName)
}

/**
 * 仕入れ案を計算する。
 * 優先順位：必須条件（数量・予算を含む）をすべて満たす → 生産者数が少ない → 商品代が安い。
 */
export function allocate(
  allListings: ListingCandidate[],
  demand: DemandSpec,
  nowMs: number,
  limits: SearchLimits = DEFAULT_LIMITS,
): AllocationResult {
  // 非公開・数量0・販売可能期間を過ぎた出品は候補にしない（仕様 9-3）。
  const available = allListings.filter(
    (l) => l.itemId === demand.itemId && l.isPublished && l.quantityMilli > 0 && l.pickupEndMs > nowMs,
  )
  const snapshot = available.map((l) => ({
    listingId: l.id,
    producerName: l.producerName,
    quantityMilli: l.quantityMilli,
    unit: l.unit,
  }))

  const excluded = new Map<ExclusionReason, Exclusion>()
  const exclude = (reason: ExclusionReason, l: ListingCandidate) => {
    const e = excluded.get(reason) ?? { reason, count: 0, quantityMilli: 0 }
    e.count++
    if (reason !== 'UNIT') e.quantityMilli += l.quantityMilli
    excluded.set(reason, e)
  }

  const byPoint = new Map<string, ListingCandidate[]>()
  for (const l of available) {
    if (l.unit !== demand.unit) exclude('UNIT', l)
    else if (l.grade === 'IRREGULAR' && !demand.allowIrregular) exclude('IRREGULAR', l)
    else if (demand.pickupPointId !== null && l.pickupPointId !== demand.pickupPointId) exclude('POINT', l)
    else if (demand.prefecture && l.prefecture !== demand.prefecture) exclude('POINT', l)
    else if (demand.area && l.area !== demand.area) exclude('POINT', l)
    else if (demand.allowedPointIds && !demand.allowedPointIds.includes(l.pickupPointId)) exclude('POINT', l)
    else if (!windowOk(l.pickupStartMs, l.pickupEndMs, demand, nowMs)) exclude('TIME', l)
    else if (maxLatticeAtMost(l, Math.min(l.quantityMilli, demand.quantityMilli)) === 0) exclude('MIN_LOT', l)
    else {
      const group = byPoint.get(l.pickupPointId) ?? []
      group.push(l)
      byPoint.set(l.pickupPointId, group)
    }
  }

  let searchTruncated = false
  let eligibleMilli = 0
  const results: PointResult[] = []

  for (const group of byPoint.values()) {
    const pointEligible = group.reduce((sum, l) => sum + l.quantityMilli, 0)
    eligibleMilli += pointEligible

    // 安い順に並べると、早い段階で良い案が見つかり枝刈りが効く。
    let listings = group
      .slice()
      .sort((a, b) => a.unitPriceYen - b.unitPriceYen || b.quantityMilli - a.quantityMilli || a.id.localeCompare(b.id))
    if (listings.length > limits.maxCandidates) {
      listings = listings.slice(0, limits.maxCandidates)
      searchTruncated = true
    }

    const outcome = searchPoint(listings, demand, nowMs, limits, false)
    if (outcome.truncated) searchTruncated = true
    const found = outcome.budgetFull ?? outcome.cheapestFull ?? outcome.partial
    if (!found) continue

    const status = outcome.budgetFull ? 'MATCHED' : outcome.cheapestFull ? 'OVER_BUDGET' : 'SHORTAGE'
    let windowConflict = false
    if (status === 'SHORTAGE') {
      const relaxed = searchPoint(listings, demand, nowMs, limits, true)
      const relaxedQty = relaxed.cheapestFull?.qty ?? relaxed.partial?.qty ?? 0
      windowConflict = relaxedQty > found.qty
    }
    results.push({
      pickupPointId: listings[0].pickupPointId,
      pickupPointName: listings[0].pickupPointName,
      status,
      plan: buildPlan(listings, found, demand, nowMs),
      eligibleMilli: pointEligible,
      shortageMilli: demand.quantityMilli - found.qty,
      windowConflict,
    })
  }

  results.sort(comparePointResults)
  const best = results[0] ?? null
  const exclusions = [...excluded.values()]

  // 複数の場所で受け取る参考案。許可があり、日時の固定指定でなく、1か所では希望量を満たせない場合だけ作る。
  let multi: MultiLocationResult | null = null
  if (demand.allowMultiLocation && demand.timeMode === 'DEADLINE' && byPoint.size >= 2 && best && best.status !== 'MATCHED') {
    let listings = [...byPoint.values()]
      .flat()
      .sort((a, b) => a.unitPriceYen - b.unitPriceYen || b.quantityMilli - a.quantityMilli || a.id.localeCompare(b.id))
    if (listings.length > limits.maxCandidates) {
      listings = listings.slice(0, limits.maxCandidates)
      searchTruncated = true
    }
    const outcome = searchPoint(listings, demand, nowMs, limits, false, limits.maxProducers)
    if (outcome.truncated) searchTruncated = true
    const found = outcome.budgetFull ?? outcome.cheapestFull ?? outcome.partial
    if (found && found.locations >= 2) {
      const status = outcome.budgetFull ? 'MATCHED' : outcome.cheapestFull ? 'OVER_BUDGET' : 'SHORTAGE'
      // 1か所の案より良くなる場合だけ示す
      const improves =
        STATUS_RANK[status] < STATUS_RANK[best.status] || (status === 'SHORTAGE' && found.qty > best.plan.totalMilli)
      if (improves) multi = buildMultiResult(listings, found, status, demand, nowMs)
    }
  }

  return {
    status: best ? best.status : available.length > 0 ? 'MISMATCH' : 'NONE',
    demandMilli: demand.quantityMilli,
    best,
    alternatives: results.slice(1),
    multi,
    exclusions,
    eligibleMilli,
    snapshot,
    searchTruncated,
  }
}
