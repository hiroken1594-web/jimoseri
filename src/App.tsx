import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import type { Role } from '../shared/dto.js'
import { Layout, PublicLayout } from './components/Layout.js'
import { Account } from './pages/Account.js'
import { Admin } from './pages/Admin.js'
import { ForgotPassword, Login, Signup } from './pages/AuthPages.js'
import { Start } from './pages/Start.js'
import { Welcome } from './pages/Welcome.js'
import { Privacy, Terms } from './pages/Legal.js'
import { ProducerForm } from './pages/ProducerForm.js'
import { ProducerList } from './pages/ProducerList.js'
import { RestaurantConfirm } from './pages/RestaurantConfirm.js'
import { RestaurantHistory } from './pages/RestaurantHistory.js'
import { RestaurantInput } from './pages/RestaurantInput.js'
import { RestaurantPlan } from './pages/RestaurantPlan.js'
import { homePath, useSession } from './session.js'
import { Loading } from './components/ui.js'

// 地図を使う画面は、地図のライブラリと一緒に必要になったときだけ読み込む（最初の表示を軽くする）
const RestaurantMap = lazy(() => import('./pages/RestaurantMap.js').then((m) => ({ default: m.RestaurantMap })))
const ListingDetail = lazy(() => import('./pages/ListingDetail.js').then((m) => ({ default: m.ListingDetail })))
const ProducerLocations = lazy(() => import('./pages/ProducerLocations.js').then((m) => ({ default: m.ProducerLocations })))
const RestaurantDiscover = lazy(() => import('./pages/RestaurantDiscover.js').then((m) => ({ default: m.RestaurantDiscover })))
const RestaurantFavorites = lazy(() => import('./pages/RestaurantFavorites.js').then((m) => ({ default: m.RestaurantFavorites })))
const Matches = lazy(() => import('./pages/Matches.js').then((m) => ({ default: m.Matches })))
const Notifications = lazy(() => import('./pages/Notifications.js').then((m) => ({ default: m.Notifications })))
const ProducerPropose = lazy(() => import('./pages/ProducerPropose.js').then((m) => ({ default: m.ProducerPropose })))
const Chat = lazy(() => import('./pages/Chat.js').then((m) => ({ default: m.Chat })))
const AdminQueue = lazy(() => import('./pages/AdminQueue.js').then((m) => ({ default: m.AdminQueue })))
const AdminQueueDetail = lazy(() => import('./pages/AdminQueue.js').then((m) => ({ default: m.AdminQueueDetail })))
const AdminReports = lazy(() => import('./pages/AdminReports.js').then((m) => ({ default: m.AdminReports })))

const lazyPage = (node: ReactNode) => <Suspense fallback={<Loading label="読み込んでいます…" />}>{node}</Suspense>

// 画面の出し分け。実際の権限確認は API 側で必ず行う。
function Require({ role, children }: { role?: Role; children: ReactNode }) {
  const { user } = useSession()
  if (!user) return <Navigate to="/login" replace />
  if (role && user.role !== role) return <Navigate to={homePath(user)} replace />
  return <Layout>{children}</Layout>
}

/** ログイン済みなら自分の役割の画面へ送る（ログイン・登録画面用） */
function GuestOnly({ children }: { children: ReactNode }) {
  const { user } = useSession()
  if (user) return <Navigate to={homePath(user)} replace />
  return <PublicLayout>{children}</PublicLayout>
}

export function App() {
  return (
    <Routes>
      {/* トップは役割の選択（新しいスタート画面）。古いトップ画面は廃止した。ロゴ・ログアウト後もここに戻る */}
      <Route path="/" element={<PublicLayout><Start /></PublicLayout>} />
      <Route path="/guide" element={<Welcome />} />
      <Route path="/start" element={<Navigate to="/" replace />} />
      <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
      <Route path="/signup" element={<PublicLayout><Signup /></PublicLayout>} />
      <Route path="/forgot-password" element={<PublicLayout><ForgotPassword /></PublicLayout>} />
      <Route path="/terms" element={<PublicLayout><Terms /></PublicLayout>} />
      <Route path="/privacy" element={<PublicLayout><Privacy /></PublicLayout>} />

      <Route path="/account" element={<Require><Account /></Require>} />
      {/* マッチングの依頼とチャット（飲食店・生産者。運営者は閲覧のみ。実際の権限はサーバーが確認する） */}
      <Route path="/matches" element={<Require>{lazyPage(<Matches />)}</Require>} />
      <Route path="/matches/:id" element={<Require>{lazyPage(<Chat />)}</Require>} />
      <Route path="/notifications" element={<Require>{lazyPage(<Notifications />)}</Require>} />
      <Route path="/producer/propose" element={<Require role="PRODUCER">{lazyPage(<ProducerPropose />)}</Require>} />
      <Route path="/restaurant" element={<Require role="RESTAURANT"><RestaurantInput /></Require>} />
      <Route path="/restaurant/confirm" element={<Require role="RESTAURANT"><RestaurantConfirm /></Require>} />
      <Route path="/restaurant/plan" element={<Require role="RESTAURANT"><RestaurantPlan /></Require>} />
      <Route path="/restaurant/history" element={<Require role="RESTAURANT"><RestaurantHistory /></Require>} />
      <Route path="/restaurant/map" element={<Require role="RESTAURANT">{lazyPage(<RestaurantMap />)}</Require>} />
      <Route path="/restaurant/discover" element={<Require role="RESTAURANT">{lazyPage(<RestaurantDiscover />)}</Require>} />
      <Route path="/restaurant/favorites" element={<Require role="RESTAURANT">{lazyPage(<RestaurantFavorites />)}</Require>} />
      <Route path="/restaurant/listing/:id" element={<Require role="RESTAURANT">{lazyPage(<ListingDetail />)}</Require>} />
      <Route path="/producer/locations" element={<Require role="PRODUCER">{lazyPage(<ProducerLocations />)}</Require>} />
      <Route path="/admin/queue" element={<Require role="ADMIN">{lazyPage(<AdminQueue />)}</Require>} />
      <Route path="/admin/queue/:type/:id" element={<Require role="ADMIN">{lazyPage(<AdminQueueDetail />)}</Require>} />
      <Route path="/admin/reports" element={<Require role="ADMIN">{lazyPage(<AdminReports />)}</Require>} />
      <Route path="/producer" element={<Require role="PRODUCER"><ProducerList /></Require>} />
      <Route path="/producer/new" element={<Require role="PRODUCER"><ProducerForm /></Require>} />
      <Route path="/producer/edit/:id" element={<Require role="PRODUCER"><ProducerForm /></Require>} />
      <Route path="/admin" element={<Require role="ADMIN"><Admin /></Require>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
