import { recoveryReissueSchema, recoveryResetSchema } from '../../shared/schemas.js'
import { checkPassword, issueRecoveryCode, setPassword, verifyRecoveryCode } from '../_lib/accounts.js'
import { requireActor } from '../_lib/auth.js'
import { handle, HttpError, json, readBody } from '../_lib/http.js'
import { clientIp, requireAllowed } from '../_lib/throttle.js'

// パスワードを忘れたとき：ユーザー名とリカバリーコードで、新しいパスワードを設定する（メールは使わない）。
// 成功すると、使ったコードは無効になり、新しいコードを一度だけ返す。すべての端末のログインも無効になる。
export const POST = handle(async (request) => {
  const body = await readBody(request, recoveryResetSchema)
  // 総当たり対策：接続元ごと・ユーザー名ごとに試行回数を制限する
  await requireAllowed('recover-ip', clientIp(request), 10, 15 * 60)
  await requireAllowed('recover-user', body.username, 5, 15 * 60)

  const userId = await verifyRecoveryCode(body.username, body.recoveryCode)
  if (!userId) {
    // ユーザー名とコードのどちらが違うかは伝えない
    throw new HttpError(400, 'BAD_RECOVERY', 'ユーザー名またはリカバリーコードが違います。')
  }
  await setPassword(userId, body.newPassword)
  const recoveryCode = await issueRecoveryCode(userId)
  return json({ recoveryCode })
})

// リカバリーコードの再発行（ログイン中・現在のパスワードの確認が必要）。それまでのコードは無効になる。
export const PUT = handle(async (request) => {
  const actor = await requireActor(request)
  const body = await readBody(request, recoveryReissueSchema)
  await requireAllowed('reissue-user', actor.user.id, 5, 15 * 60)
  if (!(await checkPassword(actor.user.id, body.password))) {
    throw new HttpError(400, 'BAD_PASSWORD', '現在のパスワードが違います。', { password: '現在のパスワードが違います。' })
  }
  const recoveryCode = await issueRecoveryCode(actor.user.id)
  return json({ recoveryCode })
})
