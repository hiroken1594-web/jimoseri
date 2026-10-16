import { Heart, Info, Layers, MapPin, RotateCcw, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Link } from 'react-router-dom'
import type { MarketListing } from '../../shared/dto.js'
import { formatDistance } from '../../shared/geo.js'
import { formatQtyUnit, formatYen, IRREGULAR_LABEL, UNIT_LABEL } from '../../shared/labels.js'
import { DemoModeToggle } from '../components/DemoModeToggle.js'
import { SearchDiagnostics } from '../components/SearchDiagnostics.js'
import { formatMarketPickup } from '../../shared/schedule.js'
import { CenterAndRadius, FilterFields } from '../components/SearchControls.js'
import { EmptyState, itemEmoji, Loading, Notice, PageTitle } from '../components/ui.js'
import { applyWider, loadSearch, saveSearch, type SearchState } from '../lib/search.js'
import { useSession } from '../session.js'
import { setFavorite, useMarketSearch } from '../lib/useMarket.js'

interface Card extends MarketListing {
  locationName: string
  municipality: string
  distanceKm: number | null
}

const SKIP_KEY = 'jimoseri.skipped.v1'
const THRESHOLD = 110
const LEAVE_MS = 280

const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
  const { user } = useSession()
  const [state, setState] = useState<SearchState>(() => loadSearch({ storePosition: user?.storePosition, prefecture: user?.address.prefecture }))
  const [picking, setPicking] = useState(false)
  const [skipped, setSkipped] = useState<Set<string>>(() => loadSkipped())
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [announce, setAnnounce] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  /** いま画面の外へ出ていく途中のカード（その間は次の操作を受け付けない） */
  const [leaving, setLeaving] = useState<string | null>(null)
  const start = useRef<number | null>(null)
  const cardRef = useRef<HTMLElement>(null)
  const { data, loading, error: searchError, needsArea, reload } = useMarketSearch(state)

  const update = (next: SearchState) => {
    setState(next)
    saveSearch(next)
  }

  const deck: Card[] = useMemo(
    () =>
      (data?.locations ?? [])
        .flatMap((loc) => loc.listings.map((l) => ({ ...l, locationName: loc.name, municipality: loc.municipality, distanceKm: loc.distanceKm })))
        .filter((c, i, all) => !c.isFavorite && !skipped.has(c.id) && !saved.has(c.id) && all.findIndex((x) => x.id === c.id) === i)
        .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0)),
    [data, skipped, saved],
  )
  const card = deck[0]
  const nextCard = deck[1]

  useEffect(() => {
    setDx(0)
    // 次のカードにキーボードの位置を移す（カードを操作していたときだけ）
    if (card && document.activeElement?.classList.contains('swipe-card')) cardRef.current?.focus()
  }, [card?.id])

  // カードを画面の外へ動かしてから、次のカードに進む（動きを減らす設定のときは、すぐ進む）
  const leave = async (dir: 1 | -1) => {
    if (!card || leaving) return null
    setLeaving(card.id)
    setDx(dir * 700)
    if (!reducedMotion()) await wait(LEAVE_MS)
    return card
  }

  const like = async () => {
    if (!card || leaving) return
    setError(null)
    const target = card
    try {
      await Promise.all([setFavorite(target.id, true), leave(1)])
      setSaved((s) => new Set(s).add(target.id))
      setAnnounce(`「気になる」に保存しました：${target.itemName}（${target.producerName}）`)
    } catch (e) {
      setError(`保存できませんでした。${e instanceof Error ? e.message : ''}`)
    } finally {
      setDx(0)
      setLeaving(null)
    }
  }
  const skip = async () => {
    const target = await leave(-1)
    if (!target) return
    const next = new Set(skipped).add(target.id)
    setSkipped(next)
    saveSkipped(next)
    setAnnounce(`スキップしました：${target.itemName}`)
    setDx(0)
    setLeaving(null)
  }

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (leaving || (e.target as HTMLElement).closest('a,button')) return
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
    if (dx > THRESHOLD) void like()
    else if (dx < -THRESHOLD) void skip()
    else setDx(0)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      void like()
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      void skip()
    }
  }

  const unit = card ? UNIT_LABEL[card.unit] : ''
  const area = state.prefecture ? `${state.prefecture}${state.municipality ? ` ${state.municipality}` : ''}` : '受取エリア未選択'
  const summary = `${area}・` + (state.center ? `${state.centerLabel || '指定地点'}から${state.radiusKm === null ? '距離指定なし' : `${state.radiusKm}km以内`}` : '距離指定なし（中心未指定）')

  return (
    <>
      <PageTitle icon={Layers}>スワイプで発見</PageTitle>
      <p className="page-lead">右へスワイプ（または「気になる」）で保存、左へ（または「スキップ」）で次へ。保存しても注文にはなりません。</p>

      <details className="alternatives" open={needsArea || undefined}>
        <summary>
          <SlidersHorizontal size={20} aria-hidden="true" style={{ marginRight: 8 }} />
          探す範囲：{summary}
        </summary>
        <CenterAndRadius state={state} onChange={update} picking={picking} onPickingChange={setPicking} />
        <p className="map-note">「地図から指定」は地図の画面で使えます。</p>
        <FilterFields state={state} onChange={update} />
      </details>
      <DemoModeToggle compact />

      <div className="swipe-toolbar">
        <Link className="btn btn-small" to="/restaurant/favorites">
          <Heart aria-hidden="true" />
          気になるを見る{saved.size > 0 && `（このページで${saved.size}件保存）`}
        </Link>
      </div>

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
      {needsArea && (
        <Notice kind="warn" title="受取エリアを選択してください">
          <p>「探す範囲」を開いて、受け取る都道府県を選んでください（市区町村は任意）。</p>
        </Notice>
      )}
      {loading && !data && !needsArea && <Loading label="農産物を探しています…" />}

      {data && !card && skipped.size + saved.size > 0 && (
        <div className="swipe-done" role="status">
          <p className="swipe-done-illust" aria-hidden="true">
            🎉
          </p>
          <h2>すべての農産物をチェックしました！</h2>
          <p>気になるに保存した農産物を確認してみましょう。</p>
          <Link className="btn btn-primary btn-large btn-block" to="/restaurant/favorites">
            <Heart aria-hidden="true" />
            気になるを見る
          </Link>
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
        </div>
      )}

      {data && !card && skipped.size + saved.size === 0 && (
        <EmptyState
          illust="🧺"
          title="条件に合う農産物がありません"
          action={
            <Link className="btn" to="/restaurant/favorites">
              <Heart aria-hidden="true" />
              気になるを見る
            </Link>
          }
        >
          <SearchDiagnostics diagnostics={data.diagnostics} demo={data.demo} onApply={(patch) => update(applyWider(state, patch))} />
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
              className={['swipe-card', dragging && 'is-dragging', leaving === card.id && 'is-leaving'].filter(Boolean).join(' ')}
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
                {card.isDemo && <span className="chip chip-demo">デモ</span>}
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
                受渡 {formatMarketPickup(card)}・{card.producerName}
              </p>
            </article>
          </div>
          <div className="swipe-actions">
            <button className="btn btn-large btn-quiet" onClick={() => void skip()} disabled={!!leaving} aria-label={`スキップ：${card.itemName}`}>
              <X aria-hidden="true" />
              スキップ
            </button>
            <Link className="btn round-btn" to={`/restaurant/listing/${card.id}`} aria-label={`${card.itemName}の詳細を見る`}>
              <Info aria-hidden="true" />
            </Link>
            <button className="btn btn-large btn-primary" onClick={() => void like()} disabled={!!leaving} aria-label={`気になる：${card.itemName}`}>
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
