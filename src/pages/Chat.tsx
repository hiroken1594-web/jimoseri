import { AlertTriangle, ArrowLeft, Check, ChevronDown, ChevronUp, ClipboardCheck, FilePen, ListChecks, Phone, RotateCcw, Send, Star, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { ChatMessageDto, ChatResponse, MatchDto, ReviewDto, TermsProposalDto } from '../../shared/dto.js'
import type { Unit } from '../../shared/allocate.js'
import { formatQty, formatQtyUnit, formatYen, UNIT_LABEL } from '../../shared/labels.js'
import { formatJstDate, formatWindow, jstDateString, jstTimeString } from '../../shared/time.js'
import { DELIVERY_LABEL, PAYER_LABEL, tradeTotals, type DeliveryMethod, type ShippingPayer } from '../../shared/trade.js'
import { api, errorMessage } from '../api.js'
import { emptyAddress } from '../components/AddressFields.js'
import { DeliveryFields, deliveryErrors, deliveryPayload, shippingFeeError, type DeliveryValue } from '../components/DeliveryFields.js'
import { ReportButton } from '../components/ReportButton.js'
import { Dialog, EmptyState, Field, Loading, Notice } from '../components/ui.js'
import { parseNumber } from '../lib/forms.js'
import { iAmResponder, MATCH_STATUS_CLASS, newClientId, notifyMatchesChanged, ratingText, statusLabel } from '../lib/matches.js'

const POLL_MS = 5000

/** チャットで相談・確認する項目（案内のためのもので、アプリが決済や配送を代行するものではない） */
const CHECKLIST = ['数量・品質の確認', '最終価格の確認', '受渡日時の確認', '受渡場所の確認', '支払い方法の確認', '配送方法・送料の確認'] as const

/** 取引の進め方（7つの段階） */
const STEPS = [
  'チャットで商品・数量・価格を確認する',
  '受渡方法・送料・日時を決める',
  '双方で最終条件に合意する（「条件を提案」→ 相手が承諾、または「この条件で合意」）',
  '支払い方法と支払い時期を当事者どうしで確認する（現金・銀行振込など）',
  '商品を受け渡す',
  '双方が「取引完了を確認」を押す',
  'お互いにレビューを投稿する',
] as const

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

/** 条件の金額：送料が未確定のときは合計を確定した金額として出さない */
function moneyLines(t: { quantityMilli: number; unitPriceYen: number; deliveryMethod: DeliveryMethod; shippingFeeYen: number | null; shippingPayer: ShippingPayer }, unit: Unit) {
  const x = tradeTotals(t)
  return {
    subtotal: `${formatYen(t.unitPriceYen)}/${UNIT_LABEL[unit]} × ${formatQtyUnit(t.quantityMilli, unit)} ＝ ${formatYen(x.subtotalYen)}`,
    shipping:
      x.shippingYen === null
        ? '未確定'
        : t.deliveryMethod === 'PICKUP' && t.shippingFeeYen === null
          ? '送料なし（受け取り）'
          : `${formatYen(x.shippingYen)}（負担：${PAYER_LABEL[t.shippingPayer]}）`,
    total: x.totalYen === null ? `${formatYen(x.subtotalYen)}＋送料（未確定）` : formatYen(x.totalYen),
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
          <p className="trade-guide-title">{match.status === 'PENDING' ? '取引の相談が始まりました' : 'マッチングが成立しました！'}</p>
          <p>まずはチャットで、農産物の数量・価格・受渡日時・受取場所などを確認しましょう。双方で条件を確認した後、支払い方法や配送・受渡方法について相談してください。</p>
          <ol className="trade-steps">
            {STEPS.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <p>
            <strong>このアプリでは決済や配送の手配は行いません。支払いの完了を確認することもできません。</strong>お取引の詳細は、当事者同士でご確認ください。
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
            支払いの前に、相手と条件を十分に確認してください。住所・口座番号などの個人情報は必要な範囲で慎重に共有し、前払いを急がせる・アプリの外の決済サイトに誘導するなどの不審なやりとりには応じないでください。
          </p>
        </div>
      )}
    </section>
  )
}

