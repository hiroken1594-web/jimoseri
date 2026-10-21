import { Ban, Check, Handshake, MessageCircle, Send, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { MatchDto } from '../../shared/dto.js'
import { formatQtyUnit, formatYen, UNIT_LABEL } from '../../shared/labels.js'
import { formatJstDateTime, formatWindow } from '../../shared/time.js'
import { DELIVERY_LABEL } from '../../shared/trade.js'
import { api, errorMessage } from '../api.js'
import { EmptyState, itemEmoji, Loading, Notice, PageTitle } from '../components/ui.js'
import { fetchMatches, iAmResponder, MATCH_STATUS_CLASS, notifyMatchesChanged, ratingText, statusLabel } from '../lib/matches.js'
import { useSession } from '../session.js'

function MatchCard({ m, onChanged }: { m: MatchDto; onChanged: (next: MatchDto) => void }) {
  const producer = m.viewer === 'PRODUCER'
  const responder = iAmResponder(m)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')

  const act = async (action: 'accept' | 'decline' | 'cancel' | 'block') => {
    if (action === 'block' && !window.confirm(`今後、${m.producerName}からの取引提案を受け取らないようにします。よろしいですか？`)) return
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

  const partner = producer ? m.restaurantName : m.producerName
  const fromPartner = m.initiator !== m.viewer
  return (
    <article className="card match-card" aria-label={`${m.itemName}（${partner}）：${statusLabel(m)}`}>
      <header className="card-head">
        <h3 className="card-title">
          <span aria-hidden="true">{itemEmoji(m.itemName)} </span>
          {m.itemName}
          {m.variety && `（${m.variety}）`} {formatQtyUnit(m.quantityMilli, m.unit)}
        </h3>
        <span className={MATCH_STATUS_CLASS[m.status]}>{statusLabel(m)}</span>
      </header>
      <dl className="meta">
        <div>
          <dt>取引相手</dt>
          <dd>
            {partner}
            <span className="muted">（{ratingText(m.partnerRating)}）</span>
            {m.isDemo && <span className="chip chip-demo">デモ</span>}
          </dd>
        </div>
        <div>
          <dt>提案</dt>
          <dd>{fromPartner ? `${partner}からの提案` : 'あなたからの提案'}</dd>
        </div>
        <div>
          <dt>受渡</dt>
          <dd>
            {DELIVERY_LABEL[m.deliveryMethod]}・{formatWindow(m.pickupStartMs, m.pickupEndMs)}
            {m.deliveryPlace && `／${m.deliveryPlace}`}
          </dd>
        </div>
        <div>
          <dt>単価</dt>
          <dd>
            {formatYen(m.unitPriceYen)}/{UNIT_LABEL[m.unit]}（税込）
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
          <dt>提案日時</dt>
          <dd>{formatJstDateTime(m.createdAtMs)}</dd>
        </div>
      </dl>

      <Link className={m.status === 'PENDING' && responder ? 'btn btn-block' : 'btn btn-primary btn-block'} to={`/matches/${m.id}`}>
        <MessageCircle aria-hidden="true" />
        {m.status === 'DECLINED' || m.status === 'CANCELLED' ? 'チャットの履歴を見る' : 'チャットを開く'}
        {m.unread > 0 && (
          <span className="badge-count" aria-label={`未読${m.unread}件`}>
            {m.unread}
          </span>
        )}
      </Link>
      {m.lastMessage && (
        <p className="muted match-last">
          {m.lastMessage.mine ? 'あなた：' : '相手：'}
          {m.lastMessage.body}
        </p>
      )}

      {m.status === 'PENDING' && responder && !declining && (
        <div className="card-actions">
          <button className="btn btn-primary" onClick={() => void act('accept')} disabled={busy}>
            <Check aria-hidden="true" />
            承認する（マッチング成立）
          </button>
          <button className="btn btn-quiet" onClick={() => setDeclining(true)} disabled={busy}>
            <X aria-hidden="true" />
            今回は辞退する
          </button>
        </div>
      )}
      {m.status === 'PENDING' && responder && declining && (
        <div className="sub-form">
          <label className="field-label" htmlFor={`reason-${m.id}`}>
            辞退の理由（任意・相手に表示されます）
          </label>
          <input id={`reason-${m.id}`} className="input" type="text" maxLength={200} value={reason} placeholder="例：今週は数量が足りません" onChange={(e) => setReason(e.target.value)} />
          <div className="card-actions">
            <button className="btn" onClick={() => void act('decline')} disabled={busy}>
              辞退を送る
            </button>
            <button className="btn btn-quiet" onClick={() => setDeclining(false)} disabled={busy}>
              やめる
            </button>
          </div>
        </div>
      )}
      {m.status === 'PENDING' && responder && <p className="footnote">承認するとマッチング成立です。承認しても、注文の確定や在庫の確保にはなりません。承認の前でも、チャットで相談できます。</p>}
      {m.status === 'PENDING' && !responder && (
        <div className="card-actions">
          <button className="btn btn-quiet" onClick={() => void act('cancel')} disabled={busy}>
            提案を取り下げる
          </button>
        </div>
      )}
      {m.viewer === 'RESTAURANT' && m.initiator === 'PRODUCER' && (
        <button type="button" className="link-button" onClick={() => void act('block')} disabled={busy}>
          <Ban size={16} aria-hidden="true" />
          この生産者からの提案を今後受け取らない
        </button>
      )}
      {error && <Notice kind="error">{<p>{error}</p>}</Notice>}
    </article>
  )
}

/** やりとり（取引の一覧）。返事が必要なもの・相談中・取引中・完了・終了に分けて表示する */
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
  const groups: { title: string; items: MatchDto[] }[] = matches
    ? [
        { title: '返事が必要な提案', items: matches.filter((m) => m.status === 'PENDING' && iAmResponder(m)) },
        { title: '相談中（相手の返事待ち）', items: matches.filter((m) => m.status === 'PENDING' && !iAmResponder(m)) },
        { title: '取引中（マッチング成立・条件の調整）', items: matches.filter((m) => m.status === 'ACCEPTED' || m.status === 'AGREED') },
        { title: '取引完了', items: matches.filter((m) => m.status === 'COMPLETED') },
        { title: '辞退・取り下げ', items: matches.filter((m) => m.status === 'DECLINED' || m.status === 'CANCELLED') },
      ]
    : []

  return (
    <>
      <PageTitle icon={Handshake}>{producer ? '依頼' : 'やりとり'}</PageTitle>
      <p className="page-lead">
        取引の提案と、そのチャットです。提案を受けた側が承認するとマッチング成立。条件に合意し、受渡の後に双方が完了を確認すると取引完了です。アプリは注文・決済・配送の手配をしません。
      </p>
      {producer && (
        <Link className="btn btn-primary btn-block" to="/producer/propose">
          <Send aria-hidden="true" />
          飲食店に農産物を提案する
        </Link>
      )}
      {error && <Notice kind="error">{<p>{error}</p>}</Notice>}
      {!matches && !error && <Loading label="読み込んでいます…" />}
      {matches && matches.length === 0 && (
        <EmptyState
          illust="🤝"
          title="まだ取引はありません"
          action={
            producer ? undefined : (
              <Link className="btn btn-primary" to="/restaurant">
                仕入れ案を作る
              </Link>
            )
          }
        >
          <p>{producer ? '飲食店からの提案が届くか、あなたから飲食店に提案すると、ここに表示されます。' : '仕入れ案や出品の詳細から、生産者に取引を提案できます。'}</p>
        </EmptyState>
      )}
      {matches &&
        matches.length > 0 &&
        groups
          .filter((g) => g.items.length > 0)
          .map((g) => (
            <section key={g.title} aria-label={g.title}>
              <h2 className="section-title">
                {g.title}（{g.items.length}件）
              </h2>
              <div className="cards">
                {g.items.map((m) => (
                  <MatchCard key={m.id} m={m} onChanged={replace} />
                ))}
              </div>
            </section>
          ))}
    </>
  )
}
