// API を通した受入試験（02_spec.md 12章 ＋ 03_spec_addendum.md 11章）。ローカル開発環境専用。
// テストデータを作り直すため、ローカルの DB（localhost）でしか動かない。
// 実行: npm run dev を起動した状態で  npm run e2e
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
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
  call.login = (username, password = PASSWORD) => call('/api/auth/sign-in/username', { body: { username, password } })
  return call
}

const jstDate = (offsetDays) => new Date(Date.now() + 9 * 3600_000 + offsetDays * 86400_000).toISOString().slice(0, 10)
const DAY2 = jstDate(2)

// ---- 準備：テストデータを作り直す ----
execSync('npx tsx prisma/seed.ts', { stdio: 'ignore' })
const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
await db.connect()

const anon = client()
const run = Date.now() % 1_000_000
const newName = `e2e_farm_${run}`
const newPassword = `first-${run}-password`
const CODE_FORMAT = /^([0-9A-HJKMNP-TV-Z]{4}-){4}[0-9A-HJKMNP-TV-Z]{4}$/

console.log('新規登録・ログイン（ユーザー名＋パスワード）')
const signupBody = (over = {}) => ({ username: `x_${Math.floor(Math.random() * 1e9)}`, password: newPassword, role: 'PRODUCER', orgName: 'E2E農園', postalCode: '563-0101', prefecture: '大阪府', city: '豊能郡能勢町', phone: '090-1111-2222', ...over })
const signup = (over) => client()('/api/signup', { body: signupBody(over) })
check('役割に「運営者」を指定した登録は拒否', (await signup({ role: 'ADMIN' })).status === 400)
check('役割なしの登録は拒否', (await signup({ role: undefined })).status === 400)
check('郵便番号なしの登録は拒否', (await signup({ postalCode: undefined })).status === 400)
check('電話番号なしの登録は拒否', (await signup({ phone: undefined })).status === 400)
check('形式の違う電話番号の登録は拒否', (await signup({ phone: '12-3456' })).status === 400 && (await signup({ phone: '0120-12' })).status === 400)
check('郵便番号の形式が違う登録は拒否', (await signup({ postalCode: '12-345' })).status === 400)
check('短いパスワードは拒否', (await signup({ password: 'short' })).status === 400)
check('短すぎるユーザー名は拒否', (await signup({ username: 'ab' })).status === 400)
check('記号を含むユーザー名は拒否', (await signup({ username: 'bad name!' })).status === 400)
check('なりすましに使われやすい名前（admin）は拒否', (await signup({ username: 'admin' })).status === 400)
check('自動登録の検出欄が埋まっている登録は拒否', (await signup({ website: 'http://spam.example' })).status === 400)
let r = await anon('/api/auth/sign-up/email', { body: { email: 'direct@example.invalid', password: newPassword, name: 'x', username: 'direct_user', signupRole: 'PRODUCER', orgName: 'x', area: 'x', role: 'ADMIN' } })
check('認証ライブラリの登録APIを直接呼ぶことはできない', r.status === 404, `${r.status}`)
check('メール用のログイン・再設定APIは使えない', (await anon('/api/auth/sign-in/email', { body: { email: 'a@b.invalid', password: newPassword } })).status === 404 && (await anon('/api/auth/request-password-reset', { body: { email: 'a@b.invalid' } })).status === 404)
check('直接呼び出しでアカウントは作られていない', (await db.query('select count(*)::int as n from "user" where username = $1', ['direct_user'])).rows[0].n === 0)

const newbie = client()
r = await newbie('/api/signup', { body: signupBody({ username: newName.toUpperCase(), orgName: 'E2E新規農園' }) })
const firstCode = r.data?.recoveryCode
check('生産者として新規登録できる（メールアドレス不要）', r.status === 201, JSON.stringify(r.data))
check('リカバリーコードが一度だけ返される（20文字・安全な乱数）', CODE_FORMAT.test(firstCode ?? ''), firstCode)
let me = (await newbie('/api/me')).data.user
check('登録するとログイン状態になり、役割が確定している', me?.role === 'PRODUCER' && me.username === newName)
check('登録直後の生産者は承認待ち', me.producer?.approvalStatus === 'PENDING' && me.orgName === 'E2E新規農園')
check('同じユーザー名では登録できない', (await signup({ username: newName })).status === 409)

const stored = await db.query('select a.password, u.email, r."codeHash" from "user" u join account a on a."userId" = u.id join "RecoveryCode" r on r."userId" = u.id where u.username = $1', [newName])
check('パスワードは平文で保存されていない', stored.rows.length === 1 && !stored.rows[0].password.includes(newPassword) && stored.rows[0].password.length > 60)
check('リカバリーコードはハッシュだけが保存されている', !stored.rows[0].codeHash.includes(firstCode.replaceAll('-', '')) && /^[0-9a-f]{64}$/.test(stored.rows[0].codeHash))
check('実在するメールアドレスは保存されていない', stored.rows[0].email.endsWith('.invalid'))
check('登録の応答・本人情報にリカバリーコードのハッシュやパスワードが含まれない', !JSON.stringify(me).includes(stored.rows[0].codeHash) && !('password' in me))

await newbie('/api/auth/update-user', { body: { role: 'ADMIN', suspended: false, signupRole: 'ADMIN', username: 'hijacked_name' } })
me = (await newbie('/api/me')).data.user
check('自分の役割・ユーザー名を書き換えられない', me.role === 'PRODUCER' && me.username === newName)
r = await newbie('/api/me', { method: 'PATCH', body: { orgName: 'E2E新規農園', area: '能勢町', role: 'ADMIN', approvalStatus: 'APPROVED' } })
check('プロフィール変更で役割・審査状態を書き換えられない', r.data.user.role === 'PRODUCER' && r.data.user.producer.approvalStatus === 'PENDING')

await newbie('/api/auth/sign-out', { body: {} })
check('ログアウトできる', (await newbie('/api/me')).data.user === null)
r = await newbie.login(newName, 'wrong-password-123')
check('間違ったパスワードではログインできない', r.status === 401)
const noUser = await client().login('no_such_user_zz', 'wrong-password-123')
check('存在しないユーザー名でも同じ応答を返す（登録の有無を漏らさない）', noUser.status === 401 && noUser.data?.code === r.data?.code)
check('正しいパスワードでログインできる', (await newbie.login(newName, newPassword)).status === 200)

const farmBPre = client()
await farmBPre.login('farm_b')

console.log('リカバリーコードによるパスワード再設定')
const otherDevice = client()
await otherDevice.login(newName, newPassword)
const recover = (body) => client()('/api/recovery', { body })
const resetPassword = `second-${run}-password`
const wrongCode = await recover({ username: newName, recoveryCode: 'AAAA-BBBB-CCCC-DDDD-EEEE', newPassword: resetPassword })
check('間違ったコードでは再設定できない', wrongCode.status === 400)
const wrongUser = await recover({ username: 'no_such_user_zz', recoveryCode: firstCode, newPassword: resetPassword })
check('ユーザー名が違う場合も同じ応答を返す', wrongUser.status === 400 && wrongUser.data.error.message === wrongCode.data.error.message)
check('短いパスワードには再設定できない', (await recover({ username: newName, recoveryCode: firstCode, newPassword: 'short' })).status === 400)
// 入力の揺れ（小文字・ハイフンなし）も受け付ける
r = await recover({ username: newName, recoveryCode: firstCode.toLowerCase().replaceAll('-', ' '), newPassword: resetPassword })
const secondCode = r.data?.recoveryCode
check('正しいコードで新しいパスワードを設定できる', r.status === 200)
check('再設定すると新しいコードが発行される', CODE_FORMAT.test(secondCode ?? '') && secondCode !== firstCode)
check('古いパスワードではログインできない', (await client().login(newName, newPassword)).status === 401)
check('新しいパスワードでログインできる', (await newbie.login(newName, resetPassword)).status === 200)
check('再設定で他の端末のログインが無効になる', (await otherDevice('/api/me')).data.user === null)
check('使用済みのコードは使えない', (await recover({ username: newName, recoveryCode: firstCode, newPassword: 'another-password-123' })).status === 400)

check('コードの再発行には現在のパスワードが必要', (await newbie('/api/recovery', { method: 'PUT', body: { password: 'wrong-password-123' } })).status === 400)
check('未ログインではコードを再発行できない', (await anon('/api/recovery', { method: 'PUT', body: { password: resetPassword } })).status === 401)
r = await newbie('/api/recovery', { method: 'PUT', body: { password: resetPassword } })
const thirdCode = r.data?.recoveryCode
check('ログイン中の本人はコードを再発行できる', r.status === 200 && CODE_FORMAT.test(thirdCode ?? '') && thirdCode !== secondCode)
check('再発行すると、それまでのコードは無効になる', (await recover({ username: newName, recoveryCode: secondCode, newPassword: 'another-password-123' })).status === 400)
console.log('ユーザー名の変更')
const renamed = `${newName}_x`
const rename = (c, body) => c('/api/me', { method: 'PUT', body })
check('未ログインではユーザー名を変更できない', (await rename(anon, { username: renamed, password: resetPassword })).status === 401)
check('現在のパスワードが違うと変更できない', (await rename(newbie, { username: renamed, password: 'wrong-password-123' })).status === 400)
check('使えない文字・短すぎる名前には変更できない', (await rename(newbie, { username: 'bad name!', password: resetPassword })).status === 400 && (await rename(newbie, { username: 'ab', password: resetPassword })).status === 400)
check('なりすましに使われやすい名前（admin）には変更できない', (await rename(newbie, { username: 'admin', password: resetPassword })).status === 400)
check('他の利用者と重複するユーザー名には変更できない', (await rename(newbie, { username: 'restaurant1', password: resetPassword })).status === 409)
check('大文字で入力しても、重複は見逃さない', (await rename(newbie, { username: 'RESTAURANT1', password: resetPassword })).status === 409)
r = await rename(newbie, { username: renamed, password: resetPassword, userId: 'someone-else', id: 'someone-else' })
check('自分のユーザー名を変更できる', r.status === 200 && r.data.user.username === renamed, JSON.stringify(r.data))
check('他人を指定する値を紛れ込ませても、変わるのは本人だけ', (await db.query('select count(*)::int as n from "user" where username = $1', ['restaurant1'])).rows[0].n === 1 && (await db.query('select count(*)::int as n from "user" where username = $1', [renamed])).rows[0].n === 1)
check('変更後もログイン状態と役割・審査状態は維持される', (await newbie('/api/me')).data.user?.producer?.approvalStatus === 'PENDING')
check('変更後のユーザー名でログインできる', (await client().login(renamed, resetPassword)).status === 200)
check('変更前のユーザー名ではログインできない', (await client().login(newName, resetPassword)).status === 401)
check('変更後のユーザー名とリカバリーコードの組み合わせが引き継がれる', (await recover({ username: newName, recoveryCode: thirdCode, newPassword: resetPassword })).status === 400 && (await db.query('select count(*)::int as n from "RecoveryCode" r join "user" u on u.id = r."userId" where u.username = $1', [renamed])).rows[0].n === 1)
check('元のユーザー名に戻せる（空いた名前は再び使える）', (await rename(newbie, { username: newName, password: resetPassword })).status === 200)
const bListingBefore = (await farmBPre('/api/listings')).data.listings.length
r = await rename(farmBPre, { username: 'farm_b_renamed', password: PASSWORD })
check('ユーザー名を変更しても、出品はそのまま残る', r.status === 200 && bListingBefore > 0 && (await farmBPre('/api/listings')).data.listings.length === bListingBefore)
await rename(farmBPre, { username: 'farm_b', password: PASSWORD })

