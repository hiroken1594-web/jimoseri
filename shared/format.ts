// 相談用コピーの文面（仕様 10-2）と、在庫変動の差分メッセージ。
import type { AllocationLine, AllocationResult, MultiLocationResult, PointResult } from './allocate.js'
import type { ConfirmedDemand, PlanResponse } from './dto.js'
import { formatQty, formatQtyUnit, formatYen, IRREGULAR_LABEL, UNIT_LABEL } from './labels.js'
import { formatJstDateTime, formatWindow } from './time.js'

/** コピー文面に添える情報。連絡先は、本人が公開を許可したものだけが入っている。 */
export interface CopyExtras {
  locations?: PlanResponse['locations']
  contacts?: PlanResponse['contacts']
}

const DISCLAIMER = '※これは注文・在庫予約・各農家の承認ではありません。条件と在庫を改めて確認してください。'

function lineText(l: AllocationLine, demand: ConfirmedDemand): string {
  const unit = UNIT_LABEL[demand.unit]
  const note = l.grade === 'IRREGULAR' && l.irregularReason ? `、${IRREGULAR_LABEL[l.irregularReason]}あり` : ''
  return `${l.producerName}：${formatQty(l.quantityMilli)}${unit} × ${formatYen(l.unitPriceYen)} = ${formatYen(l.subtotalYen)}（税込${note}）`
}

function placeText(pointId: string, name: string, extras: CopyExtras): string {
  const loc = extras.locations?.[pointId]
  return loc ? `${name}（${loc.municipality} ${loc.address}）` : name
}

function contactLines(lines: AllocationLine[], extras: CopyExtras): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const l of lines) {
    const c = extras.contacts?.[l.producerId]
    if (!c || seen.has(l.producerId)) continue
    seen.add(l.producerId)
    const parts = [c.phone && `電話 ${c.phone}`, c.email && `メール ${c.email}`, c.note && `（${c.note}）`].filter(Boolean)
    out.push(`${l.producerName}：${parts.join('／')}`)
  }
  return out.length > 0 ? ['連絡先（生産者が公開を許可したもの）：', ...out] : []
}

function statusNotes(status: 'MATCHED' | 'OVER_BUDGET' | 'SHORTAGE', shortageMilli: number, totalYen: number, demand: ConfirmedDemand): string[] {
  if (status === 'SHORTAGE') return [`※希望量に対して${formatQtyUnit(shortageMilli, demand.unit)}不足しています。`]
  if (status === 'OVER_BUDGET' && demand.budgetMaxYen !== null) {
    return [`※予算上限${formatYen(demand.budgetMaxYen)}を${formatYen(totalYen - demand.budgetMaxYen)}超えています。`]
  }
  return []
}

/** 1か所で受け取る案 */
export function buildCopyText(demand: ConfirmedDemand, point: PointResult, computedAtMs: number, extras: CopyExtras = {}): string {
  return [
    '【仕入れ相談用・未確保の提案】',
    `希望品目：${demand.itemName}／希望量：${formatQtyUnit(demand.quantityMilli, demand.unit)}`,
    ...point.plan.lines.map((l) => lineText(l, demand)),
    `合計：${formatQtyUnit(point.plan.totalMilli, demand.unit)}／${formatYen(point.plan.totalYen)}（税込商品代）`,
    ...statusNotes(point.status, point.shortageMilli, point.plan.totalYen, demand),
    `受渡候補：${formatWindow(point.plan.windowStartMs, point.plan.windowEndMs)}／${placeText(point.pickupPointId, point.pickupPointName, extras)}`,
    ...contactLines(point.plan.lines, extras),
    `計算時刻：${formatJstDateTime(computedAtMs)}`,
    DISCLAIMER,
  ].join('\n')
}

/** 複数の場所で受け取る参考案 */
export function buildMultiCopyText(demand: ConfirmedDemand, multi: MultiLocationResult, computedAtMs: number, extras: CopyExtras = {}): string {
  const out = [
    '【仕入れ相談用・未確保の提案（複数の場所で受け取る参考案）】',
    `希望品目：${demand.itemName}／希望量：${formatQtyUnit(demand.quantityMilli, demand.unit)}`,
  ]
  multi.stops.forEach((stop, i) => {
    out.push(`■受取${i + 1}：${formatWindow(stop.windowStartMs, stop.windowEndMs)}／${placeText(stop.pickupPointId, stop.pickupPointName, extras)}`)
    out.push(...stop.lines.map((l) => lineText(l, demand)))
    out.push(`小計：${formatQtyUnit(stop.totalMilli, demand.unit)}／${formatYen(stop.totalYen)}`)
  })
  out.push(`合計：${formatQtyUnit(multi.totalMilli, demand.unit)}／${formatYen(multi.totalYen)}（税込商品代）`)
  out.push(...statusNotes(multi.status, multi.shortageMilli, multi.totalYen, demand))
  out.push(`※受け取る場所が${multi.stops.length}か所あり、受取の調整が必要です。場所の間の移動時間は考慮していません。`)
  out.push(...contactLines(multi.stops.flatMap((s) => s.lines), extras))
  out.push(`計算時刻：${formatJstDateTime(computedAtMs)}`)
  out.push(DISCLAIMER)
  return out.join('\n')
}

type Snapshot = AllocationResult['snapshot']

/** 前回の計算からの在庫の変化を、人が読める文にする（例：「C農家が2kg→1kg」）。 */
export function describeStockChanges(before: Snapshot, after: Snapshot): string[] {
  const messages: string[] = []
  const afterById = new Map(after.map((s) => [s.listingId, s]))
  const beforeIds = new Set(before.map((s) => s.listingId))
  for (const old of before) {
    const now = afterById.get(old.listingId)
    if (!now) {
      messages.push(`${old.producerName}の${formatQtyUnit(old.quantityMilli, old.unit)}が出荷不可になりました（公開停止・数量0・期限切れなど）。`)
    } else if (now.quantityMilli !== old.quantityMilli) {
      messages.push(`${old.producerName}が${formatQtyUnit(old.quantityMilli, old.unit)}→${formatQtyUnit(now.quantityMilli, now.unit)}に変わりました。`)
    }
  }
  for (const now of after) {
    if (!beforeIds.has(now.listingId)) {
      messages.push(`${now.producerName}の${formatQtyUnit(now.quantityMilli, now.unit)}が新しく登録されました。`)
    }
  }
  return messages
}