/** いまの取引条件（合意の状態つき） */
function TermsCard({ m }: { m: MatchDto }) {
  const money = moneyLines({ ...m, quantityMilli: m.quantityMilli }, m.unit)
  const me = m.viewer === 'PRODUCER' ? 'producer' : 'restaurant'
  const partner = me === 'producer' ? 'restaurant' : 'producer'
  return (
    <section className="card terms-card" aria-labelledby="terms-title">
      <h2 className="card-title" id="terms-title">
        取引条件{m.status === 'AGREED' || m.status === 'COMPLETED' ? '（双方が合意）' : m.status === 'PENDING' ? '（提案の内容）' : '（調整中）'}
      </h2>
      <dl className="plan-summary">
        <dt>商品</dt>
        <dd>
          {m.itemName}
          {m.variety && `（${m.variety}）`} {formatQtyUnit(m.quantityMilli, m.unit)}
        </dd>
        <dt>商品代金</dt>
        <dd>{money.subtotal}</dd>
        <dt>受渡方法</dt>
        <dd>{DELIVERY_LABEL[m.deliveryMethod]}</dd>
        <dt>受渡場所</dt>
        <dd>{m.deliveryPlace || '未定'}</dd>
        <dt>希望日時</dt>
        <dd>{formatWindow(m.pickupStartMs, m.pickupEndMs)}</dd>
        <dt>送料</dt>
        <dd>{money.shipping}</dd>
        <dt>合計予定金額</dt>
        <dd>{money.total}（税込）</dd>
        {m.termsNote && (
          <>
            <dt>備考</dt>
            <dd>{m.termsNote}</dd>
          </>
        )}
      </dl>
      {(m.status === 'ACCEPTED' || m.status === 'AGREED') && m.viewer !== 'ADMIN' && (
        <p className="field-hint">
          合意：あなた {m.agreed[me] ? '✔ 済み' : '未'}／相手 {m.agreed[partner] ? '✔ 済み' : '未'}
        </p>
      )}
      <p className="footnote">金額は目安です。支払い・受渡の方法と時期は、当事者どうしで確認してください。</p>
    </section>
  )
}

function ProposalCard({ p, unit, mine, canRespond, onRespond, busy }: { p: TermsProposalDto; unit: Unit; mine: boolean; canRespond: boolean; onRespond: (id: string, action: 'accept' | 'reject') => void; busy: boolean }) {
  const money = moneyLines(p, unit)
  const STATUS = { PENDING: mine ? '相手の返事待ち' : 'あなたの返事待ち', ACCEPTED: '承諾されました（双方が合意）', REJECTED: '見送られました', SUPERSEDED: '新しい提案に置き換わりました' }
  return (
    <div className={`proposal-card is-${p.status.toLowerCase()}`}>
      <p className="proposal-head">
        <FilePen size={16} aria-hidden="true" /> {mine ? 'あなた' : '相手'}からの条件の提案 <span className={p.status === 'ACCEPTED' ? 'chip chip-live' : p.status === 'PENDING' ? 'chip chip-warn' : 'chip chip-off'}>{STATUS[p.status]}</span>
      </p>
      <ul>
        <li>数量・単価：{money.subtotal}</li>
        <li>
          受渡：{DELIVERY_LABEL[p.deliveryMethod]}
          {p.deliveryPlace && `／${p.deliveryPlace}`}・{formatWindow(p.pickupStartMs, p.pickupEndMs)}
        </li>
        <li>送料：{money.shipping}</li>
        <li>
          <strong>合計予定金額：{money.total}</strong>
        </li>
        {p.note && <li>備考：{p.note}</li>}
      </ul>
      {canRespond && p.status === 'PENDING' && !mine && (
        <div className="card-actions">
          <button className="btn btn-primary btn-small" onClick={() => onRespond(p.id, 'accept')} disabled={busy}>
            <Check aria-hidden="true" />
            この条件で承諾（合意）
          </button>
          <button className="btn btn-quiet btn-small" onClick={() => onRespond(p.id, 'reject')} disabled={busy}>
            見送る
          </button>
        </div>
      )}
    </div>
  )
}

