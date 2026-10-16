import { Crosshair, LocateFixed, MapPinned, Search, SlidersHorizontal, Store } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { RADIUS_OPTIONS, type LatLng, type PlaceResult } from '../../shared/geo.js'
import { api, errorMessage } from '../api.js'
import type { SearchState } from '../lib/search.js'
import { useSession } from '../session.js'
import { jstDateString } from '../../shared/time.js'
import { AreaFields } from './AreaFields.js'
import { Field, Notice } from './ui.js'

/** 位置情報の取得。利用者がボタンを押したときだけ呼ぶ（勝手には取得しない）。 */
function getCurrentPosition(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('unsupported'))
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    )
  })
}

const GEO_ERROR: Record<number, string> = {
  1: '位置情報の利用が許可されませんでした。地図をタップするか、地名で検索の中心を指定してください。',
  2: '現在地を取得できませんでした。地図をタップするか、地名で指定してください。',
  3: '現在地の取得に時間がかかりすぎました。もう一度お試しいただくか、地名で指定してください。',
}

/** 検索の中心の指定（現在地・地図から・地名）と、半径の選択 */
export function CenterAndRadius({
  state,
  onChange,
  picking,
  onPickingChange,
}: {
  state: SearchState
  onChange: (next: SearchState) => void
  picking: boolean
  onPickingChange: (picking: boolean) => void
}) {
  const [locating, setLocating] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [places, setPlaces] = useState<PlaceResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const { user } = useSession()
  const store = user?.storePosition ?? null

  const useCurrent = async () => {
    setLocating(true)
    setMessage(null)
    try {
      const center = await getCurrentPosition()
      onChange({ ...state, center, centerLabel: '現在地' })
    } catch (e) {
      const code = (e as GeolocationPositionError).code
      setMessage(GEO_ERROR[code] ?? 'この端末では現在地を使えません。地図をタップするか、地名で指定してください。')
    } finally {
      setLocating(false)
    }
  }

  const searchPlace = async (e: FormEvent) => {
    e.preventDefault()
    if (query.trim().length < 2) return setMessage('地名・住所を2文字以上で入力してください。')
    setSearching(true)
    setMessage(null)
    setPlaces(null)
    try {
      const res = await api<{ results: PlaceResult[] | null; message?: string }>('/api/geo', { body: { op: 'search', q: query.trim() } })
      if (res.results === null) setMessage(res.message ?? '地名の検索を利用できませんでした。地図をタップして指定してください。')
      else if (res.results.length === 0) setMessage(`「${query.trim()}」は見つかりませんでした。別の言い方（例：大阪市北区、梅田駅）でお試しください。`)
      else setPlaces(res.results)
    } catch (err) {
      setMessage(errorMessage(err))
    } finally {
      setSearching(false)
    }
  }

  return (
    <section className="card center-tools" aria-labelledby="center-title">
      <h2 id="center-title" className="card-title">
        どこで受け取りますか
      </h2>
      <AreaFields
        idPrefix="search-area"
        prefecture={state.prefecture}
        municipality={state.municipality}
        error={state.prefecture ? undefined : '受取エリアを選択してください'}
        onChange={(a) => onChange({ ...state, ...a })}
      />
      <Field label="受け取りたい日" hint="指定しない場合は、これから受け取れる農産物をすべて表示します。">
        <div className="input-row">
          <input className="input" type="date" min={jstDateString(Date.now())} value={state.date} onChange={(e) => onChange({ ...state, date: e.target.value })} />
          {state.date && (
            <button type="button" className="btn btn-small btn-quiet" onClick={() => onChange({ ...state, date: '' })}>
              指定しない
            </button>
          )}
        </div>
      </Field>
      <h3 className="sub-title">検索の中心と範囲（任意）</h3>
      <p className="field-hint" aria-live="polite">
        検索の中心：<strong>{state.center ? state.centerLabel || '指定した地点' : '未指定（距離では絞り込みません）'}</strong>
      </p>
      <div className="actions">
        {store && (
          <button type="button" className="btn" onClick={() => onChange({ ...state, center: store, centerLabel: '登録したお店の位置' })}>
            <Store aria-hidden="true" />
            お店の位置から
          </button>
        )}
        <button type="button" className="btn" onClick={useCurrent} disabled={locating}>
          <LocateFixed aria-hidden="true" />
          {locating ? '現在地を取得中…' : '現在地から'}
        </button>
        <button type="button" className="btn" aria-pressed={picking} onClick={() => onPickingChange(!picking)}>
          <Crosshair aria-hidden="true" />
          {picking ? '地図をタップしてください' : '地図から指定'}
        </button>
      </div>
      <form className="input-row" onSubmit={searchPlace} role="search" aria-label="地名・住所で中心を指定">
        <label className="visually-hidden" htmlFor="place-query">
          地名・住所
        </label>
        <input id="place-query" className="input" type="search" enterKeyHint="search" maxLength={60} placeholder="例：梅田、難波、大阪市北区" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="submit" className="btn btn-small" disabled={searching}>
          <Search aria-hidden="true" />
          {searching ? '検索中…' : '検索'}
        </button>
      </form>
      {places && (
        <div className="cards" aria-label="地名の候補">
          {places.map((p) => (
            <button
              key={`${p.lat},${p.lng}`}
              type="button"
              className="example-chip"
              onClick={() => {
                onChange({ ...state, center: { lat: p.lat, lng: p.lng }, centerLabel: p.label.split('、')[0] })
                setPlaces(null)
                onPickingChange(false)
              }}
            >
              <MapPinned size={18} aria-hidden="true" />
              {p.label}
            </button>
          ))}
          <p className="map-note">地名検索：© OpenStreetMap contributors（Nominatim）</p>
        </div>
      )}
      {message && <Notice kind="info">{<p>{message}</p>}</Notice>}
      <div className="field">
        <p className="field-label" id="radius-label">
          検索する範囲
        </p>
        <div className="radius-picker" role="group" aria-labelledby="radius-label">
          {RADIUS_OPTIONS.map((r) => (
            <button key={String(r)} type="button" aria-pressed={state.radiusKm === r} onClick={() => onChange({ ...state, radiusKm: r })}>
              {r === null ? '距離指定なし' : `${r}km以内`}
            </button>
          ))}
        </div>
        <p className="map-note">距離は地図上の直線距離です。実際の道のりや移動時間とは異なります。</p>
        {state.center && (
          <button type="button" className="link-button" onClick={() => onChange({ ...state, center: null, centerLabel: '' })}>
            検索の中心を解除する
          </button>
        )}
      </div>
    </section>
  )
}

