import { Handshake, Send } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { MatchDto } from '../../shared/dto.js'
import { formatQtyUnit } from '../../shared/labels.js'
import type { Unit } from '../../shared/allocate.js'
import { api, errorMessage } from '../api.js'
import { fetchMatches, MATCH_STATUS_CLASS, notifyMatchesChanged, statusLabel } from '../lib/matches.js'
import { DeliveryFields, deliveryDefaults, deliveryErrors, deliveryPayload, type DeliveryValue } from './DeliveryFields.js'
import { Notice } from './ui.js'

export interface RequestLine {
  listingId: string
  producerName: string
  itemName: string
  quantityMilli: number
  unit: Unit
  /** 生産者の受渡場所の名前（受け取りの場合の受渡場所） */
  locationName?: string
  /** 受け取りの回（仕入れ案で選ばれた日時） */
  pickupStartMs?: number
  pickupEndMs?: number
}

/**
 * 仕入れ案（または出品）の生産者に、マッチング依頼を送る。生産者ごとに選べて、状態も生産者ごとに表示する。
 * 依頼は注文ではなく、生産者が承認したときだけマッチング成立になる。
 */
export function MatchRequestPanel({ lines, demoMode, disabled, title = '生産者にマッチング依頼を送る' }: { lines: RequestLine[]; demoMode: boolean; disabled?: boolean; title?: string }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(lines.map((l) => l.listingId)))
  const [message, setMessage] = useState('')
  // 受渡方法と送料（初期値は、生産者の指定場所で受け取る）
  const [delivery, setDelivery] = useState<DeliveryValue>(deliveryDefaults(lines[0]?.locationName ?? ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentNow, setSentNow] = useState(false)
  // この出品への、これまでの依頼（返事待ち・成立を優先して表示）
  const [existing, setExisting] = useState<Map<string, MatchDto>>(new Map())

  const ids = lines.map((l) => l.listingId).join(',')
  const loadExisting = useCallback(async () => {
    try {
      const { matches } = await fetchMatches()
      const map = new Map<string, MatchDto>()
      for (const id of ids.split(',')) {
        const mine = matches.filter((m) => m.listingId === id)
        const active = mine.find((m) => m.status === 'PENDING' || m.status === 'ACCEPTED' || m.status === 'AGREED') ?? mine[0]
        if (active) map.set(id, active)
      }
      setExisting(map)
    } catch {
      // 状態が読めなくても、依頼は送れる
    }
  }, [ids])

  useEffect(() => {
    void loadExisting()
    const timer = setInterval(() => document.visibilityState === 'visible' && void loadExisting(), 15_000)
    return () => clearInterval(timer)
  }, [loadExisting])

  const isActive = (id: string) => {
    const m = existing.get(id)
    return m?.status === 'PENDING' || m?.status === 'ACCEPTED' || m?.status === 'AGREED'
  }
  const sendable = lines.filter((l) => selected.has(l.listingId) && !isActive(l.listingId))

  // 入力の誤りは、送信を試みた後に各項目の下に表示する
  const [tried, setTried] = useState(false)
  const submit = async () => {
    setTried(true)
    if (sendable.length === 0) return setError('依頼する生産者を選んでください。')
    const feeError = deliveryErrors(delivery)
    if (feeError) return setError(feeError)
    setBusy(true)
    setError(null)
    try {
      await api<{ matches: MatchDto[] }>('/api/matches', {
        body: {
          lines: sendable.map((l) => ({ listingId: l.listingId, quantity: l.quantityMilli / 1000, pickupStartMs: l.pickupStartMs, pickupEndMs: l.pickupEndMs })),
          message: message.trim() || undefined,
          demoMode,
          ...deliveryPayload(delivery),
        },
      })
      setSentNow(true)
      setMessage('')
      notifyMatchesChanged()
      await loadExisting()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card match-panel" aria-labelledby="match-panel-title">
      <h3 className="card-title" id="match-panel-title">
        <Handshake size={20} aria-hidden="true" style={{ verticalAlign: '-4px', marginRight: 6 }} />
        {title}
      </h3>
      <p className="field-hint">
        依頼したい生産者を選んで送ります。送った時点からチャットで相談でき、生産者が<strong>承認するとマッチング成立</strong>です。依頼しても、注文の確定や在庫の確保にはなりません。
      </p>
      <ul className="match-pick">
        {lines.map((l) => {
          const m = existing.get(l.listingId)
          const active = isActive(l.listingId)
          return (
            <li key={l.listingId}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={active || selected.has(l.listingId)}
                  disabled={active || disabled}
                  onChange={(e) => {
                    const next = new Set(selected)
                    if (e.target.checked) next.add(l.listingId)
                    else next.delete(l.listingId)
                    setSelected(next)
                  }}
                />
                <span>
                  <strong>{l.producerName}</strong>：{l.itemName} {formatQtyUnit(l.quantityMilli, l.unit)}
                </span>
              </label>
              {m && <span className={MATCH_STATUS_CLASS[m.status]}>{statusLabel(m)}</span>}
              {m && (
                <Link className="btn btn-small" to={`/matches/${m.id}`}>
                  チャット
                </Link>
              )}
            </li>
          )
        })}
      </ul>
      {sendable.length > 0 && (
        <>
          <DeliveryFields idPrefix="match" value={delivery} onChange={setDelivery} pickupPlace={lines[0]?.locationName ?? ''} showErrors={tried} />
          <label className="field-label" htmlFor="match-message">
            ひとこと（任意）
          </label>
          <textarea id="match-message" className="input" rows={2} maxLength={500} placeholder="例：毎週同じくらいの量を相談したいです" value={message} onChange={(e) => setMessage(e.target.value)} />
          <button type="button" className="btn btn-primary btn-block" onClick={() => void submit()} disabled={busy || disabled}>
            <Send aria-hidden="true" />
            {busy ? '送信中…' : `選んだ生産者に依頼を送る（${sendable.length}件）`}
          </button>
        </>
      )}
      {sentNow && (
        <Notice kind="success" title="依頼を送りました">
          <p>
            生産者に通知しました。承認されるとマッチング成立です。それまでも<Link to="/matches">「やりとり」</Link>のチャットで相談できます。
          </p>
        </Notice>
      )}
      {error && <Notice kind="error">{<p>{error}</p>}</Notice>}
    </section>
  )
}
