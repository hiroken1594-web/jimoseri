import { FlaskConical } from 'lucide-react'
import { useDemoMode } from '../lib/demoMode.js'

/** デモモード（お試し）の切り替え。オンの間は、表示するものがすべて架空のデモデータになる。 */
export function DemoModeToggle({ compact }: { compact?: boolean }) {
  const [on, setOn] = useDemoMode()
  return (
    <div className={on ? 'demo-toggle is-on' : 'demo-toggle'}>
      <label className="check">
        <input type="checkbox" role="switch" aria-checked={on} checked={on} onChange={(e) => setOn(e.target.checked)} />
        <span>
          <strong>
            <FlaskConical size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 4 }} />
            デモモード（お試し）
          </strong>
          {!compact && (
            <small className="block">
              オンにすると、架空のデモデータ（約500の農家）だけで、地図・スワイプ・仕入れ案を試せます。実際の出品とは混ざりません。
            </small>
          )}
        </span>
      </label>
      {on && (
        <p className="demo-banner" role="status">
          いま表示しているのは<strong>デモデータ（架空）</strong>です。実在の農家・出品ではありません。
        </p>
      )}
    </div>
  )
}
