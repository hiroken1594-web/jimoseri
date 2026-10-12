import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ExtractResponse } from '../../shared/dto.js'
import { MAX_TEXT_LENGTH } from '../../shared/limits.js'
import { api, errorMessage } from '../api.js'
import { Loading, Notice } from '../components/ui.js'
import { emptyDemandForm, formFromExtraction, loadDraft, saveDraft, type Draft } from '../lib/forms.js'
import { useSession } from '../session.js'

const EXAMPLES = [
  '明後日までに大阪近郊のトマトを10kg、多少形が悪くてもOK',
  '明後日の10時半に、なすを3kg。予算は2,000円まで',
  '明後日までにきゅうりを20個。きれいなものだけ',
]

export function RestaurantInput() {
  const { master } = useSession()
  const navigate = useNavigate()
  const [saved] = useState<Draft | null>(() => loadDraft())
  const [text, setText] = useState(saved?.text ?? '')
  const [showResume, setShowResume] = useState(Boolean(saved?.form))
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<{ kind: 'warn' | 'error'; message: string } | null>(null)

  const updateText = (value: string) => {
    setText(value)
    setProblem(null)
    saveDraft({ text: value, form: null, regionText: null, notes: [], source: 'MANUAL' })
    setShowResume(false)
  }

  const goManual = (aiMessage?: string) => {
    saveDraft({ text: text.trim(), form: emptyDemandForm(), regionText: null, notes: [], source: 'MANUAL' })
    navigate('/restaurant/confirm', { state: { aiMessage } })
  }

  const submit = async () => {
    const trimmed = text.trim()
    // 空入力では AI を呼ばない
    if (!trimmed) return setProblem({ kind: 'error', message: '品目・数量・希望日を入力してください。下の例文をタップすると入力できます。' })
    if (!master.aiEnabled) return goManual('現在、AIによる読み取りは利用できません。項目を選んで続けられます。')
    setBusy(true)
    setProblem(null)
    try {
      const result = await api<ExtractResponse>('/api/extract', { body: { text: trimmed } })
      if (result.ok) {
        saveDraft({
          text: trimmed,
          form: formFromExtraction(result.fields),
          regionText: result.fields.regionText,
          notes: result.notes,
          source: 'AI',
        })
        navigate('/restaurant/confirm')
      } else if (result.reason === 'AI_UNAVAILABLE') {
        goManual(result.message)
      } else {
        setProblem({ kind: 'warn', message: result.message })
      }
    } catch (e) {
      setProblem({ kind: 'error', message: `${errorMessage(e)} 項目を選んで手入力でも続けられます。` })
    } finally {
      setBusy(false)
    }
  }

  if (busy) return <Loading label="AIが条件を整理しています…（最大10秒ほど）" />

  return (
    <>
      <h1 className="page-title">仕入れ案を作る</h1>
      <p className="page-lead">ほしい食材・量・いつまでに、をそのまま書いてください。1回の依頼は1品目です。</p>

      {showResume && (
        <Notice kind="info" title="入力の続きから再開できます">
          <div className="notice-actions">
            <button className="btn btn-small btn-primary" onClick={() => navigate('/restaurant/confirm')}>
              続きの条件確認へ
            </button>
            <button className="btn btn-small" onClick={() => updateText('')}>
              最初からやり直す
            </button>
          </div>
        </Notice>
      )}

      <label className="field">
        <span className="visually-hidden">仕入れ希望</span>
        <textarea
          className="input textarea-large"
          value={text}
          maxLength={MAX_TEXT_LENGTH}
          rows={4}
          placeholder="例：明後日までに大阪近郊のトマトを10kg、多少形が悪くてもOK"
          onChange={(e) => updateText(e.target.value)}
        />
        <span className="field-hint align-right">
          {text.length}／{MAX_TEXT_LENGTH}文字
        </span>
      </label>

      {problem && (
        <Notice kind={problem.kind}>
          <p>{problem.message}</p>
        </Notice>
      )}

      <div className="examples">
        <p className="examples-title">例文をタップして入力</p>
        {EXAMPLES.map((example) => (
          <button key={example} type="button" className="example-chip" onClick={() => updateText(example)}>
            {example}
          </button>
        ))}
      </div>

      <div className="actions">
        <button className="btn btn-primary btn-large" onClick={submit}>
          AIで条件を整理する
        </button>
        <button className="btn btn-large" onClick={() => goManual()}>
          項目を選んで手入力する
        </button>
      </div>
      <p className="footnote">AIは文章の整理だけを行います。次の画面で内容を確認・修正してから仕入れ案を作ります。</p>
    </>
  )
}
