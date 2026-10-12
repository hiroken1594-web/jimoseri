import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { TimeMode, Unit } from '../../shared/allocate.js'
import { UNIT_LABEL, UNITS } from '../../shared/labels.js'
import { jstDateString } from '../../shared/time.js'
import { Choice, Field, Notice } from '../components/ui.js'
import {
  emptyDemandForm,
  loadDraft,
  saveConfirmedDemand,
  saveDraft,
  validateDemandForm,
  type DemandForm,
  type Draft,
  type FormErrors,
} from '../lib/forms.js'
import { useSession } from '../session.js'

export function RestaurantConfirm() {
  const { master } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const { aiMessage, title: noticeTitle } = (location.state as { aiMessage?: string; title?: string } | null) ?? {}
  const [draft] = useState<Draft>(
    () => loadDraft() ?? { text: '', form: emptyDemandForm(), regionText: null, notes: [], source: 'MANUAL' },
  )
  const [form, setForm] = useState<DemandForm>(draft.form ?? emptyDemandForm())
  const [errors, setErrors] = useState<FormErrors>({})
  const today = jstDateString(Date.now())
  const fromAi = draft.source === 'AI'

  const update = <K extends keyof DemandForm>(key: K, value: DemandForm[K]) => {
    const next = { ...form, [key]: value }
    setForm(next)
    setErrors((e) => ({ ...e, [key]: undefined }))
    saveDraft({ ...draft, form: next })
  }

  const submit = () => {
    const result = validateDemandForm(form, draft.text || null)
    if (!result.ok) {
      setErrors(result.errors)
      // 最初のエラー項目まで戻す
      requestAnimationFrame(() => document.querySelector('.field-invalid')?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
      return
    }
    saveConfirmedDemand(result.payload)
    navigate('/restaurant/plan', { state: { fresh: true } })
  }

  return (
    <>
      <h1 className="page-title">{fromAi ? 'AIの整理結果を確認' : '条件を入力'}</h1>
      <p className="page-lead">
        {fromAi
          ? '読み取った内容に間違いがないか確認してください。文章に書かれていない項目は空欄のままにしています。'
          : '項目を選んで条件を入力してください。'}
      </p>

      {aiMessage && (
        <Notice kind="warn" title={noticeTitle ?? '手入力に切り替えました'}>
          <p>{aiMessage}</p>
        </Notice>
      )}

      {draft.text && (
        <div className="quote">
          <p className="quote-label">入力した文章</p>
          <p>{draft.text}</p>
          <Link to="/restaurant">文章を直す</Link>
        </div>
      )}

      {fromAi && draft.notes.length > 0 && (
        <Notice kind="warn" title="確認が必要な点">
          <ul>
            {draft.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </Notice>
      )}

      <div className="form">
        <Field label="品目" required error={errors.itemId}>
          <select className="input" value={form.itemId} onChange={(e) => update('itemId', e.target.value)}>
            <option value="">選択してください</option>
            {master.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="数量" required error={errors.quantity} hint="単位の換算（個⇔kgなど）は行いません。">
          <div className="input-row">
            <input
              className="input"
              type="text"
              inputMode="decimal"
              value={form.quantity}
              placeholder="10"
              onChange={(e) => update('quantity', e.target.value)}
            />
            <select className="input input-unit" aria-label="単位" value={form.unit} onChange={(e) => update('unit', e.target.value as Unit)}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABEL[u]}
                </option>
              ))}
            </select>
          </div>
        </Field>

        <Field
          label="受け取りの希望"
          required
          error={errors.date ?? errors.time}
          hint={form.timeMode === 'DEADLINE' ? 'この日までに受け取れる案を探します。' : 'この日時に受け取れる案だけを探します。'}
        >
          <Choice<TimeMode>
            label="受け取りの希望の種類"
            value={form.timeMode}
            onChange={(v) => update('timeMode', v)}
            options={[
              { value: 'DEADLINE', label: 'この日までに', sub: '期限' },
              { value: 'EXACT', label: 'この日時に', sub: '日時指定' },
            ]}
          />
          <div className="input-row">
            <input className="input" type="date" aria-label="希望日" min={today} value={form.date} onChange={(e) => update('date', e.target.value)} />
            {form.timeMode === 'EXACT' && (
              <input className="input input-time" type="time" aria-label="時刻" value={form.time} onChange={(e) => update('time', e.target.value)} />
            )}
          </div>
        </Field>

        <Field
          label="受取エリア（市区町村）"
          hint={
            <>
              {draft.regionText && (
                <>
                  文章の「{draft.regionText}」は参考情報です。AIが場所を決めることはしません。
                  <br />
                </>
              )}
              エリアを選ぶと、そのエリアの受渡場所で受け取れる案だけを計算します。受渡場所は生産者が登録したものです。
            </>
          }
        >
          <select className="input" value={form.municipality} onChange={(e) => update('municipality', e.target.value)}>
            <option value="">指定なし</option>
            {/* 履歴から開いた条件のエリアが、今は選べなくなっている場合も表示だけは残す */}
            {[...new Set([...master.municipalities, ...(form.municipality ? [form.municipality] : [])])].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>

        {form.timeMode === 'DEADLINE' ? (
          <div className="field">
            <label className="check check-box">
              <input type="checkbox" checked={form.allowMultiLocation} onChange={(e) => update('allowMultiLocation', e.target.checked)} />
              <span>
                <strong>複数の場所での受け取りを許可する</strong>
                <small className="block">
                  1か所で希望量が揃わないときに限り、2〜3か所を回って受け取る参考案も作ります。場所の間の移動時間は計算しません。
                </small>
              </span>
            </label>
          </div>
        ) : (
          <p className="field-hint">日時を指定した場合は、1か所で受け取れる案だけを作ります。</p>
        )}

        <Field label="規格外品（形の不揃い・余剰など）" required error={errors.allowIrregular}>
          <Choice<'yes' | 'no'>
            label="規格外品の可否"
            value={form.allowIrregular === null ? null : form.allowIrregular ? 'yes' : 'no'}
            onChange={(v) => update('allowIrregular', v === 'yes')}
            options={[
              { value: 'yes', label: '含めてよい', sub: '形の不揃い等も可' },
              { value: 'no', label: '通常品のみ', sub: '規格外は除く' },
            ]}
          />
        </Field>

        <Field label="予算の上限（合計・税込）" error={errors.budget} hint="空欄なら予算で絞り込みません。単価（kgあたり）の上限には対応していません。">
          <div className="input-row">
            <input
              className="input"
              type="text"
              inputMode="numeric"
              value={form.budget}
              placeholder="指定なし"
              onChange={(e) => update('budget', e.target.value)}
            />
            <span className="input-suffix">円</span>
          </div>
        </Field>
      </div>

      <div className="actions">
        <button className="btn btn-primary btn-large" onClick={submit}>
          この条件で仕入れ案を作る
        </button>
      </div>
      <p className="footnote">仕入れ案の計算は、登録されている在庫データをもとにプログラムが行います。</p>
    </>
  )
}
