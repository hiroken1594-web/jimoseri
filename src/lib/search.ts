// 地図・一覧・スワイプで共有する検索条件。ブラウザのこのタブの中（sessionStorage）だけに保存し、サーバーには保存しない。
// 現在地もここに一時的に置くだけで、タブを閉じると消える。
import { DEFAULT_RADIUS_KM, type LatLng } from '../../shared/geo.js'
import type { MarketSearchInput } from '../../shared/schemas.js'
import { isDemoMode } from './demoMode.js'

export interface SearchState {
  /** 受取エリア（必須）：都道府県 */
  prefecture: string
  /** 受け取りたい日（YYYY-MM-DD）。'' は指定なし */
  date: string
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
  prefecture: '',
  date: '',
  center: null,
  centerLabel: '',
  radiusKm: DEFAULT_RADIUS_KM,
  itemId: '',
  maxPrice: '',
  minQty: '',
  irregular: 'any',
  municipality: '',
})

/** 登録したお店の情報（受取エリア・検索の中心の初期値に使う） */
export interface StoreDefaults {
  storePosition?: LatLng | null
  prefecture?: string | null
}

/**
 * このタブで前に使った条件。初めて開いたときは、登録したお店の都道府県を受取エリアに、お店の位置（あれば）を中心にする。
 * 受取エリアが空のままの古い条件にも、お店の都道府県を入れる。
 */
export function loadSearch(store: StoreDefaults = {}): SearchState {
  const initial = (): SearchState => ({
    ...defaultSearch(),
    prefecture: store.prefecture ?? '',
    ...(store.storePosition ? { center: store.storePosition, centerLabel: '登録したお店の位置' } : {}),
  })
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return initial()
    const saved = { ...defaultSearch(), ...(JSON.parse(raw) as Partial<SearchState>) }
    return saved.prefecture ? saved : { ...saved, prefecture: store.prefecture ?? '' }
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
    prefecture: state.prefecture,
    date: state.date || null,
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

/** 「条件を広げた場合の参考候補」を選んだときに、検索条件を変える */
export function applyWider(state: SearchState, patch: { radiusKm?: number | null; date?: null; municipality?: null }): SearchState {
  return {
    ...state,
    ...(patch.radiusKm !== undefined ? { radiusKm: patch.radiusKm } : {}),
    ...(patch.date === null ? { date: '' } : {}),
    ...(patch.municipality === null ? { municipality: '' } : {}),
  }
}
