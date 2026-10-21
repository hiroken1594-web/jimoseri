// マッチング（依頼）とチャットの、画面側の共通処理
import { useEffect, useState } from 'react'
import type { MatchDto, MatchStatus } from '../../shared/dto.js'
import { api } from '../api.js'

export const MATCH_STATUS_LABEL: Record<MatchStatus, string> = {
  PENDING: '返事待ち',
  ACCEPTED: 'マッチング成立',
  DECLINED: '辞退されました',
  CANCELLED: '取り下げました',
}

export const MATCH_STATUS_CLASS: Record<MatchStatus, string> = {
  PENDING: 'chip chip-warn',
  ACCEPTED: 'chip chip-live',
  DECLINED: 'chip chip-off',
  CANCELLED: 'chip chip-off',
}

/** 生産者から見た状態の名前 */
export const PRODUCER_STATUS_LABEL: Record<MatchStatus, string> = {
  PENDING: '返事が必要',
  ACCEPTED: 'マッチング成立',
  DECLINED: '辞退しました',
  CANCELLED: '飲食店が取り下げました',
}

export interface MatchList {
  matches: MatchDto[]
  unreadTotal: number
  pendingTotal: number
}

export const fetchMatches = () => api<MatchList>('/api/matches')

/** メニューに出す新着の数（相手からの未読メッセージ＋生産者は返事が必要な依頼）。30秒ごとに確認する */
export function useMatchBadge(enabled: boolean): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const load = () =>
      fetchMatches()
        .then((r) => alive && setCount(r.unreadTotal + r.pendingTotal))
        .catch(() => undefined)
    void load()
    const timer = setInterval(() => document.visibilityState === 'visible' && void load(), 30_000)
    window.addEventListener('jimoseri-matches-changed', load)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener('jimoseri-matches-changed', load)
    }
  }, [enabled])
  return count
}

/** 依頼やメッセージが変わったことを、メニューの新着表示に知らせる */
export const notifyMatchesChanged = () => window.dispatchEvent(new Event('jimoseri-matches-changed'))

/** 再送しても二重に保存されないように、メッセージごとに付ける番号 */
export const newClientId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)
