import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { DemandHistoryItem } from '../../shared/dto.js'
import { formatQtyUnit, formatYen } from '../../shared/labels.js'
import { toMilli } from '../../shared/allocate.js'
import { formatJstDate, formatJstDateTime, jstDateString, jstToMs } from '../../shared/time.js'
import { api, errorMessage } from '../api.js'
import { Loading, Notice } from '../components/ui.js'
import { formFromInput, saveConfirmedDemand, saveDraft } from '../lib/forms.js'

export function RestaurantHistory() {
  const navigate = useNavigate()
  const [demands, setDemands] = useState<DemandHistoryItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const today = jstDateString(Date.now())

  const load = useCallback(async () => {
    setError(null)
    try {
      setDemands((await api<{ demands: DemandHistoryItem[] }>('/api/demands')).demands)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 保存してあるのは条件だけ。開くたびに最新の在庫で計算し直す。
  const open = (d: DemandHistoryItem) => {
    const draft = { text: d.input.rawText ?? '', form: formFromInput(d.input), regionText: null, notes: [], source: 'MANUAL' as const }
    saveDraft(draft)
    if (d.input.date < today) {
      // 希望日が過ぎている条件は、日付を直してから計算する
      saveDraft({ ...draft, form: { ...draft.form, date: '' } })
      navigate('/restaurant/confirm', { state: { aiMessage: '希望日が過ぎているため、日付を選び直してください。', title: '条件を変更' } })
      return
    }
    saveConfirmedDemand(d.input)
    navigate('/restaurant/plan')
  }

  const remove = async (d: DemandHistoryItem) => {
    if (!window.confirm('この履歴を削除しますか？')) return
    setBusyId(d.id)
    try {
      await api(`/api/demands?id=${encodeURIComponent(d.id)}`, { method: 'DELETE' })
      setDemands((all) => all?.filter((x) => x.id !== d.id) ?? null)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <h1 className="page-title">仕入れ希望の履歴</h1>
      <p className="page-lead">保存しているのは希望条件だけです。開くと、その時点の最新の在庫から仕入れ案を計算し直します。</p>
      {error && (
        <Notice kind="error">
          <p>{error}</p>
        </Notice>
      )}
      {!demands && !error && <Loading label="履歴を読み込んでいます…" />}
      {demands && demands.length === 0 && (
        <div className="empty">
          <p className="empty-title">まだ履歴がありません</p>
          <p>仕入れ案を作ると、その条件がここに残ります。</p>
          <Link className="btn btn-primary" to="/restaurant">
            仕入れ案を作る
          </Link>
        </div>
      )}
      {demands && demands.length > 0 && (
        <div className="cards">
          {demands.map((d) => {
            const expired = d.input.date < today
            return (
              <article className="card" key={d.id}>
                <header className="card-head">
                  <h3>
                    {d.itemName} {formatQtyUnit(toMilli(d.input.quantity), d.input.unit)}
                  </h3>
                  {expired && <span className="chip chip-off">希望日が過ぎています</span>}
                </header>
                <p className="chips">
                  <span className="chip">
                    {formatJstDate(jstToMs(d.input.date))}
                    {d.input.timeMode === 'EXACT' ? ` ${d.input.time} に` : ' までに'}
                  </span>
                  <span className="chip">{d.input.allowIrregular ? '規格外も可' : '通常品のみ'}</span>
                  {d.input.municipality && <span className="chip">{d.input.municipality}</span>}
                  {d.input.budgetMaxYen !== null && <span className="chip">予算 {formatYen(d.input.budgetMaxYen)}</span>}
                  {d.input.allowMultiLocation && <span className="chip">複数の場所も可</span>}
                </p>
                {d.input.rawText && <p className="muted">「{d.input.rawText}」</p>}
                <p className="footnote">作成：{formatJstDateTime(d.createdAtMs)}</p>
                <div className="card-actions">
                  <button className="btn btn-primary" onClick={() => open(d)}>
                    {expired ? '日付を直して計算' : '最新の在庫で再計算'}
                  </button>
                  <button className="btn btn-quiet" onClick={() => remove(d)} disabled={busyId === d.id}>
                    削除
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </>
  )
}
