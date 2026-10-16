import { ClipboardList, Heart, HeartOff, Layers, Map as MapIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { FavoriteItem } from '../../shared/dto.js'
import { formatQtyUnit, formatYen, IRREGULAR_LABEL, UNIT_LABEL } from '../../shared/labels.js'
import { formatJstDateTime } from '../../shared/time.js'
import { formatMarketPickup } from '../../shared/schedule.js'
import { api, errorMessage } from '../api.js'
import { EmptyState, itemEmoji, Loading, Notice, PageTitle } from '../components/ui.js'
import { setDemoMode } from '../lib/demoMode.js'
import { emptyDemandForm, saveDraft } from '../lib/forms.js'
import { setFavorite } from '../lib/useMarket.js'

/** 「気になる」の一覧。開くたびに最新の在庫・価格を表示する（保存した時点の値は使わない）。 */
export function RestaurantFavorites() {
  const navigate = useNavigate()
  const [items, setItems] = useState<FavoriteItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setItems((await api<{ favorites: FavoriteItem[] }>('/api/favorites')).favorites)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const remove = async (f: FavoriteItem) => {
    setBusyId(f.listingId)
    try {
      await setFavorite(f.listingId, false)
      setItems((all) => all?.filter((x) => x.listingId !== f.listingId) ?? null)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  const startPlan = (f: FavoriteItem) => {
    if (!f.listing) return
    if (f.isDemo) setDemoMode(true)
    saveDraft({ text: '', form: { ...emptyDemandForm(), itemId: f.listing.itemId, unit: f.listing.unit }, regionText: null, notes: [], source: 'MANUAL' })
    navigate('/restaurant/confirm', { state: { aiMessage: `${f.itemName}の条件を入れました。数量と希望日を入力してください。`, title: 'この品目で仕入れ案を作る' } })
  }

  return (
    <>
      <PageTitle icon={Heart}>気になる</PageTitle>
      <p className="page-lead">保存した農産物です。表示している在庫・価格は最新のものです。保存は注文・予約・在庫の確保ではありません。</p>
      {error && <Notice kind="error">{<p>{error}</p>}</Notice>}
      {!items && !error && <Loading label="読み込んでいます…" />}
      {items && items.length === 0 && (
        <EmptyState
          illust="💚"
          title="まだ保存したものはありません"
          action={
            <div className="actions">
              <Link className="btn btn-primary" to="/restaurant/discover">
                <Layers aria-hidden="true" />
                スワイプで発見
              </Link>
              <Link className="btn" to="/restaurant/map">
                <MapIcon aria-hidden="true" />
                地図で探す
              </Link>
            </div>
          }
        >
          <p>スワイプや地図で見つけた農産物の「気になる」を押すと、ここに保存されます。</p>
        </EmptyState>
      )}
      {items && items.length > 0 && (
        <div className="cards cards-grid">
          {items.map((f) => (
            <article key={f.listingId} className={f.available ? 'card' : 'card is-off'}>
              <header className="card-head">
                <h3>
                  <span className="item-emoji" aria-hidden="true">
                    {itemEmoji(f.itemName)}
                  </span>
                  <span>
                    {f.itemName}
                    {f.listing?.variety && <small>（{f.listing.variety}）</small>}
                  </span>
                </h3>
                {f.isDemo && <span className="chip chip-demo">デモ</span>}
                {!f.available && <span className="chip chip-off">現在は掲載されていません</span>}
              </header>
              <p className="muted">
                {f.producerName}
                {f.locationName && `・${f.locationName}`}
              </p>
              {f.listing ? (
                <>
                  <p>
                    <span className="price">
                      {formatYen(f.listing.unitPriceYen)}
                      <small>/{UNIT_LABEL[f.listing.unit]}</small>
                    </span>
                    　在庫 {formatQtyUnit(f.listing.quantityMilli, f.listing.unit)}
                    {f.listing.grade === 'IRREGULAR' && `・規格外（${f.listing.irregularReason ? IRREGULAR_LABEL[f.listing.irregularReason] : '理由未登録'}）`}
                  </p>
                  <p className="muted">受渡 {formatMarketPickup(f.listing)}</p>
                </>
              ) : (
                <p className="field-hint">公開が止められたか、受渡日を過ぎたか、在庫がなくなりました。</p>
              )}
              <p className="footnote">保存 {formatJstDateTime(f.savedAtMs)}</p>
              <div className="card-actions">
                {f.available && (
                  <>
                    <Link className="btn" to={`/restaurant/listing/${f.listingId}${f.isDemo ? '?demo=1' : ''}`}>
                      詳細
                    </Link>
                    <button className="btn" onClick={() => startPlan(f)}>
                      <ClipboardList aria-hidden="true" />
                      仕入れ案へ
                    </button>
                  </>
                )}
                <button className="btn btn-quiet" onClick={() => remove(f)} disabled={busyId === f.listingId}>
                  <HeartOff aria-hidden="true" />
                  外す
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  )
}
