// API を通した受入試験（02_spec.md 12章 ＋ 03_spec_addendum.md 11章）。ローカル開発環境専用。
// テストデータを作り直すため、ローカルの DB（localhost）でしか動かない。
// 実行: npm run dev を起動した状態で  npm run e2e
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import pg from 'pg'

process.loadEnvFile('.env.local')
const BASE = 'http://localhost:5173'
const PASSWORD = process.env.DEV_TEST_PASSWORD
if (!/@(localhost|127\.0\.0\.1):/.test(process.env.DATABASE_URL ?? '')) throw new Error('ローカルの DB でのみ実行できます')

let failures = 0
function check(name, condition, detail = '') {
  if (condition) console.log(`  ok   ${name}`)
  else {
    failures++
    console.log(`  FAIL ${name} ${detail}`)
  }
}

/** Cookie を覚えるクライアント（ブラウザ1つ分） */
function client() {
  const jar = new Map()
  const call = async (path, { method, body, headers = {}, origin = BASE } = {}) => {
    const res = await fetch(path.startsWith('http') ? path : BASE + path, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      redirect: 'manual',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        origin,
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';')
      const i = pair.indexOf('=')
      const value = pair.slice(i + 1)
      if (value === '' || /max-age=0/i.test(line)) jar.delete(pair.slice(0, i))
      else jar.set(pair.slice(0, i), value)
    }
    return { status: res.status, data: await res.json().catch(() => null), location: res.headers.get('location') }
  }
  call.login = (email, password = PASSWORD) => call('/api/auth/sign-in/email', { body: { email, password } })
  return call
}

