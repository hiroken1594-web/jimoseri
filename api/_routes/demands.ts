import type { DemandHistoryItem } from '../../shared/dto.js'
import { requireActor } from '../_lib/auth.js'
import { handle, HttpError, json } from '../_lib/http.js'
import { getPrisma } from '../_lib/prisma.js'

// 自分の仕入れ希望の履歴。保存しているのは希望条件だけで、計算結果は保存していない。
export const GET = handle(async (request) => {
  const actor = await requireActor(request, 'RESTAURANT')
  const rows = await getPrisma().demand.findMany({
    where: { restaurantId: actor.restaurantId! },
    include: { item: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  const demands: DemandHistoryItem[] = rows.map((d) => ({
    id: d.id,
    createdAtMs: d.createdAt.getTime(),
    itemName: d.item.name,
    input: {
      itemId: d.itemId,
      quantity: Number(d.quantity),
      unit: d.unit,
      timeMode: d.timeMode,
      date: d.date,
      time: d.time,
      // 受取エリアが必須になる前の履歴は、都道府県が空（使うときに選び直してもらう）
      prefecture: d.prefecture ?? '',
      municipality: d.municipality,
      // 検索地点（現在地のこともある）は保存しないため、履歴からは距離の条件を戻さない
      center: null,
      radiusKm: null,
      budgetMaxYen: d.budgetMaxYen,
      allowIrregular: d.allowIrregular,
      allowMultiLocation: d.allowMultiLocation,
      demoMode: d.demoMode,
      rawText: d.rawText,
    },
  }))
  return json({ demands })
})

// 履歴の削除（/api/demands?id=...）。他の飲食店の履歴は「存在しない」ものとして扱う。
export const DELETE = handle(async (request) => {
  const actor = await requireActor(request, 'RESTAURANT')
  const id = new URL(request.url).searchParams.get('id')
  if (!id) throw new HttpError(400, 'BAD_REQUEST', '履歴が指定されていません。')
  const result = await getPrisma().demand.deleteMany({ where: { id, restaurantId: actor.restaurantId! } })
  if (result.count === 0) throw new HttpError(404, 'NOT_FOUND', '履歴が見つかりません。')
  return json({ ok: true })
})
