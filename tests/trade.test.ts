import { describe, expect, it } from 'vitest'
import { formatPhone, normalizePhone } from '../shared/phone.js'
import { tradeStatusLabel, tradeTotals } from '../shared/trade.js'

describe('電話番号', () => {
  it('携帯・固定・IP電話を、ハイフンや全角があっても数字だけにそろえる', () => {
    expect(normalizePhone('090-1234-5678')).toBe('09012345678')
    expect(normalizePhone('０８０（１２３４）５６７８')).toBe('08012345678')
    expect(normalizePhone('06-6123-4567')).toBe('0661234567')
    expect(normalizePhone('072 123 4567')).toBe('0721234567')
    expect(normalizePhone('050-1234-5678')).toBe('05012345678')
    expect(normalizePhone('+81 90 1234 5678')).toBe('09012345678')
  })
  it('形式の違う番号は受け付けない', () => {
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone('12-3456')).toBeNull()
    expect(normalizePhone('0612345')).toBeNull()
    // 11桁なのに携帯・IP電話の番号ではない
    expect(normalizePhone('06123456789')).toBeNull()
    // 10桁なのに携帯の番号の形
    expect(normalizePhone('0901234567')).toBeNull()
    expect(normalizePhone('090-1234-567a')).toBeNull()
  })
  it('表示はハイフンを付ける', () => {
    expect(formatPhone('09012345678')).toBe('090-1234-5678')
    expect(formatPhone('0661234567')).toBe('06-6123-4567')
    expect(formatPhone('0721234567')).toBe('0721-23-4567')
  })
})

describe('取引の金額', () => {
  it('送料が決まっていれば、合計予定金額＝商品代＋送料', () => {
    expect(tradeTotals({ quantityMilli: 6000, unitPriceYen: 480, deliveryMethod: 'DELIVERY', shippingFeeYen: 500 })).toEqual({ subtotalYen: 2880, shippingYen: 500, totalYen: 3380 })
  })
  it('配送で送料が未確定なら、合計を確定した金額として出さない', () => {
    expect(tradeTotals({ quantityMilli: 2000, unitPriceYen: 480, deliveryMethod: 'DELIVERY', shippingFeeYen: null })).toEqual({ subtotalYen: 960, shippingYen: null, totalYen: null })
    expect(tradeTotals({ quantityMilli: 2000, unitPriceYen: 480, deliveryMethod: 'DISCUSS', shippingFeeYen: null }).totalYen).toBeNull()
  })
  it('受け取りで送料の入力がなければ、送料なし（0円）', () => {
    expect(tradeTotals({ quantityMilli: 1500, unitPriceYen: 600, deliveryMethod: 'PICKUP', shippingFeeYen: null })).toEqual({ subtotalYen: 900, shippingYen: 0, totalYen: 900 })
  })
})

describe('取引の状態の名前', () => {
  it('相談中は、見ている人が返事をする側かで変わる', () => {
    expect(tradeStatusLabel('PENDING', { iAmResponder: true })).toBe('相談中（あなたの返事待ち）')
    expect(tradeStatusLabel('PENDING', { iAmResponder: false })).toBe('相談中（相手の返事待ち）')
  })
  it('合意の後は、どちらが完了を確認したかで「相手の確認待ち」などを出す', () => {
    expect(tradeStatusLabel('AGREED', { iAmResponder: false, myCompleted: true, partnerCompleted: false })).toBe('取引条件に合意・相手の完了確認待ち')
    expect(tradeStatusLabel('AGREED', { iAmResponder: false, myCompleted: false, partnerCompleted: true })).toBe('取引条件に合意・あなたの完了確認待ち')
    expect(tradeStatusLabel('COMPLETED', { iAmResponder: false })).toBe('取引完了')
  })
})
