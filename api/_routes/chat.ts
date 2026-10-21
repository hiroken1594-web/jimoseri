// マッチング成立後のチャット。使えるのは、その依頼の飲食店と生産者だけ（運営者は閲覧のみ）。
// 送った人はサーバーがログイン中の利用者から決めるので、相手になりすまして送ることはできない。
import type { ChatMessageDto, ChatResponse } from '../../shared/dto.js'
import { chatSendSchema } from '../../shared/schemas.js'
import { requireActor } from '../_lib/auth.js'
import { handle, HttpError, json, readBody } from '../_lib/http.js'
import { loadMatchFor, toMatchDto } from '../_lib/matches.js'
import { getPrisma } from '../_lib/prisma.js'
import { requireAllowed } from '../_lib/throttle.js'

const MAX_MESSAGES = 300

// メッセージの一覧（/api/chat?matchId=...）。開いた人の「最後に読んだ日時」を更新する
export const GET = handle(async (request) => {
  const actor = await requireActor(request)
  const { row, viewer } = await loadMatchFor(actor, new URL(request.url).searchParams.get('matchId'))
  if (row.status !== 'ACCEPTED') throw new HttpError(403, 'NOT_MATCHED', 'チャットは、生産者が依頼を承認した（マッチングが成立した）後に使えます。')
  const prisma = getPrisma()
  const rows = await prisma.chatMessage.findMany({ where: { matchId: row.id }, orderBy: { createdAt: 'desc' }, take: MAX_MESSAGES })
  if (viewer !== 'ADMIN') {
    await prisma.matchRequest.update({ where: { id: row.id }, data: viewer === 'RESTAURANT' ? { restaurantReadAt: new Date() } : { producerReadAt: new Date() } })
  }
  const { row: fresh } = await loadMatchFor(actor, row.id)
  const messages: ChatMessageDto[] = rows.reverse().map((m) => ({
    id: m.id,
    clientId: m.clientId,
    body: m.body,
    createdAtMs: m.createdAt.getTime(),
    senderRole: m.senderRole,
    mine: m.senderRole === viewer,
  }))
  const response: ChatResponse = { match: await toMatchDto(fresh, viewer), messages }
  return json(response)
})

// メッセージを送る（当事者だけ）。同じ clientId の再送は、1件として扱う
export const POST = handle(async (request) => {
  const actor = await requireActor(request)
  const body = await readBody(request, chatSendSchema)
  const { row, viewer } = await loadMatchFor(actor, body.matchId)
  if (viewer === 'ADMIN') throw new HttpError(403, 'FORBIDDEN', '運営者はメッセージを送れません（閲覧のみ）。')
  if (row.status !== 'ACCEPTED') throw new HttpError(403, 'NOT_MATCHED', 'チャットは、生産者が依頼を承認した（マッチングが成立した）後に使えます。')
  await requireAllowed('chat-send', actor.user.id, 60, 10 * 60)
  const prisma = getPrisma()
  const message = await prisma.chatMessage.upsert({
    where: { matchId_clientId: { matchId: row.id, clientId: body.clientId } },
    update: {},
    create: { matchId: row.id, senderUserId: actor.user.id, senderRole: viewer, body: body.body, clientId: body.clientId },
  })
  // 送った人は、そのメッセージまで読んだことにする
  await prisma.matchRequest.update({ where: { id: row.id }, data: viewer === 'RESTAURANT' ? { restaurantReadAt: new Date() } : { producerReadAt: new Date() } })
  const dto: ChatMessageDto = {
    id: message.id,
    clientId: message.clientId,
    body: message.body,
    createdAtMs: message.createdAt.getTime(),
    senderRole: message.senderRole,
    mine: true,
  }
  return json({ message: dto }, 201)
})
