import { normalizeZip } from '../../shared/geo.js'
import { geoRequestSchema } from '../../shared/schemas.js'
import { getActor, requireActor } from '../_lib/auth.js'
import { GeoUnavailableError, lookupZip, searchPlace } from '../_lib/geocode.js'
import { handle, HttpError, json, readBody } from '../_lib/http.js'
import { clientIp, requireAllowed } from '../_lib/throttle.js'

// 郵便番号 → 住所、地名 → 位置。
// 郵便番号は新規登録の画面でも使うため、ログイン前でも使える（接続元ごとに回数を制限する）。
// 地名検索はログイン中の利用者だけ（外部サービスの代理として悪用されないように）。
// 問い合わせ内容（地名・郵便番号）は、検索結果の一時保存以外には記録しない。
export const POST = handle(async (request) => {
  const body = await readBody(request, geoRequestSchema)

  if (body.op === 'zip') {
    const zip = normalizeZip(body.zip)
    if (!zip) throw new HttpError(400, 'VALIDATION', '郵便番号は7桁の数字で入力してください。', { zip: '郵便番号は7桁の数字で入力してください。' })
    const actor = await getActor(request).catch(() => null)
    if (actor) await requireAllowed('geo-zip', actor.user.id, 60, 60 * 60)
    else await requireAllowed('geo-zip-ip', clientIp(request), 30, 60 * 60)
    try {
      return json({ results: await lookupZip(zip) })
    } catch (error) {
      if (!(error instanceof GeoUnavailableError)) throw error
      console.warn('[geo] zip lookup failed:', error.message)
      return json({ results: null, unavailable: true, message: '住所の自動入力を利用できませんでした。住所を手入力してください。' })
    }
  }

  const actor = await requireActor(request)
  await requireAllowed('geo-place', actor.user.id, 30, 60 * 60)
  try {
    return json({ results: await searchPlace(body.q) })
  } catch (error) {
    if (!(error instanceof GeoUnavailableError)) throw error
    console.warn('[geo] place search failed:', error.message)
    const busy = error.message === 'busy'
    return json({
      results: null,
      unavailable: true,
      message: busy ? '検索が混み合っています。数秒待ってからもう一度お試しください。' : '地名の検索を利用できませんでした。地図をタップして場所を指定してください。',
    })
  }
})