check('有効なコードは利用者ごとに1つだけ', (await db.query('select count(*)::int as n from "RecoveryCode" r join "user" u on u.id = r."userId" where u.username = $1', [newName])).rows[0].n === 1)

console.log('権限')
const tomato = (await anon('/api/master')).data.items.find((i) => i.name === 'トマト')
const demand = (over = {}) => ({
  itemId: tomato.id,
  quantity: 10,
  unit: 'KG',
  timeMode: 'DEADLINE',
  date: DAY2,
  time: null,
  prefecture: '大阪府',
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
  ['restaurant1', 'restaurant2', 'farm_a', 'farm_b', 'farm_c', 'unei_test'].map(async (name) => {
    const c = client()
    const res = await c.login(name)
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
  contactIds.length === 1 && p.contacts[contactIds[0]].phone === '090-0000-0000' && !('email' in p.contacts[contactIds[0]]) && !JSON.stringify(p).includes('farm-a-public@example.invalid'),
)
check('応答に生産者のユーザー名や内部用の値が含まれない', !/farm_[abc]|jimoseri\.invalid/.test(JSON.stringify(p)))
const firstFingerprint = p.fingerprint

p = await plan({ allowIrregular: false })
check('規格外不可：8kg・2kg不足', p.result.status === 'SHORTAGE' && p.result.best.plan.totalMilli === 8000 && p.result.best.shortageMilli === 2000)
p = await plan({ budgetMaxYen: 5000 })
check('予算5,000円：予算超過（5,350円）', p.result.status === 'OVER_BUDGET' && p.result.best.plan.totalYen === 5350)
p = await plan({ quantity: 9.5 })
check('販売刻み：9.5kg希望でも0.5kgを割り当てない', p.result.best.plan.totalMilli === 9000 && p.result.best.shortageMilli === 500)

r = await farmC(`/api/listings?id=${cTomato.id}`, { method: 'PATCH', body: { quantity: 1 } })
check('生産者の更新：数量だけ送って更新できる', r.status === 200 && r.data.listing.quantityMilli === 1000 && r.data.listing.unitPriceYen === 350)
r = await restaurant('/api/plan', { method: 'PUT', body: { itemId: tomato.id, fingerprint: firstFingerprint } })
check('在庫変更：古い案は無効と判定される', r.data.fresh === false)
p = await plan()
check('在庫変更：再計算で9kg・1kg不足', p.result.status === 'SHORTAGE' && p.result.best.plan.totalMilli === 9000 && p.result.best.shortageMilli === 1000)
check('再計算後の案は有効と判定される', (await restaurant('/api/plan', { method: 'PUT', body: { itemId: tomato.id, fingerprint: p.fingerprint } })).data.fresh === true)
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
r = await newbie('/api/locations', { body: { prefecture: '大阪府', name: 'E2E新規農園の軒先', municipality: '能勢町', address: 'テスト3-3', note: '' } })
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
check('承認による変化で、古い案は無効と判定される', (await restaurant('/api/plan', { method: 'PUT', body: { itemId: tomato.id, fingerprint: stableFingerprint } })).data.fresh === false)
check('承認後は出品の対象外理由がなくなる', (await newbie('/api/listings')).data.listings[0].blockers.length === 0)
await admin('/api/admin', { body: { target: 'listing', id: newListing.id, action: 'suspend' } })
check('運営者が停止した出品は仕入れ案に出ない', (await plan()).result.best.plan.producerCount === 3)
await admin('/api/admin', { body: { target: 'listing', id: newListing.id, action: 'approve' } })
await admin('/api/admin', { body: { target: 'producer', id: newProducer.id, action: 'suspend' } })
check('停止された生産者の出品は仕入れ案に出ない', (await plan()).result.best.plan.producerCount === 3)
await admin('/api/admin', { body: { target: 'producer', id: newProducer.id, action: 'approve' } })

r = await farmA('/api/admin', { body: { target: 'recovery', username: 'restaurant2' } })
check('運営者以外は、他人のリカバリーコードを再発行できない', r.status === 403)
r = await admin('/api/admin', { body: { target: 'recovery', username: 'restaurant2' } })
check('運営者は、利用者のリカバリーコードを再発行できる', r.status === 200 && CODE_FORMAT.test(r.data.recoveryCode ?? ''))
r = await recover({ username: 'restaurant2', recoveryCode: r.data.recoveryCode, newPassword: PASSWORD })
check('運営者が発行したコードでパスワードを再設定できる', r.status === 200 && (await restaurant2.login('restaurant2')).status === 200)
check('運営者のコードは管理画面からは再発行できない', (await admin('/api/admin', { body: { target: 'recovery', username: 'unei_test' } })).status === 404)
check('出品に使われている受渡場所は削除できない', (await admin('/api/admin', { body: { target: 'location', id: placeP.id, action: 'delete' } })).status === 400)
r = await farmC('/api/locations', { body: { prefecture: '大阪府', name: '使わない場所', municipality: '能勢町', address: 'テスト9-9', note: '' } })
check('運営者は、使われていない受渡場所を削除できる', (await admin('/api/admin', { body: { target: 'location', id: r.data.location.id, action: 'delete' } })).status === 200)
check('生産者は受渡場所を削除できない（管理APIを使えない）', (await farmC('/api/admin', { body: { target: 'location', id: placeQ.id, action: 'delete' } })).status === 403)

console.log('連絡先・履歴・退会')
r = await farmA('/api/me', { method: 'PATCH', body: { orgName: 'テストA農園', area: '能勢町', publicPhone: '090-0000-0000', showPhone: false, publicEmail: 'farm-a-public@example.invalid', showEmail: true, contactNote: null } })
check('生産者は公開する連絡先を変更できる', r.status === 200 && r.data.user.producer.showEmail === true)
await admin('/api/admin', { body: { target: 'listing', id: newListing.id, action: 'suspend' } })
p = await plan()
const contactA = Object.values(p.contacts)[0]
check('公開設定の変更が反映される（メールのみ表示、電話は非表示）', contactA?.email === 'farm-a-public@example.invalid' && !('phone' in contactA))
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
const gone = await db.query('select count(*)::int as n from "user" where username = $1', [newName])
const orphan = await db.query('select count(*)::int as n from "Listing" where id = $1', [newListing.id])
check('退会でアカウントと出品がDBから消える', gone.rows[0].n === 0 && orphan.rows[0].n === 0)
check('退会後はログインできない', (await client().login(newName, resetPassword)).status === 401)
check('退会でリカバリーコードも消える', (await db.query('select count(*)::int as n from "RecoveryCode" r where not exists (select 1 from "user" u where u.id = r."userId")')).rows[0].n === 0 && (await db.query('select count(*)::int as n from "RecoveryCode" r join "user" u on u.id = r."userId" where u.username = $1', [newName])).rows[0].n === 0)
check('退会後は出品が仕入れ案から消える', (await plan()).result.best.plan.producerCount === 3)
r = await farmA(`/api/listings?id=${aTomato.id}`, { method: 'DELETE' })
check('自分の出品を削除できる', r.status === 200 && (await plan()).result.best.plan.totalMilli === 5000)

console.log('デモデータ（お試し用）')
execSync('npx tsx scripts/demo-data.ts seed', { stdio: 'ignore' })
const demoPassword = readFileSync('.env.demo.local', 'utf8').match(/^DEMO_FARM_PASSWORD=(.+)$/m)[1].trim()
const demo = client()
check('デモ用アカウントでログインできる', (await demo.login('demo_farm', demoPassword)).status === 200)
const demoMe = (await demo('/api/me')).data.user
check('デモ用アカウントは生産者で、デモデータの目印が付いている', demoMe.role === 'PRODUCER' && demoMe.producer.isDemo === true)
const demoListings = (await demo('/api/listings')).data.listings
check('デモデータの出品が50件あり、すべて目印付き', demoListings.length === 50 && demoListings.every((l) => l.isDemo))
const kinds = {
  stopped: demoListings.filter((l) => !l.isPublished).length,
  soldout: demoListings.filter((l) => l.quantityMilli === 0).length,
  expired: demoListings.filter((l) => l.pickupEndMs <= Date.now()).length,
  suspended: demoListings.filter((l) => l.blockers.includes('ADMIN_SUSPENDED')).length,
  pendingPlace: demoListings.filter((l) => l.blockers.includes('LOCATION_PENDING')).length,
  items: new Set(demoListings.map((l) => l.itemName)).size,
  units: new Set(demoListings.map((l) => l.unit)).size,
  irregular: demoListings.filter((l) => l.grade === 'IRREGULAR').length,
  updatedDays: new Set(demoListings.map((l) => new Date(l.updatedAtMs).toISOString().slice(0, 10))).size,
}
check('状態・品目・単位・規格外・更新日にばらつきがある', kinds.stopped === 5 && kinds.soldout === 4 && kinds.expired === 7 && kinds.suspended === 2 && kinds.pendingPlace === 2 && kinds.items >= 15 && kinds.units === 4 && kinds.irregular > 0 && kinds.updatedDays >= 10, JSON.stringify(kinds))
const demoTomatoDay = demoListings.filter((l) => l.itemName === 'トマト' && l.isPublished && l.quantityMilli > 0 && l.pickupEndMs > Date.now())
r = await restaurant('/api/plan', { body: demand({ quantity: 1, date: jstDate(11), allowMultiLocation: true }) })
check('デモデータの出品は、飲食店の仕入れ案に使われない', demoTomatoDay.length > 0 && !JSON.stringify(r.data.result).includes('デモ農園'), JSON.stringify(r.data.result?.best?.plan?.lines?.map((l) => l.producerName)))
check('デモデータの場所は、他の生産者の選択肢に出ない', !(await farmC('/api/master')).data.locations.some((l) => l.name.includes('お試し用')))
const demoPlaces = (await demo('/api/master')).data.locations
check('デモ用アカウントには、自分のデモの場所が出る', demoPlaces.filter((l) => l.name.includes('お試し用')).length === 3)
r = await demo('/api/listings', { body: listingBody({ pickupLocationId: demoPlaces.find((l) => l.status === 'APPROVED' && l.name.includes('お試し用')).id }) })
check('デモ用アカウントで新しく登録した出品も、デモデータとして扱われる', r.status === 201 && r.data.listing.isDemo === true)
check('他の生産者は、デモの場所を使って出品できない', (await farmC('/api/listings', { body: listingBody({ pickupLocationId: demoPlaces.find((l) => l.status === 'APPROVED' && l.name.includes('お試し用')).id }) })).status === 400)
overview = (await admin('/api/admin')).data
check('運営者の管理画面で、デモデータが区別できる', overview.producers.some((p) => p.isDemo) && overview.locations.some((l) => l.isDemo) && overview.listings.some((l) => l.isDemo))

console.log('デモモード（お試し）・0件の理由・条件を広げた場合の参考')
{
  const OSAKA_ST = { lat: 34.7025, lng: 135.4959 }
  const count = (res) => res.data.locations.reduce((n, l) => n + l.listings.length, 0)
  const normal = await restaurant('/api/market', { body: { prefecture: '大阪府', center: OSAKA_ST, radiusKm: 10 } })
  check('通常の検索にはデモデータが混ざらない', normal.status === 200 && normal.data.demo === false && normal.data.locations.every((l) => !l.isDemo && l.listings.every((x) => !x.isDemo)))
  const demo10 = await restaurant('/api/market', { body: { prefecture: '大阪府', center: OSAKA_ST, radiusKm: 10, demo: true } })
  check('デモモードでは、大阪駅から10km以内にデモデータの出品が見つかる', demo10.data.demo === true && count(demo10) > 100 && demo10.data.locations.every((l) => l.isDemo && l.listings.every((x) => x.isDemo) && l.distanceKm <= 10), `${count(demo10)}`)
  const demoAll = await restaurant('/api/market', { body: { prefecture: '大阪府', center: OSAKA_ST, radiusKm: null, demo: true } })
  check('距離指定なしでは、受取エリア（大阪府）内でさらに多く見つかる（東京は含まない）', count(demoAll) > count(demo10) && !demoAll.data.locations.some((l) => l.latitude > 35.5), `${count(demoAll)}`)
  const none = await restaurant('/api/market', { body: { prefecture: '大阪府', center: { lat: 33.59, lng: 130.4 }, radiusKm: 1 } })
  const st = none.data.diagnostics?.stages ?? []
  check('0件のときは、条件ごとの件数と0件になった条件を返す', none.data.locations.length === 0 && st.length >= 5 && st.at(-1).count === 0 && st[0].count > 0, JSON.stringify(none.data.diagnostics))
  const tomatoDemand = { ...demand({ quantity: 10, date: DAY2, municipality: '大阪市福島区' }), demoMode: true }
  const fp = (await restaurant('/api/plan', { body: tomatoDemand })).data
  const lines = fp.result?.best?.plan.lines.map((l) => [l.producerName, l.quantityMilli]) ?? []
  check('福島区トマト10kg：8kgを提案・2kg不足・内訳 5kg／2kg／1kg', fp.result?.best?.status === 'SHORTAGE' && fp.result.best.plan.totalMilli === 8000 && fp.result.best.shortageMilli === 2000 && JSON.stringify(lines.map((l) => l[1]).sort((a, b) => b - a)) === '[5000,2000,1000]', JSON.stringify(lines))
  check('デモの仕入れ案には、デモデータの農家だけが入る', lines.every(([n]) => n.includes('お試し用')))
  const kinds = fp.relaxations?.map((x) => x.kind) ?? []
  check('条件を広げた参考：受取日の延長・エリア指定なしを、元の案とは別に返す', kinds.includes('DATE') && kinds.includes('AREA') && fp.relaxations.every((x) => x.achievableMilli > 8000), JSON.stringify(fp.relaxations))
  const dateFix = fp.relaxations.find((x) => x.kind === 'DATE')
  const fixed = (await restaurant('/api/plan', { body: { ...tomatoDemand, ...dateFix.patch } })).data
  check('参考の条件で計算し直すと、希望量に届く', fixed.result.best.plan.totalMilli >= 10000, JSON.stringify(fixed.result.best?.plan.totalMilli))
  const real = (await restaurant('/api/plan', { body: demand({ quantity: 10, date: DAY2, municipality: '大阪市福島区' }) })).data
  check('通常の仕入れ案には、デモデータが使われない', !JSON.stringify(real.result).includes('お試し用'))
  check('デモの案は、通常の確認ではデモとして照合される', (await restaurant('/api/plan', { method: 'PUT', body: { itemId: tomato.id, fingerprint: fp.fingerprint, demoMode: true } })).data.fresh === true)
  const m = (await restaurant('/api/master')).data
  check('デモモード用の受取エリアの選択肢がある（通常の選択肢には混ざらない）', m.demoAreas.some((a) => a.prefecture === '大阪府' && a.municipality === '大阪市福島区') && !m.areas.some((a) => a.municipality === '大阪市福島区'))
  const anyDemo = demo10.data.locations[0].listings[0]
  check('デモの出品の詳細は、デモモード指定のときだけ開ける', (await restaurant(`/api/market?id=${anyDemo.id}`)).status === 404 && (await restaurant(`/api/market?id=${anyDemo.id}&demo=1`)).status === 200)
}

console.log('受取エリア（必須）・受渡期間・ご依頼の検索')
{
  const OSAKA_CITY = { lat: 34.6937, lng: 135.5023 }
  const count = (res) => res.data.locations?.reduce((n, l) => n + l.listings.length, 0) ?? -1
  const market = (body) => restaurant('/api/market', { body: { center: null, radiusKm: null, demo: true, ...body } })
  check('受取エリアのない検索は拒否', (await market({ prefecture: undefined })).status === 400)
  check('受取エリアのない仕入れ案は拒否', (await restaurant('/api/plan', { body: demand({ prefecture: undefined }) })).status === 400)
  const s1 = await market({ prefecture: '大阪府', center: OSAKA_CITY, radiusKm: 10 })
  const s2 = await market({ prefecture: '大阪府', center: OSAKA_CITY, radiusKm: 50, date: jstDate(5) })
  const s3 = await market({ prefecture: '大阪府' })
  console.log(`    デモ：大阪市内10km ${count(s1)}件／大阪市内50km・${jstDate(5)} ${count(s2)}件／大阪府内・距離なし ${count(s3)}件`)
  check('1. 大阪市内・半径10km・日付指定なしで1件以上', count(s1) > 0)
  check('2. 大阪市内・半径50km・期間内の日付で1件以上（すべてその日に受け取れる）', count(s2) > 0 && s2.data.locations.every((l) => l.listings.every((x) => new Date(x.pickupStartMs + 9 * 3600_000).toISOString().slice(0, 10) === jstDate(5))))
  check('3. 大阪府内・距離制限なしで1件以上（大阪府の拠点だけ）', count(s3) > 0 && s3.data.locations.every((l) => l.latitude < 35.2))
  check('期間の出品には、期間と曜日・時間帯が付く', s3.data.locations.some((l) => l.listings.some((x) => x.period && x.period.schedule.weekdays > 0)))
  const far = await market({ prefecture: '大阪府', date: jstDate(200) })
  check('期間外の日付では0件。理由は「受け取りたい日」、日付を外した参考候補の件数を示す', count(far) === 0 && far.data.diagnostics.stages.find((x) => x.count === 0)?.key === 'DATE' && far.data.diagnostics.wider.some((w) => w.key === 'DATE' && w.count === count(s3)))
  const aomori = await market({ prefecture: '青森県' })
  check('受渡場所のない県では0件。理由は「受取エリア」', count(aomori) === 0 && aomori.data.diagnostics.stages.find((x) => x.count === 0)?.key === 'AREA')
  const near = await market({ prefecture: '大阪府', center: OSAKA_CITY, radiusKm: 1 })
  check('半径で0件のとき、広げた場合の件数を参考として示す', count(near) > 0 || near.data.diagnostics.wider.some((w) => w.key === 'RADIUS' || w.key === 'NO_RADIUS'))
  const p4 = (await restaurant('/api/plan', { body: { ...demand({ quantity: 10, date: DAY2, prefecture: '大阪府', municipality: null, allowIrregular: false }), demoMode: true } })).data
  check('4. 大阪府のトマト10kgで仕入れ案ができる', ['MATCHED', 'OVER_BUDGET'].includes(p4.result.best?.status), JSON.stringify(p4.result.best?.status))

  // 受渡期間の出品（通常のデータで確かめる）
  const target = jstDate(5)
  const wd = 1 << new Date(`${target}T00:00:00Z`).getUTCDay()
  check('期間：終了日が開始日より前なら拒否', (await farmC('/api/listings', { body: listingBody({ grade: 'REGULAR', irregularReason: null, pickupMode: 'PERIOD', pickupDate: jstDate(3), pickupEndDate: jstDate(1), weekdays: 127 }) })).status === 400)
  check('期間：曜日がなければ拒否', (await farmC('/api/listings', { body: listingBody({ grade: 'REGULAR', irregularReason: null, pickupMode: 'PERIOD', pickupDate: jstDate(0), pickupEndDate: jstDate(30), weekdays: 0 }) })).status === 400)
  check('期間：期間内に選んだ曜日がなければ拒否', (await farmC('/api/listings', { body: listingBody({ grade: 'REGULAR', irregularReason: null, pickupMode: 'PERIOD', pickupDate: target, pickupEndDate: target, weekdays: 127 ^ wd }) })).status === 400)
  r = await farmC('/api/listings', { body: listingBody({ grade: 'REGULAR', irregularReason: null, quantity: 4, unitPriceYen: 500, pickupMode: 'PERIOD', pickupDate: jstDate(0), pickupEndDate: jstDate(30), weekdays: wd, startTime: '13:00', endTime: '14:00' }) })
  const periodListing = r.data?.listing
  check('期間の出品を登録できる（開始日・終了日・曜日・時間帯）', r.status === 201 && periodListing.schedule?.weekdays === wd && periodListing.schedule.startMin === 780, JSON.stringify(r.data))
  const onDay = await restaurant('/api/market', { body: { prefecture: '大阪府', center: null, radiusKm: null, date: target } })
  const offDay = await restaurant('/api/market', { body: { prefecture: '大阪府', center: null, radiusKm: null, date: jstDate(6) } })
  const has = (res) => res.data.locations.some((l) => l.listings.some((x) => x.id === periodListing.id))
  check('期間の出品：選んだ曜日の日付なら検索に出る（受渡時刻はその日の13時）', has(onDay) && onDay.data.locations.flatMap((l) => l.listings).find((x) => x.id === periodListing.id).pickupStartMs === Date.parse(`${target}T13:00:00+09:00`))
  check('期間の出品：選んでいない曜日の日付では出ない', !has(offDay))
  const exact = (await restaurant('/api/plan', { body: demand({ quantity: 4, timeMode: 'EXACT', date: target, time: '13:30', allowIrregular: false }) })).data
  check('期間の出品：その日の時間帯に受け取る仕入れ案に使われる', exact.result.best?.plan.lines.some((l) => l.listingId === periodListing.id) && exact.listingInfo[periodListing.id].pickupStartMs === Date.parse(`${target}T13:00:00+09:00`), JSON.stringify(exact.result.best?.plan.lines))
  const before = (await restaurant('/api/plan', { body: demand({ quantity: 4, date: DAY2, allowIrregular: false }) })).data
  check('期間の出品：希望日までに受け取れる回がなければ使われない', !(before.result.best?.plan.lines ?? []).some((l) => l.listingId === periodListing.id))
  await farmC(`/api/listings?id=${periodListing.id}`, { method: 'DELETE' })
}

console.log('マッチング（デモデータ）：仕入れ案の農家ごとに依頼 → 検証農家がログインして承認 → チャット')
{
  const tomatoDemand = { ...demand({ quantity: 10, date: DAY2, municipality: '大阪市福島区', allowIrregular: false }), demoMode: true }
  const fp = (await restaurant('/api/plan', { body: tomatoDemand })).data
  const lines = fp.result.best.plan.lines.map((l) => ({ listingId: l.listingId, quantity: l.quantityMilli / 1000, pickupStartMs: fp.listingInfo[l.listingId].pickupStartMs, pickupEndMs: fp.listingInfo[l.listingId].pickupEndMs }))
  r = await restaurant('/api/matches', { body: { lines, demoMode: true, message: 'E2E：福島区のトマトの相談です' } })
  const sent = r.data?.matches ?? []
  check('仕入れ案の3農家に、生産者ごとの依頼を一度に送れる（同じまとまりの目印・すべて返事待ち）', r.status === 201 && sent.length === 3 && sent.every((m) => m.status === 'PENDING' && m.isDemo && m.groupId && m.groupId === sent[0].groupId), JSON.stringify(r.data))
  check('デモの依頼は、デモモードでなければ送れない（実データと混ぜない）', (await restaurant('/api/matches', { body: { lines: [lines[0]], demoMode: false } })).status === 409)
  const s1 = client()
  check('検証農家（デモ検証農園A）でログインできる', (await s1.login('demo_s1', demoPassword)).status === 200)
  const inbox = (await s1('/api/matches')).data
  const mine = inbox.matches.find((m) => sent.some((x) => x.id === m.id))
  check('検証農家には、自分あての依頼だけが届く（返事が必要 1件）', inbox.matches.length === 1 && mine && inbox.pendingTotal === 1 && mine.producerName.includes('検証農園A'), JSON.stringify(inbox.matches.map((m) => m.producerName)))
  r = await s1('/api/matches?id=' + mine.id, { method: 'PATCH', body: { action: 'accept' } })
  check('検証農家が承認すると、マッチング成立', r.status === 200 && r.data.match.status === 'ACCEPTED')
  const others = (await restaurant('/api/matches')).data.matches.filter((m) => sent.some((x) => x.id === m.id))
  check('仕入れ案の農家ごとに状態が分かれる（1件成立・2件は返事待ち）', others.filter((m) => m.status === 'ACCEPTED').length === 1 && others.filter((m) => m.status === 'PENDING').length === 2)
  r = await restaurant('/api/chat', { body: { matchId: mine.id, body: 'はじめまして。数量と受渡日時の確認をお願いします。', clientId: 'e2e-demo-chat-1' } })
  const reply = await s1('/api/chat', { body: { matchId: mine.id, body: '承知しました。10時に拠点でお渡しできます。', clientId: 'e2e-demo-chat-2' } })
  const log = (await restaurant('/api/chat?matchId=' + mine.id)).data
  const texts = log.messages.filter((m) => m.kind === 'TEXT')
  check('デモでも、成立したマッチングで双方がメッセージを送受信できる', r.status === 201 && reply.status === 201 && texts.length === 2 && texts[1].mine === false)
}
execSync('npx tsx scripts/demo-data.ts remove', { stdio: 'ignore' })
const leftovers = await db.query('select (select count(*)::int from "Listing" where "isDemo") as l, (select count(*)::int from "PickupLocation" where "isDemo") as p, (select count(*)::int from "Producer" where "isDemo") as pr')
check('デモデータを一括削除できる（出品・場所・アカウント）', leftovers.rows[0].l === 0 && leftovers.rows[0].p === 0 && leftovers.rows[0].pr === 0, JSON.stringify(leftovers.rows[0]))
check('一括削除しても、通常のデータは残る', (await farmC('/api/listings')).data.listings.length > 0)

console.log('受渡拠点・地図・半径検索')
const rad = (d) => (d * Math.PI) / 180
const dist = (a, b) => {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)))
}
const OSAKA = { lat: 34.7025, lng: 135.4959 }
const P_POS = { lat: 34.9719, lng: 135.4142 }
const search = (body = {}, c = restaurant) => c('/api/market', { body: { prefecture: '大阪府', center: null, radiusKm: null, ...body } })
const locIds = (res) => res.data.locations.map((l) => l.id)
const approveLoc = (id) => admin('/api/admin', { body: { target: 'location', id, action: 'approve' } })

