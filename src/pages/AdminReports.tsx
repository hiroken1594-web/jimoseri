import { Ban, Flag, History, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { ReportItem, ReportStatus } from '../../shared/dto.js'
import { formatJstDateTime } from '../../shared/time.js'
import { api, errorMessage } from '../api.js'
import { REPORT_REASON_LABEL } from '../components/ReportButton.js'
import { EmptyState, Field, Loading, Notice, PageTitle } from '../components/ui.js'

const STATUS_LABEL: Record<ReportStatus, string> = { OPEN: '未対応', IN_REVIEW: '確認中', RESOLVED: '対応済み', REJECTED: '却下' }
const STATUS_CLASS: Record<ReportStatus, string> = { OPEN: 'chip chip-warn', IN_REVIEW: 'chip', RESOLVED: 'chip chip-live', REJECTED: 'chip chip-off' }
const TARGET_LABEL = { LISTING: '出品', PRODUCER: '生産者', RESTAURANT: '飲食店', REVIEW: 'レビュー' } as const
const STATE_LABEL = { ACTIVE: '公開中', SUSPENDED: '停止中', DELETED: '削除済み' } as const

function ReportCard({ report, onChanged }: { report: ReportItem; onChanged: () => Promise<void> }) {
  const [status, setStatus] = useState<ReportStatus>(report.status)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (extra: { targetAction?: 'suspend' | 'restore' } = {}) => {
    if (extra.targetAction === 'suspend' && !window.confirm(`「${report.targetLabel}」を停止しますか？`)) return
    setBusy(true)
    setError(null)
    try {
      await api('/api/reports', {
        method: 'PATCH',
        body: { id: report.id, ...(status !== report.status ? { status } : {}), ...(note.trim() ? { note: note.trim() } : {}), ...extra },
      })
      setNote('')
      await onChanged()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="card">
      <header className="card-head">
        <h3>
          {TARGET_LABEL[report.targetType]}：{report.targetLabel}
        </h3>
        <span className={STATUS_CLASS[report.status]}>{STATUS_LABEL[report.status]}</span>
      </header>
      <dl className="meta">
        <div>
          <dt>理由</dt>
          <dd>{REPORT_REASON_LABEL[report.reason]}</dd>
        </div>
        <div>
          <dt>詳細</dt>
          <dd>{report.detail || '（なし）'}</dd>
        </div>
        <div>
          <dt>対象の状態</dt>
          <dd>{STATE_LABEL[report.targetState]}</dd>
        </div>
        <div>
          <dt>通報者</dt>
          <dd>{report.reporterName}（運営者だけが見られます）</dd>
        </div>
        <div>
          <dt>受付</dt>
          <dd>{formatJstDateTime(report.createdAtMs)}</dd>
        </div>
      </dl>
      <div className="field-pair">
        <Field label="対応状況">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as ReportStatus)}>
            {(Object.keys(STATUS_LABEL) as ReportStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="メモ（履歴に残ります）">
          <input className="input" type="text" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      {error && <Notice kind="error">{<p>{error}</p>}</Notice>}
      <div className="card-actions">
        <button className="btn btn-primary" onClick={() => save()} disabled={busy || (status === report.status && !note.trim())}>
          保存
        </button>
        {report.targetState === 'ACTIVE' && (
          <button className="btn btn-quiet" onClick={() => save({ targetAction: 'suspend' })} disabled={busy}>
            <Ban aria-hidden="true" />
            対象を停止
          </button>
        )}
        {report.targetState === 'SUSPENDED' && (
          <button className="btn" onClick={() => save({ targetAction: 'restore' })} disabled={busy}>
            <RotateCcw aria-hidden="true" />
            停止を解除
          </button>
        )}
      </div>
      <details className="alternatives">
        <summary>
          <History size={18} aria-hidden="true" style={{ marginRight: 6 }} />
          対応履歴（{report.actions.length}件）
        </summary>
        <ul className="help-list">
          {report.actions.map((a, i) => (
            <li key={i}>
              {formatJstDateTime(a.createdAtMs)} {a.actorName}：{a.action}
              {a.note && `「${a.note}」`}
            </li>
          ))}
        </ul>
      </details>
    </article>
  )
}

/** 運営者専用：通報の管理。通報があっただけでは停止せず、内容を確認して判断する。 */
export function AdminReports() {
  const [filter, setFilter] = useState<ReportStatus | 'ALL'>('OPEN')
  const [reports, setReports] = useState<ReportItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setReports((await api<{ reports: ReportItem[] }>(`/api/reports${filter === 'ALL' ? '' : `?status=${filter}`}`)).reports)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [filter])

  useEffect(() => {
    setReports(null)
    void load()
  }, [load])

  return (
    <>
      <PageTitle icon={Flag}>通報の管理</PageTitle>
      <p className="page-lead">利用者からの通報です。内容は運営者だけが見られ、通報した人は相手に知らされません。通報があっただけで自動的には停止しないので、内容を確認して判断してください。</p>
      <div className="segmented" role="group" aria-label="対応状況で絞り込む">
        {(['OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED', 'ALL'] as const).map((s) => (
          <button key={s} type="button" aria-pressed={filter === s} onClick={() => setFilter(s)}>
            {s === 'ALL' ? 'すべて' : STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      {error && <Notice kind="error">{<p>{error}</p>}</Notice>}
      {!reports && !error && <Loading label="読み込んでいます…" />}
      {reports && reports.length === 0 && (
        <EmptyState illust="✅" title={filter === 'ALL' ? '通報はまだありません' : `「${STATUS_LABEL[filter as ReportStatus]}」の通報はありません`} />
      )}
      {reports && reports.length > 0 && (
        <div className="cards">
          {reports.map((r) => (
            <ReportCard key={r.id} report={r} onChanged={load} />
          ))}
        </div>
      )}
    </>
  )
}
