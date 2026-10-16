import { ArrowDownWideNarrow, Heart, Layers, List, Map as MapIcon, MapPin, Navigation } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { MarketListing, MarketLocation } from '../../shared/dto.js'
import { DEFAULT_CENTER, formatDistance } from '../../shared/geo.js'
import { formatQtyUnit, formatYen, IRREGULAR_LABEL, UNIT_LABEL } from '../../shared/labels.js'
import { DemoModeToggle } from '../components/DemoModeToggle.js'
import { formatMarketPickup } from '../../shared/schedule.js'
import { MapView } from '../components/MapView.js'
import { SearchDiagnostics } from '../components/SearchDiagnostics.js'
import { CenterAndRadius, FilterFields } from '../components/SearchControls.js'
import { EmptyState, itemEmoji, Loading, Notice, PageTitle } from '../components/ui.js'
import { applyWider, loadSearch, saveSearch, type SearchState } from '../lib/search.js'
import { useSession } from '../session.js'
import { useMarketSearch } from '../lib/useMarket.js'

function ListingRow({ listing }: { listing: MarketListing }) {
  const unit = UNIT_LABEL[listing.unit]
  return (
    <Link className="listing-row" to={`/restaurant/listing/${listing.id}`}>
      <span className="item-emoji" aria-hidden="true">
        {itemEmoji(listing.itemName)}
      </span>
      <span>
        <span className="listing-row-name">
          {listing.itemName}
          {listing.variety && `（${listing.variety}）`}
          {listing.isDemo && <span className="chip chip-demo">デモ</span>}
        </span>
        <span className="listing-row-sub block">
          {listing.producerName}・在庫 {formatQtyUnit(listing.quantityMilli, listing.unit)}
          {listing.grade === 'IRREGULAR' && `・規格外（${listing.irregularReason ? IRREGULAR_LABEL[listing.irregularReason] : '理由未登録'}）`}
          {listing.isFavorite && '・気になる登録済み'}
        </span>
        <span className="listing-row-sub block">受渡 {formatMarketPickup(listing)}</span>
      </span>
      <span className="price">
        {formatYen(listing.unitPriceYen)}
        <small>/{unit}</small>
      </span>
    </Link>
  )
}

function LocationCard({ loc, headingLevel = 3 }: { loc: MarketLocation; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <article className="card result-loc" aria-label={`${loc.name}（${loc.listings.length}件）`}>
      <div className="result-loc-head">
        <div>
          <H className="card-title">
            <MapPin size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 4 }} />
            {loc.name}
          </H>
          <p className="muted">
            {loc.municipality} {loc.address}
          </p>
          {loc.hours && <p className="muted">受取の目安：{loc.hours}</p>}
        </div>
        {loc.distanceKm !== null && (
          <span className="distance">
            <Navigation size={14} aria-hidden="true" />
            直線 {formatDistance(loc.distanceKm)}
          </span>
        )}
      </div>
      <div>
        {loc.listings.map((l) => (
          <ListingRow key={l.id} listing={l} />
        ))}
      </div>
    </article>
  )
}