r = await farmC('/api/locations', { body: { prefecture: '大阪府', name: 'C農園 地図テスト', municipality: '能勢町', address: 'テスト7-7', note: '', postalCode: '5630101', latitude: 34.98, longitude: 135.42, showOnMap: true, hours: '平日10〜16時' } })
check('生産者は位置つきの受渡拠点を登録できる（確認待ち）', r.status === 201 && r.data.location.status === 'PENDING' && r.data.location.latitude === 34.98 && r.data.location.postalCode === '563-0101')
const mapLoc = r.data.location
r = await farmC('/api/listings', { body: listingBody({ grade: 'REGULAR', irregularReason: null, quantity: 4, unitPriceYen: 500, pickupLocationId: mapLoc.id }) })
const mapListing = r.data.listing
// 出品のない拠点は地図に出ないため、拠点Q にも出品を1件置く
await farmB('/api/listings', { body: listingBody({ grade: 'REGULAR', irregularReason: null, quantity: 6, unitPriceYen: 520, pickupLocationId: placeQ.id }) })
let s = await search()
check('出品のない拠点や、確認待ちの拠点は地図に出ない', s.status === 200 && !locIds(s).includes(mapLoc.id))
check('地図には、公開を許可した確認済みの拠点だけが出る', locIds(s).includes(placeP.id) && locIds(s).includes(placeQ.id))

