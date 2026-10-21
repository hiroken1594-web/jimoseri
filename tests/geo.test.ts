import { afterEach, describe, expect, it, vi } from 'vitest'
import { GeoUnavailableError, parseNominatim, parseZipcloud } from '../api/_lib/geocode.js'
import { distanceKm, formatDistance, formatZip, isInJapan, isValidLatLng, normalizeZip, withinRadius, sameMunicipality } from '../shared/geo.js'
import { addressSchema, locationCreateSchema, marketSearchSchema } from '../shared/schemas.js'

// 位置情報・郵便番号の共通処理（外部サービスへの通信はしない）
const OSAKA_STATION = { lat: 34.7025, lng: 135.4959 }

afterEach(() => vi.unstubAllGlobals())

describe('距離（直線距離・Haversine）', () => {
  it('同じ地点は0km', () => {
    expect(distanceKm(OSAKA_STATION, OSAKA_STATION)).toBe(0)
  })

  it('緯度1度はおよそ111km', () => {
    expect(distanceKm({ lat: 34, lng: 135 }, { lat: 35, lng: 135 })).toBeCloseTo(111.2, 0)
  })

  it('大阪駅から難波駅はおよそ4km', () => {
    const d = distanceKm(OSAKA_STATION, { lat: 34.6661, lng: 135.5003 })
    expect(d).toBeGreaterThan(3.8)
    expect(d).toBeLessThan(4.3)
  })

  it('A→B と B→A は同じ距離', () => {
    const a = { lat: 34.9719, lng: 135.4142 }
    expect(distanceKm(OSAKA_STATION, a)).toBeCloseTo(distanceKm(a, OSAKA_STATION), 10)
  })
})

describe('半径の判定（境界）', () => {
  // 中心から北へ 5km ちょうどの地点
  const fiveKmNorth = { lat: OSAKA_STATION.lat + (5 / 6371.0088) * (180 / Math.PI), lng: OSAKA_STATION.lng }

  it('境界ちょうどは半径の「中」に含める', () => {
    expect(distanceKm(OSAKA_STATION, fiveKmNorth)).toBeCloseTo(5, 3)
    expect(withinRadius(OSAKA_STATION, fiveKmNorth, 5)).toBe(true)
  })

  it('境界を少しでも越えたら「外」', () => {
    const outside = { lat: fiveKmNorth.lat + 0.001, lng: fiveKmNorth.lng }
    expect(withinRadius(OSAKA_STATION, outside, 5)).toBe(false)
    expect(withinRadius(OSAKA_STATION, outside, 10)).toBe(true)
  })

  it('「距離指定なし」は、どれだけ遠くても対象', () => {
    expect(withinRadius(OSAKA_STATION, { lat: 43.06, lng: 141.35 }, null)).toBe(true)
  })

  it('距離の表示（1km未満はm、10km未満は小数1桁）', () => {
    expect(formatDistance(0.234)).toBe('230m')
    expect(formatDistance(3.456)).toBe('3.5km')
    expect(formatDistance(12.6)).toBe('13km')
  })
})

describe('位置の検証', () => {
  it('範囲外・数値でない位置は不正', () => {
    expect(isValidLatLng({ lat: 34.7, lng: 135.5 })).toBe(true)
    expect(isValidLatLng({ lat: 91, lng: 0 })).toBe(false)
    expect(isValidLatLng({ lat: Number.NaN, lng: 0 })).toBe(false)
    expect(isValidLatLng(null)).toBe(false)
  })

  it('日本の範囲かどうか', () => {
    expect(isInJapan(OSAKA_STATION)).toBe(true)
    expect(isInJapan({ lat: 37.77, lng: -122.42 })).toBe(false)
  })

  it('検索の半径は決められた値だけ', () => {
    expect(marketSearchSchema.safeParse({ prefecture: '大阪府', center: OSAKA_STATION, radiusKm: 10 }).success).toBe(true)
    expect(marketSearchSchema.safeParse({ prefecture: '大阪府', center: null, radiusKm: null }).success).toBe(true)
    expect(marketSearchSchema.safeParse({ prefecture: '大阪府', center: OSAKA_STATION, radiusKm: 7 }).success).toBe(false)
    // 受取エリア（都道府県）は必須
    expect(marketSearchSchema.safeParse({ center: null, radiusKm: null }).success).toBe(false)
    expect(marketSearchSchema.safeParse({ prefecture: '', center: null, radiusKm: null }).success).toBe(false)
  })

  it('受渡拠点：地図に表示するには位置が必要。日本の外の位置は登録できない', () => {
    const base = { name: 'テスト', prefecture: '大阪府', municipality: '能勢町', address: 'テスト1-1', note: '' }
    // 都道府県は必須（受取エリアの検索に使う）
    expect(locationCreateSchema.safeParse({ ...base, prefecture: '' }).success).toBe(false)
    expect(locationCreateSchema.safeParse({ ...base, showOnMap: true }).success).toBe(false)
    expect(locationCreateSchema.safeParse({ ...base, showOnMap: true, latitude: 34.97, longitude: 135.41 }).success).toBe(true)
    expect(locationCreateSchema.safeParse({ ...base, latitude: 34.97 }).success).toBe(false)
    expect(locationCreateSchema.safeParse({ ...base, latitude: 37.77, longitude: -122.42 }).success).toBe(false)
  })
})

