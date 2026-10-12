import { planCheckSchema } from '../shared/schemas.js'
import { requireActor } from './_lib/auth.js'
import { handle, json, readBody } from './_lib/http.js'
import { computeFingerprint, listingInclude, planEligibleWhere, toCandidate } from './_lib/listings.js'
import { getPrisma } from './_lib/prisma.js'

// 表示中の仕入れ案が古くなっていないか確認する（在庫変更・公開停止・期限切れ・審査状態の変化を検知）。
export const POST = handle(async (request) => {
  await requireActor(request, 'RESTAURANT')
  const body = await readBody(request, planCheckSchema)
  const nowMs = Date.now()
  const rows = await getPrisma().listing.findMany({ where: planEligibleWhere(body.itemId), include: listingInclude })
  const fresh = computeFingerprint(rows.map(toCandidate), nowMs) === body.fingerprint
  return json({ fresh, checkedAtMs: nowMs })
})
