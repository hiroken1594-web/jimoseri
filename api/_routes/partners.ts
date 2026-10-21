// 生産者が取引を提案できる飲食店の一覧。
// 出すのは「生産者からの提案を受け取る」を選んだ飲食店だけで、その生産者をブロックしている飲食店は出さない。
// 飲食店の住所・連絡先は出さない（店名と市区町村、評価だけ）。
import { requireActor } from '../_lib/auth.js'
import { handle, json } from '../_lib/http.js'
import { getPrisma } from '../_lib/prisma.js'
import { ratingSummary } from '../_lib/reviews.js'

export const GET = handle(async (request) => {
  const actor = await requireActor(request, 'PRODUCER')
  const prisma = getPrisma()
  const producer = await prisma.producer.findUniqueOrThrow({ where: { id: actor.producerId! } })
  const rows = await prisma.restaurant.findMany({
    // デモの生産者はデモの飲食店にだけ、実際の生産者は実際の飲食店にだけ提案できる
    where: { acceptProposals: true, isDemo: producer.isDemo, user: { suspended: false }, blocks: { none: { producerId: producer.id } } },
    orderBy: { name: 'asc' },
    take: 200,
  })
  const restaurants = await Promise.all(
    rows.map(async (r) => ({ id: r.id, name: r.name, area: r.city || r.area, prefecture: r.prefecture, rating: await ratingSummary('RESTAURANT', r.id) })),
  )
  return json({ restaurants, canPropose: producer.approvalStatus === 'APPROVED' })
})