/** 開発用の送信箱から、その宛先への最新メールのリンクを取り出す */
function lastMailLink(to) {
  const lines = existsSync('.dev-mail/outbox.jsonl') ? readFileSync('.dev-mail/outbox.jsonl', 'utf8').trim().split('\n') : []
  const mails = lines.map((l) => JSON.parse(l)).filter((m) => m.to === to)
  return mails.at(-1)?.text.match(/https?:\/\/\S+/)?.[0] ?? null
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitMailLink(to, previous = null) {
  for (let i = 0; i < 30; i++) {
    const link = lastMailLink(to)
    if (link && link !== previous) return link
    await wait(100)
  }
  return null
}

const jstDate = (offsetDays) => new Date(Date.now() + 9 * 3600_000 + offsetDays * 86400_000).toISOString().slice(0, 10)
const DAY2 = jstDate(2)

// ---- 準備：テストデータを作り直す ----
rmSync('.dev-mail', { recursive: true, force: true })
execSync('npx tsx prisma/seed.ts', { stdio: 'ignore' })
const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
await db.connect()

const anon = client()
const run = Date.now()
const newEmail = `e2e-farm-${run}@test.local`
const newPassword = `first-${run}-pass`

console.log('新規登録・メール確認・ログイン')
const signup = (over = {}) =>
  client()('/api/auth/sign-up/email', {
    body: { email: `x-${Math.random()}@test.local`, password: newPassword, name: 'x', signupRole: 'PRODUCER', orgName: 'E2E農園', area: '能勢町', ...over },
  })
check('役割に「運営者」を指定した登録は拒否', (await signup({ signupRole: 'ADMIN' })).status === 400)
check('役割なしの登録は拒否', (await signup({ signupRole: undefined })).status === 400)
check('短いパスワードは拒否', (await signup({ password: 'short' })).status === 400)
check('role を直接指定しても拒否または無視される', [200, 400].includes((await signup({ email: `role-${run}@test.local`, role: 'ADMIN' })).status))
const sneaky = await db.query('select role from "user" where email = $1', [`role-${run}@test.local`])
check('登録時に role=ADMIN を紛れ込ませても運営者にならない', sneaky.rows.every((r) => r.role !== 'ADMIN'))

const newbie = client()
let r = await newbie('/api/auth/sign-up/email', {
  body: { email: newEmail, password: newPassword, name: 'E2E新規農園', signupRole: 'PRODUCER', orgName: 'E2E新規農園', area: '能勢町' },
})
check('生産者として新規登録できる', r.status === 200, JSON.stringify(r.data))
check('登録直後はログイン状態にならない', (await newbie('/api/me')).data.user === null)
r = await newbie.login(newEmail, newPassword)
check('メール確認前はログインできない', r.status === 403, `${r.status}`)
const verifyLink = await waitMailLink(newEmail)
check('確認用メールが送られる', Boolean(verifyLink))
r = await newbie(verifyLink)
check('確認リンクを開くとログイン状態になる', r.status === 302 && (await newbie('/api/me')).data.user?.role === 'PRODUCER')
let me = (await newbie('/api/me')).data.user
check('登録直後の生産者は承認待ち', me.producer?.approvalStatus === 'PENDING' && me.orgName === 'E2E新規農園')

const stored = await db.query('select a.password from account a join "user" u on u.id = a."userId" where u.email = $1', [newEmail])
check('パスワードは平文で保存されていない', stored.rows.length === 1 && !stored.rows[0].password.includes(newPassword) && stored.rows[0].password.length > 60)

await newbie('/api/auth/update-user', { body: { role: 'ADMIN', suspended: false, signupRole: 'ADMIN' } })
check('自分の役割を書き換えられない', (await newbie('/api/me')).data.user.role === 'PRODUCER')
r = await newbie('/api/me', { method: 'PATCH', body: { orgName: 'E2E新規農園', area: '能勢町', role: 'ADMIN', approvalStatus: 'APPROVED' } })
check('プロフィール変更で役割・審査状態を書き換えられない', r.data.user.role === 'PRODUCER' && r.data.user.producer.approvalStatus === 'PENDING')

await newbie('/api/auth/sign-out', { body: {} })
check('ログアウトできる', (await newbie('/api/me')).data.user === null)
check('間違ったパスワードではログインできない', (await newbie.login(newEmail, 'wrong-password-123')).status === 401)

console.log('パスワード再設定')
await anon('/api/auth/request-password-reset', { body: { email: newEmail, redirectTo: '/reset-password' } })
const resetLink = await waitMailLink(newEmail, verifyLink)
r = await anon(resetLink)
const token = r.location ? new URL(r.location, BASE).searchParams.get('token') : null
check('再設定用メールのリンクからトークンを受け取れる', Boolean(token))
const resetPassword = `second-${run}-pass`
r = await anon('/api/auth/reset-password', { body: { newPassword: resetPassword, token } })
check('新しいパスワードを設定できる', r.status === 200)
check('古いパスワードではログインできない', (await client().login(newEmail, newPassword)).status === 401)
check('新しいパスワードでログインできる', (await newbie.login(newEmail, resetPassword)).status === 200)
check('使用済みのトークンは使えない', (await anon('/api/auth/reset-password', { body: { newPassword: 'another-pass-123', token } })).status === 400)
r = await anon('/api/auth/request-password-reset', { body: { email: 'nobody@test.local', redirectTo: '/reset-password' } })
check('未登録のメールアドレスでも同じ応答を返す（登録の有無を漏らさない）', r.status === 200)

console.log('権限')
const tomato = (await anon('/api/master')).data.items.find((i) => i.name === 'トマト')
const demand = (over = {}) => ({
  itemId: tomato.id,
  quantity: 10,
  unit: 'KG',
  timeMode: 'DEADLINE',
  date: DAY2,
  time: null,
  municipality: null,
  budgetMaxYen: null,
  allowIrregular: true,
  allowMultiLocation: false,
  rawText: null,
  save: false,
  ...over,
})
for (const [name, path, body] of [
  ['出品一覧', '/api/listings'],
  ['仕入れ案', '/api/plan', demand()],
  ['履歴', '/api/demands'],
  ['管理', '/api/admin'],
  ['AI抽出', '/api/extract', { text: 'トマト' }],
]) {
  check(`未ログインでは${name}を使えない`, (await anon(path, { body })).status === 401)
}

const [restaurant, restaurant2, farmA, farmB, farmC, admin] = await Promise.all(
  ['restaurant', 'restaurant2', 'farm-a', 'farm-b', 'farm-c', 'admin'].map(async (name) => {
    const c = client()
    const res = await c.login(`${name}@test.local`)
    if (res.status !== 200) throw new Error(`login failed: ${name} ${res.status}`)
    return c
  }),
)
const tomatoOf = async (c) => (await c('/api/listings')).data.listings.find((l) => l.itemName === 'トマト')
const [aTomato, bTomato, cTomato] = await Promise.all([tomatoOf(farmA), tomatoOf(farmB), tomatoOf(farmC)])
const masterC = (await farmC('/api/master')).data
const placeP = masterC.locations.find((l) => l.name.includes('P'))
const placeQ = masterC.locations.find((l) => l.name.includes('Q'))

check('飲食店は出品を変更できない', (await restaurant(`/api/listings?id=${cTomato.id}`, { method: 'PATCH', body: { quantity: 1 } })).status === 403)
check('生産者は仕入れ案を計算できない', (await farmA('/api/plan', { body: demand() })).status === 403)
check('生産者・飲食店は管理画面のAPIを使えない', (await farmA('/api/admin')).status === 403 && (await restaurant('/api/admin', { body: { target: 'producer', id: 'x', action: 'approve' } })).status === 403)
check('他の生産者の出品は数量変更できない', (await farmC(`/api/listings?id=${aTomato.id}`, { method: 'PATCH', body: { quantity: 99 } })).status === 404)
check('他の生産者の出品は削除できない', (await farmC(`/api/listings?id=${aTomato.id}`, { method: 'DELETE' })).status === 404)
check('A農園の在庫は変わっていない', (await tomatoOf(farmA)).quantityMilli === 5000)
check('他サイトからの書き込みは拒否する', (await restaurant('/api/plan', { body: demand(), origin: 'https://evil.example' })).status === 403)
check('飲食店には受渡場所の一覧（生産者用）を返さない', (await restaurant('/api/master')).data.locations.length === 0)

console.log('仕様12章')
const plan = async (over) => (await restaurant('/api/plan', { body: demand(over) })).data
let p = await plan()
check('成功：10kg・5,350円・条件達成', p.result.status === 'MATCHED' && p.result.best.plan.totalMilli === 10000 && p.result.best.plan.totalYen === 5350, JSON.stringify(p.result?.best?.plan ?? p))
const contactIds = Object.keys(p.contacts)
check(
  '連絡先：公開を選んだ項目だけを返す（Aの電話のみ。Aのメール・B・Cは含まれない）',
  contactIds.length === 1 && p.contacts[contactIds[0]].phone === '090-0000-0000' && !('email' in p.contacts[contactIds[0]]) && !JSON.stringify(p).includes('farm-a-public@test.local'),
)
check('応答に生産者のログイン用メールアドレスが含まれない', !JSON.stringify(p).includes('@test.local'))
const firstFingerprint = p.fingerprint

p = await plan({ allowIrregular: false })
check('規格外不可：8kg・2kg不足', p.result.status === 'SHORTAGE' && p.result.best.plan.totalMilli === 8000 && p.result.best.shortageMilli === 2000)
p = await plan({ budgetMaxYen: 5000 })
check('予算5,000円：予算超過（5,350円）', p.result.status === 'OVER_BUDGET' && p.result.best.plan.totalYen === 5350)
p = await plan({ quantity: 9.5 })
check('販売刻み：9.5kg希望でも0.5kgを割り当てない', p.result.best.plan.totalMilli === 9000 && p.result.best.shortageMilli === 500)

r = await farmC(`/api/listings?id=${cTomato.id}`, { method: 'PATCH', body: { quantity: 1 } })
check('生産者の更新：数量だけ送って更新できる', r.status === 200 && r.data.listing.quantityMilli === 1000 && r.data.listing.unitPriceYen === 350)
r = await restaurant('/api/plan-check', { body: { itemId: tomato.id, fingerprint: firstFingerprint } })
check('在庫変更：古い案は無効と判定される', r.data.fresh === false)
p = await plan()
check('在庫変更：再計算で9kg・1kg不足', p.result.status === 'SHORTAGE' && p.result.best.plan.totalMilli === 9000 && p.result.best.shortageMilli === 1000)
check('再計算後の案は有効と判定される', (await restaurant('/api/plan-check', { body: { itemId: tomato.id, fingerprint: p.fingerprint } })).data.fresh === true)
await farmC(`/api/listings?id=${cTomato.id}`, { method: 'PATCH', body: { quantity: 2 } })

await farmB(`/api/listings?id=${bTomato.id}`, { method: 'PATCH', body: { isPublished: false } })
p = await plan()
check('欠品：Bを非公開にするとA5+C2=7kg', p.result.best.plan.totalMilli === 7000 && !p.result.best.plan.lines.some((l) => l.producerName.includes('B')))
await farmB(`/api/listings?id=${bTomato.id}`, { method: 'PATCH', body: { isPublished: true } })

const listingBody = (over) => ({
  itemId: tomato.id,
  variety: null,
  grade: 'IRREGULAR',
  irregularReason: 'SHAPE',
  quantity: 2,
  unit: 'KG',
  unitPriceYen: 350,
  minQuantity: 1,
  stepQuantity: 1,
  pickupLocationId: placeP.id,
  pickupDate: DAY2,
  startTime: '10:00',
  endTime: '11:00',
  ...over,
})
r = await farmC(`/api/listings?id=${cTomato.id}`, { method: 'PUT', body: listingBody({ startTime: '14:00', endTime: '15:00' }) })
check('出品の編集：自分の出品の受渡時間を変更できる', r.status === 200)
p = await plan()
check('日時不一致：共通時間帯のない出品は含めない（8kg）', p.result.best.plan.totalMilli === 8000 && p.result.best.windowConflict === true)

console.log('複数の場所で受け取る参考案')
r = await farmC(`/api/listings?id=${cTomato.id}`, { method: 'PUT', body: listingBody({ pickupLocationId: placeQ.id }) })
check('出品の編集：受渡場所を変更できる', r.status === 200 && r.data.listing.pickupLocationName.includes('Q'))
p = await plan()
check('許可オフ：1か所の案だけ（8kg・不足）。別の場所の案は合算しない', p.result.multi === null && p.result.best.plan.totalMilli === 8000 && p.result.alternatives.length === 1)
p = await plan({ allowMultiLocation: true })
check(
  '許可オン：2か所で10kg・5,350円の参考案を作る（1か所の案は8kgのまま）',
  p.result.best.plan.totalMilli === 8000 && p.result.multi?.status === 'MATCHED' && p.result.multi.stops.length === 2 && p.result.multi.totalYen === 5350,
  JSON.stringify(p.result.multi),
)
check('参考案に含まれる場所の住所を返す', Object.keys(p.locations).length === 2)
p = await plan({ allowMultiLocation: true, timeMode: 'EXACT', time: '10:30' })
check('日時を固定指定した場合は複数か所の案を作らない', p.result.multi === null)
p = await plan({ municipality: '能勢町' })
check('受取エリア指定：別エリアの出品を除外する', p.result.best.plan.totalMilli === 8000 && p.result.exclusions.some((e) => e.reason === 'POINT'))
await farmC(`/api/listings?id=${cTomato.id}`, { method: 'PUT', body: listingBody({}) })
check('元に戻すと成功ケースに戻る', (await plan()).result.best.plan.totalYen === 5350)

console.log('生産者の審査')
r = await newbie('/api/locations', { body: { name: 'E2E新規農園の軒先', municipality: '能勢町', address: 'テスト3-3', note: '' } })
check('生産者は受渡場所を登録できる（確認待ち）', r.status === 201 && r.data.location.status === 'PENDING')
const newPlace = r.data.location
check('他の生産者は、確認待ちの他人の場所を使えない', (await farmC('/api/listings', { body: listingBody({ pickupLocationId: newPlace.id }) })).status === 400)
r = await newbie('/api/listings', { body: listingBody({ grade: 'REGULAR', irregularReason: null, quantity: 10, unitPriceYen: 100, pickupLocationId: newPlace.id }) })
check('承認待ちの生産者も出品を登録できる', r.status === 201 && r.data.listing.blockers.includes('PRODUCER_PENDING') && r.data.listing.blockers.includes('LOCATION_PENDING'))
const newListing = r.data.listing
p = await plan()
check('承認待ちの生産者の出品は仕入れ案に出ない', p.result.best.plan.totalYen === 5350 && p.result.best.plan.producerCount === 3)
const stableFingerprint = p.fingerprint

let overview = (await admin('/api/admin')).data
const newProducer = overview.producers.find((x) => x.farmName === 'E2E新規農園')
check('運営者は承認待ちの生産者を一覧で見られる', newProducer?.approvalStatus === 'PENDING')
await admin('/api/admin', { body: { target: 'producer', id: newProducer.id, action: 'approve' } })
p = await plan()
check('生産者を承認しても、場所が確認待ちなら仕入れ案に出ない', p.result.best.plan.producerCount === 3)
await admin('/api/admin', { body: { target: 'location', id: newPlace.id, action: 'approve' } })
p = await plan()
check('生産者と場所の両方が承認されると、出品が自動的に対象になる', p.result.best.plan.producerCount === 1 && p.result.best.plan.totalYen === 1000, JSON.stringify(p.result.best?.plan))
check('承認による変化で、古い案は無効と判定される', (await restaurant('/api/plan-check', { body: { itemId: tomato.id, fingerprint: stableFingerprint } })).data.fresh === false)
check('承認後は出品の対象外理由がなくなる', (await newbie('/api/listings')).data.listings[0].blockers.length === 0)
await admin('/api/admin', { body: { target: 'listing', id: newListing.id, action: 'suspend' } })
check('運営者が停止した出品は仕入れ案に出ない', (await plan()).result.best.plan.producerCount === 3)
await admin('/api/admin', { body: { target: 'listing', id: newListing.id, action: 'approve' } })
await admin('/api/admin', { body: { target: 'producer', id: newProducer.id, action: 'suspend' } })
check('停止された生産者の出品は仕入れ案に出ない', (await plan()).result.best.plan.producerCount === 3)
await admin('/api/admin', { body: { target: 'producer', id: newProducer.id, action: 'approve' } })

console.log('連絡先・履歴・退会')
r = await farmA('/api/me', { method: 'PATCH', body: { orgName: 'テストA農園', area: '能勢町', publicPhone: '090-0000-0000', showPhone: false, publicEmail: 'farm-a-public@test.local', showEmail: true, contactNote: null } })
check('生産者は公開する連絡先を変更できる', r.status === 200 && r.data.user.producer.showEmail === true)
await admin('/api/admin', { body: { target: 'listing', id: newListing.id, action: 'suspend' } })
p = await plan()
const contactA = Object.values(p.contacts)[0]
check('公開設定の変更が反映される（メールのみ表示、電話は非表示）', contactA?.email === 'farm-a-public@test.local' && !('phone' in contactA))
check('公開する連絡先が空のまま「公開する」にはできない', (await farmB('/api/me', { method: 'PATCH', body: { orgName: 'テストB農園', area: '豊能町', showPhone: true } })).status === 400)

r = await restaurant('/api/plan', { body: demand({ save: true, rawText: '明後日までにトマトを10kg' }) })
const demandId = r.data.demandId
let history = (await restaurant('/api/demands')).data.demands
check('仕入れ希望が履歴に保存される（条件のみ）', Boolean(demandId) && history.some((d) => d.id === demandId && d.input.quantity === 10) && !JSON.stringify(history).includes('totalYen'))
check('他の飲食店の履歴は見えない', (await restaurant2('/api/demands')).data.demands.length === 0)
check('他の飲食店の履歴は削除できない', (await restaurant2(`/api/demands?id=${demandId}`, { method: 'DELETE' })).status === 404)
check('自分の履歴は削除できる', (await restaurant(`/api/demands?id=${demandId}`, { method: 'DELETE' })).status === 200 && (await restaurant('/api/demands')).data.demands.length === 0)

await admin('/api/admin', { body: { target: 'listing', id: newListing.id, action: 'approve' } })
check('退会前：新しい生産者の出品が仕入れ案に使われている', (await plan()).result.best.plan.producerCount === 1)
check('退会にはパスワードが必要', (await newbie('/api/auth/delete-user', { body: { password: 'wrong-password-123' } })).status !== 200)
r = await newbie('/api/auth/delete-user', { body: { password: resetPassword } })
check('退会できる', r.status === 200, JSON.stringify(r.data))
const gone = await db.query('select count(*)::int as n from "user" where email = $1', [newEmail])
const orphan = await db.query('select count(*)::int as n from "Listing" where id = $1', [newListing.id])
check('退会でアカウントと出品がDBから消える', gone.rows[0].n === 0 && orphan.rows[0].n === 0)
check('退会後はログインできない', (await client().login(newEmail, resetPassword)).status === 401)
check('退会後は出品が仕入れ案から消える', (await plan()).result.best.plan.producerCount === 3)
r = await farmA(`/api/listings?id=${aTomato.id}`, { method: 'DELETE' })
check('自分の出品を削除できる', r.status === 200 && (await plan()).result.best.plan.totalMilli === 5000)

console.log('入力検証・AI停止')
check('数量が負の値なら拒否', (await restaurant('/api/plan', { body: demand({ quantity: -1 }) })).status === 400)
check('過去の日付なら拒否', (await restaurant('/api/plan', { body: demand({ date: jstDate(-1) }) })).status === 400)
check('不正な単価の出品は拒否', (await farmC('/api/listings', { body: listingBody({ unitPriceYen: 0 }) })).status === 400)
check('規格外で理由なしの出品は拒否', (await farmC('/api/listings', { body: listingBody({ irregularReason: null }) })).status === 400)
r = await restaurant('/api/extract', { body: { text: '   ' } })
check('空入力：AIを呼ばずに案内を返す', r.status === 400 && r.data.error.code === 'EMPTY')
check('長すぎる入力は拒否', (await restaurant('/api/extract', { body: { text: 'あ'.repeat(301) } })).status === 400)
if (!(await anon('/api/master')).data.aiEnabled) {
  r = await restaurant('/api/extract', { body: { text: '明後日までにトマトを10kg' } })
  check('AI停止：手入力への切替を返す', r.status === 200 && r.data.ok === false && r.data.reason === 'AI_UNAVAILABLE')
} else {
  r = await restaurant('/api/extract', { body: { text: '明後日までに大阪近郊のトマトを10kg、多少形が悪くてもOK' } })
  const f = r.data.fields ?? {}
  check(
    'AI抽出：トマト／10kg／明後日／期限／規格外可。予算と場所は補わない',
    r.data.ok && f.itemId === tomato.id && f.quantity === 10 && f.unit === 'KG' && f.date === DAY2 && f.timeMode === 'DEADLINE' && f.allowIrregular === true && f.budgetMaxYen === null && f.regionText === '大阪近郊',
    JSON.stringify(r.data),
  )
}

await db.end()
execSync('npx tsx prisma/seed.ts', { stdio: 'ignore' })
console.log(failures === 0 ? '\nすべて成功' : `\n失敗 ${failures} 件`)
process.exit(failures === 0 ? 0 : 1)