export function RestaurantMap() {
  const { user } = useSession()
  const [state, setState] = useState<SearchState>(() => loadSearch({ storePosition: user?.storePosition, prefecture: user?.address.prefecture }))
  const [view, setView] = useState<'map' | 'list'>('map')
  const [sort, setSort] = useState<'distance' | 'price'>('distance')
  const [picking, setPicking] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const update = (next: SearchState) => {
    setState(next)
    saveSearch(next)
  }
  const { data, loading, error, needsArea, reload } = useMarketSearch(state)

  const locations = useMemo(() => {
    const list = [...(data?.locations ?? [])]
    if (sort === 'price') list.sort((a, b) => Math.min(...a.listings.map((l) => l.unitPriceYen)) - Math.min(...b.listings.map((l) => l.unitPriceYen)))
    return list
  }, [data, sort])
  const listingCount = locations.reduce((n, l) => n + l.listings.length, 0)
  const selected = locations.find((l) => l.id === selectedId) ?? null

  return (
    <>
      <PageTitle icon={MapIcon}>地図で探す</PageTitle>
      <p className="page-lead">近くの受渡場所と、そこで受け取れる農産物を探せます。気になるものは詳細から保存・仕入れ案づくりへ進めます。</p>

      <CenterAndRadius
        state={state}
        onChange={(next) => {
          update(next)
          setSelectedId(null)
        }}
        picking={picking}
        onPickingChange={(p) => {
          setPicking(p)
          if (p) setView('map')
        }}
      />
      <FilterFields state={state} onChange={update} />
      <DemoModeToggle />

      <div className="segmented" role="group" aria-label="表示の切り替え">
        <button type="button" aria-pressed={view === 'map'} onClick={() => setView('map')}>
          <MapIcon aria-hidden="true" />
          地図
        </button>
        <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>
          <List aria-hidden="true" />
          一覧
        </button>
      </div>

      <div className="result-loc-head" aria-live="polite">
        <p>
          <strong>{needsArea ? '受取エリアが未選択です' : loading ? '検索中…' : `受渡場所 ${locations.length}か所・農産物 ${listingCount}件`}</strong>
          {state.center && state.radiusKm !== null && !loading && <span className="muted">（{state.centerLabel || '指定地点'}から{state.radiusKm}km以内）</span>}
        </p>
        <div className="segmented" role="group" aria-label="並び替え" style={{ flex: 'none' }}>
          <button type="button" aria-pressed={sort === 'distance'} onClick={() => setSort('distance')} disabled={!state.center}>
            <ArrowDownWideNarrow aria-hidden="true" />
            近い順
          </button>
          <button type="button" aria-pressed={sort === 'price'} onClick={() => setSort('price')}>
            安い順
          </button>
        </div>
      </div>

      {error && (
        <Notice kind="error" title="検索できませんでした">
          <p>{error}</p>
          <div className="notice-actions">
            <button className="btn btn-small" onClick={reload}>
              もう一度検索
            </button>
          </div>
        </Notice>
      )}

      {view === 'map' && (
        <>
          <MapView
            label="受渡場所の地図"
            center={state.center ?? DEFAULT_CENTER}
            zoom={state.center ? 12 : 10}
            fitToMarkers={!picking && locations.length > 0}
            searchCenter={state.center}
            radiusKm={state.center ? state.radiusKm : null}
            markers={locations.map((l) => ({
              id: l.id,
              lat: l.latitude,
              lng: l.longitude,
              label: `${l.name}（${l.listings.length}件${l.distanceKm !== null ? `・直線${formatDistance(l.distanceKm)}` : ''}）`,
              count: l.listings.length,
              selected: l.id === selectedId,
            }))}
            onMarkerClick={(id) => setSelectedId(id)}
            onMapClick={
              picking
                ? (p) => {
                    update({ ...state, center: p, centerLabel: '地図で指定した地点' })
                    setPicking(false)
                  }
                : undefined
            }
          />
          <p className="map-note">ピンを選ぶと、その場所で受け取れる農産物が下に表示されます。地図上の距離は直線距離で、道のりや移動時間とは異なります。</p>
          {selected ? (
            <LocationCard loc={selected} headingLevel={2} />
          ) : (
            locations.length > 0 && <p className="muted">ピンを選んでください（一覧表示に切り替えると、すべての場所を順に確認できます）。</p>
          )}
        </>
      )}

      {loading && !data && <Loading label="検索しています…" />}

      {view === 'list' && locations.length > 0 && (
        <div className="cards">
          {locations.map((l) => (
            <LocationCard key={l.id} loc={l} />
          ))}
        </div>
      )}

      {needsArea && (
        <Notice kind="warn" title="受取エリアを選択してください">
          <p>上の「どこで受け取りますか」で都道府県を選ぶと検索します（市区町村は任意）。</p>
        </Notice>
      )}

      {data && !loading && !needsArea && locations.length === 0 && (
        <EmptyState illust="🗺️" title="条件に合う農産物が見つかりませんでした">
          <SearchDiagnostics diagnostics={data.diagnostics} demo={data.demo} onApply={(patch) => update(applyWider(state, patch))} />
        </EmptyState>
      )}

      <div className="actions">
        <Link className="btn" to="/restaurant/discover">
          <Layers aria-hidden="true" />
          この条件でスワイプ
        </Link>
        <Link className="btn" to="/restaurant/favorites">
          <Heart aria-hidden="true" />
          気になる一覧
        </Link>
      </div>
    </>
  )
}
