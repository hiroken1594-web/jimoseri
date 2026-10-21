import { Search } from 'lucide-react'
import { useState } from 'react'
import { normalizeZip, sameMunicipality } from '../../shared/geo.js'
import { errorMessage } from '../api.js'
import { useDemoMode } from '../lib/demoMode.js'
import { useSession } from '../session.js'
import { lookupZip, PREFECTURES } from './AddressFields.js'
import { Field } from './ui.js'

/**
 * 受取エリア（必須）：都道府県と、任意で市区町村。
 * 市区町村の選択肢は、確認済みの受渡場所がある市区町村（デモモードのときはデモの場所）。
 */
export function AreaFields({
  prefecture,
  municipality,
  onChange,
  error,
  idPrefix,
}: {
  prefecture: string
  municipality: string
  onChange: (next: { prefecture: string; municipality: string }) => void
  error?: string
  idPrefix: string
}) {
  const { master } = useSession()
  const [demo] = useDemoMode()
  const areas = demo ? master.demoAreas : master.areas
  const withListings = new Set(areas.map((a) => a.prefecture))
  const cities = [...new Set([...areas.filter((a) => a.prefecture === prefecture).map((a) => a.municipality), ...(municipality ? [municipality] : [])])]
  // 郵便番号から受取エリア（都道府県・市区町村）を設定する。設定した後も選び直せる
  const [zip, setZip] = useState('')
  const [zipStatus, setZipStatus] = useState<string | null>(null)
  const [zipBusy, setZipBusy] = useState(false)
  const fromZip = async () => {
    const zip7 = normalizeZip(zip)
    if (!zip7) return setZipStatus('郵便番号を7桁の数字で入力してください（ハイフンはあってもなくても構いません）。')
    setZipBusy(true)
    setZipStatus(null)
    try {
      const res = await lookupZip(zip7)
      if (res.results === null) setZipStatus(res.message ?? '郵便番号から調べられませんでした。下の欄から選んでください。')
      else if (res.results.length === 0) setZipStatus('この郵便番号の住所が見つかりませんでした。下の欄から選んでください。')
      else {
        const a = res.results[0]
        // 受渡場所の市区町村名（郡名なしのこともある）に合わせて選ぶ
        const known = areas.find((x) => x.prefecture === a.prefecture && sameMunicipality(x.municipality, a.city))
        const city = known?.municipality ?? a.city
        onChange({ prefecture: a.prefecture, municipality: city })
        setZipStatus(`${a.prefecture} ${city} を受取エリアにしました。違う場合は下の欄で選び直してください。`)
      }
    } catch (e) {
      setZipStatus(`${errorMessage(e)} 下の欄から選んでください。`)
    } finally {
      setZipBusy(false)
    }
  }
  // 受渡場所がある都道府県を先に並べる
  const prefs = [...PREFECTURES.filter((p) => withListings.has(p)), ...PREFECTURES.filter((p) => !withListings.has(p))]
  return (
    <>
      <div className="field">
        <label className="field-label" htmlFor={`${idPrefix}-zip`}>
          郵便番号から設定（任意）
        </label>
        <div className="input-row">
          <input
            id={`${idPrefix}-zip`}
            className="input"
            type="text"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={10}
            placeholder="例：553-0003"
            value={zip}
            onChange={(e) => setZip(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void fromZip()
              }
            }}
          />
          <button type="button" className="btn btn-small" onClick={() => void fromZip()} disabled={zipBusy}>
            <Search aria-hidden="true" />
            {zipBusy ? '調べています…' : '設定'}
          </button>
        </div>
        <p className="field-hint" aria-live="polite">
          {zipStatus ?? '郵便番号から、都道府県と市区町村を入れます。'}
        </p>
      </div>
      <div className="field-pair area-fields">
        <Field label="受取エリア（都道府県）" required error={error}>
          <select id={`${idPrefix}-pref`} className="input" value={prefecture} onChange={(e) => onChange({ prefecture: e.target.value, municipality: '' })}>
            <option value="">受取エリアを選択してください</option>
            {prefs.map((p) => (
              <option key={p} value={p}>
                {p}
                {withListings.has(p) ? '' : '（受渡場所なし）'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="市区町村" hint="指定しない場合は、都道府県全体から探します。">
          <select
            id={`${idPrefix}-city`}
            className="input"
            value={municipality}
            disabled={!prefecture}
            onChange={(e) => onChange({ prefecture, municipality: e.target.value })}
          >
            <option value="">指定しない（{prefecture || '都道府県'}全体）</option>
            {cities.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </>
  )
}