r = await farmB('/api/locations', { body: { prefecture: '大阪府', name: 'B農園 自宅（非公開）', municipality: '豊能町', address: '自宅', note: '', latitude: 34.921, longitude: 135.491, showOnMap: false } })
const privLoc = r.data.location
await approveLoc(privLoc.id)
r = await farmB('/api/listings', { body: listingBody({ grade: 'REGULAR', irregularReason: null, quantity: 2, unitPriceYen: 450, pickupLocationId: privLoc.id }) })
const privListing = r.data.listing
s = await search()
check('地図への公開を許可していない拠点は、確認済みでも地図・検索に出ない', !locIds(s).includes(privLoc.id) && !JSON.stringify(s.data).includes(privListing.id))
check('非公開の拠点の位置は、他の生産者にも返さない', (() => {
  const other = s.data && null
  return other === null
})() && (await farmC('/api/master')).data.locations.filter((l) => l.id === privLoc.id).every((l) => l.latitude === null && l.longitude === null))
const detailPriv = await restaurant(`/api/market?id=${privListing.id}`)
check('非公開の拠点の出品も詳細は見られるが、位置は返さない', detailPriv.status === 200 && detailPriv.data.listing.location.latitude === null && !JSON.stringify(detailPriv.data).includes('34.921'))

await approveLoc(mapLoc.id)
s = await search()
const shown = s.data.locations.find((l) => l.id === mapLoc.id)
check('運営者が確認すると、地図に出る（位置・受取の目安つき）', shown?.latitude === 34.98 && shown.hours === '平日10〜16時' && shown.listings.some((l) => l.id === mapListing.id))

const dMap = dist(P_POS, { lat: 34.98, lng: 135.42 })
const dQ = dist(P_POS, { lat: placeQ.latitude, lng: placeQ.longitude })
s = await search({ center: P_POS, radiusKm: 1 })
check(`半径1km：中心の拠点Pは入り、${dMap.toFixed(2)}km 先・${dQ.toFixed(1)}km 先の拠点は除外`, locIds(s).includes(placeP.id) && !locIds(s).includes(mapLoc.id) && !locIds(s).includes(placeQ.id) && s.data.outsideCount >= 2, JSON.stringify(locIds(s)))
check('中心からの直線距離を返す（拠点Pは0km）', s.data.locations.find((l) => l.id === placeP.id).distanceKm === 0)
s = await search({ center: P_POS, radiusKm: 3 })
check('半径3km：近くの拠点も入る', locIds(s).includes(mapLoc.id) && !locIds(s).includes(placeQ.id))
s = await search({ center: P_POS, radiusKm: 10 })
const ds = s.data.locations.map((l) => l.distanceKm)
check('半径10km：拠点Qも入り、近い順に並ぶ', locIds(s).includes(placeQ.id) && ds.every((d, i) => i === 0 || ds[i - 1] <= d), JSON.stringify(ds))
s = await search({ center: OSAKA, radiusKm: 1 })
check('範囲内に何もない場合は0件で、範囲外の件数を返す（「広げる」提案用）', s.data.locations.length === 0 && s.data.outsideCount >= 3)
s = await search({ center: OSAKA, radiusKm: null })
check('距離指定なし：すべての公開拠点が対象', locIds(s).includes(placeP.id) && locIds(s).includes(placeQ.id))
check('距離で絞るのに中心がない検索は拒否', (await search({ radiusKm: 10 })).status === 400)
check('決められていない半径・不正な位置は拒否', (await search({ center: P_POS, radiusKm: 7 })).status === 400 && (await search({ center: { lat: 200, lng: 0 }, radiusKm: 10 })).status === 400)

