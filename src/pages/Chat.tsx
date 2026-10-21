import { AlertTriangle, ArrowLeft, ChevronDown, ChevronUp, ListChecks, RotateCcw, Send } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { ChatMessageDto, ChatResponse, MatchDto } from '../../shared/dto.js'
import { formatQtyUnit, formatYen, UNIT_LABEL } from '../../shared/labels.js'
import { formatJstDate, formatWindow, jstDateString, jstTimeString } from '../../shared/time.js'
import { api, errorMessage } from '../api.js'
import { EmptyState, Loading, Notice } from '../components/ui.js'
import { newClientId, notifyMatchesChanged } from '../lib/matches.js'

const POLL_MS = 5000

/** チャットで相談・確認する項目（案内のためのもので、アプリが決済や配送を代行するものではない） */
const CHECKLIST = ['数量・品質の確認', '最終価格の確認', '受渡日時の確認', '受渡場所の確認', '支払い方法の確認', '配送方法・送料の確認'] as const

interface Pending {
  clientId: string
  body: string
  state: 'sending' | 'failed'
  error?: string
}

const storageKey = (kind: string, matchId: string) => `jimoseri.chat.${kind}.${matchId}`
function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 保存できなくても使える
  }
}

/** 取引の進め方の案内。初めて開いたときは開いた状態で、2回目以降は「取引の進め方」から開ける */
function TradeGuide({ match }: { match: MatchDto }) {
  const firstTime = !readJson(storageKey('guideSeen', match.id), false)
  const [open, setOpen] = useState(firstTime)
  const [checked, setChecked] = useState<string[]>(() => readJson(storageKey(`checklist.${match.viewer}`, match.id), []))
  useEffect(() => {
    writeJson(storageKey('guideSeen', match.id), true)
  }, [match.id])
  const toggle = (item: string) => {
    const next = checked.includes(item) ? checked.filter((c) => c !== item) : [...checked, item]
    setChecked(next)
    writeJson(storageKey(`checklist.${match.viewer}`, match.id), next)
  }
  return (
    <section className={open ? 'trade-guide is-open' : 'trade-guide'} aria-labelledby={`guide-${match.id}`}>
      <button type="button" className="trade-guide-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ListChecks aria-hidden="true" />
        <span id={`guide-${match.id}`}>取引の進め方{!open && `（確認済み ${checked.length}/${CHECKLIST.length}）`}</span>
        {open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
      </button>
      {open && (
        <div className="trade-guide-body">
          <p className="trade-guide-title">マッチングが成立しました！</p>
          <p>まずはチャットで、農産物の数量・価格・受渡日時・受取場所などを確認しましょう。</p>
          <p>双方で条件を確認した後、支払い方法や配送・受渡方法について相談してください。</p>
          <p>
            <strong>このアプリでは決済や配送の手配は行いません。</strong>お取引の詳細は、当事者同士でご確認ください。
          </p>
          <fieldset className="checklist">
            <legend>チャットで確認すること（自分用のメモです）</legend>
            {CHECKLIST.map((item) => (
              <label key={item} className="check">
                <input type="checkbox" checked={checked.includes(item)} onChange={() => toggle(item)} />
                <span>{item}</span>
              </label>
            ))}
          </fieldset>
          <p className="trade-guide-caution">
            <AlertTriangle size={16} aria-hidden="true" />
            住所・口座番号などの個人情報は、必要な範囲で慎重に共有してください。前払いを急がせる・アプリの外の決済サイトに誘導するなど、不審なやりとりには応じないでください。
          </p>
        </div>
      )}
    </section>
  )
}

function Bubble({ m, otherName }: { m: ChatMessageDto; otherName: string }) {
  return (
    <li className={m.mine ? 'bubble-row is-mine' : 'bubble-row'}>
      <div className="bubble">
        <span className="visually-hidden">{m.mine ? 'あなた' : otherName}：</span>
        {m.body}
      </div>
      <time className="bubble-time" dateTime={new Date(m.createdAtMs).toISOString()}>
        {jstTimeString(m.createdAtMs)}
      </time>
    </li>
  )
}

/** マッチング成立後のチャット（飲食店・生産者の当事者だけ） */
export function Chat() {
  const { id = '' } = useParams()
  const [data, setData] = useState<ChatResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [pending, setPending] = useState<Pending[]>([])
  const listRef = useRef<HTMLOListElement>(null)
  const lastCount = useRef(0)

  const load = useCallback(async () => {
    try {
      const res = await api<ChatResponse>(`/api/chat?matchId=${encodeURIComponent(id)}`)
      setData(res)
      setError(null)
      // 届いたメッセージと同じ番号の「送信中」は消す
      setPending((p) => p.filter((x) => !res.messages.some((m) => m.clientId === x.clientId)))
      notifyMatchesChanged()
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [id])

  useEffect(() => {
    void load()
    const timer = setInterval(() => document.visibilityState === 'visible' && void load(), POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  // 新しいメッセージが増えたら、いちばん下まで送る
  const total = (data?.messages.length ?? 0) + pending.length
  useEffect(() => {
    if (total > lastCount.current) listRef.current?.lastElementChild?.scrollIntoView({ block: 'end' })
    lastCount.current = total
  }, [total])

  const send = async (item: Pending) => {
    setPending((p) => [...p.filter((x) => x.clientId !== item.clientId), { ...item, state: 'sending', error: undefined }])
    try {
      const res = await api<{ message: ChatMessageDto }>('/api/chat', { body: { matchId: id, body: item.body, clientId: item.clientId } })
      setData((d) => (d && !d.messages.some((m) => m.id === res.message.id) ? { ...d, messages: [...d.messages, res.message] } : d))
      setPending((p) => p.filter((x) => x.clientId !== item.clientId))
    } catch (e) {
      setPending((p) => p.map((x) => (x.clientId === item.clientId ? { ...x, state: 'failed', error: errorMessage(e) } : x)))
    }
  }

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    const body = text.trim()
    if (!body) return
    setText('')
    void send({ clientId: newClientId(), body, state: 'sending' })
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // パソコンでは Ctrl＋Enter（Mac は ⌘＋Enter）で送信。Enter だけなら改行
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit()
  }

  if (error && !data) {
    return (
      <EmptyState
        illust="💬"
        title="このチャットは開けません"
        action={
          <Link className="btn" to="/matches">
            やりとりの一覧へ
          </Link>
        }
      >
        <p>{error}</p>
      </EmptyState>
    )
  }
  if (!data) return <Loading label="チャットを読み込んでいます…" />

  const m = data.match
  const other = m.viewer === 'PRODUCER' ? m.restaurantName : m.producerName
  let lastDay = ''
  return (
    <div className="chat">
      <Link className="link-button" to="/matches">
        <ArrowLeft size={18} aria-hidden="true" />
        やりとりの一覧
      </Link>
      <header className="chat-head">
        <h1 className="page-title">{other}とのチャット</h1>
        <p className="muted">
          {m.itemName}
          {m.variety && `（${m.variety}）`} {formatQtyUnit(m.quantityMilli, m.unit)}・依頼時の単価 {formatYen(m.unitPriceYen)}/{UNIT_LABEL[m.unit]}・{formatWindow(m.pickupStartMs, m.pickupEndMs)}／{m.locationName}
          {m.isDemo && <span className="chip chip-demo">デモ</span>}
        </p>
        <p className="badge-unsecured">マッチング成立（注文・決済・在庫の確保ではありません）</p>
      </header>

      {m.viewer !== 'ADMIN' && <TradeGuide match={m} />}
      {m.viewer === 'ADMIN' && <Notice kind="info">{<p>運営者として閲覧しています（メッセージは送れません）。</p>}</Notice>}

      <ol className="chat-log" ref={listRef} aria-label="メッセージ" aria-live="polite">
        {data.messages.length === 0 && pending.length === 0 && <li className="muted chat-empty">まだメッセージはありません。まずはあいさつと、数量・受渡日時の確認から始めましょう。</li>}
        {data.messages.flatMap((msg) => {
          // 日付が変わるところに、日付の見出しを入れる
          const day = jstDateString(msg.createdAtMs)
          const items = day !== lastDay ? [<li key={`day-${day}`} className="chat-day">{formatJstDate(msg.createdAtMs)}</li>] : []
          lastDay = day
          return [...items, <Bubble key={msg.id} m={msg} otherName={other} />]
        })}
        {pending.map((p) => (
          <li key={p.clientId} className="bubble-row is-mine is-pending">
            <div className="bubble">{p.body}</div>
            {p.state === 'sending' ? (
              <span className="bubble-time">送信中…</span>
            ) : (
              <span className="bubble-failed" role="alert">
                送信できませんでした{p.error ? `（${p.error}）` : ''}
                <button type="button" className="btn btn-small" onClick={() => void send(p)}>
                  <RotateCcw aria-hidden="true" />
                  再送する
                </button>
                <button type="button" className="link-button" onClick={() => setPending((all) => all.filter((x) => x.clientId !== p.clientId))}>
                  取り消す
                </button>
              </span>
            )}
          </li>
        ))}
      </ol>

      {error && <Notice kind="warn">{<p>最新のメッセージを読み込めませんでした（{error}）。自動でもう一度試します。</p>}</Notice>}

      {m.viewer !== 'ADMIN' && (
        <form className="chat-input" onSubmit={submit}>
          <label className="visually-hidden" htmlFor="chat-text">
            メッセージ
          </label>
          <textarea
            id="chat-text"
            className="input"
            rows={2}
            maxLength={1000}
            placeholder="メッセージを入力（例：数量と受渡日時の確認をお願いします）"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button type="submit" className="btn btn-primary" disabled={!text.trim()} aria-label="送信">
            <Send aria-hidden="true" />
            送信
          </button>
        </form>
      )}
    </div>
  )
}
