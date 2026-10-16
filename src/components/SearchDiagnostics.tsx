import type { MarketDiagnostics } from '../../shared/dto.js'
import { useDemoMode } from '../lib/demoMode.js'

/** 0件のとき、どの条件で件数が減ったかを順に見せる。条件そのものは勝手に外さない。 */
export function SearchDiagnostics({ diagnostics, demo }: { diagnostics: MarketDiagnostics | null; demo: boolean }) {
  const [, setDemo] = useDemoMode()
  if (!diagnostics) return null
  const firstZero = diagnostics.stages.findIndex((s) => s.count === 0)
  return (
    <div className="stack" style={{ width: '100%' }}>
      <p>
        <strong>どの条件で0件になったか</strong>（上から順に条件を足したときの出品の数）
      </p>
      <ol className="funnel">
        {diagnostics.stages.map((s, i) => (
          <li key={s.label} className={i === firstZero ? 'is-zero' : undefined}>
            <span>{s.label}</span>
            <span>{s.count}件</span>
          </li>
        ))}
      </ol>
      {firstZero >= 0 && <p className="muted">「{diagnostics.stages[firstZero].label}」の条件で0件になりました。</p>}
      {!demo && diagnostics.demoAvailable > 0 && (
        <div className="notice-actions">
          <p className="muted">
            お試し用のデモデータなら、同じ条件で {diagnostics.demoAvailable}件 見つかります（架空の農家・出品です）。
          </p>
          <button type="button" className="btn btn-small" onClick={() => setDemo(true)}>
            デモモードで試す
          </button>
        </div>
      )}
    </div>
  )
}
