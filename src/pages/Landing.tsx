import { Link, useSearchParams } from 'react-router-dom'
import { Notice } from '../components/ui.js'
import { useSession } from '../session.js'

export function Landing() {
  const { master } = useSession()
  const [params] = useSearchParams()
  const linkError = params.get('error')

  return (
    <div className="landing">
      <header className="landing-hero">
        <p className="landing-kicker">関西の地産地消をAIで繋ぐ</p>
        <h1>AI地域商社</h1>
        <p className="landing-lead">
          少しずつある地域の野菜を組み合わせて、
          <br />
          お店の「1つの仕入れ案」にまとめます。
        </p>
      </header>

      {linkError && (
        <Notice kind="error" title="リンクを確認できませんでした">
          <p>リンクの有効期限が切れているか、既に使われています。ログイン画面からもう一度お試しください。</p>
        </Notice>
      )}

      <div className="actions">
        <Link className="btn btn-primary btn-large" to="/login">
          ログイン
        </Link>
        {master.signupMode !== 'closed' && (
          <Link className="btn btn-large" to="/signup">
            はじめての方（新規登録）
          </Link>
        )}
      </div>
      {master.signupMode === 'closed' && (
        <Notice kind="info" title="新規登録は準備中です">
          <p>現在、一般の方の新規登録は受け付けていません。公開までしばらくお待ちください。</p>
        </Notice>
      )}

      <section className="feature-list">
        <div className="feature role-restaurant">
          <h2>
            <span className="role-badge">飲食店</span>の方
          </h2>
          <p>ほしい食材・量・日を文章で伝えると、複数の生産者の在庫を組み合わせた仕入れ案を作ります。</p>
        </div>
        <div className="feature role-producer">
          <h2>
            <span className="role-badge">生産者</span>の方
          </h2>
          <p>販売に回せる量を登録すると、他の生産者の分と組み合わせて飲食店に提案されます。少量でも構いません。</p>
        </div>
      </section>

      <p className="footnote">
        このサービスが作るのは仕入れの「案」です。注文・在庫の確保・決済・配送の手配は行いません。実際のお取引は、生産者と飲食店の間で直接ご相談ください。
      </p>
    </div>
  )
}
