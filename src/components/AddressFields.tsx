import { Loader2, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatZip, normalizeZip, type ZipAddress } from '../../shared/geo.js'
import { api, errorMessage } from '../api.js'
import { Field } from './ui.js'

export interface AddressValue {
  postalCode: string
  prefecture: string
  city: string
  town: string
  addressLine: string
}

export const emptyAddress = (): AddressValue => ({ postalCode: '', prefecture: '', city: '', town: '', addressLine: '' })

export const PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
  '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
  '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
]

type Status =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'filled'; message: string }
  | { kind: 'choose'; options: ZipAddress[] }
  | { kind: 'notfound' }
  | { kind: 'unavailable'; message: string }

/** 郵便番号から住所を調べる（zipcloud をサーバー経由で呼ぶ）。失敗しても手入力で続けられる。 */
export async function lookupZip(zip: string): Promise<{ results: ZipAddress[] | null; message?: string }> {
  return api<{ results: ZipAddress[] | null; message?: string }>('/api/geo', { body: { op: 'zip', zip } })
}

/**
 * 住所の入力欄。郵便番号7桁を入れると、都道府県・市区町村・町域を自動で入れる。
 * 番地・建物名は手入力。自動入力の後も、どの欄も自由に直せる。
 */
export function AddressFields({
  value,
  onChange,
  errors = {},
  idPrefix,
  addressLineLabel = '番地・建物名',
  addressLineHint,
}: {
  value: AddressValue
  onChange: (next: AddressValue) => void
  errors?: Partial<Record<keyof AddressValue, string>>
  idPrefix: string
  addressLineLabel?: string
  addressLineHint?: string
}) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const lastLooked = useRef<string | null>(null)
  const latest = useRef(value)
  latest.current = value

  const apply = (a: ZipAddress) => {
    onChange({ ...latest.current, postalCode: formatZip(a.zipcode), prefecture: a.prefecture, city: a.city, town: a.town })
    setStatus({ kind: 'filled', message: `${a.prefecture}${a.city}${a.town} を入力しました。番地・建物名を続けて入力してください。` })
  }

  const search = async (zip7: string) => {
    lastLooked.current = zip7
    setStatus({ kind: 'searching' })
    try {
      const res = await lookupZip(zip7)
      if (lastLooked.current !== zip7) return
      if (res.results === null) return setStatus({ kind: 'unavailable', message: res.message ?? '住所の自動入力を利用できませんでした。手入力してください。' })
      if (res.results.length === 0) return setStatus({ kind: 'notfound' })
      if (res.results.length === 1) return apply(res.results[0])
      setStatus({ kind: 'choose', options: res.results })
    } catch (e) {
      setStatus({ kind: 'unavailable', message: `${errorMessage(e)} 住所は手入力できます。` })
    }
  }

  // 7桁がそろったら、少し待ってから自動で調べる（入力の途中では呼ばない）
  useEffect(() => {
    const zip7 = normalizeZip(value.postalCode)
    if (!zip7 || zip7 === lastLooked.current) return
    const timer = setTimeout(() => void search(zip7), 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.postalCode])

  const set = (key: keyof AddressValue, v: string) => onChange({ ...value, [key]: v })
  const zipValid = normalizeZip(value.postalCode)

  return (
    <fieldset className="form" style={{ border: 'none', padding: 0, margin: 0, gap: 16 }}>
      <Field label="郵便番号" error={errors.postalCode} hint="7桁を入力すると、住所を自動で入力します（ハイフンはあってもなくても構いません）。">
        <div className="input-row">
          <input
            id={`${idPrefix}-zip`}
            className="input"
            type="text"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={9}
            placeholder="例：530-0001"
            value={value.postalCode}
            onChange={(e) => {
              set('postalCode', e.target.value)
              if (status.kind !== 'searching') setStatus({ kind: 'idle' })
            }}
            aria-describedby={`${idPrefix}-zip-status`}
          />
          <button type="button" className="btn btn-small btn-quiet" disabled={!zipValid || status.kind === 'searching'} onClick={() => zipValid && void search(zipValid)}>
            <Search aria-hidden="true" />
            住所を検索
          </button>
        </div>
      </Field>
      <div id={`${idPrefix}-zip-status`} aria-live="polite">
        {status.kind === 'searching' && (
          <p className="field-hint">
            <Loader2 size={16} aria-hidden="true" style={{ verticalAlign: '-3px' }} /> 住所を検索しています…
          </p>
        )}
        {status.kind === 'filled' && <p className="saved-note">{status.message}</p>}
        {status.kind === 'notfound' && <p className="field-error">この郵便番号の住所が見つかりませんでした。番号を確かめるか、住所を手入力してください。</p>}
        {status.kind === 'unavailable' && <p className="field-hint">{status.message}</p>}
        {status.kind === 'choose' && (
          <div className="field">
            <p className="field-label">この郵便番号には住所が{status.options.length}件あります。選んでください。</p>
            <div className="cards">
              {status.options.map((o) => (
                <button key={`${o.city}${o.town}`} type="button" className="example-chip" onClick={() => apply(o)}>
                  {o.prefecture}
                  {o.city}
                  {o.town}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <Field label="都道府県" error={errors.prefecture}>
        <select id={`${idPrefix}-pref`} className="input" autoComplete="address-level1" value={value.prefecture} onChange={(e) => set('prefecture', e.target.value)}>
          <option value="">選択してください</option>
          {PREFECTURES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </Field>
      <Field label="市区町村" error={errors.city}>
        <input id={`${idPrefix}-city`} className="input" type="text" autoComplete="address-level2" maxLength={30} value={value.city} onChange={(e) => set('city', e.target.value)} />
      </Field>
      <Field label="町域" error={errors.town}>
        <input id={`${idPrefix}-town`} className="input" type="text" autoComplete="address-level3" maxLength={60} value={value.town} onChange={(e) => set('town', e.target.value)} />
      </Field>
      <Field label={addressLineLabel} error={errors.addressLine} hint={addressLineHint}>
        <input id={`${idPrefix}-line`} className="input" type="text" autoComplete="address-line1" maxLength={100} value={value.addressLine} onChange={(e) => set('addressLine', e.target.value)} />
      </Field>
    </fieldset>
  )
}
