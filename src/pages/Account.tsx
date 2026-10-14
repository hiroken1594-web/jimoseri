import { UserRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ReviewStatus, SessionUser } from '../../shared/dto.js'
import { isValidUsername, USERNAME_MAX, USERNAME_MIN } from '../../shared/limits.js'
import type { ProfileInput } from '../../shared/schemas.js'
import { api, ApiError, errorMessage } from '../api.js'
import { authClient, authErrorMessage } from '../auth-client.js'
import { AddressFields, type AddressValue } from '../components/AddressFields.js'
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

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    setResult(null)
    const body: ProfileInput = { orgName, area, ...address }
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

      <h3 className="sub-title">住所（任意・非公開）</h3>
      <p className="field-hint">
        運営者からの確認などのために登録できます。他の利用者には表示されず、地図にも出ません。受渡場所として公開する住所は「受渡拠点」で別に登録します。
      </p>
      <AddressFields idPrefix="profile" value={address} onChange={setAddress} errors={errors} />

      {p && (
        <>
          <h3 className="sub-title">飲食店に公開する連絡先（任意）</h3>
          <p className="field-hint">
            「公開する」をオンにした項目だけが、あなたの出品を含む仕入れ案を見ている飲食店に表示され、相談用のコピー文面にも入ります。ユーザー名は公開されません。
          </p>
          <Field label="電話番号" error={errors.publicPhone}>
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
    await logout().catch(() => undefined)
    navigate('/', { replace: true })
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
      <UsernameSection user={user} />
      <PasswordSection />
      <RecoverySection />
      <button
        className="btn btn-large btn-block"
        onClick={async () => {
          await logout().catch(() => undefined)
          navigate('/', { replace: true })
        }}
      >
        ログアウト
      </button>
      <DeleteSection user={user} />
    </>
  )
}
