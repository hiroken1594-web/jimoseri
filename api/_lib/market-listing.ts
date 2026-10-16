// 飲食店に見せる出品の形（地図・一覧・スワイプ・詳細・「気になる」で共通）
import { toMilli } from '../../shared/allocate.js'
import type { MarketListing } from '../../shared/dto.js'
import { nextOccurrence, occurrenceOn } from '../../shared/schedule.js'
import { scheduleOf } from './listings.js'

export interface MarketRow {
  id: string
  itemId: string
  item: { name: string }
  variety: string | null
  grade: MarketListing['grade']
  irregularReason: MarketListing['irregularReason']
  quantity: unknown
  unit: MarketListing['unit']
  unitPriceTaxIncl: number
  minQuantity: unknown
  stepQuantity: unknown
  pickupStart: Date
  pickupEnd: Date
  pickupWeekdays: number | null
  pickupStartMin: number | null
  pickupEndMin: number | null
  producerId: string
  producer: { farmName: string }
  updatedAt: Date
  isDemo: boolean
}

export const windowOf = (row: MarketRow) => ({ pickupStartMs: row.pickupStart.getTime(), pickupEndMs: row.pickupEnd.getTime(), schedule: scheduleOf(row) })

/** これから受け取れる回が残っているか（期間の出品は、最後の回が終わるまで有効） */
export const stillAvailable = (row: MarketRow, nowMs: number): boolean => nextOccurrence(windowOf(row), nowMs) !== null

/**
 * date を指定したときは、その日の受渡時間帯を、指定しないときは次に受け取れる回を、受渡日時として出す。
 */
export function toMarketListing(row: MarketRow, favorites: Set<string>, nowMs: number, date?: string | null): MarketListing {
  const w = windowOf(row)
  const shown = (date ? occurrenceOn(w, date) : null) ?? nextOccurrence(w, nowMs) ?? { startMs: w.pickupStartMs, endMs: w.pickupEndMs }
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
    pickupStartMs: shown.startMs,
    pickupEndMs: shown.endMs,
    period: w.schedule ? { startMs: w.pickupStartMs, endMs: w.pickupEndMs, schedule: w.schedule } : null,
    producerId: row.producerId,
    producerName: row.producer.farmName,
    updatedAtMs: row.updatedAt.getTime(),
    isFavorite: favorites.has(row.id),
    isDemo: row.isDemo,
  }
}
