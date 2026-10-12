import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { authClient, authErrorMessage } from '../auth-client.js'
import { Choice, Field, Notice } from '../components/ui.js'
import { homePath, useSession } from '../session.js'

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)

function PasswordInput({
  value,
  onChange,
  autoComplete,
  label,
}: {
  value: string
  onChange: (value: string) => void
  autoComplete: 'current-password' | 'new-password'
  label: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="input-row">
      <input
        className="input"
        type={show ? 'text' : 'password'}
        aria-label={label}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" className="btn btn-small btn-quiet" onClick={() => setShow((s) => !s)}>
        {show ? '隠す' : '表示'}
      </button>
    </div>
  )
}

/** 確認メールを送ったあとの案内。再送もできる。 */
function CheckEmail({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const resend = async () => {
    setState('sending')
    const { error } = await authClient.sendVerificationEmail({ email, callbackURL: '/' })
    if (error) {
      setMessage(authErrorMessage(error))
      setState('error')
    } else setState('sent')
  }
  return (
    <>
      <h1 className="page-title">メールをご確認ください</h1>
      <Notice kind="success" title="確認用のメールを送りました">
        <p>
          <strong>{email}</strong> 宛てのメールにあるリンクを開くと、登録が完了してログインできます（有効期限：1時間）。
        </p>
      </Notice>
      <ul className="help-list">
        <li>数分待っても届かない場合は、迷惑メールのフォルダもご確認ください。</li>
        <li>既に登録済みのメールアドレスの場合、確認メールは届きません。ログインをお試しください。</li>
      </ul>
      {state === 'sent' && <Notice kind="info">{<p>もう一度送りました。</p>}</Notice>}
      {state === 'error' && <Notice kind="error">{<p>{message}</p>}</Notice>}
      <div className="actions">
        <button className="btn btn-large" onClick={resend} disabled={state === 'sending'}>
          {state === 'sending' ? '送信中…' : '確認メールをもう一度送る'}
        </button>
        <Link className="btn btn-large btn-quiet" to="/login">
          ログイン画面へ
        </Link>
      </div>
    </>
  )
}

export function Login() {
  const { refresh } = useSession()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unverified, setUnverified] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!isEmail(email.trim()) || !password) return setError('メールアドレスとパスワードを入力してください。')
    setBusy(true)
    setError(null)
    const { error: authError } = await authClient.signIn.email({ email: email.trim(), password })
    if (authError) {
      setBusy(false)
      // 未確認の場合は、サーバーが確認メールを送り直している
      if (authError.code === 'EMAIL_NOT_VERIFIED') return setUnverified(true)
      return setError(authErrorMessage(authError))
    }
    try {
      const user = await refresh()
      if (user) navigate(homePath(user), { replace: true })
      else setError('アカウントの情報を読み込めませんでした。もう一度お試しください。')
    } catch {
      setError('通信できませんでした。もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  if (unverified) return <CheckEmail email={email.trim()} />

  return (
    <form className="form" onSubmit={submit} noValidate>
      <h1 className="page-title">ログイン</h1>
      {error && <Notice kind="error">{<p>{error}</p>}</Notice>}
      <Field label="メールアドレス" required>
        <input className="input" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="パスワード" required>
        <PasswordInput label="パスワード" value={password} onChange={setPassword} autoComplete="current-password" />
      </Field>
      <div className="actions">
        <button className="btn btn-primary btn-large" type="submit" disabled={busy}>
          {busy ? 'ログイン中…' : 'ログイン'}
        </button>
      </div>
      <p className="link-row">
        <Link to="/forgot-password">パスワードを忘れた方</Link>
        <Link to="/signup">新規登録はこちら</Link>
      </p>
    </form>
  )
}

export function Signup() {
  const { master } = useSession()
  const [role, setRole] = useState<'RESTAURANT' | 'PRODUCER' | null>(null)
  const [orgName, setOrgName] = useState('')
  const [area, setArea] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [invite, setInvite] = useState('')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // 入力し直したら、前回のエラー表示を消す
  useEffect(() => setErrors({}), [role, orgName, area, email, password, invite, agree])

  if (master.signupMode === 'closed') {
    return (
      <>
        <h1 className="page-title">新規登録</h1>
        <Notice kind="info" title="新規登録は準備中です">
          <p>現在、一般の方の新規登録は受け付けていません。公開までしばらくお待ちください。</p>
        </Notice>
        <Link className="btn btn-large" to="/login">
          ログイン画面へ
        </Link>
      </>
    )
  }
  if (done) return <CheckEmail email={email.trim()} />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const next: Record<string, string> = {}
    if (!role) next.role = 'どちらかを選択してください'
    if (!orgName.trim() || orgName.trim().length > 40) next.orgName = '1〜40文字で入力してください'
    if (!area.trim() || area.trim().length > 40) next.area = '1〜40文字で入力してください'
    if (!isEmail(email.trim())) next.email = 'メールアドレスの形式を確認してください'
    if (password.length < master.minPasswordLength) next.password = `${master.minPasswordLength}文字以上で入力してください`
    if (master.signupMode === 'invite' && !invite.trim()) next.invite = '招待コードを入力してください'
    if (!agree) next.agree = '同意が必要です'
    setErrors(next)
    setProblem(null)
    if (Object.keys(next).length > 0) return

    setBusy(true)
    const { error } = await authClient.signUp.email(
      { email: email.trim(), password, name: orgName.trim(), signupRole: role!, orgName: orgName.trim(), area: area.trim(), callbackURL: '/' },
      { headers: master.signupMode === 'invite' ? { 'x-invite-code': invite.trim() } : undefined },
    )
    setBusy(false)
    if (error) return setProblem(authErrorMessage(error))
    setDone(true)
    window.scrollTo(0, 0)
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <h1 className="page-title">新規登録</h1>
      {master.signupMode === 'invite' && (
        <Notice kind="info" title="公開前の検証中です">
          <p>現在は、招待コードをお持ちの関係者の方だけが登録できます。</p>
        </Notice>
      )}
      {problem && <Notice kind="error">{<p>{problem}</p>}</Notice>}

      <Field label="ご利用の種類" required error={errors.role} hint="登録後は変更できません。">
        <Choice<'RESTAURANT' | 'PRODUCER'>
          label="ご利用の種類"
          value={role}
          onChange={setRole}
          options={[
            { value: 'RESTAURANT', label: '飲食店', sub: '仕入れ案を作る' },
            { value: 'PRODUCER', label: '生産者', sub: '販売できるものを登録' },
          ]}
        />
      </Field>
      <Field label={role === 'PRODUCER' ? '農園名・屋号' : '店舗名'} required error={errors.orgName}>
        <input className="input" type="text" autoComplete="organization" maxLength={40} value={orgName} onChange={(e) => setOrgName(e.target.value)} />
      </Field>
      <Field label="地域（市区町村）" required error={errors.area} hint="例：大阪市福島区、能勢町">
        <input className="input" type="text" maxLength={40} value={area} onChange={(e) => setArea(e.target.value)} />
      </Field>
      <Field label="メールアドレス" required error={errors.email} hint="確認用のメールをお送りします。ログインにも使います。">
        <input className="input" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="パスワード" required error={errors.password} hint={`${master.minPasswordLength}文字以上。他のサービスと同じものは使わないでください。`}>
        <PasswordInput label="パスワード" value={password} onChange={setPassword} autoComplete="new-password" />
      </Field>
      {master.signupMode === 'invite' && (
        <Field label="招待コード" required error={errors.invite}>
          <input className="input" type="text" autoComplete="off" autoCapitalize="none" value={invite} onChange={(e) => setInvite(e.target.value)} />
        </Field>
      )}
      {role === 'PRODUCER' && (
        <Notice kind="info" title="生産者の方へ">
          <p>登録後、運営者による確認があります。確認が済むまでの間も出品の準備はできますが、飲食店の仕入れ案には表示されません。</p>
        </Notice>
      )}
      <div className={errors.agree ? 'field field-invalid' : 'field'}>
        <label className="check">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>
            <Link to="/terms" target="_blank">
              利用規約
            </Link>
            と
            <Link to="/privacy" target="_blank">
              プライバシーポリシー
            </Link>
            に同意します
          </span>
        </label>
        {errors.agree && (
          <p className="field-error" role="alert">
            {errors.agree}
          </p>
        )}
      </div>
      <div className="actions">
        <button className="btn btn-primary btn-large" type="submit" disabled={busy}>
          {busy ? '登録中…' : '登録して確認メールを受け取る'}
        </button>
      </div>
      <p className="link-row">
        <Link to="/login">登録済みの方はログイン</Link>
      </p>
    </form>
  )
}

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!isEmail(email.trim())) return setError('メールアドレスの形式を確認してください。')
    setBusy(true)
    setError(null)
    const { error: authError } = await authClient.requestPasswordReset({ email: email.trim(), redirectTo: '/reset-password' })
    setBusy(false)
    if (authError) return setError(authErrorMessage(authError))
    setSent(true)
  }

  if (sent) {
    return (
      <>
        <h1 className="page-title">メールをご確認ください</h1>
        <Notice kind="success" title="再設定用のメールを送りました">
          <p>登録済みのメールアドレスの場合、パスワード再設定のリンクが届きます（有効期限：1時間）。届かない場合は、アドレスの入力間違いや迷惑メールのフォルダをご確認ください。</p>
        </Notice>
        <Link className="btn btn-large" to="/login">
          ログイン画面へ
        </Link>
      </>
    )
  }
  return (
    <form className="form" onSubmit={submit} noValidate>
      <h1 className="page-title">パスワードの再設定</h1>
      <p className="page-lead">登録したメールアドレスに、再設定用のリンクをお送りします。</p>
      {error && <Notice kind="error">{<p>{error}</p>}</Notice>}
      <Field label="メールアドレス" required>
        <input className="input" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <div className="actions">
        <button className="btn btn-primary btn-large" type="submit" disabled={busy}>
          {busy ? '送信中…' : '再設定用のメールを送る'}
        </button>
        <Link className="btn btn-large btn-quiet" to="/login">
          戻る
        </Link>
      </div>
    </form>
  )
}

