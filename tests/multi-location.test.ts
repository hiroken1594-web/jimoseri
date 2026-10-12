import { describe, expect, it } from 'vitest'
import { allocate, toMilli, type DemandSpec, type ListingCandidate } from '../shared/allocate.js'
import { endOfJstDayMs, jstToMs } from '../shared/time.js'

// 複数の場所で受け取る参考案（03_spec_addendum.md 6章）
const NOW = jstToMs('2026-10-12', '20:00')
const DAY = '2026-10-14'

function listing(id: string, place: string, qty: number, price: number, over: Partial<ListingCandidate> = {}): ListingCandidate {
  return {
    id,
    producerId: `p-${id}`,
    producerName: `${id}農家`,
    itemId: 'tomato',
    variety: null,
    unit: 'KG',
    grade: 'REGULAR',
    irregularReason: null,
    quantityMilli: toMilli(qty),
    minMilli: 1000,
    stepMilli: 1000,
    unitPriceYen: price,
    pickupPointId: place,
    pickupPointName: `受渡場所${place}`,
    area: '能勢町',
    pickupStartMs: jstToMs(DAY, '10:00'),
    pickupEndMs: jstToMs(DAY, '11:00'),
    isPublished: true,
    updatedAtMs: NOW,
    ...over,
  }
}

function demand(over: Partial<DemandSpec> = {}): DemandSpec {
  return {
    itemId: 'tomato',
    unit: 'KG',
    quantityMilli: toMilli(10),
    timeMode: 'DEADLINE',
    targetMs: endOfJstDayMs(DAY),
    pickupPointId: null,
    budgetMaxYen: null,
    allowIrregular: true,
    allowMultiLocation: true,
    ...over,
  }
}

const A = listing('A', 'P', 5, 600)
const B = listing('B', 'P', 3, 550)
const C = listing('C', 'Q', 2, 350)

describe('複数の場所で受け取る参考案', () => {
  it('許可がオフ（初期値）なら作らない', () => {
    const r = allocate([A, B, C], demand({ allowMultiLocation: false }), NOW)
    expect(r.multi).toBeNull()
    expect(r.status).toBe('SHORTAGE')
    expect(r.best!.plan.totalMilli).toBe(8000)

    const { allowMultiLocation: _omit, ...unspecified } = demand()
    expect(allocate([A, B, C], unspecified, NOW).multi).toBeNull()
  })

  it('許可がオンで1か所では不足する場合、場所ごとにまとめた参考案を作る', () => {
    const r = allocate([A, B, C], demand(), NOW)
    // 1か所の案は従来どおり（第一の案は変わらない）
    expect(r.status).toBe('SHORTAGE')
    expect(r.best!.pickupPointId).toBe('P')
    expect(r.best!.plan.totalMilli).toBe(8000)

    const m = r.multi!
    expect(m.status).toBe('MATCHED')
    expect(m.totalMilli).toBe(10_000)
    expect(m.totalYen).toBe(5350)
    expect(m.producerCount).toBe(3)
    expect(m.shortageMilli).toBe(0)
    expect(m.stops.map((s) => [s.pickupPointId, s.totalMilli, s.totalYen])).toEqual([
      ['P', 8000, 4650],
      ['Q', 2000, 700],
    ])
    expect(m.stops[0].lines.map((l) => l.listingId)).toEqual(['A', 'B'])
  })

  it('1か所で希望量を満たせるなら、複数か所の案は作らない', () => {
    const cheapElsewhere = listing('D', 'Q', 10, 100)
    const r = allocate([A, B, listing('C2', 'P', 2, 350), cheapElsewhere], demand(), NOW)
    expect(r.status).toBe('MATCHED')
    expect(r.multi).toBeNull()
  })

  it('受取日時を固定指定した場合は作らない', () => {
    const r = allocate([A, B, C], demand({ timeMode: 'EXACT', targetMs: jstToMs(DAY, '10:30') }), NOW)
    expect(r.multi).toBeNull()
    expect(r.best!.plan.totalMilli).toBe(8000)
  })

  it('異なる場所どうしは時間帯が重ならなくてもよく、場所ごとの日時を示す', () => {
    const afternoon = { ...C, pickupStartMs: jstToMs(DAY, '14:00'), pickupEndMs: jstToMs(DAY, '15:00') }
    const m = allocate([A, B, afternoon], demand(), NOW).multi!
    expect(m.totalMilli).toBe(10_000)
    expect(m.stops[1].windowStartMs).toBe(jstToMs(DAY, '14:00'))
    expect(m.stops[1].windowEndMs).toBe(jstToMs(DAY, '15:00'))
  })

  it('期限より後にしか受け取れない場所は使わない', () => {
    const late = { ...C, pickupStartMs: jstToMs('2026-10-15', '10:00'), pickupEndMs: jstToMs('2026-10-15', '11:00') }
    const r = allocate([A, B, late], demand(), NOW)
    expect(r.multi).toBeNull()
  })

  it('同じ場所の出品どうしには、複数か所の案でも共通の時間帯が必要', () => {
    const bAfternoon = { ...B, pickupStartMs: jstToMs(DAY, '14:00'), pickupEndMs: jstToMs(DAY, '15:00') }
    const m = allocate([A, bAfternoon, C], demand(), NOW).multi!
    // P では A と B を同時に受け取れないので、A(5)+C(2)=7kg まで
    expect(m.status).toBe('SHORTAGE')
    expect(m.totalMilli).toBe(7000)
    expect(m.shortageMilli).toBe(3000)
    expect(m.stops.flatMap((s) => s.lines.map((l) => l.listingId)).sort()).toEqual(['A', 'C'])
  })

  it('受け取る場所は最大3か所', () => {
    const four = ['W', 'X', 'Y', 'Z'].map((id) => listing(id, id, 3, 500))
    const m = allocate(four, demand(), NOW).multi!
    expect(m.stops).toHaveLength(3)
    expect(m.totalMilli).toBe(9000)
    expect(m.status).toBe('SHORTAGE')
  })

  it('受け取る場所が少ない案を、安い案より優先する', () => {
    const r = allocate(
      [listing('A', 'P', 5, 900), listing('B', 'Q', 5, 900), listing('C', 'R', 4, 100), listing('D', 'S', 1, 100)],
      demand(),
      NOW,
    )
    const m = r.multi!
    expect(m.status).toBe('MATCHED')
    // 3か所（P+R+S = 5,000円）より、2か所（P+Q = 9,000円）を選ぶ
    expect(m.stops.map((s) => s.pickupPointId).sort()).toEqual(['P', 'Q'])
    expect(m.totalYen).toBe(9000)
  })

  it('予算内に収まる複数か所の案があれば、条件達成の参考案として示す', () => {
    const r = allocate([A, B, C], demand({ budgetMaxYen: 5350 }), NOW)
    expect(r.multi!.status).toBe('MATCHED')
    const over = allocate([A, B, C], demand({ budgetMaxYen: 5000 }), NOW)
    expect(over.multi!.status).toBe('OVER_BUDGET')
  })

  it('受取エリアを指定した場合、そのエリアの場所だけを使う', () => {
    const elsewhere = { ...C, area: '豊能町' }
    const r = allocate([A, B, elsewhere], demand({ area: '能勢町' }), NOW)
    expect(r.multi).toBeNull()
    expect(r.exclusions).toContainEqual({ reason: 'POINT', count: 1, quantityMilli: 2000 })
  })
})
