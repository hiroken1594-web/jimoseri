// 取引（マッチング依頼・提案）の条件と状態の表示。決済・配送の手配はアプリでは行わない。

export type DeliveryMethod = 'PICKUP' | 'DELIVERY' | 'DISCUSS'
export type ShippingPayer = 'UNDECIDED' | 'RESTAURANT' | 'PRODUCER'

export const DELIVERY_LABEL: Record<DeliveryMethod, string> = {
  PICKUP: '生産者の指定場所で受け取る',
  DELIVERY: '飲食店の指定場所に配送する',
  DISCUSS: '双方で相談して決める',
}

export const PAYER_LABEL: Record<ShippingPayer, string> = {
  UNDECIDED: '未定',
  RESTAURANT: '飲食店',
  PRODUCER: '生産者',
}

export interface TradeTerms {
  quantityMilli: number
  unitPriceYen: number
  deliveryMethod: DeliveryMethod
  /** null は送料が未確定 */
  shippingFeeYen: number | null
}

/**
 * 商品代と合計予定金額。送料が未確定のときは、合計を確定した金額として出さない（totalYen が null）。
 * 受け取り（PICKUP）で送料が未入力なら、送料なし（0円）として扱う。
 */
export function tradeTotals(t: TradeTerms): { subtotalYen: number; shippingYen: number | null; totalYen: number | null } {
  const subtotalYen = Math.round((t.unitPriceYen * t.quantityMilli) / 1000)
  const shippingYen = t.shippingFeeYen ?? (t.deliveryMethod === 'PICKUP' ? 0 : null)
  return { subtotalYen, shippingYen, totalYen: shippingYen === null ? null : subtotalYen + shippingYen }
}

/** 取引の状態の名前（見ている人の立場で少し変える） */
export function tradeStatusLabel(
  status: 'PENDING' | 'ACCEPTED' | 'AGREED' | 'COMPLETED' | 'DECLINED' | 'CANCELLED',
  opts: { iAmResponder: boolean; myCompleted?: boolean; partnerCompleted?: boolean },
): string {
  switch (status) {
    case 'PENDING':
      return opts.iAmResponder ? '相談中（あなたの返事待ち）' : '相談中（相手の返事待ち）'
    case 'ACCEPTED':
      return 'マッチング成立・取引準備中'
    case 'AGREED':
      if (opts.myCompleted && !opts.partnerCompleted) return '取引条件に合意・相手の完了確認待ち'
      if (!opts.myCompleted && opts.partnerCompleted) return '取引条件に合意・あなたの完了確認待ち'
      return '取引条件に合意'
    case 'COMPLETED':
      return '取引完了'
    case 'DECLINED':
      return '辞退されました'
    case 'CANCELLED':
      return '取り下げられました'
  }
}

/** レビューが公開されるまでの日数（双方が投稿すればすぐ公開。片方だけでも、この日数が過ぎたら公開） */
export const REVIEW_PUBLISH_DAYS = 14