/** 条件の提案のフォーム（数量・単価・受渡方法・場所・日時・送料・備考） */
function TermsForm({ m, onDone, onCancel }: { m: MatchDto; onDone: () => void; onCancel: () => void }) {
  const [quantity, setQuantity] = useState(formatQty(m.quantityMilli))
  const [price, setPrice] = useState(String(m.unitPriceYen))
  const [date, setDate] = useState(jstDateString(m.pickupStartMs))
  const [startTime, setStartTime] = useState(jstTimeString(m.pickupStartMs))
  const [endTime, setEndTime] = useState(jstTimeString(m.pickupEndMs))
  // 配送先の住所は、いまの条件の住所を入れ直してもらう（保存しているのは1行の住所のため）
  const [delivery, setDelivery] = useState<DeliveryValue>({ deliveryMethod: m.deliveryMethod, deliveryPlace: m.deliveryMethod === 'PICKUP' ? m.locationName : m.deliveryMethod === 'DISCUSS' ? m.deliveryPlace : '', address: emptyAddress(), shippingFee: m.shippingFeeYen === null ? '' : String(m.shippingFeeYen), shippingPayer: m.shippingPayer })
  const [showErrors, setShowErrors] = useState(false)
  const [note, setNote] = useState(m.termsNote)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const qty = parseNumber(quantity)
  const unitPrice = parseNumber(price)
  const preview =
    qty && unitPrice && !shippingFeeError(delivery)
      ? moneyLines({ quantityMilli: Math.round(qty * 1000), unitPriceYen: Math.round(unitPrice), ...deliveryPayload(delivery) }, m.unit)
      : null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const next: Record<string, string> = {}
    if (!qty || qty <= 0) next.quantity = '数量を数字で入力してください'
    if (!unitPrice || unitPrice < 1) next.price = '単価を1円以上の数字で入力してください'
    if (!date) next.date = '日付を選んでください'
    if (!startTime || !endTime || endTime <= startTime) next.time = '終了時刻は開始時刻より後にしてください'
    const fee = deliveryErrors(delivery)
    if (fee) next.fee = fee
    setShowErrors(true)
    setErrors(next)
    if (Object.keys(next).length > 0) return
    setBusy(true)
    setProblem(null)
    try {
      await api('/api/proposals', { body: { matchId: m.id, quantity: qty!, unitPriceYen: Math.round(unitPrice!), date, startTime, endTime, note: note.trim() || undefined, ...deliveryPayload(delivery) } })
      notifyMatchesChanged()
      onDone()
    } catch (err) {
      setProblem(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <h2 className="card-title" id="terms-form-title">
        取引条件を提案する
      </h2>
      <p className="field-hint">相手が承諾すると、この条件が取引条件になり、双方が合意したことになります。</p>
      <div className="field-pair">
        <Field label={`数量（${UNIT_LABEL[m.unit]}）`} required error={errors.quantity}>
          <input className="input" type="text" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </Field>
        <Field label={`単価（円/${UNIT_LABEL[m.unit]}・税込）`} required error={errors.price}>
          <input className="input" type="text" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
      </div>
      {m.deliveryMethod === 'DELIVERY' && <p className="field-hint">いまの配送先：{m.deliveryPlace}</p>}
      <DeliveryFields idPrefix="terms" value={delivery} onChange={setDelivery} pickupPlace={m.locationName} showErrors={showErrors} />
      {errors.fee && <p className="field-error">{errors.fee}</p>}
      <Field label="受渡の日付" required error={errors.date}>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="受渡の時間帯" required error={errors.time}>
        <div className="input-row">
          <input className="input" type="time" aria-label="開始時刻" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          <span className="input-suffix">〜</span>
          <input className="input" type="time" aria-label="終了時刻" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </div>
      </Field>
      <Field label="備考（任意）">
        <textarea className="input" rows={2} maxLength={500} value={note} placeholder="例：箱は返却不要です" onChange={(e) => setNote(e.target.value)} />
      </Field>
      {preview && (
        <p className="terms-preview">
          商品代金 {preview.subtotal}／送料 {preview.shipping}／<strong>合計予定金額 {preview.total}</strong>
        </p>
      )}
      {problem && <Notice kind="error">{<p>{problem}</p>}</Notice>}
      <div className="card-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? '送信中…' : 'この条件を提案する'}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>
          やめる
        </button>
      </div>
    </form>
  )
}

const SCORES = [
  ['rating', '総合評価'],
  ['satisfaction', '取引の満足度'],
  ['politeness', '対応の丁寧さ'],
  ['smoothness', '受渡のスムーズさ'],
] as const

function Stars({ value }: { value: number }) {
  return (
    <span aria-label={`5段階中${value}`}>
      {'★'.repeat(value)}
      {'☆'.repeat(5 - value)}
    </span>
  )
}

function ReviewView({ r, title }: { r: ReviewDto; title: string }) {
  return (
    <div className="review-item">
      <p>
        <strong>{title}</strong>：<Stars value={r.rating} />
      </p>
      <p className="muted">
        満足度 {r.satisfaction}／丁寧さ {r.politeness}／受渡 {r.smoothness}
      </p>
      {r.comment && <p>{r.comment}</p>}
    </div>
  )
}

/** 取引完了後の相互レビュー（1取引につき1回） */
function ReviewSection({ data, onPosted }: { data: ChatResponse; onPosted: () => void }) {
  const m = data.match
  const partnerName = m.viewer === 'PRODUCER' ? m.restaurantName : m.producerName
  const [scores, setScores] = useState<Record<string, number>>({ rating: 0, satisfaction: 0, politeness: 0, smoothness: 0 })
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (Object.values(scores).some((v) => v < 1)) return setProblem('すべての項目で、1〜5の評価を選んでください。')
    setBusy(true)
    setProblem(null)
    try {
      await api('/api/reviews', { body: { matchId: m.id, ...scores, comment: comment.trim() || undefined } })
      onPosted()
    } catch (err) {
      setProblem(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="card review-card" aria-labelledby="review-title">
      <h2 className="card-title" id="review-title">
        <Star size={20} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 4 }} />
        相互レビュー
      </h2>
      {data.reviews.mine ? (
        <ReviewView r={data.reviews.mine} title="あなたのレビュー" />
      ) : (
        <form className="form" onSubmit={submit} noValidate>
          <p className="field-hint">{partnerName}との取引を評価してください（1回だけ投稿できます）。相手のレビューは、双方が投稿すると見られます。</p>
          {SCORES.map(([key, label]) => (
            <fieldset key={key} className="star-field">
              <legend>{label}</legend>
              <div className="star-pick">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={scores[key] === n}
                    aria-label={`${label}：${n}`}
                    className={scores[key] >= n ? 'is-on' : ''}
                    onClick={() => setScores({ ...scores, [key]: n })}
                  >
                    ★
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
          <Field label="コメント（任意）">
            <textarea className="input" rows={3} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          {problem && <Notice kind="error">{<p>{problem}</p>}</Notice>}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? '送信中…' : 'レビューを投稿する'}
          </button>
        </form>
      )}
      {data.reviews.partner ? (
        <>
          <ReviewView r={data.reviews.partner} title={`${partnerName}からのレビュー`} />
          <ReportButton target={{ type: 'REVIEW', id: data.reviews.partner.id, label: `${partnerName}のレビュー` }} />
        </>
      ) : (
        <p className="muted">{data.reviews.partnerSubmitted ? '相手はレビューを投稿済みです。あなたが投稿すると表示されます。' : '相手のレビューはまだありません。'}</p>
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

/** 取引チャット（当事者だけ）。提案した時点から使え、承認・条件の合意・取引完了・レビューまでをこの画面で進める */
export function Chat() {
  const { id = '' } = useParams()
  const [data, setData] = useState<ChatResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [pending, setPending] = useState<Pending[]>([])
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [phoneOpen, setPhoneOpen] = useState(false)
  const [termsOpen, setTermsOpen] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
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
    if (total > lastCount.current) listRef.current?.lastElementChild?.scrollIntoView({ block: 'nearest' })
    lastCount.current = total
  }, [total])

  const send = async (item: Pending) => {
    setPending((p) => [...p.filter((x) => x.clientId !== item.clientId), { ...item, state: 'sending', error: undefined }])
    try {
      const res = await api<{ message: ChatMessageDto }>('/api/chat', { body: { matchId: id, body: item.body, clientId: item.clientId } })
      // 送信直後に自分のメッセージを表示する（再読み込みしなくても会話が進む）
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

  const act = async (action: 'accept' | 'decline' | 'cancel' | 'agree' | 'complete') => {
    if (action === 'complete' && !window.confirm('商品の受渡が済み、取引を完了してよいですか？（相手も確認すると取引完了になります）')) return
    setBusy(true)
    setActionError(null)
    try {
      await api(`/api/matches?id=${encodeURIComponent(id)}`, { method: 'PATCH', body: { action, reason: reason.trim() || undefined } })
      setDeclining(false)
      await load()
    } catch (e) {
      setActionError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const respondProposal = async (proposalId: string, action: 'accept' | 'reject') => {
    setBusy(true)
    setActionError(null)
    try {
      await api(`/api/proposals?id=${encodeURIComponent(proposalId)}`, { method: 'PATCH', body: { action } })
      await load()
    } catch (e) {
      setActionError(errorMessage(e))
    } finally {
      setBusy(false)
    }
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
  const partnerName = m.viewer === 'PRODUCER' ? m.restaurantName : m.producerName
  const me = m.viewer === 'PRODUCER' ? 'producer' : 'restaurant'
  const party = m.viewer !== 'ADMIN'
  const open = m.status !== 'DECLINED' && m.status !== 'CANCELLED'
  const completionStarted = m.completed.restaurant || m.completed.producer
  const hasPendingProposal = data.messages.some((x) => x.proposal?.status === 'PENDING')
  let lastDay = ''

  return (
    <div className="chat">
      <Link className="link-button" to="/matches">
        <ArrowLeft size={18} aria-hidden="true" />
        やりとりの一覧
      </Link>
      <header className="chat-head">
        <div className="chat-head-main">
          <h1 className="page-title">{partnerName}</h1>
          <p className="muted">
            {ratingText(m.partnerRating)}・{m.itemName}
            {m.variety && `（${m.variety}）`} {formatQtyUnit(m.quantityMilli, m.unit)}
            {m.isDemo && <span className="chip chip-demo">デモ</span>}
          </p>
          <span className={MATCH_STATUS_CLASS[m.status]}>{statusLabel(m)}</span>
        </div>
        {party && (
          <button type="button" className="phone-btn" aria-label={`${partnerName}に電話する`} onClick={() => setPhoneOpen(true)}>
            <Phone aria-hidden="true" />
          </button>
        )}
      </header>

      <Dialog open={phoneOpen} onClose={() => setPhoneOpen(false)} labelledBy="phone-title">
        <h2 id="phone-title" className="card-title">
          {partnerName}に電話
        </h2>
        {data.partnerPhone ? (
          <>
            <p>
              <strong>{data.partnerPhone}</strong> に電話をかけますか？
            </p>
            <p className="field-hint">
              アプリ内の匿名の通話ではなく、通常の電話として発信されます。<strong>相手にあなたの電話番号が通知される場合があります。</strong>パソコンでは、電話に対応したアプリが設定されている場合に使えます。
            </p>
            <div className="card-actions">
              <a className="btn btn-primary" href={`tel:${data.partnerPhone.replace(/-/g, '')}`} onClick={() => setPhoneOpen(false)}>
                <Phone aria-hidden="true" />
                電話をかける
              </a>
              <button type="button" className="btn btn-quiet" onClick={() => setPhoneOpen(false)}>
                やめる
              </button>
            </div>
          </>
        ) : (
          <>
            <p>{data.phoneNote}</p>
            <button type="button" className="btn" onClick={() => setPhoneOpen(false)}>
              閉じる
            </button>
          </>
        )}
      </Dialog>

      {party && m.status === 'PENDING' && iAmResponder(m) && (
        <section className="card respond-card" aria-label="提案への返事">
          <p>
            <strong>{partnerName}から取引の提案が届いています。</strong>承認するとマッチング成立です。承認の前でも、チャットで相談できます。
          </p>
          {!declining ? (
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
          ) : (
            <div className="sub-form">
              <label className="field-label" htmlFor="decline-reason">
                辞退の理由（任意・相手に表示されます）
              </label>
              <input id="decline-reason" className="input" type="text" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
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
        </section>
      )}
      {party && m.status === 'PENDING' && !iAmResponder(m) && (
        <p className="field-hint">
          {partnerName}の返事を待っています。返事の前でも、チャットで相談できます。
          <button type="button" className="link-button" onClick={() => void act('cancel')} disabled={busy}>
            提案を取り下げる
          </button>
        </p>
      )}

      <TermsCard m={m} />
      {party && open && <TradeGuide match={m} />}
      {m.viewer === 'ADMIN' && <Notice kind="info">{<p>運営者として閲覧しています（メッセージは送れません）。</p>}</Notice>}
      {actionError && <Notice kind="error">{<p>{actionError}</p>}</Notice>}

      <ol className="chat-log" ref={listRef} aria-label="メッセージ" aria-live="polite">
        {data.messages.length === 0 && pending.length === 0 && <li className="muted chat-empty">まだメッセージはありません。まずはあいさつと、数量・受渡日時の確認から始めましょう。</li>}
        {data.messages.flatMap((msg) => {
          // 日付が変わるところに、日付の見出しを入れる
          const day = jstDateString(msg.createdAtMs)
          const items = day !== lastDay ? [<li key={`day-${day}`} className="chat-day">{formatJstDate(msg.createdAtMs)}</li>] : []
          lastDay = day
          if (msg.kind === 'SYSTEM') {
            items.push(
              <li key={msg.id} className="chat-system">
                <ClipboardCheck size={16} aria-hidden="true" /> {msg.body}
                <time dateTime={new Date(msg.createdAtMs).toISOString()}>{jstTimeString(msg.createdAtMs)}</time>
              </li>,
            )
          } else if (msg.kind === 'PROPOSAL' && msg.proposal) {
            items.push(
              <li key={msg.id} className={msg.mine ? 'bubble-row is-mine' : 'bubble-row'}>
                <ProposalCard p={msg.proposal} unit={m.unit} mine={msg.mine} canRespond={party} onRespond={(pid, a) => void respondProposal(pid, a)} busy={busy} />
                <time className="bubble-time">{jstTimeString(msg.createdAtMs)}</time>
              </li>,
            )
          } else {
            items.push(<Bubble key={msg.id} m={msg} otherName={partnerName} />)
          }
          return items
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

      {party && m.status === 'COMPLETED' && <ReviewSection data={data} onPosted={() => void load()} />}

      {error && <Notice kind="warn">{<p>最新のメッセージを読み込めませんでした（{error}）。自動でもう一度試します。</p>}</Notice>}

      {party && open && (
        <div className="chat-bottom">
          <div className="chat-actions">
            {(m.status === 'ACCEPTED' || m.status === 'AGREED') && !completionStarted && (
              <button type="button" className="btn btn-small" onClick={() => setTermsOpen(true)} disabled={busy}>
                <FilePen aria-hidden="true" />
                条件を提案
              </button>
            )}
            {m.status === 'ACCEPTED' && !m.agreed[me] && (
              <button type="button" className="btn btn-small" onClick={() => void act('agree')} disabled={busy || hasPendingProposal}>
                <Check aria-hidden="true" />
                この条件で合意
              </button>
            )}
            {m.status === 'AGREED' && !m.completed[me] && (
              <button type="button" className="btn btn-small btn-primary" onClick={() => void act('complete')} disabled={busy}>
                <ClipboardCheck aria-hidden="true" />
                取引完了を確認
              </button>
            )}
            {m.status === 'AGREED' && m.completed[me] && <span className="chip chip-warn">相手の完了確認待ち</span>}
          </div>
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
        </div>
      )}
      {party && !open && <p className="muted">この取引は終了しました（辞退・取り下げ）。これまでのメッセージは見られます。</p>}

      <Dialog open={termsOpen} onClose={() => setTermsOpen(false)} labelledBy="terms-form-title">
        <TermsForm
          m={m}
          onCancel={() => setTermsOpen(false)}
          onDone={() => {
            setTermsOpen(false)
            void load()
          }}
        />
      </Dialog>
    </div>
  )
}
