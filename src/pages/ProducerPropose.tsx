import { Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { ListingDto, MatchDto, RatingSummary } from '../../shared/dto.js'
import { formatQty, formatQtyUnit, formatYen, UNIT_LABEL } from '../../shared/labels.js'
import { formatPickup } from '../../shared/schedule.js'
import { api, errorMessage } from '../api.js'
import { DeliveryFields, deliveryDefaults, deliveryErrors, deliveryPayload, type DeliveryValue } from '../components/DeliveryFields.js'
import { EmptyState, Field, Loading, Notice, PageTitle } from '../components/ui.js'
import { parseNumber } from '../lib/forms.js'
import { notifyMatchesChanged, ratingText } from '../lib/matches.js'

interface Partner {
  id: string
  name: string
  area: string
  prefecture: string | null
  rating: RatingSummary | null
}

/**
 * 生産者から飲食店への取引提案。提案先は「生産者からの提案を受け取る」を選んだ飲食店だけ。
 * 提案は注文ではなく、飲食店が承認するとマッチング成立になる。
 */
export function ProducerPropose() {
  const navigate = useNavigate()
  const [partners, setPartners] = useState<Partner[] | null>(null)
  const [canPropose, setCanPropose] = useState(true)
  const [listings, setListings] = useState<ListingDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [restaurantId, setRestaurantId] = useState('')
  const [listingId, setListingId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [message, setMessage] = useState('')
  const [delivery, setDelivery] = useState<DeliveryValue>(deliveryDefaults(''))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([api<{ restaurants: Partner[]; canPropose: boolean }>('/api/partners'), api<{ listings: ListingDto[] }>('/api/listings')])
      .then(([p, l]) => {
        setPartners(p.restaurants)
        setCanPropose(p.canPropose)
        // 提案に使えるのは、公開中で在庫があり、受渡日時が残っていて、仕入れ案の対象になっている出品
        setListings(l.listings.filter((x) => x.isPublished && x.quantityMilli > 0 && x.pickupEndMs > Date.now() && x.blockers.length === 0))
      })
      .catch((e) => setError(errorMessage(e)))
  }, [])

  const listing = listings?.find((l) => l.id === listingId)
  const pickListing = (id: string) => {
    setListingId(id)
    const l = listings?.find((x) => x.id === id)
    if (l) setDelivery(deliveryDefaults(l.pickupLocationName))
  }

  // 入力の誤りは、送信を試みた後に各項目の下に表示する
  const [tried, setTried] = useState(false)
  const submit = async () => {
    setTried(true)
    const e: Record<string, string> = {}
    const qty = parseNumber(quantity)
    if (!restaurantId) e.restaurant = '提案する飲食店を選んでください'
    if (!listing) e.listing = '提案する農産物を選んでください'
    if (qty === null || qty <= 0) e.quantity = '数量を数字で入力してください'
    else if (listing && qty * 1000 > listing.quantityMilli) e.quantity = `いまの在庫（${formatQtyUnit(listing.quantityMilli, listing.unit)}）以下にしてください`
    const feeError = deliveryErrors(delivery)
    if (feeError) e.fee = feeError
    setErrors(e)
    if (Object.keys(e).length > 0) return
    setBusy(true)
    setError(null)
    try {
      const res = await api<{ matches: MatchDto[] }>('/api/matches', { body: { restaurantId, listingId, quantity: qty!, message: message.trim() || undefined, ...deliveryPayload(delivery) } })
      notifyMatchesChanged()
      navigate(`/matches/${res.matches[0].id}`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (error && !partners) return <Notice kind="error">{<p>{error}</p>}</Notice>
  if (!partners || !listings) return <Loading label="読み込んでいます…" />

  return (
    <>
      <PageTitle icon={Send}>飲食店に提案する</PageTitle>
      <p className="page-lead">
        提案を受け付けている飲食店に、あなたの農産物を提案できます。飲食店が承認するとマッチング成立です。提案した時点から、チャットで相談できます。
      </p>
      {!canPropose && (
        <Notice kind="warn" title="運営者の確認が済むまで、提案はできません">
          <p>登録内容の確認が済むと、提案できるようになります。</p>
        </Notice>
      )}
      {partners.length === 0 ? (
        <EmptyState illust="🏪" title="いま提案を受け付けている飲食店はありません" action={<Link className="btn" to="/matches">依頼の一覧へ</Link>}>
          <p>飲食店が「生産者からの取引提案を受け取る」を選ぶと、ここに表示されます。</p>
        </EmptyState>
      ) : listings.length === 0 ? (
        <EmptyState illust="🌱" title="提案に使える出品がありません" action={<Link className="btn btn-primary" to="/producer/new">出品を登録する</Link>}>
          <p>公開中で在庫があり、受渡場所の確認が済んだ出品が、提案に使えます。</p>
        </EmptyState>
      ) : (
        <div className="form">
          <Field label="提案する飲食店" required error={errors.restaurant} hint="提案を受け付けている飲食店だけが表示されます（店名と市区町村・評価だけ）。">
            <div className="choice-list" role="radiogroup" aria-label="提案する飲食店">
              {partners.map((p) => (
                <label key={p.id} className={restaurantId === p.id ? 'choice-card is-selected' : 'choice-card'}>
                  <input type="radio" name="restaurant" value={p.id} checked={restaurantId === p.id} onChange={() => setRestaurantId(p.id)} />
                  <span>
                    <strong>{p.name}</strong>
                    <small className="block">
                      {p.prefecture ?? ''}
                      {p.area}・{ratingText(p.rating)}
                    </small>
                  </span>
                </label>
              ))}
            </div>
          </Field>
          <Field label="提案する農産物" required error={errors.listing}>
            <select className="input" value={listingId} onChange={(e) => pickListing(e.target.value)}>
              <option value="">選んでください</option>
              {listings.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.itemName}
                  {l.variety ? `（${l.variety}）` : ''}・{formatQtyUnit(l.quantityMilli, l.unit)}・{formatYen(l.unitPriceYen)}/{UNIT_LABEL[l.unit]}
                </option>
              ))}
            </select>
          </Field>
          {listing && <p className="field-hint">受渡：{formatPickup(listing)}／{listing.pickupLocationName}（次に受け取れる回で提案します。日時はチャットで調整できます）</p>}
          <Field label="数量" required error={errors.quantity} hint={listing ? `いまの在庫：${formatQtyUnit(listing.quantityMilli, listing.unit)}` : undefined}>
            <div className="input-row">
              <input className="input" type="text" inputMode="decimal" value={quantity} placeholder={listing ? formatQty(listing.quantityMilli) : ''} onChange={(e) => setQuantity(e.target.value)} />
              <span className="input-suffix">{listing ? UNIT_LABEL[listing.unit] : ''}</span>
            </div>
          </Field>
          <DeliveryFields idPrefix="propose" value={delivery} onChange={setDelivery} pickupPlace={listing?.pickupLocationName ?? ''} showErrors={tried} />
          {errors.fee && <p className="field-error">{errors.fee}</p>}
          <Field label="ひとこと（任意）">
            <textarea className="input" rows={3} maxLength={500} value={message} placeholder="例：今週採れたトマトです。毎週の取引も相談できます。" onChange={(e) => setMessage(e.target.value)} />
          </Field>
          {error && <Notice kind="error">{<p>{error}</p>}</Notice>}
          <button type="button" className="btn btn-primary btn-large btn-block" onClick={() => void submit()} disabled={busy || !canPropose}>
            <Send aria-hidden="true" />
            {busy ? '送信中…' : 'この内容で提案する'}
          </button>
          <p className="footnote">提案は注文ではありません。飲食店が承認するとマッチング成立となり、条件はチャットで相談して決めます。1日に送れる提案の数には上限があります。</p>
        </div>
      )}
    </>
  )
}
