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
const signupBody = (over = {}) => ({ username: `x_${Math.floor(Math.random() * 1e9)}`, password: newPassword, role: 'PRODUCER', orgName: 'E2E農園', area: '能勢町', ...over })
const signup = (over) => client()('/api/signup', { body: signupBody(over) })
check('役割に「運営者」を指定した登録は拒否', (await signup({ role: 'ADMIN' })).status === 400)
check('役割なしの登録は拒否', (await signup({ role: undefined })).status === 400)
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
r = await farmC('/api/locations', { body: { name: '使わない場所', municipality: '能勢町', address: 'テスト9-9', note: '' } })
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
  const normal = await restaurant('/api/market', { body: { center: OSAKA_ST, radiusKm: 10 } })
  check('通常の検索にはデモデータが混ざらない', normal.status === 200 && normal.data.demo === false && normal.data.locations.every((l) => !l.isDemo && l.listings.every((x) => !x.isDemo)))
  const demo10 = await restaurant('/api/market', { body: { center: OSAKA_ST, radiusKm: 10, demo: true } })
  check('デモモードでは、大阪駅から10km以内にデモデータの出品が見つかる', demo10.data.demo === true && count(demo10) > 100 && demo10.data.locations.every((l) => l.isDemo && l.listings.every((x) => x.isDemo) && l.distanceKm <= 10), `${count(demo10)}`)
  const demoAll = await restaurant('/api/market', { body: { center: OSAKA_ST, radiusKm: null, demo: true } })
  check('距離指定なしでは、さらに多く見つかる（東京も含む）', count(demoAll) > count(demo10) && demoAll.data.locations.some((l) => l.municipality.startsWith('東京都') || l.latitude > 35.5), `${count(demoAll)}`)
  const none = await restaurant('/api/market', { body: { center: { lat: 33.59, lng: 130.4 }, radiusKm: 1 } })
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
  check('デモモード用の受取エリアの選択肢がある（通常の選択肢には混ざらない）', m.demoMunicipalities.includes('大阪市福島区') && !m.municipalities.includes('大阪市福島区'))
  const anyDemo = demo10.data.locations[0].listings[0]
  check('デモの出品の詳細は、デモモード指定のときだけ開ける', (await restaurant(`/api/market?id=${anyDemo.id}`)).status === 404 && (await restaurant(`/api/market?id=${anyDemo.id}&demo=1`)).status === 200)
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
const search = (body = {}, c = restaurant) => c('/api/market', { body: { center: null, radiusKm: null, ...body } })
const locIds = (res) => res.data.locations.map((l) => l.id)
const approveLoc = (id) => admin('/api/admin', { body: { target: 'location', id, action: 'approve' } })

r = await farmC('/api/locations', { body: { name: 'C農園 地図テスト', municipality: '能勢町', address: 'テスト7-7', note: '', postalCode: '5630101', latitude: 34.98, longitude: 135.42, showOnMap: true, hours: '平日10〜16時' } })
check('生産者は位置つきの受渡拠点を登録できる（確認待ち）', r.status === 201 && r.data.location.status === 'PENDING' && r.data.location.latitude === 34.98 && r.data.location.postalCode === '563-0101')
const mapLoc = r.data.location
r = await farmC('/api/listings', { body: listingBody({ grade: 'REGULAR', irregularReason: null, quantity: 4, unitPriceYen: 500, pickupLocationId: mapLoc.id }) })
const mapListing = r.data.listing
// 出品のない拠点は地図に出ないため、拠点Q にも出品を1件置く
await farmB('/api/listings', { body: listingBody({ grade: 'REGULAR', irregularReason: null, quantity: 6, unitPriceYen: 520, pickupLocationId: placeQ.id }) })
let s = await search()
check('出品のない拠点や、確認待ちの拠点は地図に出ない', s.status === 200 && !locIds(s).includes(mapLoc.id))
check('地図には、公開を許可した確認済みの拠点だけが出る', locIds(s).includes(placeP.id) && locIds(s).includes(placeQ.id))

r = await farmB('/api/locations', { body: { name: 'B農園 自宅（非公開）', municipality: '豊能町', address: '自宅', note: '', latitude: 34.921, longitude: 135.491, showOnMap: false } })
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

r = await farmC(`/api/locations?id=${mapLoc.id}`, { method: 'PUT', body: { name: 'C農園 地図テスト', municipality: '能勢町', address: 'テスト7-7', note: '', latitude: 34.985, longitude: 135.425, showOnMap: true, hours: '平日10〜16時' } })
check('位置を変えると、運営者の確認を受け直す（地図から消える）', r.status === 200 && r.data.reviewAgain === true && r.data.location.status === 'PENDING' && !locIds(await search()).includes(mapLoc.id))
await approveLoc(mapLoc.id)
r = await farmC(`/api/locations?id=${mapLoc.id}`, { method: 'PUT', body: { name: 'C農園 地図テスト', municipality: '能勢町', address: 'テスト7-7', note: '', latitude: 34.985, longitude: 135.425, showOnMap: true, hours: '毎日9〜12時' } })
check('受取の目安だけの変更では、確認済みのまま', r.data.location.status === 'APPROVED' && r.data.reviewAgain === false)
check('他の生産者の受渡拠点は編集・削除できない', (await farmA(`/api/locations?id=${mapLoc.id}`, { method: 'PUT', body: { name: 'x', municipality: 'x', address: 'x', note: '' } })).status === 404 && (await farmA(`/api/locations?id=${mapLoc.id}`, { method: 'DELETE' })).status === 404)
check('出品に使われている受渡拠点は削除できない', (await farmC(`/api/locations?id=${mapLoc.id}`, { method: 'DELETE' })).status === 400)
r = await farmC('/api/locations', { body: { name: '使わない拠点', municipality: '能勢町', address: 'テスト8-8', note: '' } })
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
check('未ログインでは使えない', (await zip('5300001', anon)).status === 401)
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
