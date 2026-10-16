// 地図の表示（Leaflet ＋ 地理院タイル）。
// 地理院タイルは出典（地理院タイル）の表示で申請不要・無料で利用できる。
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useEffect, useMemo } from 'react'
import { Circle, MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import type { LatLng } from '../../shared/geo.js'

export interface MapMarker {
  id: string
  lat: number
  lng: number
  /** 読み上げ・ツールチップ用の名前 */
  label: string
  /** ピンに表示する数字（出品の数など） */
  count?: number
  selected?: boolean
}

const TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'
const ATTRIBUTION = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">地理院タイル</a>'

function pinIcon(marker: MapMarker): L.DivIcon {
  const text = marker.count !== undefined ? String(Math.min(99, marker.count)) : ''
  return L.divIcon({
    className: marker.selected ? 'map-pin is-selected' : 'map-pin',
    html: `<span><b>${text}</b></span>`,
    iconSize: [38, 38],
    iconAnchor: [19, 38],
    tooltipAnchor: [0, -36],
  })
}

const centerIcon = L.divIcon({ className: 'map-pin is-center', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 11] })

function Recenter({ center, zoom }: { center: LatLng; zoom?: number }) {
  const map = useMap()
  useEffect(() => {
    map.setView([center.lat, center.lng], zoom ?? map.getZoom(), { animate: false })
  }, [center.lat, center.lng, zoom, map])
  return null
}

function FitTo({ points }: { points: LatLng[] }) {
  const map = useMap()
  const key = points.map((p) => `${p.lat},${p.lng}`).join('|')
  useEffect(() => {
    if (points.length === 0) return
    if (points.length === 1) map.setView([points[0].lat, points[0].lng], Math.max(map.getZoom(), 14), { animate: false })
    else map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [40, 40], maxZoom: 15, animate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map])
  return null
}

function ClickHandler({ onClick }: { onClick: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onClick({ lat: e.latlng.lat, lng: e.latlng.lng }) })
  return null
}

export function MapView({
  center,
  zoom = 12,
  markers = [],
  searchCenter,
  radiusKm,
  onMarkerClick,
  onMapClick,
  fitToMarkers,
  small,
  label,
}: {
  center: LatLng
  zoom?: number
  markers?: MapMarker[]
  /** 検索の中心（青い点） */
  searchCenter?: LatLng | null
  /** 検索の半径（km）。円で表示する */
  radiusKm?: number | null
  onMarkerClick?: (id: string) => void
  onMapClick?: (p: LatLng) => void
  fitToMarkers?: boolean
  small?: boolean
  /** 地図全体の説明（読み上げ用） */
  label: string
}) {
  const icons = useMemo(() => new Map(markers.map((m) => [m.id, pinIcon(m)])), [markers])
  return (
    <div className={small ? 'map-box map-small' : 'map-box'} role="region" aria-label={label}>
      <MapContainer center={[center.lat, center.lng]} zoom={zoom} scrollWheelZoom={false} keyboard>
        <TileLayer url={TILE_URL} attribution={ATTRIBUTION} minZoom={5} maxZoom={18} />
        {!fitToMarkers && <Recenter center={center} zoom={zoom} />}
        {fitToMarkers && <FitTo points={[...markers.map((m) => ({ lat: m.lat, lng: m.lng })), ...(searchCenter ? [searchCenter] : [])]} />}
        {onMapClick && <ClickHandler onClick={onMapClick} />}
        {searchCenter && radiusKm ? (
          <Circle center={[searchCenter.lat, searchCenter.lng]} radius={radiusKm * 1000} pathOptions={{ color: '#1f5f8b', weight: 2, fillOpacity: 0.06 }} />
        ) : null}
        {searchCenter && <Marker position={[searchCenter.lat, searchCenter.lng]} icon={centerIcon} title="検索の中心" alt="検索の中心" keyboard={false} />}
        {markers.map((m) => (
          <Marker
            key={m.id}
            position={[m.lat, m.lng]}
            icon={icons.get(m.id)!}
            title={m.label}
            alt={m.label}
            eventHandlers={onMarkerClick ? { click: () => onMarkerClick(m.id), keypress: (e) => (e.originalEvent as KeyboardEvent).key === 'Enter' && onMarkerClick(m.id) } : undefined}
          >
            <Tooltip>{m.label}</Tooltip>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}
