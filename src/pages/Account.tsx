import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ReviewStatus, SessionUser } from '../../shared/dto.js'
import type { ProfileInput } from '../../shared/schemas.js'
import { api, ApiError, errorMessage } from '../api.js'
import { authClient, authErrorMessage } from '../auth-client.js'
import { Field, Notice } from '../components/ui.js'
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
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    setResult(null)
    const body: ProfileInput = { orgName, area }
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

      {p && (
        <>
          <h3 className="sub-title">飲食店に公開する連絡先（任意）</h3>
          <p className="field-hint">
            「公開する」をオンにした項目だけが、あなたの出品を含む仕入れ案を見ている飲食店に表示され、相談用のコピー文面にも入ります。ログイン用のメールアドレスは公開されません。
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

function EmailSection({ user }: { user: SessionUser }) {
  const [newEmail, setNewEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) return setResult({ kind: 'error', message: 'メールアドレスの形式を確認してください。' })
    setBusy(true)
    setResult(null)
    const { error } = await authClient.changeEmail({ newEmail: newEmail.trim(), callbackURL: '/account' })
    setBusy(false)
    if (error) return setResult({ kind: 'error', message: authErrorMessage(error) })
    setNewEmail('')
    setResult({ kind: 'success', message: '確認用のメールを送りました。メール内のリンクを開くと、変更が完了します。' })
  }
  return (
    <form className="card form" onSubmit={submit} noValidate>
      <h2 className="card-title">ログイン用メールアドレス</h2>
      <p className="muted">現在：{user.email}</p>
      <Field label="新しいメールアドレス" required>
        <input className="input" type="email" inputMode="email" autoCapitalize="none" autoComplete="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
      </Field>
      {result && <Notice kind={result.kind}>{<p>{result.message}</p>}</Notice>}
      <button className="btn btn-block" type="submit" disabled={busy}>
        {busy ? '送信中…' : '変更の確認メールを送る'}
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
      <h1 className="page-title">マイページ</h1>
      <ProfileSection user={user} />
      <EmailSection user={user} />
      <PasswordSection />
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
