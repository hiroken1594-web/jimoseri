import { ArrowRight, LogIn, Sprout, Store, UserPlus } from 'lucide-react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { homePath, useSession } from '../session.js'
import { welcomeSeen } from './Welcome.js'

/**
 * 役割の選択。飲食店（緑）と生産者（オレンジ）から選んで、新規登録またはログインへ進む。
 * ここで選んだ役割は登録画面の初期値になるだけで、ログイン後の画面はサーバーが記録している役割で決まる。
 */
export function Start() {
  const { master, user, logout } = useSession()
  const navigate = useNavigate()
  const open = master.signupMode !== 'closed'
  // はじめての方には、まず使い方の案内（4ステップ）を出す（ログイン中の方には出さない）
  if (!user && !welcomeSeen()) return <Navigate to="/guide" replace />
  const roleLabel = user ? { RESTAURANT: '飲食店', PRODUCER: '生産者', ADMIN: '運営者' }[user.role] : ''
  return (
    <div className="start">
      {user && (
        <div className="start-signed-in" role="status">
          <p>
            <strong>{user.orgName}</strong>（{roleLabel}）としてログイン中です。
          </p>
          <div className="actions">
            <Link className="btn btn-primary" to={homePath(user)}>
              自分の画面へ
              <ArrowRight aria-hidden="true" />
            </Link>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={async () => {
                await logout().catch(() => undefined)
                navigate('/', { replace: true })
              }}
            >
              ログアウト
            </button>
          </div>
        </div>
      )}
      <h1 className="start-title">どちらで使いますか？</h1>
      <div className="start-circles">
        <section className="role-circle role-circle-green" aria-labelledby="start-restaurant">
          <Store className="role-circle-icon" aria-hidden="true" />
          <h2 id="start-restaurant">飲食店の方</h2>
          <p>近くの農産物を探して、仕入れ案を作る</p>
          <div className="role-circle-actions">
            {open && (
              <Link className="btn btn-on-green" to="/signup?role=RESTAURANT">
                <UserPlus aria-hidden="true" />
                新規登録
              </Link>
            )}
            <Link className="btn btn-outline-light" to="/login?role=RESTAURANT">
              <LogIn aria-hidden="true" />
              ログイン
            </Link>
          </div>
        </section>
        <section className="role-circle role-circle-orange" aria-labelledby="start-producer">
          <Sprout className="role-circle-icon" aria-hidden="true" />
          <h2 id="start-producer">生産者の方</h2>
          <p>販売できる農産物を登録する</p>
          <div className="role-circle-actions">
            {open && (
              <Link className="btn btn-on-orange" to="/signup?role=PRODUCER">
                <UserPlus aria-hidden="true" />
                新規登録
              </Link>
            )}
            <Link className="btn btn-outline-dark" to="/login?role=PRODUCER">
              <LogIn aria-hidden="true" />
              ログイン
            </Link>
          </div>
        </section>
      </div>
      <p className="footnote">ログイン後の画面は、登録したときの種類で決まります（あとから変更はできません）。</p>
      <p className="link-row">
        <Link to="/guide">使い方ガイドを見る</Link>
      </p>
    </div>
  )
}
