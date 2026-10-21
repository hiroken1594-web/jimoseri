import { Bell, ClipboardCheck, ClipboardList, Flag, Handshake, Heart, Layers, Map, MapPin, ShieldCheck, Sprout, Store, User, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import type { Role } from '../../shared/dto.js'
import { useMatchBadge, useNotificationCount, useQueueCount } from '../lib/matches.js'
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
    { to: '/matches', label: 'やりとり', icon: Handshake },
    { to: '/account', label: 'マイページ', icon: User },
  ],
  PRODUCER: [
    { to: '/producer', label: '出品', icon: Sprout, end: true },
    { to: '/producer/locations', label: '受渡拠点', icon: MapPin },
    { to: '/matches', label: '依頼', icon: Handshake },
    { to: '/account', label: 'マイページ', icon: User },
  ],
  ADMIN: [
    { to: '/admin/queue', label: '審査待ち', icon: ClipboardCheck },
    { to: '/admin', label: '管理', icon: ShieldCheck, end: true },
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
      <Link to="/guide">使い方ガイド</Link>
      <Link to="/terms">利用規約</Link>
      <Link to="/privacy">プライバシーポリシー</Link>
    </footer>
  )
}

/** ログイン後の画面の枠。役割ごとに色とメニューを変える。 */
export function Layout({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const { user } = useSession()
  const { pathname } = useLocation()
  // 新着（相手からの未読メッセージ・返事が必要な依頼）の数をメニューに出す
  const badge = useMatchBadge(Boolean(user) && user?.role !== 'ADMIN')
  const bell = useNotificationCount(Boolean(user) && user?.role !== 'ADMIN')
  // 運営者：審査待ちの件数（実際に確認待ちの申請の数）
  const queue = useQueueCount(user?.role === 'ADMIN')
  const badgeFor = (to: string) => (to === '/matches' ? badge : to === '/admin/queue' ? queue : 0)
  if (!user) return null
  // 以前に登録した方で、郵便番号が未登録の場合はマイページでの入力をお願いする
  // 住所に不足がある（以前に登録した方など）ときは、マイページでの入力をお願いする（ログインは止めない）
  const ad = user.address
  const addressIncomplete = !ad.postalCode || !ad.prefecture || !ad.city || !ad.town || !ad.addressLine || ad.building === null
  const needsAddress = user.role !== 'ADMIN' && addressIncomplete && pathname !== '/account'
  // 電話番号が未登録の方にも、マイページでの登録をお願いする（ログインは止めない）
  const needsPhone = user.role !== 'ADMIN' && !user.phone && pathname !== '/account'
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
          {user.role !== 'ADMIN' && (
            <Link to="/notifications" className="bell" aria-label={bell > 0 ? `お知らせ（未読${bell}件）` : 'お知らせ'}>
              <Bell aria-hidden="true" />
              {bell > 0 && <span className="nav-badge bell-badge">{bell > 99 ? '99+' : bell}</span>}
            </Link>
          )}
        </div>
      </header>
      <nav className="app-nav" aria-label="メニュー">
        {NAV[user.role].map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'is-active' : '')}>
            <Icon aria-hidden="true" />
            <span className="nav-label">{label}</span>
            {badgeFor(to) > 0 && (
              <span className="nav-badge" aria-label={to === '/admin/queue' ? `審査待ち${badgeFor(to)}件` : `新着${badgeFor(to)}件`}>
                {badgeFor(to) > 99 ? '99+' : badgeFor(to)}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      <main id="main" className={wide ? 'page page-wide' : 'page'} tabIndex={-1}>
        {needsAddress && (
          <p className="info-banner">
            {user.role === 'RESTAURANT' ? 'お店の住所に、入力されていない項目があります（郵便番号・町域・番地・建物名など）。' : '所在地の住所に、入力されていない項目があります（公開はされません）。'}
            <Link to="/account">マイページで入力する</Link>
          </p>
        )}
        {needsPhone && (
          <p className="info-banner">
            電話番号が未登録です（他の利用者には公開されません）。取引の連絡に使えるよう登録してください。
            <Link to="/account">マイページで登録する</Link>
          </p>
        )}
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
