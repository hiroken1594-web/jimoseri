import { ArrowLeft, Check, ClipboardCheck, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { QueueDetail, QueueItem, QueueType, ReviewStatus } from '../../shared/dto.js'
import { formatJstDateTime } from '../../shared/time.js'
import { api, errorMessage } from '../api.js'
import { MapView } from '../components/MapView.js'
import { EmptyState, Field, Loading, Notice, PageTitle } from '../components/ui.js'

const TYPE_LABEL: Record<QueueType, string> = { PRODUCER: '生産者の登録申請', LOCATION: '受渡拠点の登録申請' }
const STATUS_LABEL: Record<ReviewStatus, string> = { PENDING: '審査待ち', APPROVED: '承認', REJECTED: '却下', SUSPENDED: '停止' }
const changed = () => window.dispatchEvent(new Event('jimoseri-queue-changed'))

/** 経過時間（例：3日前） */
function ago(ms: number): string {
  const min = Math.floor((Date.now() - ms) / 60000)
  if (min < 60) return `${Math.max(1, min)}分前`
  if (min < 60 * 24) return `${Math.floor(min / 60)}時間前`
  return `${Math.floor(min / 60 / 24)}日前`
}

/** 運営者：審査待ちの一覧（申請日時が古い順）。種類で絞り込める */
export function AdminQueue() {
  const [items, setItems] = useState<QueueItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'ALL' | QueueType>('ALL')
  const [order, setOrder] = useState<'old' | 'new'>('old')

  useEffect(() => {
    api<{ items: QueueItem[] }>('/api/admin?view=queue')
      .then((r) => setItems(r.items))
      .catch((e) => setError(errorMessage(e)))
  }, [])

  const shown = (items ?? []).filter((i) => filter === 'ALL' || i.type === filter).sort((a, b) => (order === 'old' ? a.submittedAtMs - b.submittedAtMs : b.submittedAtMs - a.submittedAtMs))
  const count = (t: 'ALL' | QueueType) => (items ?? []).filter((i) => t === 'ALL' || i.type === t).length

  return (
    <>
      <PageTitle icon={ClipboardCheck}>審査待ち</PageTitle>
      <p className="page-lead">運営者の確認が必要な申請です。詳細を見て、承認または却下してください。結果は申請者にアプリ内で通知されます。</p>
      {error && <Notice kind="error">{<p>{error}</p>}</Notice>}
      {!items && !error && <Loading label="読み込んでいます…" />}
      {items && (
        <>
          <div className="segmented" role="group" aria-label="申請の種類で絞り込む">
            {(['ALL', 'PRODUCER', 'LOCATION'] as const).map((t) => (
              <button key={t} type="button" aria-pressed={filter === t} onClick={() => setFilter(t)}>
                {t === 'ALL' ? 'すべて' : t === 'PRODUCER' ? '生産者' : '受渡拠点'}（{count(t)}）
              </button>
            ))}
          </div>
          <div className="result-loc-head">
            <p>
              <strong>審査待ち {shown.length}件</strong>
            </p>
            <label className="sort-select">
              <span className="visually-hidden">並び順</span>
              <select className="input" value={order} onChange={(e) => setOrder(e.target.value as 'old' | 'new')}>
                <option value="old">申請が古い順</option>
                <option value="new">申請が新しい順</option>
              </select>
            </label>
          </div>
          {shown.length === 0 ? (
            <EmptyState illust="✅" title="審査待ちの申請はありません">
              <p>新しい申請が届くと、ここに表示されます。</p>
            </EmptyState>
          ) : (
            <ul className="queue-list">
              {shown.map((i) => (
                <li key={`${i.type}-${i.id}`} className="card queue-item">
                  <p className="queue-meta">
                    <span className={i.type === 'PRODUCER' ? 'chip chip-warn' : 'chip'}>{TYPE_LABEL[i.type]}</span>
                    <span className="chip chip-warn">{STATUS_LABEL[i.status]}</span>
                    {i.isDemo && <span className="chip chip-demo">デモ</span>}
                  </p>
                  <h2 className="card-title">{i.title}</h2>
                  <p className="muted">
                    申請者：{i.applicantName}（{i.username}）
                  </p>
                  <p>{i.summary}</p>
                  <p className="muted">
                    申請日時：{formatJstDateTime(i.submittedAtMs)}（{ago(i.submittedAtMs)}）
                  </p>
                  <Link className="btn btn-primary btn-block" to={`/admin/queue/${i.type}/${i.id}`}>
                    詳細を見る
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  )
}

/** 運営者：申請の詳細。承認・却下（却下は理由が必須）を行う */
export function AdminQueueDetail() {
  const { type = '', id = '' } = useParams()
  const navigate = useNavigate()
  const [item, setItem] = useState<QueueDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setItem((await api<{ item: QueueDetail }>(`/api/admin?view=item&type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`)).item)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [type, id])
  useEffect(() => {
    void load()
  }, [load])

  const decide = async (action: 'approve' | 'reject') => {
    if (action === 'reject' && !reason.trim()) return setReasonError('却下の理由を入力してください（申請者に表示されます）')
    setBusy(true)
    setError(null)
    try {
      await api('/api/admin', { body: { target: type === 'PRODUCER' ? 'producer' : 'location', id, action, reason: action === 'reject' ? reason.trim() : undefined } })
      changed()
      setDone(action === 'approve' ? '承認しました。申請者に通知しました。' : '却下しました。理由とあわせて申請者に通知しました。')
      setRejecting(false)
      await load()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (error && !item) return <Notice kind="error">{<p>{error}</p>}</Notice>
  if (!item) return <Loading label="読み込んでいます…" />
  const pending = item.status === 'PENDING'
  return (
    <>
      <button className="link-button" style={{ alignSelf: 'flex-start' }} onClick={() => navigate('/admin/queue')}>
        <ArrowLeft size={18} aria-hidden="true" />
        審査待ちの一覧へ
      </button>
      <PageTitle icon={ClipboardCheck}>{TYPE_LABEL[item.type]}</PageTitle>
      <p className="queue-meta">
        <span className={pending ? 'chip chip-warn' : item.status === 'APPROVED' ? 'chip chip-live' : 'chip chip-off'}>{STATUS_LABEL[item.status]}</span>
        {item.isDemo && <span className="chip chip-demo">デモ</span>}
      </p>
      {done && <Notice kind="success">{<p>{done}</p>}</Notice>}
      <section className="card">
        <h2 className="card-title">{item.title}</h2>
        <dl className="plan-summary">
          <dt>申請者</dt>
          <dd>
            {item.applicantName}（{item.username}）
          </dd>
          <dt>申請日時</dt>
          <dd>{formatJstDateTime(item.submittedAtMs)}</dd>
          {item.fields.map((f) => (
            <div key={f.label} style={{ display: 'contents' }}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
        {item.latitude !== null && item.longitude !== null && (
          <MapView small label={`${item.title}の位置`} center={{ lat: item.latitude, lng: item.longitude }} zoom={15} markers={[{ id: item.id, lat: item.latitude, lng: item.longitude, label: item.title }]} />
        )}
      </section>
      {item.history.length > 0 && (
        <section className="card">
          <h2 className="card-title">審査の記録</h2>
          <ul className="review-list">
            {item.history.map((h, i) => (
              <li key={i} className="review-item">
                <p>
                  <strong>{STATUS_LABEL[h.decision]}</strong>（{formatJstDateTime(h.atMs)}）
                </p>
                {h.reason && <p>理由：{h.reason}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {error && <Notice kind="error">{<p>{error}</p>}</Notice>}
      {pending && !rejecting && (
        <div className="action-bar">
          <button className="btn btn-primary action-main" onClick={() => void decide('approve')} disabled={busy}>
            <Check aria-hidden="true" />
            承認する
          </button>
          <button className="btn" onClick={() => setRejecting(true)} disabled={busy}>
            <X aria-hidden="true" />
            却下する
          </button>
        </div>
      )}
      {pending && rejecting && (
        <section className="card">
          <Field label="却下の理由" required error={reasonError ?? undefined} hint="申請者に表示されます。直してほしい点を具体的に書いてください。">
            <textarea className="input" rows={3} maxLength={300} value={reason} onChange={(e) => { setReason(e.target.value); setReasonError(null) }} />
          </Field>
          <div className="card-actions">
            <button className="btn btn-primary" onClick={() => void decide('reject')} disabled={busy}>
              却下を確定する
            </button>
            <button className="btn btn-quiet" onClick={() => setRejecting(false)} disabled={busy}>
              やめる
            </button>
          </div>
        </section>
      )}
      {!pending && <p className="muted">この申請は審査が済んでいます。</p>}
    </>
  )
}
