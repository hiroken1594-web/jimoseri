import type { ExclusionReason, IrregularReason, Unit } from './allocate.js'

export const UNITS: Unit[] = ['KG', 'PIECE', 'BUNCH', 'BAG']
export const UNIT_LABEL: Record<Unit, string> = { KG: 'kg', PIECE: '個', BUNCH: '束', BAG: '袋' }

export const IRREGULAR_REASONS: IrregularReason[] = ['SHAPE', 'SIZE', 'SURPLUS', 'OTHER']
// 規格外理由は、傷み・鮮度低下と混同しない表現にする（仕様 10-1）。
export const IRREGULAR_LABEL: Record<IrregularReason, string> = {
  SHAPE: '形の不揃い',
  SIZE: 'サイズの不揃い',
  SURPLUS: '余剰',
  OTHER: 'その他（規格外）',
}

export const EXCLUSION_LABEL: Record<ExclusionReason, string> = {
  UNIT: '数量単位が異なるため組み合わせられない在庫',
  IRREGULAR: '規格外のため対象外にした在庫',
  POINT: '受取エリアが異なる在庫',
  TIME: '希望日に受け取れない在庫',
  MIN_LOT: '最低販売量が希望量より多い在庫',
}

/** 例: 5000 → "5"、2500 → "2.5" */
export function formatQty(milli: number): string {
  return String(milli / 1000)
}

export function formatQtyUnit(milli: number, unit: Unit): string {
  return `${formatQty(milli)}${UNIT_LABEL[unit]}`
}

export function formatYen(yen: number): string {
  return `${yen.toLocaleString('ja-JP')}円`
}