/** 品目・価格・数量・規格外・エリアの絞り込み */
export function FilterFields({ state, onChange }: { state: SearchState; onChange: (next: SearchState) => void }) {
  const { master } = useSession()
  const set = <K extends keyof SearchState>(key: K, value: SearchState[K]) => onChange({ ...state, [key]: value })
  const activeCount = [state.itemId, state.maxPrice, state.minQty, state.irregular !== 'any' ? 'x' : ''].filter(Boolean).length
  return (
    <details className="alternatives" open={activeCount > 0}>
      <summary>
        <SlidersHorizontal size={20} aria-hidden="true" style={{ marginRight: 8 }} />
        絞り込み{activeCount > 0 ? `（${activeCount}件の条件）` : ''}
      </summary>
      <div className="filters">
        <div className="filter-row">
          <Field label="品目">
            <select className="input" value={state.itemId} onChange={(e) => set('itemId', e.target.value)}>
              <option value="">すべて</option>
              {master.items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="単価の上限（円）">
            <input className="input" type="text" inputMode="numeric" placeholder="指定なし" value={state.maxPrice} onChange={(e) => set('maxPrice', e.target.value)} />
          </Field>
          <Field label="在庫の下限">
            <input className="input" type="text" inputMode="decimal" placeholder="指定なし" value={state.minQty} onChange={(e) => set('minQty', e.target.value)} />
          </Field>
          <Field label="規格外品">
            <select className="input" value={state.irregular} onChange={(e) => set('irregular', e.target.value as SearchState['irregular'])}>
              <option value="any">含める</option>
              <option value="exclude">含めない</option>
              <option value="only">規格外品だけ</option>
            </select>
          </Field>
        </div>
        {activeCount > 0 && (
          <button type="button" className="link-button" onClick={() => onChange({ ...state, itemId: '', maxPrice: '', minQty: '', irregular: 'any' })}>
            絞り込みをすべて解除
          </button>
        )}
      </div>
    </details>
  )
}
