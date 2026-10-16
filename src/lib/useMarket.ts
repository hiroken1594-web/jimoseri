import { useEffect, useRef, useState } from 'react'
import type { MarketSearchResponse } from '../../shared/dto.js'
import { api, errorMessage } from '../api.js'
import { useDemoMode } from './demoMode.js'
import { toSearchInput, type SearchState } from './search.js'

/** 検索条件が変わるたびに（少し待ってから）地図・一覧用の検索を行う */
export function useMarketSearch(state: SearchState) {
  const [data, setData] = useState<MarketSearchResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const seq = useRef(0)
  const [demo] = useDemoMode()
  const input = JSON.stringify({ ...toSearchInput(state), demo })

  // 受取エリア（必須）が選ばれていない間は検索しない
  const needsArea = !state.prefecture

  useEffect(() => {
    const my = ++seq.current
    if (needsArea) {
      setData(null)
      setLoading(false)
      return
    }
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const res = await api<MarketSearchResponse>('/api/market', { body: JSON.parse(input) })
        if (my === seq.current) {
          setData(res)
          setError(null)
        }
      } catch (e) {
        if (my === seq.current) setError(errorMessage(e))
      } finally {
        if (my === seq.current) setLoading(false)
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [input, reloadKey, needsArea])

  return { data, loading, error, needsArea, reload: () => setReloadKey((k) => k + 1), setData }
}

/** 「気になる」の登録・解除。注文・予約・在庫の確保ではない。 */
export async function setFavorite(listingId: string, on: boolean): Promise<void> {
  if (on) await api('/api/favorites', { body: { listingId } })
  else await api(`/api/favorites?listingId=${encodeURIComponent(listingId)}`, { method: 'DELETE' })
}