const nasu = (await anon('/api/master')).data.items.find((i) => i.name === 'なす')
s = await search({ itemId: tomato.id, maxPriceYen: 500 })
check('品目・単価の上限で絞り込める', s.data.locations.flatMap((l) => l.listings).every((l) => l.itemId === tomato.id && l.unitPriceYen <= 500) && s.data.locations.length > 0)
s = await search({ irregular: 'only' })
check('規格外品だけに絞り込める', s.data.locations.flatMap((l) => l.listings).every((l) => l.grade === 'IRREGULAR'))
s = await search({ irregular: 'exclude', minQuantity: 3 })
check('規格外品を除き、在庫の下限で絞り込める', s.data.locations.flatMap((l) => l.listings).every((l) => l.grade === 'REGULAR' && l.quantityMilli >= 3000))
s = await search({ itemId: nasu.id, municipality: '豊能町' })
check('品目とエリアの組み合わせで0件になる場合も正しく返す', s.status === 200 && s.data.locations.length === 0)
check('生産者・未ログインは地図検索を使えない', (await search({}, farmA)).status === 403 && (await search({}, anon)).status === 401)
check('検索の中心はDBに保存しない（保存先の項目がない）', (await db.query(`select count(*)::int as n from information_schema.columns where column_name ilike '%center%'`)).rows[0].n === 0)

r = await farmC(`/api/locations?id=${mapLoc.id}`, { method: 'PUT', body: { prefecture: '大阪府', name: 'C農園 地図テスト', municipality: '能勢町', address: 'テスト7-7', note: '', latitude: 34.985, longitude: 135.425, showOnMap: true, hours: '平日10〜16時' } })
check('位置を変えると、運営者の確認を受け直す（地図から消える）', r.status === 200 && r.data.reviewAgain === true && r.data.location.status === 'PENDING' && !locIds(await search()).includes(mapLoc.id))
await approveLoc(mapLoc.id)
r = await farmC(`/api/locations?id=${mapLoc.id}`, { method: 'PUT', body: { prefecture: '大阪府', name: 'C農園 地図テスト', municipality: '能勢町', address: 'テスト7-7', note: '', latitude: 34.985, longitude: 135.425, showOnMap: true, hours: '毎日9〜12時' } })
check('受取の目安だけの変更では、確認済みのまま', r.data.location.status === 'APPROVED' && r.data.reviewAgain === false)
check('他の生産者の受渡拠点は編集・削除できない', (await farmA(`/api/locations?id=${mapLoc.id}`, { method: 'PUT', body: { prefecture: '大阪府', name: 'x', municipality: 'x', address: 'x', note: '' } })).status === 404 && (await farmA(`/api/locations?id=${mapLoc.id}`, { method: 'DELETE' })).status === 404)
check('出品に使われている受渡拠点は削除できない', (await farmC(`/api/locations?id=${mapLoc.id}`, { method: 'DELETE' })).status === 400)
r = await farmC('/api/locations', { body: { prefecture: '大阪府', name: '使わない拠点', municipality: '能勢町', address: 'テスト8-8', note: '' } })
check('使われていない自分の受渡拠点は削除できる', (await farmC(`/api/locations?id=${r.data.location.id}`, { method: 'DELETE' })).status === 200)
check('自分の受渡拠点の一覧には、位置・郵便番号・出品数が入る', (await farmC('/api/locations')).data.locations.some((l) => l.id === mapLoc.id && l.latitude === 34.985 && l.listingCount === 1))
const mapPlan = await plan()
check(
  '地図上で近い拠点どうしでも、仕入れ案は従来どおり1か所の中で組む（複数か所は許可した場合の参考案だけ）',
  mapPlan.result.best.plan.lines.every((l) => l.pickupPointId === mapPlan.result.best.pickupPointId) && mapPlan.result.multi === null,
)

console.log('気になる（お気に入り）')
r = await restaurant('/api/favorites', { body: { listingId: mapListing.id } })
check('気になるに保存できる', r.status === 201)
check('同じ出品を何度保存しても1件', (await restaurant('/api/favorites', { body: { listingId: mapListing.id } })).status === 201 && (await restaurant('/api/favorites')).data.favorites.filter((f) => f.listingId === mapListing.id).length === 1)
check('検索結果で保存済みとわかる', (await search()).data.locations.flatMap((l) => l.listings).find((l) => l.id === mapListing.id)?.isFavorite === true)
check('保存しても在庫は減らない（予約・確保ではない）', (await farmC('/api/listings')).data.listings.find((l) => l.id === mapListing.id).quantityMilli === 4000)
await farmC(`/api/listings?id=${mapListing.id}`, { method: 'PATCH', body: { quantity: 3 } })
let favs = (await restaurant('/api/favorites')).data.favorites
check('保存後に在庫が変わると、最新の数量を表示する', favs.find((f) => f.listingId === mapListing.id)?.listing?.quantityMilli === 3000)
check('他の飲食店の保存は見えない', (await restaurant2('/api/favorites')).data.favorites.length === 0)
check('生産者は保存できない', (await farmA('/api/favorites', { body: { listingId: mapListing.id } })).status === 403)
check('存在しない出品は保存できない', (await restaurant('/api/favorites', { body: { listingId: 'nope' } })).status === 404)
await farmC(`/api/listings?id=${mapListing.id}`, { method: 'PATCH', body: { isPublished: false } })
favs = (await restaurant('/api/favorites')).data.favorites
check('公開が止まった出品は「掲載されていません」になり、詳細は返さない', favs.find((f) => f.listingId === mapListing.id)?.available === false && favs.find((f) => f.listingId === mapListing.id)?.listing === null)
check('公開が止まった出品は検索・保存の対象外', !JSON.stringify((await search()).data).includes(mapListing.id) && (await restaurant('/api/favorites', { body: { listingId: mapListing.id } })).status === 404)
check('公開が止まった出品の詳細は見られない', (await restaurant(`/api/market?id=${mapListing.id}`)).status === 404)
await farmC(`/api/listings?id=${mapListing.id}`, { method: 'PATCH', body: { isPublished: true } })
check('保存を解除できる', (await restaurant(`/api/favorites?listingId=${mapListing.id}`, { method: 'DELETE' })).status === 200 && !(await restaurant('/api/favorites')).data.favorites.some((f) => f.listingId === mapListing.id))
await restaurant('/api/favorites', { body: { listingId: privListing.id } })
await farmB(`/api/listings?id=${privListing.id}`, { method: 'DELETE' })
check('出品が削除されると、保存も一緒に消える', !(await restaurant('/api/favorites')).data.favorites.some((f) => f.listingId === privListing.id))

console.log('通報')
r = await restaurant('/api/reports', { body: { targetType: 'LISTING', targetId: mapListing.id, reason: 'FALSE_INFO', detail: '写真と数量が違うようです' } })
check('出品を通報できる（受付の結果だけを返す）', r.status === 201 && JSON.stringify(r.data) === '{"ok":true}')
check('同じ対象への重複通報は受け付けない', (await restaurant('/api/reports', { body: { targetType: 'LISTING', targetId: mapListing.id, reason: 'NUISANCE' } })).status === 409)
check('「その他」は詳細が必須', (await restaurant('/api/reports', { body: { targetType: 'PRODUCER', targetId: mapListing.id, reason: 'OTHER' } })).status === 400)
const producerC = (await admin('/api/admin')).data.producers.find((x) => x.username === 'farm_c')
r = await restaurant2('/api/reports', { body: { targetType: 'PRODUCER', targetId: producerC.id, reason: 'OTHER', detail: '連絡がつきません' } })
check('生産者アカウントを通報できる', r.status === 201)
check('飲食店アカウントの通報は（確認できる画面がないため）受け付けない', (await farmA('/api/reports', { body: { targetType: 'RESTAURANT', targetId: 'x', reason: 'FRAUD' } })).status === 400)
check('自分の出品・自分のアカウントは通報できない', (await farmC('/api/reports', { body: { targetType: 'LISTING', targetId: mapListing.id, reason: 'FRAUD' } })).status === 400 && (await farmC('/api/reports', { body: { targetType: 'PRODUCER', targetId: producerC.id, reason: 'FRAUD' } })).status === 400)
check('存在しない対象は通報できない', (await restaurant('/api/reports', { body: { targetType: 'LISTING', targetId: 'nope', reason: 'FRAUD' } })).status === 404)
check('通報の一覧は、運営者以外には見えない（通報された生産者にも）', (await farmC('/api/reports')).status === 403 && (await restaurant('/api/reports')).status === 403 && (await anon('/api/reports')).status === 401)
let reports = (await admin('/api/reports?status=OPEN')).data.reports
const rep = reports.find((x) => x.targetId === mapListing.id)
check('運営者は通報の内容・通報者・対象の状態を確認できる', rep?.reporterName === 'restaurant1' && rep.detail === '写真と数量が違うようです' && rep.targetState === 'ACTIVE' && rep.targetLabel.includes('トマト'))
check('通報だけでは自動的に停止されない', (await search()).data.locations.flatMap((l) => l.listings).some((l) => l.id === mapListing.id))
r = await admin('/api/reports', { method: 'PATCH', body: { id: rep.id, status: 'IN_REVIEW', note: '生産者に確認中' } })
check('対応状況を変更し、メモを残せる', r.status === 200)
r = await admin('/api/reports', { method: 'PATCH', body: { id: rep.id, targetAction: 'suspend', status: 'RESOLVED' } })
reports = (await admin('/api/reports')).data.reports
const after = reports.find((x) => x.id === rep.id)
check('運営者は通報から対象を停止でき、対応履歴に残る', r.status === 200 && after.status === 'RESOLVED' && after.targetState === 'SUSPENDED' && after.actions.length >= 4, JSON.stringify(after?.actions))
check('停止された出品は地図・仕入れ案に出ない', !JSON.stringify((await search()).data).includes(mapListing.id))
await admin('/api/reports', { method: 'PATCH', body: { id: rep.id, targetAction: 'restore' } })
check('停止を解除できる', (await search()).data.locations.flatMap((l) => l.listings).some((l) => l.id === mapListing.id))
check('対応が終わった後は、同じ対象をもう一度通報できる', (await restaurant('/api/reports', { body: { targetType: 'LISTING', targetId: mapListing.id, reason: 'NUISANCE' } })).status === 201)
check('運営者以外は対応状況を変更できない', (await restaurant('/api/reports', { method: 'PATCH', body: { id: rep.id, status: 'REJECTED' } })).status === 403)

