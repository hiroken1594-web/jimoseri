import type { LocationDto } from '../../shared/dto.js'
import { locationCreateSchema } from '../../shared/schemas.js'
import { requireActor } from '../_lib/auth.js'
import { handle, HttpError, json, readBody } from '../_lib/http.js'
import { getPrisma } from '../_lib/prisma.js'

const MAX_PENDING_PER_PRODUCER = 5

// 生産者が受渡場所を新しく登録する。運営者が確認するまでは「確認待ち」で、仕入れ案には使われない。
export const POST = handle(async (request) => {
  const actor = await requireActor(request, 'PRODUCER')
  const body = await readBody(request, locationCreateSchema)
  const prisma = getPrisma()

  const pending = await prisma.pickupLocation.count({ where: { createdById: actor.producerId!, status: 'PENDING' } })
  if (pending >= MAX_PENDING_PER_PRODUCER) {
    throw new HttpError(400, 'TOO_MANY', '確認待ちの受渡場所が多すぎます。運営者の確認をお待ちください。')
  }
  const row = await prisma.pickupLocation.create({ data: { ...body, createdById: actor.producerId!, isDemo: actor.user.producer?.isDemo ?? false } })
  const location: LocationDto = {
    id: row.id,
    name: row.name,
    municipality: row.municipality,
    address: row.address,
    note: row.note,
    status: row.status,
    mine: true,
  }
  return json({ location }, 201)
})
