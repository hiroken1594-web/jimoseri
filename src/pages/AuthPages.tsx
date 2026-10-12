import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { isValidUsername, USERNAME_MAX, USERNAME_MIN } from '../../shared/limits.js'
import type { SignupInput } from '../../shared/schemas.js'
import { api, ApiError, errorMessage } from '../api.js'
import { authClient, authErrorMessage } from '../auth-client.js'
import { Choice, Field, Notice } from '../components/ui.js'
import { homePath, useSession } from '../session.js'

export function PasswordInput({
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

/**
 * リカバリーコードの表示。発行した直後に一度だけ表示し、控えたことを確認してから先へ進める。
 * サーバーにはコードそのものを保存していないため、後から表示し直すことはできない。
 */
export function RecoveryCodeNotice({ code, onDone, doneLabel }: { code: string; onDone: () => void; doneLabel: string }) {
  const [kept, setKept] = useState(false)
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  return (
    <>
      <h1 className="page-title">リカバリーコードを控えてください</h1>
      <Notice kind="warn" title="このコードは、いま一度だけ表示されます">
        <p>
          パスワードを忘れたときに、このコードで新しいパスワードを設定できます。このサービスはメールを使わないため、
          <strong>パスワードとこのコードの両方を失くすと、ご自身ではログインできなくなります。</strong>
        </p>
      </Notice>
      <p className="recovery-code" aria-label="リカバリーコード">
        {code}
      </p>
      <button className="btn btn-block" onClick={copy}>
        {copied ? 'コピーしました' : 'コードをコピー'}
      </button>
      <ul className="help-list">
        <li>紙に書く、パスワード管理アプリに保存するなど、他の人に見られない場所に保管してください。</li>
        <li>コードを知っている人は、あなたのパスワードを変更できます。人に教えないでください。</li>
        <li>マイページから、いつでも新しいコードに作り直せます（古いコードは使えなくなります）。</li>
      </ul>
      <label className="check check-box">
        <input type="checkbox" checked={kept} onChange={(e) => setKept(e.target.checked)} />
        <span>
          <strong>リカバリーコードを控えました</strong>
        </span>
      </label>
      <button className="btn btn-primary btn-large" disabled={!kept} onClick={onDone}>
        {doneLabel}
      </button>
    </>
  )
}

export function Login() {
  const { refresh } = useSession()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) return setError('ユーザー名とパスワードを入力してください。')
    setBusy(true)
    setError(null)
    const { error: authError } = await authClient.signIn.username({ username: username.trim().toLowerCase(), password })
    if (authError) {
      setBusy(false)
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

  return (
    <form className="form" onSubmit={submit} noValidate>
      <h1 className="page-title">ログイン</h1>
      {error && <Notice kind="error">{<p>{error}</p>}</Notice>}
      <Field label="ユーザー名" required>
        <input className="input" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} />
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
  const { master, refresh } = useSession()
  const navigate = useNavigate()
  const [role, setRole] = useState<'RESTAURANT' | 'PRODUCER' | null>(null)
  const [orgName, setOrgName] = useState('')
  const [area, setArea] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [invite, setInvite] = useState('')
  const [website, setWebsite] = useState('')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null)

  // 入力し直したら、前回のエラー表示を消す
  useEffect(() => setErrors({}), [role, orgName, area, username, password, invite, agree])

  if (recoveryCode) {
    return (
      <RecoveryCodeNotice
        code={recoveryCode}
        doneLabel="利用を始める"
        onDone={async () => {
          // ここで初めてログイン状態を読み込み、役割に応じた画面へ進む
          const user = await refresh().catch(() => null)
          navigate(homePath(user), { replace: true })
        }}
      />
    )
  }
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

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const name = username.trim().toLowerCase()
    const next: Record<string, string> = {}
    if (!role) next.role = 'どちらかを選択してください'
    if (!orgName.trim() || orgName.trim().length > 40) next.orgName = '1〜40文字で入力してください'
    if (!area.trim() || area.trim().length > 40) next.area = '1〜40文字で入力してください'
    if (!isValidUsername(name)) next.username = `半角の英小文字・数字・_ で${USERNAME_MIN}〜${USERNAME_MAX}文字、英字で始めてください`
    if (password.length < master.minPasswordLength) next.password = `${master.minPasswordLength}文字以上で入力してください`
    else if (password.toLowerCase().includes(name) && name.length >= USERNAME_MIN) next.password = 'ユーザー名を含まないパスワードにしてください'
    if (master.signupMode === 'invite' && !invite.trim()) next.inviteCode = '招待コードを入力してください'
    if (!agree) next.agree = '同意が必要です'
    setErrors(next)
    setProblem(null)
    if (Object.keys(next).length > 0) return

    setBusy(true)
    try {
      const body: SignupInput = { username: name, password, role: role!, orgName: orgName.trim(), area: area.trim(), inviteCode: invite.trim() || undefined, website }
      const result = await api<{ recoveryCode: string }>('/api/signup', { body })
      setRecoveryCode(result.recoveryCode)
      window.scrollTo(0, 0)
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields)
      setProblem(errorMessage(err))
    } finally {
      setBusy(false)
    }
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
        <input className="input" type="text" name="area" maxLength={40} value={area} onChange={(e) => setArea(e.target.value)} />
      </Field>
      <Field
        label="ユーザー名"
        required
        error={errors.username}
        hint={`ログインに使います。半角の英小文字・数字・_ で${USERNAME_MIN}〜${USERNAME_MAX}文字。登録後は変更できません。他の利用者には表示されません。`}
      >
        <input
          className="input"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={USERNAME_MAX}
          value={username}
          placeholder="例：mikami_fukushima"
          onChange={(e) => setUsername(e.target.value)}
        />
      </Field>
      <Field label="パスワード" required error={errors.password} hint={`${master.minPasswordLength}文字以上。他のサービスと同じものは使わないでください。`}>
        <PasswordInput label="パスワード" value={password} onChange={setPassword} autoComplete="new-password" />
      </Field>
      {master.signupMode === 'invite' && (
        <Field label="招待コード" required error={errors.inviteCode}>
          <input className="input" type="text" autoComplete="off" autoCapitalize="none" value={invite} onChange={(e) => setInvite(e.target.value)} />
        </Field>
      )}
      {/* 人には見えない入力欄。自動登録プログラムが埋めた場合は、サーバーが登録を拒否する。 */}
      <div className="visually-hidden" aria-hidden="true">
        <label>
          ウェブサイト（入力しないでください）
          <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>
      {role === 'PRODUCER' && (
        <Notice kind="info" title="生産者の方へ">
          <p>登録後、運営者による確認があります。確認が済むまでの間も出品の準備はできますが、飲食店の仕入れ案には表示されません。</p>
        </Notice>
      )}
      <Notice kind="info" title="メールアドレスは不要です">
        <p>登録が終わると「リカバリーコード」を一度だけ表示します。パスワードを忘れたときに必要になるので、必ず控えてください。</p>
      </Notice>
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
          {busy ? '登録中…' : '登録する'}
        </button>
      </div>
      <p className="link-row">
        <Link to="/login">登録済みの方はログイン</Link>
      </p>
    </form>
  )
}

