import { Eye, EyeOff, MapPin, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { LocationDto, ReviewStatus } from '../../shared/dto.js'
import { DEFAULT_CENTER, type LatLng, type PlaceResult } from '../../shared/geo.js'
import type { LocationCreateInput } from '../../shared/schemas.js'
import { api, ApiError, errorMessage } from '../api.js'
import { AddressFields, addressErrors, addressFromSaved, addressPayload, emptyAddress, type AddressValue } from '../components/AddressFields.js'
import { MapView } from '../components/MapView.js'
import { EmptyState, Field, Loading, Notice, PageTitle } from '../components/ui.js'
import { useSession } from '../session.js'

const STATUS: Record<ReviewStatus, { label: string; className: string; text: string }> = {
  PENDING: { label: '確認待ち', className: 'chip chip-warn', text: '運営者の確認が済むまで、仕入れ案と地図には出ません。' },
  APPROVED: { label: '確認済み', className: 'chip chip-live', text: '仕入れ案に使われます。' },
  SUSPENDED: { label: '停止中', className: 'chip chip-off', text: '運営者により停止されています。' },
  REJECTED: { label: '却下', className: 'chip chip-off', text: '運営者が却下しました。理由を確認し、内容を直して保存すると、もう一度確認を受けられます。' },
}

interface Draft {
  name: string
  address: AddressValue
  latLng: LatLng | null
  showOnMap: boolean
  hours: string
  note: string
}

const emptyDraft = (area: string): Draft => ({ name: '', address: { ...emptyAddress(), city: area }, latLng: null, showOnMap: false, hours: '', note: '' })

function draftFrom(l: LocationDto): Draft {
  // 保存している「住所・目印」から、町域の部分を取り除いて番地・目印の欄に戻す
  const line = l.town && l.address.startsWith(l.town) ? l.address.slice(l.town.length) : l.address
  return {
    name: l.name,
    address: addressFromSaved({ postalCode: l.postalCode, prefecture: l.prefecture, city: l.municipality, town: l.town, addressLine: line, building: l.building ?? null }),
    latLng: l.latitude !== null && l.longitude !== null ? { lat: l.latitude, lng: l.longitude } : null,
    showOnMap: l.showOnMap,
    hours: l.hours,
    note: l.note,
  }
}

function LocationEditor({ initial, editingId, onDone, onCancel }: { initial: Draft; editingId: string | null; onDone: (message: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<Draft>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [finding, setFinding] = useState(false)
  const [places, setPlaces] = useState<PlaceResult[] | null>(null)
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))

  // 住所から地図の位置の候補を探す（郵便番号だけでは正確な位置は決まらないため、必ず地図で確かめてもらう）
  const findOnMap = async () => {
    const a = draft.address
    const q = [a.prefecture, a.city, a.town, a.addressLine].filter(Boolean).join('')
    if (q.length < 2) return setProblem('先に住所を入力してください。')
    setFinding(true)
    setProblem(null)
    try {
      const res = await api<{ results: PlaceResult[] | null; message?: string }>('/api/geo', { body: { op: 'search', q } })
      if (res.results === null) setProblem(res.message ?? '位置を探せませんでした。地図をタップしてピンを置いてください。')
      else if (res.results.length === 0) setProblem('住所から位置が見つかりませんでした。地図をタップしてピンを置いてください。')
      else if (res.results.length === 1) set('latLng', { lat: res.results[0].lat, lng: res.results[0].lng })
      else setPlaces(res.results)
    } catch (e) {
      setProblem(errorMessage(e))
    } finally {
      setFinding(false)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const a = draft.address
    const next: Record<string, string> = {}
    if (!draft.name.trim()) next.name = '受渡場所の名称を入力してください'
    // 住所はすべて必須（郵便番号・都道府県・市区町村・町域・丁目番地・建物名または「建物名なし」）
    Object.assign(next, addressErrors(a))
    if (draft.showOnMap && !draft.latLng) next.showOnMap = '地図に表示するには、地図をタップして位置を指定してください'
    setErrors(next)
    if (Object.keys(next).length > 0) return
    const ad = addressPayload(a)
    const body: LocationCreateInput = {
      name: draft.name.trim(),
      municipality: ad.city,
      address: `${ad.town}${ad.addressLine}`,
      note: draft.note.trim(),
      postalCode: ad.postalCode,
      prefecture: ad.prefecture,
      town: ad.town,
      addressLine: ad.addressLine,
      building: ad.building,
      latitude: draft.latLng?.lat ?? null,
      longitude: draft.latLng?.lng ?? null,
      showOnMap: draft.showOnMap,
      hours: draft.hours.trim(),
    }
    setBusy(true)
    setProblem(null)
    try {
      const res = editingId
        ? await api<{ reviewAgain?: boolean }>(`/api/locations?id=${encodeURIComponent(editingId)}`, { method: 'PUT', body })
        : await api<object>('/api/locations', { body })
      onDone(
        editingId
          ? (res as { reviewAgain?: boolean }).reviewAgain
            ? '変更しました。名称・住所・位置を変えたため、運営者の確認を受け直します。'
            : '変更しました。'
          : '登録しました。運営者が確認すると、仕入れ案や地図に使われるようになります。',
      )
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setProblem(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card form" onSubmit={submit} noValidate aria-labelledby="loc-form-title">
      <h2 id="loc-form-title" className="card-title">
        {editingId ? '受渡拠点を編集' : '受渡拠点を登録'}
      </h2>
      {problem && <Notice kind="error">{<p>{problem}</p>}</Notice>}
      <Field label="名称" required error={errors.name} hint="例：〇〇農園 直売所前、△△集荷場">
        <input className="input" type="text" maxLength={40} value={draft.name} onChange={(e) => set('name', e.target.value)} />
      </Field>
      <AddressFields
        idPrefix="loc"
        value={draft.address}
        onChange={(v) => set('address', v)}
        errors={errors}
        addressLineLabel="番地・目印"
        addressLineHint="飲食店に表示されます。自宅の場合は、番地まで書かず目印にとどめるなど、公開してよい範囲で入力してください。"
      />

      <div className="field">
        <p className="field-label">地図での位置</p>
        <p className="field-hint">
          地図をタップするとピンを置けます。郵便番号や住所だけでは正確な位置が決まらないため、必ず地図で確かめてください。正確な場所でなく、近くの目印でも構いません。
        </p>
        <button type="button" className="btn btn-small" onClick={findOnMap} disabled={finding}>
          <Search aria-hidden="true" />
          {finding ? '探しています…' : '住所から位置の候補を探す'}
        </button>
        {places && (
          <div className="cards">
            {places.map((p) => (
              <button
                key={`${p.lat},${p.lng}`}
                type="button"
                className="example-chip"
                onClick={() => {
                  set('latLng', { lat: p.lat, lng: p.lng })
                  setPlaces(null)
                }}
              >
                <MapPin size={18} aria-hidden="true" />
                {p.label}
              </button>
            ))}
            <p className="map-note">地名検索：© OpenStreetMap contributors（Nominatim）</p>
          </div>
        )}
        <MapView
          small
          label="受渡拠点の位置を指定する地図。タップでピンを置けます"
          center={draft.latLng ?? DEFAULT_CENTER}
          zoom={draft.latLng ? 16 : 10}
          markers={draft.latLng ? [{ id: 'pin', lat: draft.latLng.lat, lng: draft.latLng.lng, label: '受渡拠点の位置', selected: true }] : []}
          onMapClick={(p) => set('latLng', p)}
        />
        <p className="field-hint" aria-live="polite">
          {draft.latLng ? `位置を指定しました（緯度 ${draft.latLng.lat.toFixed(5)}、経度 ${draft.latLng.lng.toFixed(5)}）。` : 'まだ位置を指定していません。'}
          {draft.latLng && (
            <button type="button" className="link-button" onClick={() => set('latLng', null)}>
              位置を消す
            </button>
          )}
        </p>
      </div>

      <div className={errors.showOnMap ? 'field field-invalid' : 'field'}>
        <label className="check check-box">
          <input type="checkbox" checked={draft.showOnMap} onChange={(e) => set('showOnMap', e.target.checked)} />
          <span>
            <strong>飲食店向けの地図に表示する</strong>
            <small className="block">
              オンにすると、運営者の確認後、ログインした飲食店が見る地図にピンと名称・住所（上で入力した範囲）が表示され、距離での検索の対象になります。オフの場合、位置は誰にも公開されません。
            </small>
          </span>
        </label>
        {errors.showOnMap && (
          <p className="field-error" role="alert">
            {errors.showOnMap}
          </p>
        )}
      </div>
      <Field label="受取できる日時の目安" hint="例：平日10〜16時、土曜は午前のみ（出品ごとの受渡日時は出品で設定します）">
        <input className="input" type="text" maxLength={60} value={draft.hours} onChange={(e) => set('hours', e.target.value)} />
      </Field>
      <Field label="補足" hint="例：駐車場あり、到着したら電話してください">
        <input className="input" type="text" maxLength={100} value={draft.note} onChange={(e) => set('note', e.target.value)} />
      </Field>
      <div className="actions">
        <button className="btn btn-primary btn-large" type="submit" disabled={busy}>
          {busy ? '保存中…' : editingId ? '変更を保存する' : 'この内容で登録する'}
        </button>
        <button className="btn btn-large btn-quiet" type="button" onClick={onCancel} disabled={busy}>
          やめる
        </button>
      </div>
    </form>
  )
}

export function ProducerLocations() {
  const { user, refresh } = useSession()
  const [locations, setLocations] = useState<LocationDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLocations((await api<{ locations: LocationDto[] }>('/api/locations')).locations)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const remove = async (l: LocationDto) => {
    if (!window.confirm(`「${l.name}」を削除しますか？`)) return
    setMessage(null)
    try {
      await api(`/api/locations?id=${encodeURIComponent(l.id)}`, { method: 'DELETE' })
      setMessage('削除しました。')
      await load()
      await refresh().catch(() => undefined)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  if (editing) {
    return (
      <>
        <PageTitle icon={MapPin}>受渡拠点</PageTitle>
        <LocationEditor
          initial={editing.draft}
          editingId={editing.id}
          onCancel={() => setEditing(null)}
          onDone={async (msg) => {
            setEditing(null)
            setMessage(msg)
            await load()
            await refresh().catch(() => undefined)
            window.scrollTo(0, 0)
          }}
        />
      </>
    )
  }

  return (
    <>
      <PageTitle icon={MapPin}>受渡拠点</PageTitle>
      <p className="page-lead">飲食店が農産物を受け取りに来る場所です。複数登録できます。新しい場所は、運営者の確認後に使えるようになります。</p>
      <button className="btn btn-primary btn-large btn-block" onClick={() => setEditing({ id: null, draft: emptyDraft(user?.area ?? '') })}>
        <Plus aria-hidden="true" />
        受渡拠点を登録
      </button>
      {message && <Notice kind="success">{<p>{message}</p>}</Notice>}
      {error && <Notice kind="error">{<p>{error}</p>}</Notice>}
      {!locations && !error && <Loading label="読み込んでいます…" />}
      {locations && locations.length === 0 && (
        <EmptyState illust="📍" title="まだ受渡拠点がありません">
          <p>直売所や集荷場など、飲食店が受け取りに来られる場所を登録しましょう。出品の登録画面からも追加できます。</p>
        </EmptyState>
      )}
      {locations && locations.length > 0 && (
        <div className="cards">
          {locations.map((l) => (
            <article className="card" key={l.id}>
              <header className="card-head">
                <h3>{l.name}</h3>
                <span className={STATUS[l.status].className}>{STATUS[l.status].label}</span>
              </header>
              <p className="muted">
                {l.postalCode && `〒${l.postalCode} `}
                {l.prefecture}
                {l.municipality} {l.address}
              </p>
              <p className="chips">
                {l.showOnMap ? (
                  <span className="chip chip-live">
                    <Eye aria-hidden="true" />
                    地図に表示する
                  </span>
                ) : (
                  <span className="chip chip-off">
                    <EyeOff aria-hidden="true" />
                    地図に表示しない
                  </span>
                )}
                <span className="chip">{l.latitude !== null ? '位置：指定済み' : '位置：未指定'}</span>
                <span className="chip">出品 {l.listingCount ?? 0}件</span>
              </p>
              <p className="field-hint">{STATUS[l.status].text}</p>
              {l.status === 'REJECTED' && l.reviewNote && <p className="field-error">却下の理由：{l.reviewNote}</p>}
              {l.hours && <p className="muted">受取の目安：{l.hours}</p>}
              {l.latitude !== null && l.longitude !== null && (
                <MapView small label={`${l.name}の位置`} center={{ lat: l.latitude, lng: l.longitude }} zoom={15} markers={[{ id: l.id, lat: l.latitude, lng: l.longitude, label: l.name }]} />
              )}
              <div className="card-actions">
                <button className="btn" onClick={() => setEditing({ id: l.id, draft: draftFrom(l) })}>
                  <Pencil aria-hidden="true" />
                  編集
                </button>
                <button className="btn btn-quiet" onClick={() => remove(l)} disabled={(l.listingCount ?? 0) > 0} aria-describedby={(l.listingCount ?? 0) > 0 ? `in-use-${l.id}` : undefined}>
                  <Trash2 aria-hidden="true" />
                  削除
                </button>
              </div>
              {(l.listingCount ?? 0) > 0 && (
                <p id={`in-use-${l.id}`} className="field-hint">
                  出品に使われているため削除できません。
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  )
}
