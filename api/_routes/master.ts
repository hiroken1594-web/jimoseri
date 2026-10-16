import type { MasterData } from '../../shared/dto.js'
import { getActor } from '../_lib/auth.js'
import { MIN_PASSWORD_LENGTH } from '../_lib/auth-server.js'
import { operatorInfo, signupMode, supportPhone } from '../_lib/config.js'
import { handle, json } from '../_lib/http.js'
import { isAiConfigured } from '../_lib/openai.js'
import { toLocationDto } from '../_lib/places.js'
import { getPrisma } from '../_lib/prisma.js'

/** 受取エリアの選択肢（都道府県・市区町村の組）。都道府県が未登録の場所は選択肢にしない。 */
function toAreas(places: { prefecture: string | null; municipality: string }[]): MasterData['areas'] {
  const seen = new Set<string>()
  const out: MasterData['areas'] = []
  for (const p of places) {
    if (!p.prefecture) continue
    const key = `${p.prefecture}|${p.municipality}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ prefecture: p.prefecture, municipality: p.municipality })
  }
  return out
}

// 画面の選択肢と、公開してよい設定。秘密情報は含めない。
export const GET = handle(async (request) => {
  const prisma = getPrisma()
  const actor = await getActor(request).catch(() => null)
  const producerId = actor?.producerId ?? null

  const [items, approved, mine, demoPlaces] = await Promise.all([
    prisma.item.findMany({ orderBy: { sortOrder: 'asc' } }),
    // デモデータの場所は、それを登録したデモ用の生産者にだけ見せる
    prisma.pickupLocation.findMany({
      where: { status: 'APPROVED', OR: [{ isDemo: false }, ...(producerId ? [{ createdById: producerId }] : [])] },
      orderBy: [{ municipality: 'asc' }, { name: 'asc' }],
    }),
    // 生産者には、自分が登録した確認待ちの場所も返す
    producerId
      ? prisma.pickupLocation.findMany({ where: { createdById: producerId, status: { not: 'APPROVED' } }, orderBy: { createdAt: 'desc' } })
      : Promise.resolve([]),
    // デモモード（お試し）の受取エリアの選択肢
    prisma.pickupLocation.findMany({
      where: { status: 'APPROVED', isDemo: true },
      select: { prefecture: true, municipality: true },
      distinct: ['prefecture', 'municipality'],
      orderBy: [{ prefecture: 'asc' }, { municipality: 'asc' }],
    }),
  ])

  const data: MasterData = {
    items: items.map((i) => ({ id: i.id, name: i.name })),
    locations: producerId
      ? [...approved, ...mine].map((l) => toLocationDto(l, producerId))
      : [],
    areas: toAreas(approved.filter((l) => !l.isDemo)),
    demoAreas: toAreas(demoPlaces),
    aiEnabled: isAiConfigured(),
    signupMode: signupMode(),
    operator: operatorInfo(),
    supportPhone: supportPhone(),
    minPasswordLength: MIN_PASSWORD_LENGTH,
  }
  return json(data)
})