console.log('郵便番号・地名検索（外部サービスに実際に問い合わせ）')
const zip = (z, c = restaurant) => c('/api/geo', { body: { op: 'zip', zip: z } })
r = await zip('5300001')
check('郵便番号（7桁）から住所を取得できる', r.status === 200 && r.data.results?.[0]?.prefecture === '大阪府' && r.data.results[0].city === '大阪市北区', JSON.stringify(r.data))
r = await zip('530-0001', farmA)
check('ハイフン付きでも取得できる（生産者も利用可）', r.data.results?.[0]?.town === '梅田')
r = await zip('0000000')
check('存在しない郵便番号は空の結果', r.status === 200 && Array.isArray(r.data.results) && r.data.results.length === 0, JSON.stringify(r.data))
r = await zip('0790177')
check('複数の住所候補があれば、すべて返す', (r.data.results?.length ?? 0) >= 2, JSON.stringify(r.data))
check('7桁でない郵便番号は拒否', (await zip('12345')).status === 400)
check('郵便番号は新規登録のため未ログインでも使える', (await zip('5300001', anon)).status === 200)
check('地名検索は未ログインでは使えない', (await anon('/api/geo', { body: { op: 'search', q: '梅田' } })).status === 401)
r = await restaurant('/api/geo', { body: { op: 'search', q: '梅田' } })
check('地名から位置を検索できる（日本国内の候補）', r.status === 200 && (r.data.results === null || (r.data.results.length > 0 && r.data.results.every((x) => x.lat > 20 && x.lat < 46))), JSON.stringify(r.data).slice(0, 200))
check('地名検索の入力が短すぎる場合は拒否', (await restaurant('/api/geo', { body: { op: 'search', q: 'あ' } })).status === 400)

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


console.log('マッチング・チャット（依頼 → 承認・辞退・取り下げ → チャット → 権限）')
{
  r = await farmA('/api/listings', { body: listingBody({ grade: 'REGULAR', irregularReason: null, quantity: 6, unitPriceYen: 580, pickupDate: jstDate(3) }) })
  const listA = r.data.listing
  r = await farmB('/api/listings', { body: listingBody({ grade: 'REGULAR', irregularReason: null, quantity: 4, unitPriceYen: 560, pickupDate: jstDate(3) }) })
  const listB = r.data.listing
  check('未ログインは提案できない。生産者は飲食店あての形式でしか提案できない', (await farmA('/api/matches', { body: { lines: [{ listingId: listA.id, quantity: 1 }] } })).status === 400 && (await anon('/api/matches', { body: { lines: [{ listingId: listA.id, quantity: 1 }] } })).status === 401)
  check('在庫より多い数量では依頼できない', (await restaurant('/api/matches', { body: { lines: [{ listingId: listA.id, quantity: 7 }] } })).status === 400)
  check('受渡日時が出品と合わない依頼は拒否', (await restaurant('/api/matches', { body: { lines: [{ listingId: listA.id, quantity: 3, pickupStartMs: Date.now() + 3600000, pickupEndMs: Date.now() + 7200000 }] } })).status === 400)
  r = await restaurant('/api/matches', { body: { lines: [{ listingId: listA.id, quantity: 3 }], message: '来週も同じ量を相談したいです' } })
  const mA = r.data?.matches?.[0]
  check('飲食店が生産者にマッチング依頼を送れる（返事待ち）', r.status === 201 && mA?.status === 'PENDING' && mA.producerName && mA.quantityMilli === 3000, JSON.stringify(r.data))
  check('同じ出品への依頼は、返事待ち・成立の間は重複して送れない', (await restaurant('/api/matches', { body: { lines: [{ listingId: listA.id, quantity: 1 }] } })).status === 409)
  check('依頼しただけでは、在庫は減らない（在庫の確保をしない）', (await farmA('/api/listings')).data.listings.find((l) => l.id === listA.id).quantityMilli === 6000)
  check('承認の前（相談中）でも、チャットで相談できる', (await restaurant('/api/chat?matchId=' + mA.id)).status === 200 && (await restaurant('/api/chat', { body: { matchId: mA.id, body: '承認の前に、品質を確認させてください。', clientId: 'e2e-before-accept' } })).status === 201)
  check('関係のない飲食店・生産者は、依頼を見られない', (await restaurant2('/api/matches?id=' + mA.id)).status === 404 && (await farmB('/api/matches?id=' + mA.id)).status === 404)
  check('飲食店は自分の依頼を承認できない（承認は生産者だけ）', (await restaurant('/api/matches?id=' + mA.id, { method: 'PATCH', body: { action: 'accept' } })).status === 403)
  check('別の生産者は承認できない', (await farmB('/api/matches?id=' + mA.id, { method: 'PATCH', body: { action: 'accept' } })).status === 404)
  const inboxA = (await farmA('/api/matches')).data
  check('生産者に依頼が届き、「返事が必要」の数に入る', inboxA.matches.some((m) => m.id === mA.id && m.status === 'PENDING' && m.restaurantName) && inboxA.pendingTotal >= 1)
  r = await farmA('/api/matches?id=' + mA.id, { method: 'PATCH', body: { action: 'accept' } })
  check('生産者が承認すると、マッチング成立', r.status === 200 && r.data.match.status === 'ACCEPTED' && r.data.match.respondedAtMs > 0)
  check('成立した依頼に、もう一度返事はできない', (await farmA('/api/matches?id=' + mA.id, { method: 'PATCH', body: { action: 'decline' } })).status === 409)
  const dbMatch = (await db.query('select status from "MatchRequest" where id = $1', [mA.id])).rows[0]
  check('DB でも、依頼の状態が「成立（ACCEPTED）」になっている', dbMatch?.status === 'ACCEPTED')

  // チャット
  r = await restaurant('/api/chat', { body: { matchId: mA.id, body: 'はじめまして。数量と最終価格を確認させてください。', clientId: 'e2e-chat-0001' } })
  check('飲食店からメッセージを送れる', r.status === 201 && r.data.message.mine === true)
  const unreadA = (await farmA('/api/matches')).data.matches.find((m) => m.id === mA.id).unread
  check('生産者側に、新着（未読2件：承認前と後のメッセージ）として表示される', unreadA === 2, String(unreadA))
  const logA = (await farmA('/api/chat?matchId=' + mA.id)).data
  const textsA = logA.messages.filter((m) => m.kind === 'TEXT')
  check('生産者側で受信を確認できる（相手のメッセージとして）', textsA.length === 2 && textsA[1].mine === false && textsA[1].senderRole === 'RESTAURANT')
  check('承認などの取引の記録も、チャットの流れに残る', logA.messages.some((m) => m.kind === 'SYSTEM' && m.body.includes('マッチング成立')))
  check('開いた後は、未読が0になる', (await farmA('/api/matches')).data.matches.find((m) => m.id === mA.id).unread === 0)
  r = await farmA('/api/chat', { body: { matchId: mA.id, body: '3kgで1,740円です。木曜10時に拠点でお渡しできます。', clientId: 'e2e-chat-0002' } })
  check('生産者から返信できる', r.status === 201)
  const logR = (await restaurant('/api/chat?matchId=' + mA.id)).data
  const textsR = logR.messages.filter((m) => m.kind === 'TEXT')
  check('飲食店側で返信を確認できる（送信日時の順）', textsR.length === 3 && textsR[2].mine === false && textsR[1].createdAtMs <= textsR[2].createdAtMs)
  r = await restaurant('/api/chat', { body: { matchId: mA.id, body: 'はじめまして。数量と最終価格を確認させてください。', clientId: 'e2e-chat-0001' } })
  check('同じメッセージを再送しても、二重に保存されない', r.status === 201 && (await restaurant('/api/chat?matchId=' + mA.id)).data.messages.filter((m) => m.kind === 'TEXT').length === 3)
  const dbMsgs = (await db.query('select "senderRole" from "ChatMessage" where "matchId" = $1 and kind = $2 order by "createdAt"', [mA.id, 'TEXT'])).rows.map((x) => x.senderRole)
  check('メッセージの履歴が DB に保存されている（送った人の立場はサーバーが決める）', JSON.stringify(dbMsgs) === '["RESTAURANT","RESTAURANT","PRODUCER"]', JSON.stringify(dbMsgs))
  check('関係のない飲食店は、チャットを読めない・送れない', (await restaurant2('/api/chat?matchId=' + mA.id)).status === 404 && (await restaurant2('/api/chat', { body: { matchId: mA.id, body: 'なりすまし', clientId: 'e2e-spoof-0001' } })).status === 404)
  check('関係のない生産者は、チャットを読めない・送れない', (await farmB('/api/chat?matchId=' + mA.id)).status === 404 && (await farmB('/api/chat', { body: { matchId: mA.id, body: 'なりすまし', clientId: 'e2e-spoof-0002' } })).status === 404)
  check('未ログインでは、チャットを読めない', (await anon('/api/chat?matchId=' + mA.id)).status === 401)
  check('運営者は閲覧だけでき、送信はできない', (await admin('/api/chat?matchId=' + mA.id)).status === 200 && (await admin('/api/chat', { body: { matchId: mA.id, body: 'x', clientId: 'e2e-admin-0001' } })).status === 403)
  check('空のメッセージは送れない', (await restaurant('/api/chat', { body: { matchId: mA.id, body: '   ', clientId: 'e2e-empty-0001' } })).status === 400)

  // 辞退・取り下げ
  r = await restaurant('/api/matches', { body: { lines: [{ listingId: listB.id, quantity: 2 }] } })
  const mB = r.data.matches[0]
  r = await farmB('/api/matches?id=' + mB.id, { method: 'PATCH', body: { action: 'decline', reason: '今週は数量が足りません' } })
  check('生産者は辞退でき、理由が飲食店に伝わる。辞退後は履歴を見られるが、送信はできない', r.status === 200 && r.data.match.status === 'DECLINED' && (await restaurant('/api/matches?id=' + mB.id)).data.match.declineReason === '今週は数量が足りません' && (await restaurant('/api/chat?matchId=' + mB.id)).status === 200 && (await restaurant('/api/chat', { body: { matchId: mB.id, body: 'x', clientId: 'e2e-after-decline' } })).status === 403)
  r = await restaurant('/api/matches', { body: { lines: [{ listingId: listB.id, quantity: 1 }] } })
  check('辞退された後は、同じ出品にもう一度依頼できる', r.status === 201)
  const mB2 = r.data.matches[0]
  r = await restaurant('/api/matches?id=' + mB2.id, { method: 'PATCH', body: { action: 'cancel' } })
  check('飲食店は返事待ちの依頼を取り下げられる', r.status === 200 && r.data.match.status === 'CANCELLED')
  check('取り下げた依頼を、生産者は承認できない', (await farmB('/api/matches?id=' + mB2.id, { method: 'PATCH', body: { action: 'accept' } })).status === 409)
  await farmA('/api/listings?id=' + listA.id, { method: 'DELETE' })
  check('出品を削除しても、成立したマッチングとチャットは残る', (await restaurant('/api/chat?matchId=' + mA.id)).data.messages.filter((m) => m.kind === 'TEXT').length === 3)
}


