import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import type { Role } from '../../shared/dto.js'
import { useSession } from '../session.js'

const ROLE_LABEL: Record<Role, string> = { PRODUCER: '生産者', RESTAURANT: '飲食店', ADMIN: '運営者' }
const ROLE_CLASS: Record<Role, string> = { PRODUCER: 'role-producer', RESTAURANT: 'role-restaurant', ADMIN: 'role-admin' }
const NAV: Record<Role, { to: string; label: string; end?: boolean }[]> = {
  RESTAURANT: [
    { to: '/restaurant', label: '仕入れ案を作る', end: true },
    { to: '/restaurant/history', label: '履歴' },
    { to: '/account', label: 'マイページ' },
  ],
  PRODUCER: [
    { to: '/producer', label: '販売できるもの', end: true },
    { to: '/account', label: 'マイページ' },
  ],
  ADMIN: [
    { to: '/admin', label: '審査・管理', end: true },
    { to: '/account', label: 'マイページ' },
  ],
}

function Footer() {
  return (
    <footer className="app-footer">
      <Link to="/terms">利用規約</Link>
      <Link to="/privacy">プライバシーポリシー</Link>
    </footer>
  )
}

/** ログイン後の画面の枠。役割ごとに色とメニューを変える。 */
export function Layout({ children }: { children: ReactNode }) {
  const { user } = useSession()
  if (!user) return null
  return (
    <div className={`app ${ROLE_CLASS[user.role]}`}>
      <header className="app-header">
        <div className="app-header-inner">
          <span className="role-badge">{ROLE_LABEL[user.role]}</span>
          <span className="app-header-name">{user.orgName}</span>
        </div>
        <nav className="app-nav" aria-label="メニュー">
          {NAV[user.role].map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'is-active' : '')}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="page">{children}</main>
      <Footer />
    </div>
  )
}

/** ログイン前の画面の枠 */
export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <header className="public-header">
        <Link to="/" className="brand">
          AI地域商社
        </Link>
      </header>
      <main className="page">{children}</main>
      <Footer />
    </div>
  )
}
