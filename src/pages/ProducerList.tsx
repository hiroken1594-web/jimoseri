import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ListingBlocker, ListingDto } from '../../shared/dto.js'
import { formatQty, formatYen, IRREGULAR_LABEL, UNIT_LABEL } from '../../shared/labels.js'
import { DAY_MS, formatJstDateTime, formatWindow } from '../../shared/time.js'
import { api, errorMessage } from '../api.js'
import { Loading, Notice } from '../components/ui.js'
import { parseNumber } from '../lib/forms.js'
import { useSession } from '../session.js'

const STALE_UPDATE_MS = 2 * DAY_MS

const BLOCKER_TEXT: Record<ListingBlocker, string> = {
  PRODUCER_PENDING: '運営者があなたの登録内容を確認中です',
  PRODUCER_SUSPENDED: 'アカウントが運営者により停止されています',
  LOCATION_PENDING: '受渡場所を運営者が確認中です',
  LOCATION_SUSPENDED: '受渡場所が運営者により停止されています',
  ADMIN_SUSPENDED: 'この出品は運営者により停止されています',
}

function ListingCard({
  listing,
  nowMs,
  onChange,
  onDelete,
}: {
  listing: ListingDto
  nowMs: number
  onChange: (next: ListingDto) => void
  onDelete: (id: string) => void
}) {
  const unit = UNIT_LABEL[listing.unit]
  const current = formatQty(listing.quantityMilli)
  const [qtyText, setQtyText] = useState(current)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const value = parseNumber(qtyText)
  const changed = qtyText.trim() !== current
  const expired = listing.pickupEndMs <= nowMs
  const soldOut = listing.quantityMilli === 0
  const old = nowMs - listing.updatedAtMs > STALE_UPDATE_MS
  const url = `/api/listings?id=${encodeURIComponent(listing.id)}`

  const patch = async (body: { quantity?: number; isPublished?: boolean }) => {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const result = await api<{ listing: ListingDto }>(url, { method: 'PATCH', body })
      onChange(result.listing)
      setQtyText(formatQty(result.listing.quantityMilli))
      setSaved(true)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!window.confirm(`「${listing.itemName}」の出品を削除しますか？元に戻せません。`)) return
    setBusy(true)
    setError(null)
    try {
      await api(url, { method: 'DELETE' })
      onDelete(listing.id)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  const step = (direction: 1 | -1) => {
    const base = value ?? listing.quantityMilli / 1000
    const next = Math.max(0, Math.round(base * 1000 + direction * listing.stepMilli) / 1000)
    setQtyText(String(next))
    setSaved(false)
  }

  const saveQuantity = () => {
    if (value === null) return setError('数量を数字で入力してください。')
    void patch({ quantity: value })
  }

  let state = { label: '公開中・提案候補', className: 'chip chip-live' }
  if (expired) state = { label: '受渡日時を過ぎました', className: 'chip chip-off' }
  else if (!listing.isPublished) state = { label: '公開停止中', className: 'chip chip-off' }
  else if (listing.blockers.length > 0) state = { label: '提案の対象外', className: 'chip chip-warn' }
  else if (soldOut) state = { label: '数量0・候補外', className: 'chip chip-off' }

  return (
    <article className={expired || !listing.isPublished ? 'card listing-card is-off' : 'card listing-card'}>
      <header className="card-head">
        <h3>
          {listing.itemName}
          {listing.variety && <small>（{listing.variety}）</small>}
        </h3>
        <span className={state.className}>{state.label}</span>
      </header>
      <p className="chips">
        {listing.grade === 'IRREGULAR' ? (
          <span className="chip chip-irregular">規格外：{listing.irregularReason ? IRREGULAR_LABEL[listing.irregularReason] : '理由未登録'}</span>
        ) : (
          <span className="chip">通常品</span>
        )}
        <span className="chip">
          {formatYen(listing.unitPriceYen)}/{unit}（税込）
        </span>
      </p>
      {!expired && listing.blockers.length > 0 && (
        <Notice kind="warn" title="まだ飲食店の仕入れ案には表示されません">
          <ul>
            {listing.blockers.map((b) => (
              <li key={b}>{BLOCKER_TEXT[b]}</li>
            ))}
          </ul>
        </Notice>
      )}

      <div className="qty-editor">
        <p className="qty-label">いま販売に回せる量</p>
        <div className="stepper">
          <button type="button" className="stepper-btn" aria-label={`${formatQty(listing.stepMilli)}${unit}減らす`} onClick={() => step(-1)} disabled={busy}>
            −
          </button>
          <div className="stepper-value">
            <input
              className="input stepper-input"
              type="text"
              inputMode="decimal"
              aria-label={`${listing.itemName}の販売可能量`}
              value={qtyText}
              onChange={(e) => {
                setQtyText(e.target.value)
                setSaved(false)
                setError(null)
              }}
            />
            <span>{unit}</span>
          </div>
          <button type="button" className="stepper-btn" aria-label={`${formatQty(listing.stepMilli)}${unit}増やす`} onClick={() => step(1)} disabled={busy}>
            ＋
          </button>
        </div>
        {changed && (
          <button className="btn btn-primary btn-block" onClick={saveQuantity} disabled={busy}>
            {busy ? '保存中…' : `${qtyText.trim() || '?'}${unit} に更新する`}
          </button>
        )}
        {saved && !changed && <p className="saved-note">更新しました。仕入れ案の計算に反映されます。</p>}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>

      <dl className="meta">
        <div>
          <dt>受渡</dt>
          <dd>
            {formatWindow(listing.pickupStartMs, listing.pickupEndMs)}／{listing.pickupLocationName}
          </dd>
        </div>
        <div>
          <dt>販売単位</dt>
          <dd>
            最低{formatQty(listing.minMilli)}
            {unit}・{formatQty(listing.stepMilli)}
            {unit}刻み
          </dd>
        </div>
        <div>
          <dt>最終更新</dt>
          <dd>
            {formatJstDateTime(listing.updatedAtMs)}
            {old && !expired && <span className="chip chip-warn">更新が古い・数量を確認</span>}
          </dd>
        </div>
      </dl>
      {expired && <p className="footnote">受渡日時を過ぎたため、仕入れ案には使われません。「内容を編集」で次回の日時に変更できます。</p>}

      <div className="card-actions">
        {!expired && (
          <button className="btn" onClick={() => patch({ isPublished: !listing.isPublished })} disabled={busy}>
            {listing.isPublished ? '公開を止める' : '公開を再開する'}
          </button>
        )}
        <Link className="btn" to={`/producer/edit/${listing.id}`} state={{ listing }}>
          内容を編集
        </Link>
        <button className="btn btn-quiet" onClick={remove} disabled={busy}>
          削除
        </button>
      </div>
    </article>
  )
}

export function ProducerList() {
  const { user } = useSession()
  const [listings, setListings] = useState<ListingDto[] | null>(null)
  const [nowMs, setNowMs] = useState(Date.now())
  const [error, setError] = useState<string | null>(null)
  const approval = user?.producer?.approvalStatus

  const load = useCallback(async () => {
    setError(null)
    try {
      const result = await api<{ listings: ListingDto[]; nowMs: number }>('/api/listings')
      setListings(result.listings)
      setNowMs(result.nowMs)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <>
      <h1 className="page-title">販売できるもの</h1>
      {approval === 'PENDING' && (
        <Notice kind="warn" title="運営者が登録内容を確認中です">
          <p>確認が済むまで、出品は飲食店の仕入れ案に表示されません。今のうちに出品を登録して準備しておくことができます。</p>
        </Notice>
      )}
      {approval === 'SUSPENDED' && (
        <Notice kind="error" title="アカウントが停止されています">
          <p>運営者により停止されているため、出品は飲食店の仕入れ案に表示されません。</p>
        </Notice>
      )}
      <p className="page-lead">
        登録した内容は、条件が合う飲食店の仕入れ案の<strong>候補</strong>になります。登録や提案への掲載は、売れたことを意味しません。
      </p>
      <Link className="btn btn-primary btn-large btn-block" to="/producer/new">
        ＋ 販売できるものを登録
      </Link>

      {error && (
        <Notice kind="error" title="読み込めませんでした">
          <p>{error}</p>
          <div className="notice-actions">
            <button className="btn btn-small" onClick={load}>
              もう一度読み込む
            </button>
          </div>
        </Notice>
      )}
      {!listings && !error && <Loading label="出品を読み込んでいます…" />}
      {listings && listings.length === 0 && (
        <div className="empty">
          <p className="empty-title">まだ出品がありません</p>
          <p>選別や数量の確認が終わったら、販売に回せる量を登録してください。少量でも、他の生産者の分と組み合わせて提案されます。</p>
        </div>
      )}
      {listings && listings.length > 0 && (
        <div className="cards">
          {listings.map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              nowMs={nowMs}
              onChange={(next) => setListings((all) => all?.map((l) => (l.id === next.id ? next : l)) ?? null)}
              onDelete={(id) => setListings((all) => all?.filter((l) => l.id !== id) ?? null)}
            />
          ))}
        </div>
      )}
      {user?.producer && !user.producer.showPhone && !user.producer.showEmail && (
        <Notice kind="info" title="連絡先を公開していません">
          <p>
            飲食店が相談の連絡をするための電話番号やメールアドレスを、<Link to="/account">マイページ</Link>で公開できます（任意）。
          </p>
        </Notice>
      )}
    </>
  )
}
