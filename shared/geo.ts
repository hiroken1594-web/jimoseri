// 位置情報の共通処理（画面とサーバーの両方で使う）。

/** 半径検索で選べる距離（km）。null は「距離指定なし」。 */
export const RADIUS_OPTIONS: (number | null)[] = [1, 3, 5, 10, 20, 50, null]
export const DEFAULT_RADIUS_KM = 10

/** 地図の初期表示の中心（大阪駅付近）。位置情報を使わない場合の既定値。 */
export const DEFAULT_CENTER = { lat: 34.7025, lng: 135.4959 }

export interface LatLng {
  lat: number
  lng: number
}

export function isValidLatLng(p: Partial<LatLng> | null | undefined): p is LatLng {
  return (
    !!p &&
    typeof p.lat === 'number' &&
    typeof p.lng === 'number' &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180
  )
}

/** 日本の範囲（離島を含むおおまかな範囲）に入っているか */
export function isInJapan(p: LatLng): boolean {
  return p.lat >= 20 && p.lat <= 46 && p.lng >= 122 && p.lng <= 154
}

const EARTH_RADIUS_KM = 6371.0088

/** 2点間の直線距離（km）。Haversine 式。道路距離・移動時間ではない。 */
export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** 半径の中か（境界ちょうど（1mm以内の誤差を含む）は「中」に含める）。radiusKm が null なら常に true。 */
export function withinRadius(center: LatLng, point: LatLng, radiusKm: number | null): boolean {
  return radiusKm === null || distanceKm(center, point) <= radiusKm + 1e-6
}

export function formatDistance(km: number): string {
  if (km < 1) return `${Math.max(10, Math.round(km * 100) * 10)}m`
  return `${km < 10 ? km.toFixed(1) : Math.round(km)}km`
}

/** 郵便番号の入力を7桁の数字にそろえる（全角・ハイフン・空白・〒を許す）。7桁にならなければ null。 */
export function normalizeZip(input: string): string | null {
  const digits = input
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[〒\s\-ー－‐−]/g, '')
  return /^\d{7}$/.test(digits) ? digits : null
}

/**
 * 市区町村名を比べるための形にそろえる。郵便番号の住所は「豊能郡豊能町」のように郡名が付き、
 * 手で入力した場所は「豊能町」のこともあるため、郡名と前後の空白を除いて比べる。
 */
export function normalizeMunicipality(name: string | null | undefined): string {
  return (name ?? '').trim().replace(/\s+/g, '').replace(/^.+?郡(?=.+[町村]$)/, '')
}

export const sameMunicipality = (a: string | null | undefined, b: string | null | undefined): boolean =>
  normalizeMunicipality(a) !== '' && normalizeMunicipality(a) === normalizeMunicipality(b)

export function formatZip(zip7: string): string {
  return /^\d{7}$/.test(zip7) ? `${zip7.slice(0, 3)}-${zip7.slice(3)}` : zip7
}

/** 郵便番号から得られる住所の候補 */
export interface ZipAddress {
  zipcode: string
  prefecture: string
  city: string
  town: string
}

/** 地名・住所検索の候補 */
export interface PlaceResult {
  label: string
  lat: number
  lng: number
}
