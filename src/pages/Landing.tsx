import { Layers, LogIn, Map as MapIcon, ShieldCheck, Sparkles, Sprout, Store, UserPlus } from 'lucide-react'
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
        <p className="hero-veg" aria-hidden="true">
          🍅🥬🍆🥕🌽
        </p>
      </header>

      {linkError && (
        <Notice kind="error" title="リンクを確認できませんでした">
          <p>リンクの有効期限が切れているか、既に使われています。ログイン画面からもう一度お試しください。</p>
        </Notice>
      )}

      <div className="actions">
        <Link className="btn btn-primary btn-large" to="/login">
          <LogIn aria-hidden="true" />
          ログイン
        </Link>
        {master.signupMode !== 'closed' && (
          <Link className="btn btn-large" to="/signup">
            <UserPlus aria-hidden="true" />
            はじめての方（新規登録）
          </Link>
        )}
      </div>
      {master.signupMode === 'closed' && (
        <Notice kind="info" title="新規登録は準備中です">
          <p>現在、一般の方の新規登録は受け付けていません。公開までしばらくお待ちください。</p>
        </Notice>
      )}

      <section className="feature-list" aria-label="できること">
        <div className="feature role-restaurant">
          <span className="feature-icon" aria-hidden="true">
            <Store />
          </span>
          <div>
            <h2>飲食店の方</h2>
            <p>ほしい食材・量・日を文章で伝えると、複数の生産者の在庫を組み合わせた仕入れ案を作ります。</p>
          </div>
        </div>
        <div className="feature role-producer">
          <span className="feature-icon" aria-hidden="true">
            <Sprout />
          </span>
          <div>
            <h2>生産者の方</h2>
            <p>販売に回せる量を登録すると、他の生産者の分と組み合わせて飲食店に提案されます。少量でも構いません。</p>
          </div>
        </div>
        <div className="feature role-restaurant">
          <span className="feature-icon" aria-hidden="true">
            <MapIcon />
          </span>
          <div>
            <h2>地図で近くの農産物を探す</h2>
            <p>お店の近くの受渡場所と、そこで受け取れる農産物を地図で探せます。</p>
          </div>
        </div>
        <div className="feature role-restaurant">
          <span className="feature-icon" aria-hidden="true">
            <Layers />
          </span>
          <div>
            <h2>スワイプで発見</h2>
            <p>農産物を1枚ずつめくって、気になるものを保存できます。保存しても注文にはなりません。</p>
          </div>
        </div>
        <div className="feature role-restaurant">
          <span className="feature-icon" aria-hidden="true">
            <Sparkles />
          </span>
          <div>
            <h2>AIが条件を整理</h2>
            <p>「明後日までにトマト10kg」のような文章から、品目・量・日付をAIが読み取ります。計算はプログラムが行います。</p>
          </div>
        </div>
        <div className="feature role-admin">
          <span className="feature-icon" aria-hidden="true">
            <ShieldCheck />
          </span>
          <div>
            <h2>安心して使えるしくみ</h2>
            <p>生産者と受渡場所は運営者が確認してから公開します。気になる出品は通報できます。</p>
          </div>
        </div>
      </section>

      <p className="footnote">
        このサービスが作るのは仕入れの「案」です。注文・在庫の確保・決済・配送の手配は行いません。実際のお取引は、生産者と飲食店の間で直接ご相談ください。
      </p>
    </div>
  )
}
