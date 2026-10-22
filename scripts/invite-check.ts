// 招待コード方式（SIGNUP_MODE=invite）の確認。ローカルの DB（localhost）でだけ動く。
// 実行: npx tsx scripts/invite-check.ts
export {}

process.loadEnvFile('.env.local')
if (!/@(localhost|127\.0\.0\.1):/.test(process.env.DATABASE_URL ?? '') || process.env.VERCEL) {
  console.error('このスクリプトはローカル開発用の DB（localhost）でのみ実行できます。')
  process.exit(1)
}
// テスト用の値（本番の招待コードとは無関係）
process.env.SIGNUP_MODE = 'invite'
process.env.SIGNUP_INVITE_CODE = 'LOCAL-TEST-INVITE'
process.env.AUTH_RATE_LIMIT = 'off'

const { route } = await import('../api/router.js')
const { getPrisma } = await import('../api/_lib/prisma.js')
const prisma = getPrisma()

let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name} ${ok ? '' : detail}`)
}
const BASE = 'http://localhost:5173'
let ip = 0
const call = async (path: string, body?: unknown, ipAddr = `203.0.113.${(ip++ % 200) + 1}`) => {
  const res = await route(new Request(BASE + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', origin: BASE, host: 'localhost:5173', 'x-forwarded-for': ipAddr }, body: body ? JSON.stringify(body) : undefined }))
  return { status: res.status, data: (await res.json().catch(() => null)) as Record<string, unknown> | null }
}
const name = `invite_${Date.now() % 1e8}`
const body = (inviteCode?: string) => ({ username: name, password: `invite-check-${Date.now()}`, role: 'RESTAURANT', orgName: '招待テスト食堂', postalCode: '530-0001', prefecture: '大阪府', city: '大阪市北区', town: '梅田', addressLine: '1-1', building: '', phone: '090-5555-6666', ...(inviteCode === undefined ? {} : { inviteCode }) })

console.log('招待コード方式（SIGNUP_MODE=invite）')
const master = (await call('/api/master')).data as { signupMode: string }
check('画面には「招待コードが必要」だけを伝え、コードそのものは返さない', master.signupMode === 'invite' && !JSON.stringify(master).includes('LOCAL-TEST-INVITE'))
check('招待コードなしでは登録できない', (await call('/api/signup', body())).status === 403)
check('間違った招待コードでは登録できない', (await call('/api/signup', body('WRONG-CODE'))).status === 403)
const ok = await call('/api/signup', body('LOCAL-TEST-INVITE'))
check('正しい招待コードなら登録できる', ok.status === 201, JSON.stringify(ok.data).slice(0, 200))
// 総当たりの対策：同じ接続元から何度も試すと止まる
let last = 0
for (let i = 0; i < 25; i++) last = (await call('/api/signup', body(`GUESS-${i}`), '198.51.100.7')).status
check('同じ接続元から招待コードを何度も試すと、回数制限で止まる', last === 429, String(last))
check('既存の利用者は、招待コード方式でもログインできる', (await call('/api/auth/sign-in/username', { username: 'restaurant1', password: process.env.DEV_TEST_PASSWORD })).status === 200)

await prisma.user.deleteMany({ where: { username: name } })
console.log(failures === 0 ? '\nすべて成功' : `\n失敗 ${failures} 件`)
process.exit(failures === 0 ? 0 : 1)
