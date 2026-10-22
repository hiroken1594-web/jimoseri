// 受渡拠点の公開範囲を一か所で決める。
//  - 名称・市区町村・町域は、確認済みの拠点なら公開してよい
//  - 番地・建物名は、登録者本人・運営者と、マッチングが成立した取引相手（チャット）にだけ見せる
//    （町域を持たない以前の拠点は、登録者が「公開してよい範囲」として書いた住所をそのまま出す）
//  - 緯度・経度は、登録者が「地図に表示する」を選んだ場合だけ公開する（自分の拠点は本人にだけ返す）
import type { LocationDto } from '../../shared/dto.js'
import type { PickupLocation } from '../../generated/prisma/client.js'

/** 飲食店・他の生産者に見せる住所（町域まで） */
export const publicAddress = (row: { town: string | null; address: string }): string => (row.town ? `${row.town}（番地は取引成立後に表示）` : row.address)

/** マッチング成立後の取引相手に見せる、受渡場所の住所（番地・建物名まで） */
export const fullAddress = (row: { prefecture: string | null; municipality: string; address: string; building: string | null }): string =>
  [`${row.prefecture ?? ''}${row.municipality}${row.address}`, row.building ?? ''].filter(Boolean).join(' ')

export function toLocationDto(row: PickupLocation, producerId: string | null, listingCount?: number): LocationDto {
  const mine = producerId !== null && row.createdById === producerId
  const showCoords = mine || row.showOnMap
  return {
    id: row.id,
    name: row.name,
    municipality: row.municipality,
    address: mine ? row.address : publicAddress(row),
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
