import { Check, Handshake, MessageCircle, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { MatchDto } from '../../shared/dto.js'
import { formatQtyUnit, formatYen, UNIT_LABEL } from '../../shared/labels.js'
import { formatJstDateTime, formatWindow } from '../../shared/time.js'
import { api, errorMessage } from '../api.js'
import { EmptyState, itemEmoji, Loading, Notice, PageTitle } from '../components/ui.js'
import { fetchMatches, MATCH_STATUS_CLASS, MATCH_STATUS_LABEL, notifyMatchesChanged, PRODUCER_STATUS_LABEL } from '../lib/matches.js'
import { useSession } from '../session.js'

function MatchCard({ m, onChanged }: { m: MatchDto; onChanged: (next: MatchDto) => void }) {
  const producer = m.viewer === 'PRODUCER'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')

  const respond = async (action: 'accept' | 'decline' | 'cancel') => {
    setBusy(true)
    setError(null)
    try {
      const res = await api<{ match: MatchDto }>(`/api/matches?id=${encodeURIComponent(m.id)}`, { method: 'PATCH', body: { action, reason: reason.trim() || undefined } })
      onChanged(res.match)
      notifyMatchesChanged()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
      setDeclining(false)
    }
  }

  const label = producer ? PRODUCER_STATUS_LABEL[m.status] : MATCH_STATUS_LABEL[m.status]
  return (
    <article className="card match-card" aria-label={`${m.itemName}（${producer ? m.restaurantName : m.producerName}）：${label}`}>
      <header className="card-head">
        <h3 className="card-title">
          <span aria-hidden="true">{itemEmoji(m.itemName)} </span>
          {m.itemName}
          {m.variety && `（${m.variety}）`} {formatQtyUnit(m.quantityMilli, m.unit)}
        </h3>
        <span className={MATCH_STATUS_CLASS[m.status]}>{label}</span>
      </header>
      <dl className="meta">
        <div>
          <dt>{producer ? '依頼した飲食店' : '依頼先の生産者'}</dt>
          <dd>
            {producer ? m.restaurantName : m.producerName}
            {m.isDemo && <span className="chip chip-demo">デモ</span>}
          </dd>
        </div>
        <div>
          <dt>受渡の希望</dt>
          <dd>
            {formatWindow(m.pickupStartMs, m.pickupEndMs)}／{m.locationName}
          </dd>
        </div>
        <div>
          <dt>依頼時の単価</dt>
          <dd>
            {formatYen(m.unitPriceYen)}/{UNIT_LABEL[m.unit]}（税込・最終価格はチャットで確認）
          </dd>
        </div>
        {m.message && (
          <div>
            <dt>ひとこと</dt>
            <dd>{m.message}</dd>
          </div>
        )}
        {m.declineReason && (
          <div>
            <dt>辞退の理由</dt>
            <dd>{m.declineReason}</dd>
          </div>
        )}
        <div>
          <dt>依頼日時</dt>
          <dd>{formatJstDateTime(m.createdAtMs)}</dd>
        </div>
      </dl>

      {m.status === 'ACCEPTED' && (
        <Link className="btn btn-primary btn-block" to={`/matches/${m.id}`}>
          <MessageCircle aria-hidden="true" />
          チャットを開く
          {m.unread > 0 && <span className="badge-count" aria-label={`未読${m.unread}件`}>{m.unread}</span>}
        </Link>
      )}
      {m.status === 'ACCEPTED' && m.lastMessage && (
        <p className="muted match-last">
          {m.lastMessage.mine ? 'あなた：' : '相手：'}
          {m.lastMessage.body}
        </p>
      )}

      {producer && m.status === 'PENDING' && !declining && (
        <div className="card-actions">
          <button className="btn btn-primary" onClick={() => void respond('accept')} disabled={busy}>
            <Check aria-hidden="true" />
            承認する（マッチング成立）
          </button>
          <button className="btn btn-quiet" onClick={() => setDeclining(true)} disabled={busy}>
            <X aria-hidden="true" />
            今回は辞退する
          </button>
        </div>
      )}
      {producer && m.status === 'PENDING' && declining && (
        <div className="sub-form">
          <label className="field-label" htmlFor={`reason-${m.id}`}>
            辞退の理由（任意・飲食店に表示されます）
          </label>
          <input id={`reason-${m.id}`} className="input" type="text" maxLength={200} value={reason} placeholder="例：今週は数量が足りません" onChange={(e) => setReason(e.target.value)} />
          <div className="card-actions">
            <button className="btn" onClick={() => void respond('decline')} disabled={busy}>
              辞退を送る
            </button>
            <button className="btn btn-quiet" onClick={() => setDeclining(false)} disabled={busy}>
              やめる
            </button>
          </div>
        </div>
      )}
      {producer && m.status === 'PENDING' && (
        <p className="footnote">承認するとマッチングが成立し、この飲食店とチャットで相談できます。承認しても、注文の確定や在庫の確保にはなりません。</p>
      )}
      {!producer && m.status === 'PENDING' && (
        <div className="card-actions">
          <button className="btn btn-quiet" onClick={() => void respond('cancel')} disabled={busy}>
            依頼を取り下げる
          </button>
        </div>
      )}
      {error && <Notice kind="error">{<p>{error}</p>}</Notice>}
    </article>
  )
}

/** やりとり（飲食店：送った依頼／生産者：届いた依頼）。成立したものからチャットを開く */
export function Matches() {
  const { user } = useSession()
  const producer = user?.role === 'PRODUCER'
  const [matches, setMatches] = useState<MatchDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setMatches((await fetchMatches()).matches)
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => document.visibilityState === 'visible' && void load(), 20_000)
    return () => clearInterval(timer)
  }, [load])

  const replace = (next: MatchDto) => setMatches((all) => all?.map((m) => (m.id === next.id ? next : m)) ?? null)
  const groups: { title: string; items: MatchDto[]; empty: string }[] = matches
    ? [
        { title: producer ? '返事が必要な依頼' : '返事待ち', items: matches.filter((m) => m.status === 'PENDING'), empty: producer ? '返事が必要な依頼はありません' : '返事待ちの依頼はありません' },
        { title: 'マッチング成立（チャットで相談）', items: matches.filter((m) => m.status === 'ACCEPTED'), empty: 'まだありません' },
        { title: '辞退・取り下げ', items: matches.filter((m) => m.status === 'DECLINED' || m.status === 'CANCELLED'), empty: 'ありません' },
      ]
    : []

  return (
    <>
      <PageTitle icon={Handshake}>{producer ? '依頼' : 'やりとり'}</PageTitle>
      <p className="page-lead">
        {producer
          ? '飲食店からのマッチング依頼です。承認するとマッチングが成立し、その飲食店とチャットで数量・価格・受渡などを相談できます。'
          : '生産者に送ったマッチング依頼です。生産者が承認するとマッチングが成立し、チャットで相談できます。'}
      </p>
      {error && <Notice kind="error">{<p>{error}</p>}</Notice>}
      {!matches && !error && <Loading label="読み込んでいます…" />}
      {matches && matches.length === 0 && (
        <EmptyState
          illust="🤝"
          title={producer ? 'まだ依頼は届いていません' : 'まだ依頼を送っていません'}
          action={
            producer ? undefined : (
              <Link className="btn btn-primary" to="/restaurant">
                仕入れ案を作る
              </Link>
            )
          }
        >
          <p>{producer ? '出品が飲食店の仕入れ案に入ると、依頼が届くことがあります。' : '仕入れ案や出品の詳細から、生産者にマッチング依頼を送れます。'}</p>
        </EmptyState>
      )}
      {matches &&
        matches.length > 0 &&
        groups.map((g) => (
          <section key={g.title} aria-label={g.title}>
            <h2 className="section-title">
              {g.title}（{g.items.length}件）
            </h2>
            {g.items.length === 0 ? (
              <p className="muted">{g.empty}</p>
            ) : (
              <div className="cards">
                {g.items.map((m) => (
                  <MatchCard key={m.id} m={m} onChanged={replace} />
                ))}
              </div>
            )}
          </section>
        ))}
    </>
  )
}
