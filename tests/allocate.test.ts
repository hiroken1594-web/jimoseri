import { describe, expect, it } from 'vitest'
import {
  allocate,
  DEFAULT_LIMITS,
  isOnLattice,
  toMilli,
  type DemandSpec,
  type ListingCandidate,
} from '../shared/allocate.js'
import { endOfJstDayMs, jstToMs } from '../shared/time.js'

// 仕様 8章・12章のデモデータ（すべて架空）
const NOW = jstToMs('2026-10-12', '20:00')
const DAY = '2026-10-14' // 明後日

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
    pickupPointName: '共通受渡拠点P',
    pickupStartMs: jstToMs(DAY, '10:00'),
    pickupEndMs: jstToMs(DAY, '11:00'),
    isPublished: true,
    updatedAtMs: NOW,
    ...over,
  }
}

const A = listing({ id: 'A', quantityMilli: toMilli(5), unitPriceYen: 600 })
const B = listing({ id: 'B', quantityMilli: toMilli(3), unitPriceYen: 550 })
const C = listing({
  id: 'C',
  quantityMilli: toMilli(2),
  unitPriceYen: 350,
  grade: 'IRREGULAR',
  irregularReason: 'SHAPE',
})

function demand(over: Partial<DemandSpec> = {}): DemandSpec {
  return {
    itemId: 'tomato',
    unit: 'KG',
    quantityMilli: toMilli(10),
    timeMode: 'DEADLINE',
    targetMs: endOfJstDayMs(DAY),
    pickupPointId: 'P',
    budgetMaxYen: null,
    allowIrregular: true,
    ...over,
  }
}

const qtyOf = (r: ReturnType<typeof allocate>, id: string) =>
  r.best?.plan.lines.find((l) => l.listingId === id)?.quantityMilli ?? 0

describe('仕様12章の受入試験', () => {
  it('成功：A5+B3+C2=10kg・5,350円', () => {
    const r = allocate([A, B, C], demand(), NOW)
    expect(r.status).toBe('MATCHED')
    expect(r.best!.plan.totalMilli).toBe(10_000)
    expect(r.best!.plan.totalYen).toBe(5350)
    expect(qtyOf(r, 'A')).toBe(5000)
    expect(qtyOf(r, 'B')).toBe(3000)
    expect(qtyOf(r, 'C')).toBe(2000)
    expect(r.best!.plan.lines.map((l) => l.subtotalYen).sort((x, y) => x - y)).toEqual([700, 1650, 3000])
    expect(r.best!.plan.windowStartMs).toBe(jstToMs(DAY, '10:00'))
    expect(r.best!.plan.windowEndMs).toBe(jstToMs(DAY, '11:00'))
    expect(r.searchTruncated).toBe(false)
  })

  it('規格外不可：8kg・2kg不足。成立表示しない', () => {
    const r = allocate([A, B, C], demand({ allowIrregular: false }), NOW)
    expect(r.status).toBe('SHORTAGE')
    expect(r.best!.plan.totalMilli).toBe(8000)
    expect(r.best!.shortageMilli).toBe(2000)
    expect(qtyOf(r, 'C')).toBe(0)
    expect(r.exclusions).toContainEqual({ reason: 'IRREGULAR', count: 1, quantityMilli: 2000 })
  })

  it('在庫変更：Cを1kgにすると9kg・1kg不足', () => {
    const r = allocate([A, B, { ...C, quantityMilli: toMilli(1) }], demand(), NOW)
    expect(r.status).toBe('SHORTAGE')
    expect(r.best!.plan.totalMilli).toBe(9000)
    expect(r.best!.shortageMilli).toBe(1000)
  })

  it('欠品：Bを非公開にするとA5+C2=7kg', () => {
    const r = allocate([A, { ...B, isPublished: false }, C], demand(), NOW)
    expect(r.status).toBe('SHORTAGE')
    expect(r.best!.plan.totalMilli).toBe(7000)
    expect(qtyOf(r, 'B')).toBe(0)
    expect(r.snapshot.map((s) => s.listingId)).not.toContain('B')
  })

  it('日時不一致：Cだけ共通時間帯から外れると成立案に含めない', () => {
    const c = { ...C, pickupStartMs: jstToMs(DAY, '14:00'), pickupEndMs: jstToMs(DAY, '15:00') }
    const r = allocate([A, B, c], demand(), NOW)
    expect(r.status).toBe('SHORTAGE')
    expect(r.best!.plan.totalMilli).toBe(8000)
    expect(qtyOf(r, 'C')).toBe(0)
    expect(r.best!.windowConflict).toBe(true)
  })

  it('拠点不一致：Cだけ別拠点なら同じ案に含めない', () => {
    const c = { ...C, pickupPointId: 'Q', pickupPointName: '拠点Q' }
    const r = allocate([A, B, c], demand(), NOW)
    expect(r.status).toBe('SHORTAGE')
    expect(r.best!.plan.totalMilli).toBe(8000)
    expect(r.exclusions).toContainEqual({ reason: 'POINT', count: 1, quantityMilli: 2000 })

    // 拠点指定なし：拠点ごとに計算し、拠点をまたいで合算しない
    const open = allocate([A, B, c], demand({ pickupPointId: null }), NOW)
    expect(open.best!.pickupPointId).toBe('P')
    expect(open.best!.plan.totalMilli).toBe(8000)
    expect(open.alternatives).toHaveLength(1)
    expect(open.alternatives[0].pickupPointId).toBe('Q')
    expect(open.alternatives[0].plan.totalMilli).toBe(2000)
  })

  it('販売刻み：1kg刻みの商品に0.5kgを割り当てない', () => {
    const r = allocate([A, B, C], demand({ quantityMilli: toMilli(9.5) }), NOW)
    expect(r.status).toBe('SHORTAGE')
    expect(r.best!.plan.totalMilli).toBe(9000)
    expect(r.best!.shortageMilli).toBe(500)
    for (const line of r.best!.plan.lines) {
      expect(isOnLattice({ minMilli: 1000, stepMilli: 1000 }, line.quantityMilli)).toBe(true)
    }
  })

  it('予算：上限5,000円なら条件達成とせず予算超過（最安5,350円）を示す', () => {
    const r = allocate([A, B, C], demand({ budgetMaxYen: 5000 }), NOW)
    expect(r.status).toBe('OVER_BUDGET')
    expect(r.best!.plan.totalMilli).toBe(10_000)
    expect(r.best!.plan.totalYen).toBe(5350)

    expect(allocate([A, B, C], demand({ budgetMaxYen: 5350 }), NOW).status).toBe('MATCHED')
  })
})

