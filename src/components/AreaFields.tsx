import { useDemoMode } from '../lib/demoMode.js'
import { useSession } from '../session.js'
import { PREFECTURES } from './AddressFields.js'
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
  // 受渡場所がある都道府県を先に並べる
  const prefs = [...PREFECTURES.filter((p) => withListings.has(p)), ...PREFECTURES.filter((p) => !withListings.has(p))]
  return (
    <div className="field-pair area-fields">
      <Field label="受取エリア（都道府県）" required error={error}>
        <select
          id={`${idPrefix}-pref`}
          className="input"
          value={prefecture}
          onChange={(e) => onChange({ prefecture: e.target.value, municipality: '' })}
        >
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
  )
}
