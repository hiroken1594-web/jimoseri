import { ClipboardList, Flag, Heart, Layers, Map, MapPin, ShieldCheck, Sprout, Store, User, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import type { Role } from '../../shared/dto.js'
import { useSession } from '../session.js'

const ROLE_LABEL: Record<Role, string> = { PRODUCER: '生産者', RESTAURANT: '飲食店', ADMIN: '運営者' }
const ROLE_CLASS: Record<Role, string> = { PRODUCER: 'role-producer', RESTAURANT: 'role-restaurant', ADMIN: 'role-admin' }
const ROLE_ICON: Record<Role, LucideIcon> = { PRODUCER: Sprout, RESTAURANT: Store, ADMIN: ShieldCheck }

// スマートフォンでは画面下のタブ、PCでは上部のメニューとして表示する（同じ HTML を CSS で切り替える）
const NAV: Record<Role, { to: string; label: string; icon: LucideIcon; end?: boolean }[]> = {
  RESTAURANT: [
    { to: '/restaurant', label: '仕入れ案', icon: ClipboardList, end: true },
    { to: '/restaurant/map', label: '地図', icon: Map },
    { to: '/restaurant/discover', label: '発見', icon: Layers },
    { to: '/restaurant/favorites', label: '気になる', icon: Heart },
    { to: '/account', label: 'マイページ', icon: User },
  ],
  PRODUCER: [
    { to: '/producer', label: '出品', icon: Sprout, end: true },
    { to: '/producer/locations', label: '受渡拠点', icon: MapPin },
    { to: '/account', label: 'マイページ', icon: User },
  ],
  ADMIN: [
    { to: '/admin', label: '審査・管理', icon: ShieldCheck, end: true },
    { to: '/admin/reports', label: '通報', icon: Flag },
    { to: '/account', label: 'マイページ', icon: User },
  ],
}

function Brand() {
  return (
    <Link to="/" className="brand" aria-label="AI地域商社 トップへ">
      <span className="brand-mark" aria-hidden="true">
        <Sprout size={20} />
      </span>
      AI地域商社
    </Link>
  )
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
export function Layout({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const { user } = useSession()
  if (!user) return null
  const RoleIcon = ROLE_ICON[user.role]
  return (
    <div className={`app has-tabbar ${ROLE_CLASS[user.role]}`}>
      <a className="skip-link" href="#main">
        本文へ移動
      </a>
      <header className="app-header">
        <div className="app-header-inner">
          <Brand />
          <span className="role-badge">
            <RoleIcon size={14} aria-hidden="true" />
            {ROLE_LABEL[user.role]}
          </span>
          <span className="app-header-name">{user.orgName}</span>
        </div>
      </header>
      <nav className="app-nav" aria-label="メニュー">
        {NAV[user.role].map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'is-active' : '')}>
            <Icon aria-hidden="true" />
            <span className="nav-label">{label}</span>
          </NavLink>
        ))}
      </nav>
      <main id="main" className={wide ? 'page page-wide' : 'page'} tabIndex={-1}>
        {children}
      </main>
      <Footer />
    </div>
  )
}

/** ログイン前の画面の枠 */
export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <a className="skip-link" href="#main">
        本文へ移動
      </a>
      <header className="public-header">
        <Brand />
      </header>
      <main id="main" className="page" tabIndex={-1}>
        {children}
      </main>
      <Footer />
    </div>
  )
}