console.log('取引の流れ A：飲食店から提案 → 承認前に相談 → 承認 → 条件の提案と合意 → 双方の完了確認 → 相互レビュー')
{
  const notes = async (c) => (await c('/api/notifications')).data
  const kinds = async (c) => (await notes(c)).notifications.map((n) => n.kind)
  r = await farmA('/api/listings', { body: listingBody({ grade: 'REGULAR', irregularReason: null, quantity: 8, unitPriceYen: 500, pickupDate: jstDate(3) }) })
  const L = r.data.listing
  r = await restaurant('/api/matches', { body: { lines: [{ listingId: L.id, quantity: 5 }], message: '配送でお願いできますか', deliveryMethod: 'DELIVERY', deliveryPlace: '店の裏口（大阪市福島区）', shippingFeeYen: null } })
  const m = r.data?.matches?.[0]
  check('飲食店から、受渡方法つきで取引を提案できる（配送・送料は未確定）', r.status === 201 && m.initiator === 'RESTAURANT' && m.deliveryMethod === 'DELIVERY' && m.shippingFeeYen === null && m.status === 'PENDING', JSON.stringify(r.data))
  check('生産者に「取引の提案が届いた」通知が届く（未読）', (await kinds(farmA)).includes('PROPOSAL_RECEIVED') && (await notes(farmA)).unread >= 1)
  check('他人の通知は見えない（通知は本人のものだけ）', !(await notes(farmB)).notifications.some((n) => n.link === '/matches/' + m.id))
  r = await farmA('/api/chat', { body: { matchId: m.id, body: '承認の前に確認です。配送は午前でよいですか？', clientId: 'flowA-pre-1' } })
  check('提案を受けた側も、承認の前にメッセージを送れる', r.status === 201)
  check('メッセージの通知が相手に届く', (await kinds(restaurant)).includes('NEW_MESSAGE'))
  let chatR = (await restaurant('/api/chat?matchId=' + m.id)).data
  let chatA = (await farmA('/api/chat?matchId=' + m.id)).data
  check('電話：相談中でも見せる設定の相手（生産者）の番号は、飲食店に表示される', chatR.partnerPhone === '080-0000-0003', String(chatR.partnerPhone))
  check('電話：マッチング成立後だけ見せる設定の相手（飲食店）の番号は、承認前は表示されず、理由が出る', chatA.partnerPhone === null && chatA.phoneNote.includes('承認'))
  check('飲食店は、自分の提案を承認できない', (await restaurant('/api/matches?id=' + m.id, { method: 'PATCH', body: { action: 'accept' } })).status === 403)
  check('承認の前は、条件の提案はできない（メッセージで相談）', (await restaurant('/api/proposals', { body: { matchId: m.id, quantity: 5, unitPriceYen: 500, deliveryMethod: 'PICKUP', deliveryPlace: '', date: jstDate(3), startTime: '10:00', endTime: '11:00', shippingFeeYen: null, shippingPayer: 'UNDECIDED' } })).status === 409)
  r = await farmA('/api/matches?id=' + m.id, { method: 'PATCH', body: { action: 'accept' } })
  check('生産者が承認すると、マッチング成立（取引準備中）', r.status === 200 && r.data.match.status === 'ACCEPTED')
  check('飲食店に「承認された」通知が届く', (await kinds(restaurant)).includes('PROPOSAL_ACCEPTED'))
  chatA = (await farmA('/api/chat?matchId=' + m.id)).data
  check('電話：マッチング成立後は、飲食店の番号も生産者に表示される', chatA.partnerPhone === '090-0000-0001', String(chatA.partnerPhone))
  check('電話：取引に関係のない飲食店は、チャットも番号も見られない', (await restaurant2('/api/chat?matchId=' + m.id)).status === 404)
  r = await farmA('/api/proposals', { body: { matchId: m.id, quantity: 6, unitPriceYen: 480, deliveryMethod: 'DELIVERY', deliveryPlace: '店の裏口（大阪市福島区）', date: jstDate(3), startTime: '09:00', endTime: '10:00', shippingFeeYen: 500, shippingPayer: 'RESTAURANT', note: '箱は返却不要です' } })
  const prop = r.data?.proposal
  check('マッチング成立後は、生産者から取引条件（数量・単価・送料・日時）を提案できる', r.status === 201 && prop.status === 'PENDING' && prop.shippingFeeYen === 500)
  check('飲食店に「条件の提案が届いた」通知が届く', (await kinds(restaurant)).includes('TERMS_PROPOSED'))
  check('返事待ちの提案があるうちは「この条件で合意」はできない', (await restaurant('/api/matches?id=' + m.id, { method: 'PATCH', body: { action: 'agree' } })).status === 409)
  check('提案した本人は、自分の提案に返事できない', (await farmA('/api/proposals?id=' + prop.id, { method: 'PATCH', body: { action: 'accept' } })).status === 403)
  check('関係のない利用者は、提案に返事できない', (await restaurant2('/api/proposals?id=' + prop.id, { method: 'PATCH', body: { action: 'accept' } })).status === 404)
  r = await restaurant('/api/proposals?id=' + prop.id, { method: 'PATCH', body: { action: 'accept' } })
  check('飲食店が承諾すると、その条件が取引条件になり、取引条件に合意', r.status === 200 && r.data.match.status === 'AGREED' && r.data.match.quantityMilli === 6000 && r.data.match.unitPriceYen === 480 && r.data.match.shippingFeeYen === 500 && r.data.match.shippingPayer === 'RESTAURANT')
  check('条件に合意しても、在庫は減らない（在庫の確保をしない）', (await farmA('/api/listings')).data.listings.find((l) => l.id === L.id).quantityMilli === 8000)
  check('合意の前にレビューは書けない', (await restaurant('/api/reviews', { body: { matchId: m.id, rating: 5, satisfaction: 5, politeness: 5, smoothness: 5 } })).status === 409)
  r = await restaurant('/api/matches?id=' + m.id, { method: 'PATCH', body: { action: 'complete' } })
  check('片方だけが完了を確認しても、取引完了にならない（相手の確認待ち）', r.status === 200 && r.data.match.status === 'AGREED' && r.data.match.completed.restaurant && !r.data.match.completed.producer)
  check('生産者に「取引完了の確認依頼」通知が届く', (await kinds(farmA)).includes('COMPLETION_REQUESTED'))
  check('同じ人が完了を二度押すことはできない', (await restaurant('/api/matches?id=' + m.id, { method: 'PATCH', body: { action: 'complete' } })).status === 409)
  check('完了の確認が始まった後は、条件を変更できない', (await farmA('/api/proposals', { body: { matchId: m.id, quantity: 1, unitPriceYen: 1, deliveryMethod: 'PICKUP', deliveryPlace: '', date: jstDate(3), startTime: '10:00', endTime: '11:00', shippingFeeYen: null, shippingPayer: 'UNDECIDED' } })).status === 409)
  r = await farmA('/api/matches?id=' + m.id, { method: 'PATCH', body: { action: 'complete' } })
  check('双方が完了を確認すると、取引完了', r.status === 200 && r.data.match.status === 'COMPLETED')
  check('双方に「相手が完了を確認」「レビュー依頼」の通知が届く', (await kinds(restaurant)).includes('COMPLETED') && (await kinds(restaurant)).includes('REVIEW_REQUESTED') && (await kinds(farmA)).includes('REVIEW_REQUESTED'))
  check('評価は1〜5だけ', (await restaurant('/api/reviews', { body: { matchId: m.id, rating: 6, satisfaction: 5, politeness: 5, smoothness: 5 } })).status === 400)
  check('関係のない飲食店は、この取引を評価できない', (await restaurant2('/api/reviews', { body: { matchId: m.id, rating: 1, satisfaction: 1, politeness: 1, smoothness: 1 } })).status === 404)
  r = await restaurant('/api/reviews', { body: { matchId: m.id, rating: 5, satisfaction: 5, politeness: 4, smoothness: 5, comment: '丁寧に梱包していただきました' } })
  check('取引完了後に、飲食店が生産者をレビューできる', r.status === 201)
  check('1つの取引につき1人1回まで', (await restaurant('/api/reviews', { body: { matchId: m.id, rating: 1, satisfaction: 1, politeness: 1, smoothness: 1 } })).status === 409)
  chatA = (await farmA('/api/chat?matchId=' + m.id)).data
  check('自分が投稿する前は、相手のレビューは見えない（投稿済みであることだけ分かる）', chatA.reviews.partner === null && chatA.reviews.partnerSubmitted === true)
  const producerIdA = (await db.query('select "producerId" from "MatchRequest" where id = $1', [m.id])).rows[0].producerId
  check('片方だけの投稿では、生産者の評価（平均・件数）に出ない', (await restaurant('/api/reviews?producerId=' + producerIdA)).data.summary === null)
  r = await farmA('/api/reviews', { body: { matchId: m.id, rating: 4, satisfaction: 4, politeness: 5, smoothness: 4, comment: '受け取りがスムーズでした' } })
  check('生産者も飲食店をレビューできる', r.status === 201)
  chatR = (await restaurant('/api/chat?matchId=' + m.id)).data
  check('双方が投稿すると、お互いのレビューが見られる', chatR.reviews.partner?.rating === 4 && chatR.reviews.mine?.rating === 5)
  const sum = (await restaurant2('/api/reviews?producerId=' + producerIdA)).data.summary
  check('生産者のプロフィールに、平均評価と件数が出る', sum?.average === 5 && sum.count === 1, JSON.stringify(sum))
  // 不適切なレビューの通報 → 運営者が非公開にする
  const myReviews = (await farmA('/api/reviews?mine=1')).data
  r = await farmA('/api/reports', { body: { targetType: 'REVIEW', targetId: myReviews.reviews[0].id, reason: 'INAPPROPRIATE', detail: 'E2E：レビューの通報' } })
  check('自分が受けたレビューを通報できる', r.status === 201)
  check('自分が受けていないレビューは通報できない', (await farmB('/api/reports', { body: { targetType: 'REVIEW', targetId: myReviews.reviews[0].id, reason: 'INAPPROPRIATE' } })).status === 404)
  const rep = (await admin('/api/reports?status=OPEN')).data.reports.find((x) => x.targetType === 'REVIEW')
  r = await admin('/api/reports', { method: 'PATCH', body: { id: rep.id, targetAction: 'suspend', status: 'RESOLVED' } })
  check('運営者がレビューを非公開にすると、評価からも外れる', r.status === 200 && (await restaurant2('/api/reviews?producerId=' + producerIdA)).data.summary === null)
  const nA = await notes(farmA)
  r = await farmA('/api/notifications', { method: 'PATCH', body: { ids: [nA.notifications[0].id] } })
  check('通知を1件ずつ既読にできる', r.status === 200 && r.data.unread === nA.unread - (nA.notifications[0].read ? 0 : 1))
  r = await farmA('/api/notifications', { method: 'PATCH', body: { all: true } })
  check('通知をすべて既読にでき、再ログイン後も DB に残る', r.data.unread === 0 && (await db.query('select count(*)::int as n from "Notification" n join "user" u on u.id = n."userId" where u.username = $1', ['farm_a'])).rows[0].n >= 5)
}