describe('配分ルール', () => {
  it('在庫を超えて割り当てない・希望量を超えない', () => {
    const r = allocate([A, B, C], demand({ quantityMilli: toMilli(4) }), NOW)
    expect(r.status).toBe('MATCHED')
    expect(r.best!.plan.totalMilli).toBe(4000)
    for (const line of r.best!.plan.lines) {
      const src = [A, B, C].find((l) => l.id === line.listingId)!
      expect(line.quantityMilli).toBeLessThanOrEqual(src.quantityMilli)
    }
  })

  it('生産者数が少ない案を、安い案より優先する', () => {
    const big = listing({ id: 'D', quantityMilli: toMilli(10), unitPriceYen: 900 })
    const r = allocate([A, B, C, big], demand(), NOW)
    expect(r.status).toBe('MATCHED')
    expect(r.best!.plan.producerCount).toBe(1)
    expect(r.best!.plan.totalYen).toBe(9000)
  })

  it('予算があるときは、生産者が増えても予算内の案を条件達成として選ぶ', () => {
    const big = listing({ id: 'D', quantityMilli: toMilli(10), unitPriceYen: 900 })
    const r = allocate([A, B, C, big], demand({ budgetMaxYen: 6000 }), NOW)
    expect(r.status).toBe('MATCHED')
    expect(r.best!.plan.totalYen).toBe(5350)
    expect(r.best!.plan.producerCount).toBe(3)
  })

  it('同じ生産者数なら安い案を選ぶ', () => {
    const cheap = listing({ id: 'E', quantityMilli: toMilli(5), unitPriceYen: 400 })
    const r = allocate([A, B, cheap], demand({ quantityMilli: toMilli(5) }), NOW)
    expect(r.best!.plan.producerCount).toBe(1)
    expect(r.best!.plan.lines[0].listingId).toBe('E')
  })

  it('最大3農家：4農家に3kgずつあっても9kgまで', () => {
    const four = ['W', 'X', 'Y', 'Z'].map((id) => listing({ id, quantityMilli: toMilli(3) }))
    const r = allocate(four, demand(), NOW)
    expect(r.status).toBe('SHORTAGE')
    expect(r.best!.plan.totalMilli).toBe(9000)
    expect(r.best!.plan.producerCount).toBe(3)
    expect(r.eligibleMilli).toBe(12_000)
    expect(r.best!.windowConflict).toBe(false)
  })

  it('最低販売量を下回る割当をしない', () => {
    const lot = listing({ id: 'L', quantityMilli: toMilli(10), minMilli: toMilli(5), stepMilli: toMilli(5) })
    const r = allocate([lot], demand({ quantityMilli: toMilli(3) }), NOW)
    expect(r.status).toBe('MISMATCH')
    expect(r.best).toBeNull()
    expect(r.exclusions[0].reason).toBe('MIN_LOT')
  })

  it('単位が異なる出品は換算せず除外する', () => {
    const pieces = listing({ id: 'N', unit: 'PIECE', quantityMilli: toMilli(100) })
    const r = allocate([A, pieces], demand(), NOW)
    expect(r.best!.plan.totalMilli).toBe(5000)
    expect(r.exclusions).toContainEqual({ reason: 'UNIT', count: 1, quantityMilli: 0 })
  })

  it('販売可能期間を過ぎた出品・数量0の出品は除外する', () => {
    const expired = { ...B, pickupStartMs: jstToMs('2026-10-12', '10:00'), pickupEndMs: jstToMs('2026-10-12', '11:00') }
    const r = allocate([A, expired, { ...C, quantityMilli: 0 }], demand(), NOW)
    expect(r.best!.plan.totalMilli).toBe(5000)
    expect(r.snapshot.map((s) => s.listingId)).toEqual(['A'])
  })

  it('期限より後にしか受け取れない出品は除外する', () => {
    const late = { ...C, pickupStartMs: jstToMs('2026-10-15', '10:00'), pickupEndMs: jstToMs('2026-10-15', '11:00') }
    const r = allocate([A, B, late], demand(), NOW)
    expect(r.best!.plan.totalMilli).toBe(8000)
    expect(r.exclusions).toContainEqual({ reason: 'TIME', count: 1, quantityMilli: 2000 })
  })

  it('日時指定：その時刻を含む時間帯の出品だけを使う', () => {
    const ok = allocate([A, B, C], demand({ timeMode: 'EXACT', targetMs: jstToMs(DAY, '10:30') }), NOW)
    expect(ok.status).toBe('MATCHED')
    const ng = allocate([A, B, C], demand({ timeMode: 'EXACT', targetMs: jstToMs(DAY, '13:00') }), NOW)
    expect(ng.status).toBe('MISMATCH')
    expect(ng.best).toBeNull()
  })

  it('同じ品目の出品がなければ NONE', () => {
    expect(allocate([A], demand({ itemId: 'eggplant' }), NOW).status).toBe('NONE')
  })

  it('小数の刻み（0.5kg）でも誤差なく計算する', () => {
    const half = listing({ id: 'H', quantityMilli: toMilli(2.5), minMilli: toMilli(0.5), stepMilli: toMilli(0.5), unitPriceYen: 555 })
    const r = allocate([half], demand({ quantityMilli: toMilli(1.5) }), NOW)
    expect(r.status).toBe('MATCHED')
    expect(r.best!.plan.totalYen).toBe(833) // 555 × 1.5 = 832.5 → 四捨五入
  })

  it('探索上限に達したら searchTruncated を立てる', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      listing({ id: `M${i}`, quantityMilli: toMilli(7), minMilli: toMilli(0.1), stepMilli: toMilli(0.1), unitPriceYen: 300 + i }),
    )
    const r = allocate(many, demand({ quantityMilli: toMilli(20.05) }), NOW, { ...DEFAULT_LIMITS, maxNodes: 2000 })
    expect(r.searchTruncated).toBe(true)
    expect(r.best!.plan.totalMilli).toBeLessThanOrEqual(20_050)
    expect(r.best!.plan.producerCount).toBeLessThanOrEqual(3)
  })
})
