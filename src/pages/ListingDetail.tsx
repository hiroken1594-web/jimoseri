import { ArrowLeft, ClipboardList, Heart, MapPin, Phone } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { ListingDetail as Detail } from '../../shared/dto.js'
import { formatQty, formatQtyUnit, formatYen, IRREGULAR_LABEL, UNIT_LABEL } from '../../shared/labels.js'
import { formatJstDateTime } from '../../shared/time.js'
import { formatMarketPickup } from '../../shared/schedule.js'
import { api, errorMessage } from '../api.js'
import { MapView } from '../components/MapView.js'
import { MatchRequestPanel } from '../components/MatchRequestPanel.js'
import { ReportButton } from '../components/ReportButton.js'
import { EmptyState, Field, itemEmoji, Loading, Notice } from '../components/ui.js'
import { isDemoMode, setDemoMode } from '../lib/demoMode.js'
import { emptyDemandForm, parseNumber, saveDraft } from '../lib/forms.js'
import { ratingText } from '../lib/matches.js'
import { setFavorite } from '../lib/useMarket.js'

export function ListingDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // デモデータの出品は、デモモードのとき（または「気になる」一覧などから明示されたとき）だけ開ける
  const demo = isDemoMode() || params.get('demo') === '1'
  const [listing, setListing] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [requestQty, setRequestQty] = useState('')

  const load = useCallback(async () => {
    try {
      setListing((await api<{ listing: Detail }>(`/api/market?id=${encodeURIComponent(id ?? '')}${demo ? '&demo=1' : ''}`)).listing)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [id, demo])

  useEffect(() => {
    void load()
  }, [load])

  if (error) {
    return (
      <EmptyState
        illust="🔍"
        title="この出品は表示できません"
        action={
          <Link className="btn" to="/restaurant/map">
            地図で探す
          </Link>
        }
      >
        <p>{error}</p>
      </EmptyState>
    )
  }
  if (!listing) return <Loading label="読み込んでいます…" />

  const unit = UNIT_LABEL[listing.unit]
  const toggleFavorite = async () => {
    setBusy(true)
    setNotice(null)
    try {
      await setFavorite(listing.id, !listing.isFavorite)
      setListing({ ...listing, isFavorite: !listing.isFavorite })
      setNotice(listing.isFavorite ? '「気になる」から外しました。' : '「気になる」に保存しました。注文や在庫の確保にはなりません。')
    } catch (e) {
      setNotice(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  // この品目で仕入れ案を作る：品目と単位だけを入れた条件の入力画面へ（数量・日付は利用者が決める）
  const startPlan = () => {
    // デモデータの出品から作る仕入れ案は、デモデータだけで計算する
    if (listing.isDemo) setDemoMode(true)
    saveDraft({ text: '', form: { ...emptyDemandForm(), itemId: listing.itemId, unit: listing.unit, municipality: listing.location.municipality }, regionText: null, notes: [], source: 'MANUAL' })
    navigate('/restaurant/confirm', { state: { aiMessage: `${listing.itemName}・${listing.location.municipality}の条件を入れました。数量と希望日を入力してください。`, title: 'この品目で仕入れ案を作る' } })
  }

  return (
    <>
      <button className="link-button" style={{ alignSelf: 'flex-start' }} onClick={() => navigate(-1)}>
        <ArrowLeft size={18} aria-hidden="true" />
        戻る
      </button>
      <div className="swipe-visual" aria-hidden="true">
        {itemEmoji(listing.itemName)}
      </div>
      <h1 className="page-title">
        {listing.itemName}
        {listing.variety && <small>（{listing.variety}）</small>}
      </h1>
      <p className="chips">
        {listing.grade === 'IRREGULAR' ? (
          <span className="chip chip-irregular">規格外：{listing.irregularReason ? IRREGULAR_LABEL[listing.irregularReason] : '理由未登録'}</span>
        ) : (
          <span className="chip">通常品</span>
        )}
        {listing.isDemo && <span className="chip chip-demo">デモデータ（架空）</span>}
        {listing.isFavorite && (
          <span className="chip chip-live">
            <Heart aria-hidden="true" />
            気になる登録済み
          </span>
        )}
      </p>
      {listing.description && <p className="listing-desc">{listing.description}</p>}
      <p className="chips">
        <span className={listing.deliveryAvailable ? 'chip chip-live' : 'chip'}>
          {listing.deliveryAvailable ? `配送に対応（送料の目安：${listing.shippingFeeYen === null ? '相談' : listing.shippingFeeYen === 0 ? '無料' : formatYen(listing.shippingFeeYen)}）` : '受け取りのみ（配送は相談）'}
        </span>
        <span className="chip">最低 {formatQtyUnit(listing.minMilli, listing.unit)}から</span>
      </p>
      <dl className="hero-stats">
        <div>
          <dt>税込単価</dt>
          <dd>
            {formatYen(listing.unitPriceYen)}
            <small>/{unit}</small>
          </dd>
        </div>
        <div>
          <dt>いまの在庫</dt>
          <dd>{formatQtyUnit(listing.quantityMilli, listing.unit)}</dd>
        </div>
        <div className="hero-stats-wide">
          <dt>受渡できる日時</dt>
          <dd>{formatMarketPickup(listing)}</dd>
        </div>
      </dl>
      <p className="muted">
        販売単位：最低{formatQtyUnit(listing.minMilli, listing.unit)}・{formatQtyUnit(listing.stepMilli, listing.unit)}刻み／在庫の最終更新 {formatJstDateTime(listing.updatedAtMs)}
      </p>

      {notice && <Notice kind="success">{<p>{notice}</p>}</Notice>}
      <div className="actions">
        <button className={listing.isFavorite ? 'btn btn-large' : 'btn btn-primary btn-large'} onClick={toggleFavorite} disabled={busy} aria-pressed={listing.isFavorite}>
          <Heart aria-hidden="true" fill={listing.isFavorite ? 'currentColor' : 'none'} />
          {listing.isFavorite ? '「気になる」から外す' : '気になる'}
        </button>
        <button className="btn btn-large" onClick={startPlan}>
          <ClipboardList aria-hidden="true" />
          この品目で仕入れ案を作る
        </button>
      </div>

      <section className="card">
        <h2 className="card-title">
          <MapPin size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 4 }} />
          受渡場所
        </h2>
        <p>
          <strong>{listing.location.name}</strong>
        </p>
        <p className="muted">
          {listing.location.municipality} {listing.location.address}
        </p>
        {listing.location.hours && <p className="muted">受取の目安：{listing.location.hours}</p>}
        {listing.location.note && <p className="muted">{listing.location.note}</p>}
        {listing.location.latitude !== null && listing.location.longitude !== null ? (
          <MapView
            small
            label={`${listing.location.name}の位置`}
            center={{ lat: listing.location.latitude, lng: listing.location.longitude }}
            zoom={15}
            markers={[{ id: listing.location.id, lat: listing.location.latitude, lng: listing.location.longitude, label: listing.location.name }]}
          />
        ) : (
          <p className="field-hint">この受渡場所は、地図での位置を公開していません。</p>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">生産者</h2>
        <p>
          <strong>{listing.producerName}</strong>（{listing.producerArea}）
          <span className="muted"> {ratingText(listing.producerRating)}</span>
        </p>
        {listing.contact ? (
          <dl className="meta">
            {listing.contact.phone && (
              <div>
                <dt>電話</dt>
                <dd>
                  <a href={`tel:${listing.contact.phone}`}>
                    <Phone size={14} aria-hidden="true" /> {listing.contact.phone}
                  </a>
                </dd>
              </div>
            )}
            {listing.contact.email && (
              <div>
                <dt>メール</dt>
                <dd>
                  <a href={`mailto:${listing.contact.email}`}>{listing.contact.email}</a>
                </dd>
              </div>
            )}
            {listing.contact.note && (
              <div>
                <dt>補足</dt>
                <dd>{listing.contact.note}</dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="field-hint">この生産者は連絡先を公開していません。</p>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">この生産者にマッチング依頼</h2>
        <Field label="希望する数量" hint={`いまの在庫：${formatQtyUnit(listing.quantityMilli, listing.unit)}`}>
          <div className="input-row">
            <input className="input" type="text" inputMode="decimal" value={requestQty} placeholder={formatQty(listing.quantityMilli)} onChange={(e) => setRequestQty(e.target.value)} />
            <span className="input-suffix">{unit}</span>
          </div>
        </Field>
        <MatchRequestPanel
          key={`${listing.id}-${requestQty}`}
          title="依頼を送る"
          demoMode={listing.isDemo}
          lines={[
            {
              listingId: listing.id,
              producerName: listing.producerName,
              itemName: listing.itemName,
              quantityMilli: Math.min(listing.quantityMilli, Math.round((parseNumber(requestQty) ?? listing.quantityMilli / 1000) * 1000)),
              unit: listing.unit,
              locationName: listing.location.name,
              pickupStartMs: listing.pickupStartMs,
              pickupEndMs: listing.pickupEndMs,
            },
          ]}
        />
      </section>

      <p className="disclaimer">
        「気になる」への保存や、この画面を見ることは、注文・予約・在庫の確保ではなく、生産者にも通知されません。マッチング依頼を送ると、生産者の「依頼」に届きます（承認されても、注文の確定や在庫の確保にはなりません）。
      </p>
      <div className="chips" style={{ justifyContent: 'flex-end' }}>
        <ReportButton target={{ type: 'LISTING', id: listing.id, label: `${listing.itemName}（${listing.producerName}）` }} />
        <ReportButton target={{ type: 'PRODUCER', id: listing.producerId, label: listing.producerName }} />
      </div>
    </>
  )
}
