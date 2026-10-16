// デモモード（お試し）：オンのときは、地図・スワイプ・仕入れ案でデモデータ（架空の出品）だけを使う。
// 実際の出品とデモデータは混ぜない。設定はこのブラウザにだけ保存する。
import { useEffect, useState } from 'react'

const KEY = 'jimoseri.demoMode.v1'
const EVENT = 'jimoseri-demo-mode'

export function isDemoMode(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setDemoMode(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    // 保存できない環境では、この画面の間だけ有効
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: on }))
}

/** デモモードの状態（どの画面で切り替えても、ほかの画面にすぐ反映される） */
export function useDemoMode(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(isDemoMode)
  useEffect(() => {
    const sync = () => setOn(isDemoMode())
    window.addEventListener(EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  return [on, setDemoMode]
}