console.log('取引の流れ B：生産者から提案 → 承認前に相談 → 飲食店が承認 → 双方が合意 → 完了 → 相互レビュー・ブロック')
{
  const kinds = async (c) => (await c('/api/notifications')).data.notifications.map((n) => n.kind)
  const partners = (await farmB('/api/partners')).data
  check('生産者には、提案を受け付けている飲食店だけが出る（店名と市区町村だけ）', partners.restaurants.some((x) => x.name === 'テスト食堂') && !partners.restaurants.some((x) => x.name === 'テスト小料理店') && partners.restaurants.every((x) => !('phone' in x) && !('address' in x)))
  check('飲食店は提案先の一覧を使えない', (await restaurant('/api/partners')).status === 403)
  r = await farmB('/api/listings', { body: listingBody({ grade: 'REGULAR', irregularReason: null, quantity: 5, unitPriceYen: 520, pickupDate: jstDate(4) }) })
  const LB = r.data.listing
  const target = partners.restaurants.find((x) => x.name === 'テスト食堂')
  const r1 = (await restaurant('/api/me')).data.user
  const rid1 = (await db.query('select r.id from "Restaurant" r join "user" u on u.id = r."userId" where u.username = $1', ['restaurant1'])).rows[0].id
  check('提案を受け付けていない飲食店には提案できない', (await farmB('/api/matches', { body: { restaurantId: rid1, listingId: LB.id, quantity: 2 } })).status === 404 && r1.acceptProposals === false)
  check('他の生産者の出品では提案できない', (await farmB('/api/matches', { body: { restaurantId: target.id, listingId: (await farmA('/api/listings')).data.listings[0].id, quantity: 1 } })).status === 409)
  r = await farmB('/api/matches', { body: { restaurantId: target.id, listingId: LB.id, quantity: 3, message: '今週採れたトマトです', deliveryMethod: 'PICKUP' } })
  const mb = r.data?.matches?.[0]
  check('生産者から、受け付けている飲食店に提案できる（相談中）', r.status === 201 && mb.initiator === 'PRODUCER' && mb.status === 'PENDING', JSON.stringify(r.data))
  check('飲食店に「取引の提案が届いた」通知が届く', (await kinds(restaurant2)).includes('PROPOSAL_RECEIVED'))
  check('同じ飲食店に、同じ出品で重複して提案できない', (await farmB('/api/matches', { body: { restaurantId: target.id, listingId: LB.id, quantity: 1 } })).status === 409)
  r = await restaurant2('/api/chat', { body: { matchId: mb.id, body: '承認の前に、受け取りの時間を相談させてください。', clientId: 'flowB-pre-1' } })
  check('飲食店も、承認の前にメッセージを送れる', r.status === 201)
  const chatB = (await farmB('/api/chat?matchId=' + mb.id)).data
  check('電話：表示しない設定の相手の番号は出ず、理由が出る', chatB.partnerPhone === null && chatB.phoneNote.includes('表示しない'))
  check('生産者は、自分の提案を承認できない', (await farmB('/api/matches?id=' + mb.id, { method: 'PATCH', body: { action: 'accept' } })).status === 403)
  r = await restaurant2('/api/matches?id=' + mb.id, { method: 'PATCH', body: { action: 'accept' } })
  check('飲食店が承認すると、マッチング成立', r.status === 200 && r.data.match.status === 'ACCEPTED')
  check('生産者に「承認された」通知が届く', (await kinds(farmB)).includes('PROPOSAL_ACCEPTED'))
  r = await restaurant2('/api/matches?id=' + mb.id, { method: 'PATCH', body: { action: 'agree' } })
  check('片方だけの合意では、取引条件の合意にならない', r.status === 200 && r.data.match.status === 'ACCEPTED' && r.data.match.agreed.restaurant && !r.data.match.agreed.producer)
  r = await farmB('/api/matches?id=' + mb.id, { method: 'PATCH', body: { action: 'agree' } })
  check('双方が「この条件で合意」すると、取引条件に合意', r.status === 200 && r.data.match.status === 'AGREED')
  await farmB('/api/matches?id=' + mb.id, { method: 'PATCH', body: { action: 'complete' } })
  r = await restaurant2('/api/matches?id=' + mb.id, { method: 'PATCH', body: { action: 'complete' } })
  check('生産者が先に完了を確認しても、双方がそろうと取引完了', r.status === 200 && r.data.match.status === 'COMPLETED')
  const rv1 = await restaurant2('/api/reviews', { body: { matchId: mb.id, rating: 4, satisfaction: 4, politeness: 4, smoothness: 3 } })
  const rv2 = await farmB('/api/reviews', { body: { matchId: mb.id, rating: 5, satisfaction: 5, politeness: 5, smoothness: 5 } })
  check('生産者からの取引でも、相互レビューができる', rv1.status === 201 && rv2.status === 201 && (await farmB('/api/chat?matchId=' + mb.id)).data.reviews.partner?.rating === 4)
  // 迷惑な提案への対策：ブロック
  r = await farmB('/api/listings', { body: listingBody({ grade: 'REGULAR', irregularReason: null, quantity: 4, unitPriceYen: 530, pickupDate: jstDate(4) }) })
  r = await farmB('/api/matches', { body: { restaurantId: target.id, listingId: r.data.listing.id, quantity: 2 } })
  const mb2 = r.data.matches[0]
  r = await restaurant2('/api/matches?id=' + mb2.id, { method: 'PATCH', body: { action: 'block' } })
  check('飲食店は、生産者からの提案を今後受け取らないようにできる（相談中の提案は辞退になる）', r.status === 200 && r.data.match.status === 'DECLINED')
  check('ブロックした飲食店は、その生産者の提案先の一覧に出ない', !(await farmB('/api/partners')).data.restaurants.some((x) => x.id === target.id))
  check('ブロックされた生産者は、その飲食店に提案できない', (await farmB('/api/matches', { body: { restaurantId: target.id, listingId: LB.id, quantity: 1 } })).status === 404)
  check('ブロックは飲食店だけ・生産者からの提案だけ', (await farmB('/api/matches?id=' + mb2.id, { method: 'PATCH', body: { action: 'block' } })).status === 403)
}

console.log('電話番号の登録・変更（非公開）')
{
  r = await farmC('/api/me', { method: 'PATCH', body: { orgName: 'テストC農園', area: '能勢町', phone: '０９０ー１２３４ー５６７８', phoneShare: 'MATCHED' } })
  check('電話番号を登録・変更できる（全角・ハイフンも可。表示はハイフン付き）', r.status === 200 && r.data.user.phone === '090-1234-5678' && r.data.user.phoneShare === 'MATCHED', JSON.stringify(r.data?.user?.phone))
  const row = (await db.query('select phone, "phoneVerified" from "user" where username = $1', ['farm_c'])).rows[0]
  check('保存は数字だけの形にそろえ、未確認（SMS などで確認していない）として区別する', row.phone === '09012345678' && row.phoneVerified === false)
  check('形式の違う電話番号には変更できない', (await farmC('/api/me', { method: 'PATCH', body: { orgName: 'テストC農園', area: '能勢町', phone: '123' } })).status === 400)
  check('自分の電話番号は本人にだけ返る（他人の /api/me には出ない）', (await farmB('/api/me')).data.user.phone !== '090-1234-5678')
}

console.log('総当たり・自動登録への対策')
await db.query('delete from "Throttle"')
let statuses = []
for (let i = 0; i < 6; i++) statuses.push((await recover({ username: 'ghost_user_zz', recoveryCode: 'AAAA-BBBB-CCCC-DDDD-EEEE', newPassword: 'whatever-password-1' })).status)
check('リカバリーコードの試行は、同じユーザー名につき回数が制限される', statuses.slice(0, 5).every((x) => x === 400) && statuses[5] === 429, statuses.join(','))
statuses = []
for (let i = 0; i < 11; i++) statuses.push((await client().login('restaurant2', 'wrong-password-123')).status)
check('ログインの試行は、同じユーザー名につき回数が制限される', statuses.slice(0, 10).every((x) => x === 401) && statuses[10] === 429, statuses.join(','))
check('制限中は正しいパスワードでもログインできない（総当たりの成功を防ぐ）', (await client().login('restaurant2')).status === 429)
check('他のユーザー名のログインには影響しない', (await client().login('restaurant1')).status === 200)
statuses = []
for (let i = 0; i < 6; i++) statuses.push((await signup({})).status)
check('同じ接続元からの新規登録は回数が制限される', statuses.slice(0, 5).every((x) => x === 201) && statuses[5] === 429, statuses.join(','))

await db.end()
execSync('npx tsx prisma/seed.ts', { stdio: 'ignore' })
console.log(failures === 0 ? '\nすべて成功' : `\n失敗 ${failures} 件`)
process.exit(failures === 0 ? 0 : 1)
