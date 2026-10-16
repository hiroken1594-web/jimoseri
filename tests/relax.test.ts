import { describe, expect, it } from 'vitest'
import { allocate, toMilli, type DemandSpec, type ListingCandidate } from '../shared/allocate.js'
import { suggestRelaxations } from '../shared/relax.js'
import { addDaysJst, endOfJstDayMs, jstToMs } from '../shared/time.js'

// 条件を広げた場合の参考（すべて架空のデータ）
const NOW = jstToMs('2026-10-12', '20:00')
const DAY = '2026-10-14'

function listing(over: Partial<ListingCandidate> & { id: string }): ListingCandidate {
  return {
    producerId: `p-${over.id}`,
    producerName: `${over.id}農家`,
    itemId: 'tomato',
    variety: null,
    unit: 'KG',
    grade: 'REGULAR',
    irregularReason: null,
    quantityMilli: toMilli(1),
    minMilli: toMilli(1),
    stepMilli: toMilli(1),
    unitPriceYen: 500,
    pickupPointId: 'P',
    pickupPointName: '福島区の拠点',
    area: '大阪市福島区',
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
    area: '大阪市福島区',
    budgetMaxYen: null,
    allowIrregular: false,
    ...over,
  }
}

const A = listing({ id: 'A', quantityMilli: toMilli(5) })
const B = listing({ id: 'B', quantityMilli: toMilli(2) })
const C = listing({ id: 'C', quantityMilli: toMilli(1) })
const run = (list: ListingCandidate[], spec = demand()) => {
  const base = allocate(list, spec, NOW)
  return { base, rel: suggestRelaxations(list, spec, base, NOW, { date: DAY }) }
}

describe('条件を広げた場合の参考', () => {
  it('希望量に届いているときは何も出さない', () => {
    const big = listing({ id: 'X', quantityMilli: toMilli(10) })
    expect(run([big]).rel).toEqual([])
  })

  it('5kg・2kg・1kgで8kg（2kg不足）。広げても増えない条件は出さない', () => {
    const { base, rel } = run([A, B, C])
    expect(base.best!.plan.totalMilli).toBe(8000)
    expect(base.best!.shortageMilli).toBe(2000)
    expect(rel).toEqual([])
  })

  it('翌日なら1農家で10kg → 受取日の延長を出し、希望量に届くと示す', () => {
    const next = addDaysJst(DAY, 1)
    const E = listing({ id: 'E', quantityMilli: toMilli(10), pickupStartMs: jstToMs(next, '10:00'), pickupEndMs: jstToMs(next, '11:00') })
    const { base, rel } = run([A, B, C, E])
    expect(base.best!.plan.totalMilli).toBe(8000)
    const date = rel.find((r) => r.kind === 'DATE')!
    expect(date.patch).toEqual({ date: next })
    expect(date.reachesTarget).toBe(true)
    expect(date.achievableMilli).toBe(10_000)
  })

  it('他のエリアなら集まる → エリア指定なしを出す', () => {
    const far = listing({ id: 'D', quantityMilli: toMilli(10), pickupPointId: 'Q', pickupPointName: '北区の拠点', area: '大阪市北区' })
    const rel = run([A, B, C, far]).rel
    const area = rel.find((r) => r.kind === 'AREA')!
    expect(area.patch).toEqual({ municipality: null, radiusKm: null })
    expect(area.reachesTarget).toBe(true)
  })

  it('規格外品を含めると増える → 規格外品も含めるを出す（3農家まで・届かない場合はその量を示す）', () => {
    const ir = listing({ id: 'I', quantityMilli: toMilli(2), grade: 'IRREGULAR', irregularReason: 'SHAPE' })
    const r = run([A, B, C, ir]).rel.find((x) => x.kind === 'IRREGULAR')!
    expect(r.achievableMilli).toBe(9000)
    expect(r.reachesTarget).toBe(false)
    expect(r.detail).toContain('9kg')
  })

  it('同じエリアの別の場所を合わせると届く → 複数の場所（参考案）を出す', () => {
    const other = listing({ id: 'F', quantityMilli: toMilli(3), pickupPointId: 'R', pickupPointName: '福島区の別の拠点' })
    const r = run([A, B, C, other]).rel.find((x) => x.kind === 'MULTI')!
    expect(r.patch).toEqual({ allowMultiLocation: true })
    expect(r.achievableMilli).toBeGreaterThanOrEqual(10_000)
  })

  it('日時を固定しているときは、その日のうちならよい条件を出す（複数の場所は出さない）', () => {
    const late = listing({ id: 'L', quantityMilli: toMilli(2), pickupStartMs: jstToMs(DAY, '15:00'), pickupEndMs: jstToMs(DAY, '16:00') })
    const spec = demand({ timeMode: 'EXACT', targetMs: jstToMs(DAY, '15:30') })
    const rel = run([A, B, C, late], spec).rel
    expect(rel.some((r) => r.kind === 'MULTI')).toBe(false)
    expect(rel.some((r) => r.kind === 'DATE')).toBe(false)
  })

  it('希望量に届くものを先に並べる', () => {
    const ir = listing({ id: 'I', quantityMilli: toMilli(2), grade: 'IRREGULAR', irregularReason: 'SHAPE' })
    const far = listing({ id: 'D', quantityMilli: toMilli(10), pickupPointId: 'Q', area: '大阪市北区' })
    const rel = run([A, B, C, ir, far]).rel
    expect(rel[0].reachesTarget).toBe(true)
    expect(rel.at(-1)!.reachesTarget).toBe(false)
  })
})
