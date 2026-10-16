import { describe, expect, it } from 'vitest'
import { allocate, toMilli, type ListingCandidate } from '../shared/allocate.js'
import type { ConfirmedDemand } from '../shared/dto.js'
import { buildCopyText, buildMultiCopyText, describeStockChanges } from '../shared/format.js'
import { endOfJstDayMs, jstToMs } from '../shared/time.js'

const NOW = jstToMs('2026-10-12', '20:00')
const DAY = '2026-10-14'

const listing = (id: string, qty: number, price: number, irregular = false): ListingCandidate => ({
  id,
  producerId: `p-${id}`,
  producerName: `${id}農家`,
  itemId: 'tomato',
  variety: null,
  unit: 'KG',
  grade: irregular ? 'IRREGULAR' : 'REGULAR',
  irregularReason: irregular ? 'SHAPE' : null,
  quantityMilli: toMilli(qty),
  minMilli: 1000,
  stepMilli: 1000,
  unitPriceYen: price,
  pickupPointId: 'P',
  pickupPointName: '共通拠点P（デモ）',
  pickupStartMs: jstToMs(DAY, '10:00'),
  pickupEndMs: jstToMs(DAY, '11:00'),
  isPublished: true,
  updatedAtMs: NOW,
})

const demand: ConfirmedDemand = {
  itemId: 'tomato',
  itemName: 'トマト',
  quantityMilli: 10_000,
  unit: 'KG',
  timeMode: 'DEADLINE',
  date: DAY,
  time: null,
  municipality: null,
  budgetMaxYen: null,
  allowIrregular: true,
  allowMultiLocation: false,
  demoMode: false,
}

const spec = {
  itemId: 'tomato',
  unit: 'KG' as const,
  quantityMilli: 10_000,
  timeMode: 'DEADLINE' as const,
  targetMs: endOfJstDayMs(DAY),
  pickupPointId: 'P',
  budgetMaxYen: null,
  allowIrregular: true,
}

describe('相談用コピー（仕様 10-2）', () => {
  it('農家別の数量・価格・合計・受渡候補・未確保の注意を含む', () => {
    const result = allocate([listing('A', 5, 600), listing('B', 3, 550), listing('C', 2, 350, true)], spec, NOW)
    const text = buildCopyText(demand, result.best!, NOW)
    expect(text.split('\n')).toEqual([
      '【仕入れ相談用・未確保の提案】',
      '希望品目：トマト／希望量：10kg',
      'A農家：5kg × 600円 = 3,000円（税込）',
      'B農家：3kg × 550円 = 1,650円（税込）',
      'C農家：2kg × 350円 = 700円（税込、形の不揃いあり）',
      '合計：10kg／5,350円（税込商品代）',
      '受渡候補：10月14日(水) 10:00〜11:00／共通拠点P（デモ）',
      '計算時刻：10/12 20:00',
      '※これは注文・在庫予約・各農家の承認ではありません。条件と在庫を改めて確認してください。',
    ])
  })

  it('場所の住所と、公開が許可された連絡先だけを含める', () => {
    const result = allocate([listing('A', 5, 600), listing('B', 3, 550), listing('C', 2, 350, true)], spec, NOW)
    const text = buildCopyText(demand, result.best!, NOW, {
      locations: { P: { name: '共通拠点P（デモ）', municipality: '能勢町', address: 'テスト1-1', note: '' } },
      // サーバーは、本人が公開を選んだ項目だけを返す（B は非公開なので含まれない）
      contacts: { 'p-A': { phone: '090-0000-0000', note: '平日のみ' }, 'p-C': { email: 'c@example.com' } },
    })
    expect(text).toContain('受渡候補：10月14日(水) 10:00〜11:00／共通拠点P（デモ）（能勢町 テスト1-1）')
    expect(text).toContain('連絡先（生産者が公開を許可したもの）：')
    expect(text).toContain('A農家：電話 090-0000-0000／（平日のみ）')
    expect(text).toContain('C農家：メール c@example.com')
    expect(text).not.toMatch(/B農家：(電話|メール)/)
  })

  it('複数の場所で受け取る参考案は、場所ごとの日時と、移動時間を考慮していない旨を含む', () => {
    const elsewhere = { ...listing('C', 2, 350, true), pickupPointId: 'Q', pickupPointName: '拠点Q' }
    const result = allocate([listing('A', 5, 600), listing('B', 3, 550), elsewhere], { ...spec, pickupPointId: null, allowMultiLocation: true }, NOW)
    const text = buildMultiCopyText(demand, result.multi!, NOW)
    expect(text.split('\n')).toEqual([
      '【仕入れ相談用・未確保の提案（複数の場所で受け取る参考案）】',
      '希望品目：トマト／希望量：10kg',
      '■受取1：10月14日(水) 10:00〜11:00／共通拠点P（デモ）',
      'A農家：5kg × 600円 = 3,000円（税込）',
      'B農家：3kg × 550円 = 1,650円（税込）',
      '小計：8kg／4,650円',
      '■受取2：10月14日(水) 10:00〜11:00／拠点Q',
      'C農家：2kg × 350円 = 700円（税込、形の不揃いあり）',
      '小計：2kg／700円',
      '合計：10kg／5,350円（税込商品代）',
      '※受け取る場所が2か所あり、受取の調整が必要です。場所の間の移動時間は考慮していません。',
      '計算時刻：10/12 20:00',
      '※これは注文・在庫予約・各農家の承認ではありません。条件と在庫を改めて確認してください。',
    ])
  })

  it('不足している案には不足量を明記する', () => {
    const result = allocate([listing('A', 5, 600), listing('B', 3, 550)], spec, NOW)
    expect(buildCopyText(demand, result.best!, NOW)).toContain('※希望量に対して2kg不足しています。')
  })
})

describe('在庫変動の差分', () => {
  it('数量変更・出荷不可・新規登録を文章にする', () => {
    const before = allocate([listing('A', 5, 600), listing('B', 3, 550), listing('C', 2, 350)], spec, NOW).snapshot
    const after = allocate(
      [listing('A', 5, 600), { ...listing('B', 3, 550), isPublished: false }, listing('C', 1, 350), listing('D', 4, 500)],
      spec,
      NOW,
    ).snapshot
    expect(describeStockChanges(before, after)).toEqual([
      'B農家の3kgが出荷不可になりました（公開停止・数量0・期限切れなど）。',
      'C農家が2kg→1kgに変わりました。',
      'D農家の4kgが新しく登録されました。',
    ])
  })
})
