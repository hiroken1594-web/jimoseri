// 取引（マッチング）・チャット・通知の、画面側の共通処理
import { useEffect, useState } from 'react'
import type { MatchDto, MatchStatus } from '../../shared/dto.js'
import { tradeStatusLabel } from '../../shared/trade.js'
import { api } from '../api.js'

export const MATCH_STATUS_CLASS: Record<MatchStatus, string> = {
  PENDING: 'chip chip-warn',
  ACCEPTED: 'chip chip-live',
  AGREED: 'chip chip-live',
  COMPLETED: 'chip chip-done',
  DECLINED: 'chip chip-off',
  CANCELLED: 'chip chip-off',
}

/** 見ている人の立場での状態の名前（例：相談中（あなたの返事待ち）） */
export function statusLabel(m: MatchDto): string {
  const me = m.viewer === 'PRODUCER' ? 'producer' : 'restaurant'
  const partner = me === 'producer' ? 'restaurant' : 'producer'
  return tradeStatusLabel(m.status, { iAmResponder: m.viewer !== 'ADMIN' && m.initiator !== m.viewer, myCompleted: m.completed[me], partnerCompleted: m.completed[partner] })
}

/** 自分が返事をする側か（相談中のとき） */
export const iAmResponder = (m: MatchDto) => m.viewer !== 'ADMIN' && m.initiator !== m.viewer

export interface MatchList {
  matches: MatchDto[]
  unreadTotal: number
  pendingTotal: number
}

export const fetchMatches = () => api<MatchList>('/api/matches')

/** 一定の間隔で数を取りに行く（画面が表示されているときだけ）。変更の知らせを受けたら、すぐ取り直す */
function usePolledCount(enabled: boolean, load: () => Promise<number>, eventName: string, intervalMs: number): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const run = () =>
      load()
        .then((n) => alive && setCount(n))
        .catch(() => undefined)
    void run()
    const timer = setInterval(() => document.visibilityState === 'visible' && void run(), intervalMs)
    window.addEventListener(eventName, run)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener(eventName, run)
    }
  }, [enabled, load, eventName, intervalMs])
  return count
}

const loadMatchBadge = () => fetchMatches().then((r) => r.unreadTotal + r.pendingTotal)
const loadNotificationCount = () => api<{ unread: number }>('/api/notifications?count=1').then((r) => r.unread)

/** メニューの「やりとり」に出す新着（相手からの未読メッセージ＋返事が必要な提案）の数 */
export const useMatchBadge = (enabled: boolean) => usePolledCount(enabled, loadMatchBadge, 'jimoseri-matches-changed', 30_000)

/** ベルのマークに出す未読の通知の数 */
export const useNotificationCount = (enabled: boolean) => usePolledCount(enabled, loadNotificationCount, 'jimoseri-notifications-changed', 20_000)

/** 取引やメッセージ・通知が変わったことを、メニューの新着表示に知らせる */
export const notifyMatchesChanged = () => {
  window.dispatchEvent(new Event('jimoseri-matches-changed'))
  window.dispatchEvent(new Event('jimoseri-notifications-changed'))
}

/** 再送しても二重に保存されないように、メッセージごとに付ける番号 */
export const newClientId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)

/** ★の表示（例：★4.5（3件）） */
export const ratingText = (r: { average: number; count: number } | null) => (r ? `★${r.average.toFixed(1)}（${r.count}件）` : 'まだ評価はありません')