describe('郵便番号', () => {
  it('ハイフンあり・なし・全角・〒付きを7桁にそろえる', () => {
    expect(normalizeZip('5300001')).toBe('5300001')
    expect(normalizeZip('530-0001')).toBe('5300001')
    expect(normalizeZip('５３０－０００１')).toBe('5300001')
    expect(normalizeZip('〒530 0001')).toBe('5300001')
  })

  it('7桁にならない入力は null', () => {
    expect(normalizeZip('530001')).toBeNull()
    expect(normalizeZip('53000011')).toBeNull()
    expect(normalizeZip('abc-defg')).toBeNull()
    expect(normalizeZip('')).toBeNull()
  })

  it('表示用にハイフンを入れる', () => {
    expect(formatZip('5300001')).toBe('530-0001')
  })

  it('住所欄の郵便番号は空欄か7桁（ハイフン可）', () => {
    expect(addressSchema.safeParse({ postalCode: '530-0001' }).success).toBe(true)
    expect(addressSchema.safeParse({ postalCode: '' }).success).toBe(true)
    expect(addressSchema.safeParse({ postalCode: '53-0001' }).success).toBe(false)
  })
})

describe('郵便番号サービス（zipcloud）の応答の読み取り', () => {
  it('1件の住所', () => {
    const r = parseZipcloud({ status: 200, message: null, results: [{ zipcode: '5300001', address1: '大阪府', address2: '大阪市北区', address3: '梅田' }] })
    expect(r).toEqual([{ zipcode: '5300001', prefecture: '大阪府', city: '大阪市北区', town: '梅田' }])
  })

  it('複数の住所候補', () => {
    const r = parseZipcloud({
      status: 200,
      results: [
        { zipcode: '0790177', address1: '北海道', address2: '美唄市', address3: '上美唄町協和' },
        { zipcode: '0790177', address1: '北海道', address2: '美唄市', address3: '上美唄町南' },
      ],
    })
    expect(r.map((a) => a.town)).toEqual(['上美唄町協和', '上美唄町南'])
  })

  it('存在しない郵便番号は空の配列', () => {
    expect(parseZipcloud({ status: 200, message: null, results: null })).toEqual([])
  })

  it('サービスのエラーは GeoUnavailableError（画面では手入力へ案内）', () => {
    expect(() => parseZipcloud({ status: 500, message: 'error', results: null })).toThrow(GeoUnavailableError)
    expect(() => parseZipcloud('not json')).toThrow(GeoUnavailableError)
  })
})

describe('地名検索（Nominatim）の応答の読み取り', () => {
  it('日本の候補だけを、短い名前にして返す', () => {
    const r = parseNominatim([
      { display_name: '梅田, 北区, 大阪市, 大阪府, 530-0001, 日本', lat: '34.7038', lon: '135.4983' },
      { display_name: 'Umeda, Somewhere, USA', lat: '37.7', lon: '-122.4' },
    ])
    expect(r).toEqual([{ label: '梅田、北区、大阪市、大阪府', lat: 34.7038, lng: 135.4983 }])
  })

  it('配列でない応答は GeoUnavailableError', () => {
    expect(() => parseNominatim({ error: 'busy' })).toThrow(GeoUnavailableError)
  })
})

describe('市区町村名の比較', () => {
  it('郵便番号の住所（郡名つき）と、郡名なしの入力を同じ市区町村として扱う', () => {
    expect(sameMunicipality('豊能郡豊能町', '豊能町')).toBe(true)
    expect(sameMunicipality('豊能郡能勢町', '能勢町')).toBe(true)
    expect(sameMunicipality(' 大阪市福島区 ', '大阪市福島区')).toBe(true)
  })
  it('違う市区町村や、空の値は同じとしない', () => {
    expect(sameMunicipality('豊能町', '能勢町')).toBe(false)
    expect(sameMunicipality('', '')).toBe(false)
    expect(sameMunicipality(null, '豊能町')).toBe(false)
    // 「郡」で終わらない名前は変えない
    expect(sameMunicipality('郡山市', '山市')).toBe(false)
  })
})
