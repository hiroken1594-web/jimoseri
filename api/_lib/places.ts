// 受渡拠点の公開範囲を一か所で決める。
//  - 名称・市区町村・住所（登録者が飲食店向けに書いた範囲）は、確認済みの拠点なら公開してよい
//  - 緯度・経度は、登録者が「地図に表示する」を選んだ場合だけ公開する（自分の拠点は本人にだけ返す）
import type { LocationDto } from '../../shared/dto.js'
import type { PickupLocation } from '../../generated/prisma/client.js'

export function toLocationDto(row: PickupLocation, producerId: string | null, listingCount?: number): LocationDto {
  const mine = producerId !== null && row.createdById === producerId
  const showCoords = mine || row.showOnMap
  return {
    id: row.id,
    name: row.name,
    municipality: row.municipality,
    address: row.address,
    note: row.note,
    status: row.status,
    mine,
    postalCode: mine ? row.postalCode : null,
    prefecture: row.prefecture,
    town: mine ? row.town : null,
    latitude: showCoords ? row.latitude : null,
    longitude: showCoords ? row.longitude : null,
    showOnMap: row.showOnMap,
    hours: row.hours,
    ...(mine ? { reviewNote: row.reviewNote, building: row.building } : {}),
    ...(mine && listingCount !== undefined ? { listingCount } : {}),
  }
}
