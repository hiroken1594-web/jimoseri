// 地図・一覧・スワイプで共有する検索条件。ブラウザのこのタブの中（sessionStorage）だけに保存し、サーバーには保存しない。
// 現在地もここに一時的に置くだけで、タブを閉じると消える。
import { DEFAULT_RADIUS_KM, type LatLng } from '../../shared/geo.js'
import type { MarketSearchInput } from '../../shared/schemas.js'
import { isDemoMode } from './demoMode.js'

export interface SearchState {
  center: LatLng | null
  centerLabel: string
  /** null は「距離指定なし」 */
  radiusKm: number | null
  itemId: string
  maxPrice: string
  minQty: string
  irregular: 'any' | 'exclude' | 'only'
  municipality: string
}

const KEY = 'jimoseri.search.v1'

export const defaultSearch = (): SearchState => ({
  center: null,
  centerLabel: '',
  radiusKm: DEFAULT_RADIUS_KM,
  itemId: '',
  maxPrice: '',
  minQty: '',
  irregular: 'any',
  municipality: '',
})

/** このタブで前に使った条件。初めて開いたときは、登録したお店の位置（あれば）を中心にする。 */
export function loadSearch(storePosition?: LatLng | null): SearchState {
  const initial = (): SearchState => (storePosition ? { ...defaultSearch(), center: storePosition, centerLabel: '登録したお店の位置' } : defaultSearch())
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? { ...defaultSearch(), ...(JSON.parse(raw) as Partial<SearchState>) } : initial()
  } catch {
    return initial()
  }
}

export function saveSearch(state: SearchState): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // 保存できない環境でも検索はできる
  }
}

export function clearSearch(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // 何もしない
  }
}

const toNumber = (s: string) => {
  const n = Number(s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[,，]/g, ''))
  return s.trim() && Number.isFinite(n) && n > 0 ? n : null
}

/** 画面の検索条件を API の形にする。中心が無いときは距離で絞り込まない。 */
export function toSearchInput(state: SearchState): MarketSearchInput {
  return {
    center: state.center,
    radiusKm: state.center ? (state.radiusKm as MarketSearchInput['radiusKm']) : null,
    itemId: state.itemId || null,
    maxPriceYen: toNumber(state.maxPrice) ? Math.round(toNumber(state.maxPrice)!) : null,
    minQuantity: toNumber(state.minQty),
    irregular: state.irregular,
    municipality: state.municipality || null,
    demo: isDemoMode(),
  }
}
