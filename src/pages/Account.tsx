import { MapPinned, Star, UserRound } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { RatingSummary, ReviewDto, ReviewStatus, SessionUser } from '../../shared/dto.js'
import { normalizePhone, PHONE_SHARE_LABEL, type PhoneShare } from '../../shared/phone.js'
import { REVIEW_PUBLISH_DAYS } from '../../shared/trade.js'
import { ReportButton } from '../components/ReportButton.js'
import { ratingText } from '../lib/matches.js'
import { DEFAULT_CENTER, type LatLng, type PlaceResult } from '../../shared/geo.js'
import { isValidUsername, USERNAME_MAX, USERNAME_MIN } from '../../shared/limits.js'
import type { ProfileInput } from '../../shared/schemas.js'
import { api, ApiError, errorMessage } from '../api.js'
import { authClient, authErrorMessage } from '../auth-client.js'
import { AddressFields, type AddressValue } from '../components/AddressFields.js'
import { MapView } from '../components/MapView.js'
import { Field, Notice, PageTitle } from '../components/ui.js'
import { RecoveryCodeNotice } from './AuthPages.js'
import { useSession } from '../session.js'

const REVIEW: Record<ReviewStatus, { label: string; className: string; text: string }> = {
  PENDING: {
    label: '確認待ち',
    className: 'chip chip-warn',
    text: '運営者が登録内容を確認しています。確認が済むまで、出品は飲食店の仕入れ案に表示されません。',
  },
  APPROVED: { label: '確認済み', className: 'chip chip-live', text: '出品は、条件が合う飲食店の仕入れ案の候補になります。' },
  SUSPENDED: { label: '停止中', className: 'chip chip-off', text: '運営者により停止されています。出品は仕入れ案に表示されません。' },
}

type Result = { kind: 'success' | 'error'; message: string } | null

