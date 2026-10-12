// API を通した受入試験（02_spec.md 12章 ＋ 03_spec_addendum.md 11章）。ローカル開発環境専用。
// テストデータを作り直すため、ローカルの DB（localhost）でしか動かない。
// 実行: npm run dev を起動した状態で  npm run e2e
import { execSync } from 'node:child_process'
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
