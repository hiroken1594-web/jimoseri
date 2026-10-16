import { Heart, Info, Layers, MapPin, RotateCcw, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Link } from 'react-router-dom'
import type { MarketListing } from '../../shared/dto.js'
import { formatDistance } from '../../shared/geo.js'
import { formatQtyUnit, formatYen, IRREGULAR_LABEL, UNIT_LABEL } from '../../shared/labels.js'
import { formatWindow } from '../../shared/time.js'
import { CenterAndRadius, FilterFields } from '../components/SearchControls.js'
import { EmptyState, itemEmoji, Loading, Notice, PageTitle } from '../components/ui.js'
import { loadSearch, saveSearch, type SearchState } from '../lib/search.js'
import { setFavorite, useMarketSearch } from '../lib/useMarket.js'

interface Card extends MarketListing {
  locationName: string
  municipality: string
  distanceKm: number | null
}

const SKIP_KEY = 'jimoseri.skipped.v1'
const THRESHOLD = 110

function loadSkipped(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(SKIP_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

function saveSkipped(ids: Set<string>) {
  try {
    sessionStorage.setItem(SKIP_KEY, JSON.stringify([...ids]))
  } catch {
    // 保存できなくても使える
  }
}

/**
 * スワイプで農産物を発見する。右（または「気になる」ボタン・→キー）で保存、左（「スキップ」・←キー）で次へ。
 * 保存は「気になる」への登録だけで、注文・予約・在庫の確保・生産者への通知は行わない。
 */
export function RestaurantDiscover() {
  const [state, setState] = useState<SearchState>(() => loadSearch())
  const [picking, setPicking] = useState(false)
  const [skipped, setSkipped] = useState<Set<string>>(() => loadSkipped())
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [announce, setAnnounce] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const start = useRef<number | null>(null)
  const cardRef = useRef<HTMLElement>(null)
  const { data, loading, error: searchError, reload } = useMarketSearch(state)

  const update = (next: SearchState) => {
    setState(next)
    saveSearch(next)
  }

  const deck: Card[] = useMemo(
    () =>
      (data?.locations ?? [])
        .flatMap((loc) => loc.listings.map((l) => ({ ...l, locationName: loc.name, municipality: loc.municipality, distanceKm: loc.distanceKm })))
        .filter((c) => !c.isFavorite && !skipped.has(c.id) && !saved.has(c.id))
        .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0)),
    [data, skipped, saved],
  )
  const card = deck[0]
  const nextCard = deck[1]

  useEffect(() => {
    setDx(0)
  }, [card?.id])

  const like = async () => {
    if (!card) return
    setError(null)
    try {
      await setFavorite(card.id, true)
      setSaved((s) => new Set(s).add(card.id))
      setAnnounce(`「気になる」に保存しました：${card.itemName}（${card.producerName}）`)
    } catch (e) {
      setDx(0)
      setError(`保存できませんでした。${e instanceof Error ? e.message : ''}`)
    }
  }
  const skip = () => {
    if (!card) return
    const next = new Set(skipped).add(card.id)
    setSkipped(next)
    saveSkipped(next)
    setAnnounce(`スキップしました：${card.itemName}`)
  }

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('a,button')) return
    start.current = e.clientX
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    if (start.current !== null) setDx(e.clientX - start.current)
  }
  const onPointerUp = () => {
    if (start.current === null) return
    start.current = null
    setDragging(false)
    if (dx > THRESHOLD) {
      setDx(600)
      void like()
    } else if (dx < -THRESHOLD) {
      setDx(-600)
      skip()
    } else setDx(0)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      void like()
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      skip()
    }
  }

  const unit = card ? UNIT_LABEL[card.unit] : ''
  const summary = state.center ? `${state.centerLabel || '指定地点'}から${state.radiusKm === null ? '距離指定なし' : `${state.radiusKm}km以内`}` : '距離指定なし（中心未指定）'

  return (
    <>
      <PageTitle icon={Layers}>スワイプで発見</PageTitle>
      <p className="page-lead">右へスワイプ（または「気になる」）で保存、左へ（または「スキップ」）で次へ。保存しても注文にはなりません。</p>

      <details className="alternatives">
        <summary>
          <SlidersHorizontal size={20} aria-hidden="true" style={{ marginRight: 8 }} />
          探す範囲：{summary}
        </summary>
        <CenterAndRadius state={state} onChange={update} picking={picking} onPickingChange={setPicking} />
        <p className="map-note">「地図から指定」は地図の画面で使えます。</p>
        <FilterFields state={state} onChange={update} />
      </details>

      <p className="visually-hidden" aria-live="polite">
        {announce}
      </p>
      {error && <Notice kind="error">{<p>{error}</p>}</Notice>}
      {searchError && (
        <Notice kind="error" title="読み込めませんでした">
          <p>{searchError}</p>
          <div className="notice-actions">
            <button className="btn btn-small" onClick={reload}>
              もう一度読み込む
            </button>
          </div>
        </Notice>
      )}
      {loading && !data && <Loading label="農産物を探しています…" />}

      {data && !card && (
        <EmptyState
          illust="🧺"
          title={skipped.size + saved.size > 0 ? 'この条件の農産物は、すべて見終わりました' : '条件に合う農産物がありません'}
          action={
            <div className="actions">
              {skipped.size > 0 && (
                <button
                  className="btn"
                  onClick={() => {
                    setSkipped(new Set())
                    saveSkipped(new Set())
                  }}
                >
                  <RotateCcw aria-hidden="true" />
                  スキップしたものをもう一度見る
                </button>
              )}
              <Link className="btn btn-primary" to="/restaurant/favorites">
                <Heart aria-hidden="true" />
                気になる一覧を見る
              </Link>
            </div>
          }
        >
          <p>探す範囲を広げるか、絞り込みの条件を減らしてみてください。表示されるのは、地図への公開を許可された受渡場所の出品だけです。</p>
        </EmptyState>
      )}

      {card && (
        <>
          <div className="swipe-area">
            {nextCard && (
              <div className="swipe-card is-next" aria-hidden="true">
                <div className="swipe-visual">{itemEmoji(nextCard.itemName)}</div>
              </div>
            )}
            <article
              ref={cardRef}
              key={card.id}
              className={dragging ? 'swipe-card is-dragging' : 'swipe-card'}
              style={{ transform: `translateX(${dx}px) rotate(${dx / 20}deg)` }}
              tabIndex={0}
              aria-roledescription="スワイプできるカード"
              aria-label={`${card.itemName}、${formatYen(card.unitPriceYen)}/${unit}、在庫${formatQtyUnit(card.quantityMilli, card.unit)}、${card.producerName}。→キーで気になる、←キーでスキップ`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={onKeyDown}
            >
              <span className="swipe-stamp like" style={{ opacity: Math.max(0, Math.min(1, dx / THRESHOLD)) }} aria-hidden="true">
                気になる
              </span>
              <span className="swipe-stamp skip" style={{ opacity: Math.max(0, Math.min(1, -dx / THRESHOLD)) }} aria-hidden="true">
                スキップ
              </span>
              <div className="swipe-visual" aria-hidden="true">
                {itemEmoji(card.itemName)}
              </div>
              <h2 className="card-title" style={{ fontSize: '1.35rem' }}>
                {card.itemName}
                {card.variety && <small>（{card.variety}）</small>}
              </h2>
              <p className="price" style={{ fontSize: '1.4rem' }}>
                {formatYen(card.unitPriceYen)}
                <small>/{unit}（税込）</small>
              </p>
              <p className="chips">
                <span className="chip">在庫 {formatQtyUnit(card.quantityMilli, card.unit)}</span>
                {card.grade === 'IRREGULAR' ? (
                  <span className="chip chip-irregular">規格外：{card.irregularReason ? IRREGULAR_LABEL[card.irregularReason] : '理由未登録'}</span>
                ) : (
                  <span className="chip">通常品</span>
                )}
              </p>
              <p className="muted">
                <MapPin size={16} aria-hidden="true" style={{ verticalAlign: '-3px' }} /> {card.municipality}・{card.locationName}
                {card.distanceKm !== null && `（直線 ${formatDistance(card.distanceKm)}）`}
              </p>
              <p className="muted">
                受渡 {formatWindow(card.pickupStartMs, card.pickupEndMs)}・{card.producerName}
              </p>
            </article>
          </div>
          <div className="swipe-actions">
            <button className="btn btn-large btn-quiet" onClick={skip} aria-label={`スキップ：${card.itemName}`}>
              <X aria-hidden="true" />
              スキップ
            </button>
            <Link className="btn round-btn" to={`/restaurant/listing/${card.id}`} aria-label={`${card.itemName}の詳細を見る`}>
              <Info aria-hidden="true" />
            </Link>
            <button className="btn btn-large btn-primary" onClick={() => void like()} aria-label={`気になる：${card.itemName}`}>
              <Heart aria-hidden="true" />
              気になる
            </button>
          </div>
          <p className="map-note">
            残り {deck.length} 件。カードを選んで ←／→ キーでも操作できます。「気になる」は保存だけで、注文・予約・在庫の確保にはならず、生産者にも通知されません。
          </p>
        </>
      )}
    </>
  )
}
