import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { MasterData, SessionUser } from '../shared/dto.js'
import { api, errorMessage } from './api.js'
import { authClient } from './auth-client.js'
import { clearLocalData } from './lib/forms.js'

interface SessionState {
  user: SessionUser | null
  master: MasterData
  /** ログイン状態と選択肢を読み込み直す（ログイン直後・プロフィール変更後など） */
  refresh: () => Promise<SessionUser | null>
  setUser: (user: SessionUser | null) => void
  logout: () => Promise<void>
}

const SessionContext = createContext<SessionState | null>(null)

export function useSession(): SessionState {
  const value = useContext(SessionContext)
  if (!value) throw new Error('SessionProvider が必要です')
  return value
}

export function homePath(user: SessionUser | null): string {
  if (!user) return '/'
  return { RESTAURANT: '/restaurant', PRODUCER: '/producer', ADMIN: '/admin' }[user.role]
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [master, setMaster] = useState<MasterData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const refresh = useCallback(async () => {
    const [m, me] = await Promise.all([api<MasterData>('/api/master'), api<{ user: SessionUser | null }>('/api/me')])
    setMaster(m)
    setUser(me.user)
    return me.user
  }, [])

  useEffect(() => {
    let cancelled = false
    setError(null)
    refresh().catch((e) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [attempt, refresh])

  const value = useMemo<SessionState | null>(() => {
    if (!master) return null
    return {
      user,
      master,
      refresh,
      setUser,
      logout: async () => {
        await authClient.signOut()
        // 共用端末に入力内容を残さない
        clearLocalData()
        setUser(null)
      },
    }
  }, [user, master, refresh])

  if (error) {
    return (
      <main className="page center-page">
        <div className="notice notice-error" role="alert">
          <strong>読み込めませんでした</strong>
          <p>{error}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>
          もう一度読み込む
        </button>
      </main>
    )
  }
  if (!value) {
    return (
      <main className="page center-page" aria-busy="true">
        <div className="spinner" />
        <p className="muted">読み込み中…</p>
      </main>
    )
  }
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
