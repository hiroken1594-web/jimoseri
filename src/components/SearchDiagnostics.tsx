import type { MarketDiagnostics, MarketStageKey, MarketWider } from '../../shared/dto.js'
import { useDemoMode } from '../lib/demoMode.js'

/** 0件になった条件ごとの説明と、次にできること */
const REASON: Record<MarketStageKey, { title: string; next: string }> = {
  PUBLISHED: { title: '公開中で、これから受け取れる出品がありません', next: '生産者の出品をお待ちください。お試しにはデモモードが使えます。' },
  PRODUCER: { title: '運営者の承認が済んだ生産者の出品がありません', next: '生産者の確認が済むまでお待ちください。' },
  LOCATION: { title: '確認が済んだ受渡拠点の出品がありません', next: '受渡拠点の確認が済むまでお待ちください。' },
  MAP: { title: '地図に公開されている受渡拠点の出品がありません', next: '地図に公開されていない拠点の出品は、仕入れ案の計算では候補になります。' },
  AREA: { title: '指定した受取エリアには出品がありません', next: '受取エリア（都道府県・市区町村）を変えて、もう一度検索してください。' },
  FILTER: { title: '絞り込みの条件に合う農産物がありません', next: '品目・単価・在庫などの絞り込みを減らしてみてください。' },
  DATE: { title: '希望日に受け取れる農産物がありません', next: '受け取りたい日を変更して、もう一度検索してください。' },
  RADIUS: { title: '検索範囲の中に受渡拠点がありません', next: '検索半径を広げると、候補が見つかる可能性があります。' },
}

/**
 * 0件のとき：どの条件で0件になったかと次の操作を示す。
 * 条件を広げた場合の件数は「参考候補」として、元の条件の結果とは分けて示す（選んだときだけ条件を変える）。
 */
export function SearchDiagnostics({
  diagnostics,
  demo,
  onApply,
}: {
  diagnostics: MarketDiagnostics | null
  demo: boolean
  onApply?: (patch: MarketWider['patch']) => void
}) {
  const [, setDemo] = useDemoMode()
  if (!diagnostics) return null
  const firstZero = diagnostics.stages.findIndex((s) => s.count === 0)
  const reason = firstZero >= 0 ? REASON[diagnostics.stages[firstZero].key] : null
  return (
    <div className="stack diag" style={{ width: '100%' }}>
      {reason && (
        <div className="diag-reason" role="status">
          <p>
            <strong>{reason.title}</strong>
          </p>
          <p>{reason.next}</p>
        </div>
      )}
      {diagnostics.wider.length > 0 && (
        <section className="diag-wider" aria-labelledby="diag-wider-title">
          <h3 id="diag-wider-title">条件を広げた場合の参考候補</h3>
          <p className="muted">いまの条件には一致しません。選んだときだけ、条件を変えて検索し直します。</p>
          <ul>
            {diagnostics.wider.map((w) => (
              <li key={w.key}>
                <span>
                  {w.label}：<strong>{w.count}件</strong>
                </span>
                {onApply && (
                  <button type="button" className="btn btn-small" onClick={() => onApply(w.patch)}>
                    この条件で検索
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <details>
        <summary>条件ごとの件数を見る</summary>
        <ol className="funnel">
          {diagnostics.stages.map((s, i) => (
            <li key={s.key} className={i === firstZero ? 'is-zero' : undefined}>
              <span>{s.label}</span>
              <span>{s.count}件</span>
            </li>
          ))}
        </ol>
      </details>
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