/** パスワードを忘れたとき：ユーザー名とリカバリーコードで新しいパスワードを設定する */
export function ForgotPassword() {
  const { master, setUser } = useSession()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newCode, setNewCode] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !code.trim()) return setError('ユーザー名とリカバリーコードを入力してください。')
    if (password.length < master.minPasswordLength) return setError(`新しいパスワードは${master.minPasswordLength}文字以上で入力してください。`)
    setBusy(true)
    setError(null)
    try {
      const result = await api<{ recoveryCode: string }>('/api/recovery', {
        body: { username: username.trim().toLowerCase(), recoveryCode: code.trim(), newPassword: password },
      })
      // 再設定で、すべての端末のログインは無効になっている
      setUser(null)
      setNewCode(result.recoveryCode)
      window.scrollTo(0, 0)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (newCode) {
    return (
      <>
        <Notice kind="success" title="パスワードを変更しました">
          <p>使ったリカバリーコードは無効になりました。下の新しいコードを控えてから、新しいパスワードでログインしてください。</p>
        </Notice>
        <RecoveryCodeNotice code={newCode} doneLabel="ログイン画面へ" onDone={() => navigate('/login', { replace: true })} />
      </>
    )
  }
  return (
    <form className="form" onSubmit={submit} noValidate>
      <h1 className="page-title">パスワードを忘れた方</h1>
      <p className="page-lead">登録したときに表示された「リカバリーコード」を使って、新しいパスワードを設定します。</p>
      {error && <Notice kind="error">{<p>{error}</p>}</Notice>}
      <Field label="ユーザー名" required>
        <input className="input" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} />
      </Field>
      <Field label="リカバリーコード" required hint="ハイフンや大文字・小文字の違いは気にせず入力できます。">
        <input className="input input-code" type="text" autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} value={code} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" onChange={(e) => setCode(e.target.value)} />
      </Field>
      <Field label="新しいパスワード" required hint={`${master.minPasswordLength}文字以上`}>
        <PasswordInput label="新しいパスワード" value={password} onChange={setPassword} autoComplete="new-password" />
      </Field>
      <div className="actions">
        <button className="btn btn-primary btn-large" type="submit" disabled={busy}>
          {busy ? '変更中…' : 'パスワードを変更する'}
        </button>
        <Link className="btn btn-large btn-quiet" to="/login">
          戻る
        </Link>
      </div>
      <Notice kind="info" title="リカバリーコードも失くした場合">
        <p>
          このサービスはメールアドレスを登録しないため、ご自身では再設定できません。
          {master.operator ? `運営者（${master.operator.email}）へご連絡ください。ご本人であることを確認したうえで、新しいコードを発行します。` : '運営者へご連絡ください。ご本人であることを確認したうえで、新しいコードを発行します。'}
        </p>
      </Notice>
    </form>
  )
}
