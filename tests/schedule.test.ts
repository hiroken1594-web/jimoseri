import { describe, expect, it } from 'vitest'
import { allocate, toMilli, type DemandSpec, type ListingCandidate } from '../shared/allocate.js'
import { allocateScheduled, availableOn, formatPeriod, nextOccurrence, occurrenceOn } from '../shared/schedule.js'
import { addDaysJst, endOfJstDayMs, jstToMs } from '../shared/time.js'

// 受渡の期間（すべて架空のデータ）。2026-10-12 は月曜日。
const NOW = jstToMs('2026-10-12', '20:00')
const MON = 1 << 1
const WED = 1 << 3
const FRI = 1 << 5

function listing(over: Partial<ListingCandidate> & { id: string }): ListingCandidate {
  return {
    producerId: `p-${over.id}`,
    producerName: `${over.id}農家`,
    itemId: 'tomato',
    variety: null,
    unit: 'KG',
    grade: 'REGULAR',
    irregularReason: null,
    quantityMilli: toMilli(5),
    minMilli: toMilli(1),
    stepMilli: toMilli(1),
    unitPriceYen: 500,
    pickupPointId: 'P',
    pickupPointName: '拠点P',
    area: '大阪市福島区',
    prefecture: '大阪府',
    pickupStartMs: jstToMs('2026-10-14', '10:00'),
    pickupEndMs: jstToMs('2026-10-14', '11:00'),
    isPublished: true,
    updatedAtMs: NOW,
    ...over,
  }
}

/** 2026-10-01〜12-31 の、指定した曜日の 10:00〜11:00 */
const period = (id: string, weekdays: number, over: Partial<ListingCandidate> = {}) =>
  listing({
    id,
    pickupStartMs: jstToMs('2026-10-01', '10:00'),
    pickupEndMs: jstToMs('2026-12-31', '11:00'),
    schedule: { weekdays, startMin: 600, endMin: 660 },
    ...over,
  })

const demand = (over: Partial<DemandSpec> = {}): DemandSpec => ({
  itemId: 'tomato',
  unit: 'KG',
  quantityMilli: toMilli(10),
  timeMode: 'DEADLINE',
  targetMs: endOfJstDayMs('2026-10-16'),
  pickupPointId: null,
  budgetMaxYen: null,
  allowIrregular: true,
  ...over,
})

describe('受渡の期間：その日に受け取れるか', () => {
  const mwf = period('A', MON | WED | FRI)
  it('期間内の、選んだ曜日だけ受け取れる', () => {
    expect(occurrenceOn(mwf, '2026-10-14')).toEqual({ startMs: jstToMs('2026-10-14', '10:00'), endMs: jstToMs('2026-10-14', '11:00') }) // 水
    expect(occurrenceOn(mwf, '2026-10-15')).toBeNull() // 木
  })
  it('期間の前後は受け取れない（終了日は含む）', () => {
    expect(occurrenceOn(mwf, '2026-09-30')).toBeNull()
    const daily = period('D', 127)
    expect(occurrenceOn(daily, '2026-12-31')).not.toBeNull()
    expect(occurrenceOn(daily, '2027-01-01')).toBeNull()
  })
  it('次に受け取れる回：今日の回が終わっていれば次の曜日', () => {
    expect(nextOccurrence(mwf, NOW)?.startMs).toBe(jstToMs('2026-10-14', '10:00'))
    expect(nextOccurrence(mwf, jstToMs('2026-10-12', '10:30'))?.startMs).toBe(jstToMs('2026-10-12', '10:00'))
  })
  it('期間が終わった出品は、次の回がない（期限切れとして扱う）', () => {
    expect(nextOccurrence(mwf, jstToMs('2027-01-01', '09:00'))).toBeNull()
  })
  it('日付の指定：その日に受け取れて、まだ終わっていない場合だけ', () => {
    expect(availableOn(mwf, '2026-10-16', NOW)).toBe(true)
    expect(availableOn(mwf, '2026-10-17', NOW)).toBe(false)
    expect(availableOn(mwf, '2026-10-12', NOW)).toBe(false) // 今日の回は終わっている
  })
  it('1日だけの出品も、同じ関数で扱える', () => {
    const one = listing({ id: 'X' })
    expect(availableOn(one, '2026-10-14', NOW)).toBe(true)
    expect(availableOn(one, '2026-10-15', NOW)).toBe(false)
  })
  it('期間の表示', () => {
    expect(formatPeriod(mwf.pickupStartMs, mwf.pickupEndMs, mwf.schedule!)).toBe('10月1日(木)〜12月31日(木)の月・水・金曜 10:00〜11:00')
  })
})

describe('受渡の期間を含む仕入れ案', () => {
  it('期間の出品がなければ、従来の計算と同じ結果', () => {
    const list = [listing({ id: 'A' }), listing({ id: 'B', quantityMilli: toMilli(5) })]
    expect(allocateScheduled(list, demand(), NOW)).toEqual(allocate(list, demand(), NOW))
  })
  it('同じ曜日に受け取れる農家どうしを組み合わせる（共通の日を探す）', () => {
    // A：月水金 5kg、B：水だけ 5kg → 水曜(10/14)なら 10kg
    const r = allocateScheduled([period('A', MON | WED | FRI), period('B', WED)], demand(), NOW)
    expect(r.best?.status).toBe('MATCHED')
    expect(r.best?.plan.totalMilli).toBe(10_000)
    expect(r.best?.plan.windowStartMs).toBe(jstToMs('2026-10-14', '10:00'))
  })
  it('同じ出品の別の日の回を、1つの案で重ねて数えない', () => {
    const r = allocateScheduled([period('A', 127)], demand(), NOW)
    expect(r.best?.plan.totalMilli).toBe(5000)
    expect(r.best?.shortageMilli).toBe(5000)
  })
  it('希望日までに受け取れる回がない出品は使わない（日時が合わないとして扱う）', () => {
    const late = period('L', 127, { pickupStartMs: jstToMs('2026-10-20', '10:00') })
    const r = allocateScheduled([late], demand(), NOW)
    expect(r.best).toBeNull()
    expect(r.exclusions.some((e) => e.reason === 'TIME')).toBe(true)
  })
  it('日時の指定：その日の時間帯に受け取れる出品だけ', () => {
    const exact = demand({ timeMode: 'EXACT', targetMs: jstToMs('2026-10-16', '10:30') })
    const r = allocateScheduled([period('A', FRI), period('B', WED)], exact, NOW)
    expect(r.best?.plan.lines.map((l) => l.listingId)).toEqual(['A'])
  })
  it('受取エリア（都道府県）が違う場所の出品は使わない', () => {
    const r = allocateScheduled([period('A', 127, { prefecture: '京都府' })], demand({ prefecture: '大阪府' }), NOW)
    expect(r.best).toBeNull()
  })
  it('検索地点の半径の外の場所は使わない', () => {
    const r = allocateScheduled([period('A', 127)], demand({ allowedPointIds: ['Q'] }), NOW)
    expect(r.best).toBeNull()
    expect(r.exclusions.some((e) => e.reason === 'POINT')).toBe(true)
  })
  it('希望日が遠くても、見る日数には上限がある（計算が重くならない）', () => {
    const r = allocateScheduled([period('A', 127)], demand({ targetMs: endOfJstDayMs(addDaysJst('2026-10-12', 500)) }), NOW)
    expect(r.best?.plan.totalMilli).toBe(5000)
  })
})
