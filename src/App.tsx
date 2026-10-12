import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import type { Role } from '../shared/dto.js'
import { Layout, PublicLayout } from './components/Layout.js'
import { Account } from './pages/Account.js'
import { Admin } from './pages/Admin.js'
import { ForgotPassword, Login, Signup } from './pages/AuthPages.js'
import { Landing } from './pages/Landing.js'
import { Privacy, Terms } from './pages/Legal.js'
import { ProducerForm } from './pages/ProducerForm.js'
import { ProducerList } from './pages/ProducerList.js'
import { RestaurantConfirm } from './pages/RestaurantConfirm.js'
import { RestaurantHistory } from './pages/RestaurantHistory.js'
import { RestaurantInput } from './pages/RestaurantInput.js'
import { RestaurantPlan } from './pages/RestaurantPlan.js'
import { homePath, useSession } from './session.js'

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
      <Route path="/" element={<GuestOnly><Landing /></GuestOnly>} />
      <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
      <Route path="/signup" element={<PublicLayout><Signup /></PublicLayout>} />
      <Route path="/forgot-password" element={<PublicLayout><ForgotPassword /></PublicLayout>} />
      <Route path="/terms" element={<PublicLayout><Terms /></PublicLayout>} />
      <Route path="/privacy" element={<PublicLayout><Privacy /></PublicLayout>} />

      <Route path="/account" element={<Require><Account /></Require>} />
      <Route path="/restaurant" element={<Require role="RESTAURANT"><RestaurantInput /></Require>} />
      <Route path="/restaurant/confirm" element={<Require role="RESTAURANT"><RestaurantConfirm /></Require>} />
      <Route path="/restaurant/plan" element={<Require role="RESTAURANT"><RestaurantPlan /></Require>} />
      <Route path="/restaurant/history" element={<Require role="RESTAURANT"><RestaurantHistory /></Require>} />
      <Route path="/producer" element={<Require role="PRODUCER"><ProducerList /></Require>} />
      <Route path="/producer/new" element={<Require role="PRODUCER"><ProducerForm /></Require>} />
      <Route path="/producer/edit/:id" element={<Require role="PRODUCER"><ProducerForm /></Require>} />
      <Route path="/admin" element={<Require role="ADMIN"><Admin /></Require>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
