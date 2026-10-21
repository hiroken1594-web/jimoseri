import { ArrowLeft, ArrowRight, ClipboardList, Layers, ShieldCheck, Sprout } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { homePath, useSession } from '../session.js'

const SEEN_KEY = 'jimoseri.welcomeSeen.v1'

/** 初回の案内を見たか（このブラウザにだけ保存する） */
export function welcomeSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return true
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    // 保存できなくても使える
  }
}

const STEPS: { icon: typeof Sprout; tone: 'green' | 'orange'; title: string; body: ReactNode }[] = [
  {
    icon: ClipboardList,
    tone: 'green',
    title: '少しずつの野菜を、1つの仕入れ案に',
    body: (
      <p>
        1つの農家だけでは足りない量も、近くの農家（最大3軒）の在庫を組み合わせて、お店の「1つの仕入れ案」にまとめます。
      </p>
    ),
  },
  {
    icon: Layers,
    tone: 'green',
    title: '飲食店の方：探して、比べて、相談',
    body: (
      <p>
        地図やスワイプで近くの農産物を探し、「気になる」に保存できます。「明後日までにトマト10kg」のように入力すると、足りない量や条件を広げた場合の参考も表示します。
      </p>
    ),
  },
  {
    icon: Sprout,
    tone: 'orange',
    title: '生産者の方：少量から出品',
    body: (
      <p>
        販売できる量・価格・受け渡しの日時と場所を登録するだけ。ご自宅の住所は公開されません。受け渡しの場所は別に登録し、運営者の確認後に表示されます。
      </p>
    ),
  },
  {
    icon: ShieldCheck,
    tone: 'green',
    title: '仕入れ案は「案」です',
    body: (
      <p>
        表示される仕入れ案は見積・提案で、注文や在庫の確保ではありません。実際のお取引は、生産者と飲食店の間で直接ご相談ください。
      </p>
    ),
  },
]

/** はじめての方への案内（4ステップ）。最後まで見るか「スキップ」で、次からは表示しない。ヘルプからいつでも見直せる。 */
export function Welcome() {
  const navigate = useNavigate()
  const { user } = useSession()
  const [step, setStep] = useState(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const s = STEPS[step]
  const Icon = s.icon
  const last = step === STEPS.length - 1

  useEffect(() => {
    heading.current?.focus()
  }, [step])

  const finish = () => {
    markSeen()
    navigate(user ? homePath(user) : '/', { replace: true })
  }

  return (
    <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="welcome-top">
        <p className="welcome-progress" aria-live="polite">
          <span className="visually-hidden">ステップ</span>
          {step + 1}/{STEPS.length}
        </p>
        <div className="welcome-dots" aria-hidden="true">
          {STEPS.map((_, i) => (
            <span key={i} className={i <= step ? 'is-done' : undefined} />
          ))}
        </div>
        {!last && (
          <button type="button" className="link-button" onClick={finish}>
            スキップ
          </button>
        )}
      </div>
      <div className="welcome-body">
        <span className={`welcome-icon tone-${s.tone}`} aria-hidden="true">
          <Icon />
        </span>
        <h1 id="welcome-title" ref={heading} tabIndex={-1}>
          {s.title}
        </h1>
        {s.body}
      </div>
      <div className="welcome-actions">
        {step > 0 ? (
          <button type="button" className="btn btn-large" onClick={() => setStep(step - 1)}>
            <ArrowLeft aria-hidden="true" />
            戻る
          </button>
        ) : (
          <span />
        )}
        {last ? (
          <button type="button" className="btn btn-primary btn-large" onClick={finish}>
            使ってみる
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-large" onClick={() => setStep(step + 1)}>
            次へ
            <ArrowRight aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  )
}