export function ResetPassword() {
  const { master, logout } = useSession()
  const [params] = useSearchParams()
  const token = params.get('token')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(params.get('error') ? 'リンクの有効期限が切れているか、既に使われています。' : null)
  const [done, setDone] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < master.minPasswordLength) return setError(`パスワードは${master.minPasswordLength}文字以上で入力してください。`)
    setBusy(true)
    setError(null)
    const { error: authError } = await authClient.resetPassword({ newPassword: password, token: token! })
    setBusy(false)
    if (authError) return setError(authErrorMessage(authError))
    // 再設定で他の端末のログインは無効になる。この端末もログインし直してもらう。
    await logout().catch(() => undefined)
    setDone(true)
  }

  if (done) {
    return (
      <>
        <h1 className="page-title">パスワードを変更しました</h1>
        <Notice kind="success">{<p>新しいパスワードでログインしてください。他の端末でのログインは無効になりました。</p>}</Notice>
        <Link className="btn btn-primary btn-large" to="/login">
          ログイン画面へ
        </Link>
      </>
    )
  }
  if (!token) {
    return (
      <>
        <h1 className="page-title">パスワードの再設定</h1>
        <Notice kind="error">{<p>{error ?? 'リンクが正しくありません。'} もう一度、再設定用のメールをお申し込みください。</p>}</Notice>
        <Link className="btn btn-large" to="/forgot-password">
          再設定をやり直す
        </Link>
      </>
    )
  }
  return (
    <form className="form" onSubmit={submit} noValidate>
      <h1 className="page-title">新しいパスワードの設定</h1>
      {error && <Notice kind="error">{<p>{error}</p>}</Notice>}
      <Field label="新しいパスワード" required hint={`${master.minPasswordLength}文字以上`}>
        <PasswordInput label="新しいパスワード" value={password} onChange={setPassword} autoComplete="new-password" />
      </Field>
      <div className="actions">
        <button className="btn btn-primary btn-large" type="submit" disabled={busy}>
          {busy ? '変更中…' : 'パスワードを変更する'}
        </button>
      </div>
    </form>
  )
}