function ProfileSection({ user }: { user: SessionUser }) {
  const { setUser } = useSession()
  const p = user.producer
  const [orgName, setOrgName] = useState(user.orgName)
  const [area, setArea] = useState(user.area)
  const [publicPhone, setPublicPhone] = useState(p?.publicPhone ?? '')
  const [showPhone, setShowPhone] = useState(p?.showPhone ?? false)
  const [publicEmail, setPublicEmail] = useState(p?.publicEmail ?? '')
  const [showEmail, setShowEmail] = useState(p?.showEmail ?? false)
  const [contactNote, setContactNote] = useState(p?.contactNote ?? '')
  const [phone, setPhone] = useState(user.phone ?? '')
  const [phoneShare, setPhoneShare] = useState<PhoneShare>(user.phoneShare)
  const [acceptProposals, setAcceptProposals] = useState(user.acceptProposals)
  const [address, setAddress] = useState<AddressValue>({
    postalCode: user.address.postalCode ?? '',
    prefecture: user.address.prefecture ?? '',
    city: user.address.city ?? '',
    town: user.address.town ?? '',
    addressLine: user.address.addressLine ?? '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result>(null)
  const isRestaurant = user.role === 'RESTAURANT'
  const [storePos, setStorePos] = useState<LatLng | null>(user.storePosition)
  const [places, setPlaces] = useState<PlaceResult[] | null>(null)
  const [finding, setFinding] = useState(false)
  const [findProblem, setFindProblem] = useState<string | null>(null)

  // 住所から、お店の位置の候補を探す（正確な位置は、地図で確かめてもらう）
  const findOnMap = async () => {
    const q = [address.prefecture, address.city, address.town, address.addressLine].filter(Boolean).join('')
    if (q.length < 2) return setFindProblem('先に郵便番号・住所を入力してください。')
    setFinding(true)
    setFindProblem(null)
    setPlaces(null)
    try {
      const res = await api<{ results: PlaceResult[] | null; message?: string }>('/api/geo', { body: { op: 'search', q } })
      if (res.results === null) setFindProblem(res.message ?? '位置を探せませんでした。地図をタップして指定してください。')
      else if (res.results.length === 0) setFindProblem('住所から位置が見つかりませんでした。地図をタップして指定してください。')
      else if (res.results.length === 1) setStorePos({ lat: res.results[0].lat, lng: res.results[0].lng })
      else setPlaces(res.results)
    } catch (e) {
      setFindProblem(errorMessage(e))
    } finally {
      setFinding(false)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    setResult(null)
    if (phone.trim() && !normalizePhone(phone)) {
      setBusy(false)
      setErrors({ phone: '電話番号の形式を確認してください（例：090-1234-5678、06-1234-5678）' })
      return
    }
    const body: ProfileInput = { orgName, area, ...address, phoneShare }
    if (phone.trim()) body.phone = normalizePhone(phone)!
    if (isRestaurant) body.acceptProposals = acceptProposals
    if (isRestaurant) body.storePosition = storePos
    if (p) Object.assign(body, { publicPhone: publicPhone || null, showPhone, publicEmail: publicEmail || null, showEmail, contactNote: contactNote || null })
    try {
      const res = await api<{ user: SessionUser | null }>('/api/me', { method: 'PATCH', body })
      setUser(res.user)
      setResult({ kind: 'success', message: '保存しました。' })
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setResult({ kind: 'error', message: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card form" onSubmit={submit} noValidate>
      <h2 className="card-title">プロフィール</h2>
      {p && (
        <div className="review-box">
          <p>
            審査の状態：<span className={REVIEW[p.approvalStatus].className}>{REVIEW[p.approvalStatus].label}</span>
          </p>
          <p className="field-hint">{REVIEW[p.approvalStatus].text}</p>
        </div>
      )}
      <Field label={p ? '農園名・屋号' : '店舗名'} required error={errors.orgName}>
        <input className="input" type="text" maxLength={40} value={orgName} onChange={(e) => setOrgName(e.target.value)} />
      </Field>
      <Field label="地域（市区町村）" required error={errors.area}>
        <input className="input" type="text" maxLength={40} value={area} onChange={(e) => setArea(e.target.value)} />
      </Field>

      <h3 className="sub-title">電話番号（非公開）</h3>
      <Field label="あなたの電話番号" error={errors.phone} hint="携帯・固定のどちらでも。他の利用者には公開されません。">
        <input className="input" type="tel" inputMode="tel" autoComplete="tel" maxLength={20} value={phone} placeholder="例：090-1234-5678" onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <Field label="取引相手への電話番号の表示" hint="取引チャットの電話ボタンで、取引相手があなたに電話をかけられるようにするかを選びます。取引に関係のない利用者には、どの設定でも表示されません。">
        <select className="input" value={phoneShare} onChange={(e) => setPhoneShare(e.target.value as PhoneShare)}>
          {(Object.keys(PHONE_SHARE_LABEL) as PhoneShare[]).map((k) => (
            <option key={k} value={k}>
              {PHONE_SHARE_LABEL[k]}
            </option>
          ))}
        </select>
      </Field>
      {isRestaurant && (
        <div className="field">
          <label className="check check-box">
            <input type="checkbox" checked={acceptProposals} onChange={(e) => setAcceptProposals(e.target.checked)} />
            <span>
              <strong>生産者からの取引提案を受け取る</strong>
              <small className="block">オンにすると、生産者が提案先としてこのお店（店名と市区町村だけ）を見られ、農産物を提案できるようになります。特定の生産者からの提案は、やりとりの画面で受け取らないようにできます。</small>
            </span>
          </label>
        </div>
      )}

      <h3 className="sub-title">{isRestaurant ? 'お店の住所（非公開）' : '所在地（非公開）'}</h3>
      <p className="field-hint">
        {isRestaurant
          ? '他の利用者には表示されません。下の「お店の位置」を保存すると、地図で探すときの中心になります。'
          : '運営者からの確認などに使います。他の利用者には表示されず、地図にも出ません（ご自宅の住所が公開されることはありません）。受渡場所として公開する住所は「受渡拠点」で別に登録します。'}
      </p>
      <AddressFields idPrefix="profile" value={address} onChange={setAddress} errors={errors} />

      {isRestaurant && (
        <>
          <h3 className="sub-title">お店の位置（地図で探すときの中心）</h3>
          <p className="field-hint">住所から候補を探し、ずれていれば地図をタップして直してください。他の利用者には公開しません。</p>
          <div className="actions">
            <button type="button" className="btn btn-small" onClick={() => void findOnMap()} disabled={finding}>
              <MapPinned aria-hidden="true" />
              {finding ? '探しています…' : '住所から位置を探す'}
            </button>
            {storePos && (
              <button type="button" className="btn btn-small btn-quiet" onClick={() => setStorePos(null)}>
                位置を消す
              </button>
            )}
          </div>
          {findProblem && <Notice kind="warn">{<p>{findProblem}</p>}</Notice>}
          {places && (
            <div className="field" role="group" aria-label="位置の候補">
              {places.map((pl) => (
                <button
                  type="button"
                  key={`${pl.lat},${pl.lng}`}
                  className="btn btn-small btn-block"
                  onClick={() => {
                    setStorePos({ lat: pl.lat, lng: pl.lng })
                    setPlaces(null)
                  }}
                >
                  {pl.label}
                </button>
              ))}
            </div>
          )}
          <MapView
            small
            label="お店の位置の地図（タップで位置を指定）"
            center={storePos ?? DEFAULT_CENTER}
            zoom={storePos ? 15 : 10}
            markers={storePos ? [{ id: 'store', lat: storePos.lat, lng: storePos.lng, label: 'お店の位置', count: 0, selected: true }] : []}
            onMapClick={(pt) => setStorePos(pt)}
          />
          <p className="map-note">{storePos ? 'ピンの位置で保存します。「保存する」を押すと反映されます。' : 'まだ位置が登録されていません。'}</p>
        </>
      )}

      {p && (
        <>
          <h3 className="sub-title">飲食店に公開する連絡先（任意）</h3>
          <p className="field-hint">
            「公開する」をオンにした項目だけが、あなたの出品を含む仕入れ案を見ている飲食店に表示され、相談用のコピー文面にも入ります。ユーザー名は公開されません。
          </p>
          <Field label="公開用の電話番号" error={errors.publicPhone}>
            <input className="input" type="tel" inputMode="tel" autoComplete="tel" maxLength={20} value={publicPhone} placeholder="例：072-000-0000" onChange={(e) => setPublicPhone(e.target.value)} />
            <label className="check">
              <input type="checkbox" checked={showPhone} onChange={(e) => setShowPhone(e.target.checked)} />
              <span>電話番号を飲食店に公開する</span>
            </label>
          </Field>
          <Field label="連絡用メールアドレス" error={errors.publicEmail}>
            <input className="input" type="email" inputMode="email" autoCapitalize="none" maxLength={100} value={publicEmail} onChange={(e) => setPublicEmail(e.target.value)} />
            <label className="check">
              <input type="checkbox" checked={showEmail} onChange={(e) => setShowEmail(e.target.checked)} />
              <span>メールアドレスを飲食店に公開する</span>
            </label>
          </Field>
          <Field label="連絡時の注意書き" error={errors.contactNote} hint="例：電話は平日9〜17時にお願いします">
            <input className="input" type="text" maxLength={100} value={contactNote} onChange={(e) => setContactNote(e.target.value)} />
          </Field>
        </>
      )}
      {result && <Notice kind={result.kind}>{<p>{result.message}</p>}</Notice>}
      <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
        {busy ? '保存中…' : '保存する'}
      </button>
    </form>
  )
}

/** 自分が受けた評価（公開中のレビューの平均・件数と一覧）。不適切なレビューは通報できる */
function MyReviews() {
  const [data, setData] = useState<{ summary: RatingSummary | null; reviews: ReviewDto[] } | null>(null)
  useEffect(() => {
    api<{ summary: RatingSummary | null; reviews: ReviewDto[] }>('/api/reviews?mine=1')
      .then(setData)
      .catch(() => setData({ summary: null, reviews: [] }))
  }, [])
  return (
    <section className="card">
      <h2 className="card-title">
        <Star size={20} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 4 }} />
        あなたの評価
      </h2>
      {!data ? (
        <p className="muted">読み込んでいます…</p>
      ) : (
        <>
          <p className="rating-big">{ratingText(data.summary)}</p>
          <p className="field-hint">取引完了後に、取引相手が投稿したレビューです。双方が投稿するか、取引完了から{REVIEW_PUBLISH_DAYS}日たつと公開されます。</p>
          <ul className="review-list">
            {data.reviews.map((r) => (
              <li key={r.id} className="review-item">
                <p>
                  <strong>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</strong> {r.reviewerName}
                </p>
                {r.comment && <p>{r.comment}</p>}
                <ReportButton target={{ type: 'REVIEW', id: r.id, label: `${r.reviewerName}のレビュー` }} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function UsernameSection({ user }: { user: SessionUser }) {
  const { setUser } = useSession()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const name = username.trim().toLowerCase()
    const next: Record<string, string> = {}
    if (!isValidUsername(name)) next.username = `半角の英小文字・数字・_ で${USERNAME_MIN}〜${USERNAME_MAX}文字、英字で始めてください`
    else if (name === user.username) next.username = '現在と同じユーザー名です'
    if (!password) next.password = '確認のため、現在のパスワードを入力してください'
    setErrors(next)
    setResult(null)
    if (Object.keys(next).length > 0) return
    setBusy(true)
    try {
      const res = await api<{ user: SessionUser | null }>('/api/me', { method: 'PUT', body: { username: name, password } })
      setUser(res.user)
      setUsername('')
      setPassword('')
      setResult({ kind: 'success', message: `ユーザー名を「${name}」に変更しました。次回のログインから、新しいユーザー名を使ってください。` })
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setResult({ kind: 'error', message: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="card form" onSubmit={submit} noValidate>
      <h2 className="card-title">ユーザー名の変更</h2>
      <p className="muted">
        現在のユーザー名：<strong className="current-username">{user.username}</strong>
      </p>
      <p className="field-hint">ログインに使う名前です。変更しても、出品・仕入れ希望の履歴・プロフィールはそのまま引き継がれます。他の利用者には表示されません。</p>
      <Field label="新しいユーザー名" required error={errors.username} hint={`半角の英小文字・数字・_ で${USERNAME_MIN}〜${USERNAME_MAX}文字、英字で始める`}>
        <input className="input" type="text" name="new-username" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={USERNAME_MAX} value={username} onChange={(e) => setUsername(e.target.value)} />
      </Field>
      <Field label="現在のパスワード" required error={errors.password}>
        <input className="input" type="password" name="rename-password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {result && <Notice kind={result.kind}>{<p>{result.message}</p>}</Notice>}
      <button className="btn btn-block" type="submit" disabled={busy}>
        {busy ? '変更中…' : 'ユーザー名を変更する'}
      </button>
    </form>
  )
}

function RecoverySection() {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!password) return setError('確認のため、現在のパスワードを入力してください。')
    if (!window.confirm('新しいリカバリーコードを発行すると、これまでのコードは使えなくなります。発行しますか？')) return
    setBusy(true)
    setError(null)
    try {
      const result = await api<{ recoveryCode: string }>('/api/recovery', { method: 'PUT', body: { password } })
      setPassword('')
      setCode(result.recoveryCode)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  if (code) {
    return (
      <div className="card form">
        <RecoveryCodeNotice code={code} doneLabel="閉じる" onDone={() => setCode(null)} />
      </div>
    )
  }
  return (
    <form className="card form" onSubmit={submit} noValidate>
      <h2 className="card-title">リカバリーコード</h2>
      <p className="field-hint">
        パスワードを忘れたときに使うコードです。登録時に表示したコードを失くした場合や、他の人に見られた可能性がある場合は、新しく発行してください。これまでのコードは使えなくなります。
      </p>
      <Field label="現在のパスワード" required>
        <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {error && <Notice kind="error">{<p>{error}</p>}</Notice>}
      <button className="btn btn-block" type="submit" disabled={busy}>
        {busy ? '発行中…' : '新しいリカバリーコードを発行する'}
      </button>
    </form>
  )
}

function PasswordSection() {
  const { master } = useSession()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!current) return setResult({ kind: 'error', message: '現在のパスワードを入力してください。' })
    if (next.length < master.minPasswordLength) {
      return setResult({ kind: 'error', message: `新しいパスワードは${master.minPasswordLength}文字以上で入力してください。` })
    }
    setBusy(true)
    setResult(null)
    const { error } = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true })
    setBusy(false)
    if (error) return setResult({ kind: 'error', message: authErrorMessage(error) })
    setCurrent('')
    setNext('')
    setResult({ kind: 'success', message: 'パスワードを変更しました。他の端末でのログインは無効になりました。' })
  }
  return (
    <form className="card form" onSubmit={submit} noValidate>
      <h2 className="card-title">パスワードの変更</h2>
      <Field label="現在のパスワード" required>
        <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      <Field label="新しいパスワード" required hint={`${master.minPasswordLength}文字以上`}>
        <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
      {result && <Notice kind={result.kind}>{<p>{result.message}</p>}</Notice>}
      <button className="btn btn-block" type="submit" disabled={busy}>
        {busy ? '変更中…' : 'パスワードを変更する'}
      </button>
    </form>
  )
}

function DeleteSection({ user }: { user: SessionUser }) {
  const { logout } = useSession()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!password) return setError('確認のため、パスワードを入力してください。')
    if (!window.confirm('退会すると、アカウントと登録した情報がすべて削除され、元に戻せません。退会しますか？')) return
    setBusy(true)
    setError(null)
    const { error: authError } = await authClient.deleteUser({ password })
    if (authError) {
      setBusy(false)
      return setError(authErrorMessage(authError))
    }
    navigate('/', { replace: true })
    await logout().catch(() => undefined)
  }
  return (
    <details className="alternatives">
      <summary>退会する</summary>
      <form className="form" onSubmit={submit} noValidate>
        <p className="footnote">
          退会すると、アカウント、プロフィール、
          {user.role === 'PRODUCER' ? '出品' : '仕入れ希望の履歴'}
          などの登録情報がすべて削除されます。元に戻すことはできません。
        </p>
        <Field label="パスワード" required>
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <Notice kind="error">{<p>{error}</p>}</Notice>}
        <button className="btn btn-danger btn-block" type="submit" disabled={busy}>
          {busy ? '処理中…' : '退会してデータを削除する'}
        </button>
      </form>
    </details>
  )
}

export function Account() {
  const { user, logout } = useSession()
  const navigate = useNavigate()
  if (!user) return null
  return (
    <>
      <PageTitle icon={UserRound}>マイページ</PageTitle>
      <ProfileSection user={user} />
      {user.role !== 'ADMIN' && <MyReviews />}
      <UsernameSection user={user} />
      <PasswordSection />
      <RecoverySection />
      <button
        className="btn btn-large btn-block"
        onClick={async () => {
          // 先にトップ（新しいスタート画面）へ移ってからログアウトする（ログインが必要な画面に残ると、ログイン画面へ飛ばされるため）
          navigate('/', { replace: true })
          await logout().catch(() => undefined)
        }}
      >
        ログアウト
      </button>
      <DeleteSection user={user} />
    </>
  )
}
