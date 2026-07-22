import { useMemo, useState } from 'react'
import type { EventDraft } from '../domain/types'

interface CreateWizardProps {
  onCreate: (draft: EventDraft) => void | Promise<void>
  onLoadDemo: () => void
  onLoadFourPersonDemo: () => void
  cloudConfigured?: boolean
  authLoading?: boolean
  userEmail?: string | null
  onGoogleSignIn?: () => Promise<void>
  onSignOut?: () => Promise<void>
}

type DurationChoice = 'single' | 'one_night' | 'multi_night'

const localIsoDate = (date = new Date()) => {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

const addDays = (value: string, days: number) => {
  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  date.setDate(date.getDate() + days)
  return localIsoDate(date)
}

export function CreateWizard({
  onCreate,
  onLoadDemo,
  onLoadFourPersonDemo,
  cloudConfigured = false,
  authLoading = false,
  userEmail,
  onGoogleSignIn,
  onSignOut,
}: CreateWizardProps) {
  const today = useMemo(() => localIsoDate(), [])
  const [step, setStep] = useState(1)
  const [title, setTitle] = useState('')
  const [duration, setDuration] = useState<DurationChoice>('one_night')
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(addDays(today, 1))
  const [capacity, setCapacity] = useState(6)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const setDurationChoice = (choice: DurationChoice) => {
    setDuration(choice)
    if (choice === 'single') setEndDate(startDate)
    if (choice === 'one_night') setEndDate(addDays(startDate, 1))
    if (choice === 'multi_night' && endDate <= addDays(startDate, 1)) {
      setEndDate(addDays(startDate, 2))
    }
  }

  const updateStartDate = (value: string) => {
    setStartDate(value)
    if (duration === 'single') setEndDate(value)
    if (duration === 'one_night') setEndDate(addDays(value, 1))
    if (duration === 'multi_night' && endDate <= addDays(value, 1)) {
      setEndDate(addDays(value, 2))
    }
  }

  const validateStep = () => {
    if (step === 1 && !title.trim()) return 'イベント名を入力してください。'
    if (step === 2 && (!startDate || !endDate || endDate < startDate)) {
      return '正しい日付を選択してください。'
    }
    return ''
  }

  const goNext = async () => {
    const message = validateStep()
    if (message) {
      setError(message)
      return
    }
    setError('')
    if (step < 3) {
      setStep((current) => current + 1)
      return
    }
    try {
      setSubmitting(true)
      await onCreate({
        title: title.trim(),
        eventType: duration === 'single' ? 'single_day' : 'overnight',
        startDate,
        endDate: duration === 'single' ? startDate : endDate,
        capacity,
      })
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'イベントを作成できませんでした。もう一度お試しください。',
      )
    } finally {
      setSubmitting(false)
    }
  }

  const runAuthAction = async (action?: () => Promise<void>) => {
    if (!action) return
    setError('')
    setSubmitting(true)
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ログイン処理に失敗しました。')
    } finally {
      setSubmitting(false)
    }
  }

  const loadDemo = () => {
    try {
      onLoadDemo()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'デモを読み込めませんでした。もう一度お試しください。',
      )
    }
  }

  const loadFourPersonDemo = () => {
    try {
      onLoadFourPersonDemo()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : '4人用テンプレートを読み込めませんでした。もう一度お試しください。',
      )
    }
  }

  return (
    <main className="create-page">
      <section className="create-card" aria-labelledby="create-title">
        <header className="create-card__header">
          <div>
            <p className="eyebrow">新しいイベント</p>
            <h1 id="create-title">割り勘をはじめる</h1>
          </div>
          <span className="step-count" aria-label={`全3ステップ中${step}ステップ目`}>
            {step} / 3
          </span>
        </header>

        <div className="progress-segments" aria-hidden="true">
          {[1, 2, 3].map((item) => (
            <span key={item} className={item <= step ? 'is-active' : ''} />
          ))}
        </div>

        {cloudConfigured && (
          <div className="cloud-auth-panel">
            <div>
              <strong>クラウド保存</strong>
              <span>{authLoading ? 'ログイン状態を確認中…' : userEmail ? `${userEmail} でログイン中` : 'イベント作成にはGoogleログインが必要です'}</span>
            </div>
            {userEmail ? (
              <button type="button" className="button button--secondary" disabled={submitting} onClick={() => void runAuthAction(onSignOut)}>ログアウト</button>
            ) : (
              <button type="button" className="button button--secondary" disabled={authLoading || submitting} onClick={() => void runAuthAction(onGoogleSignIn)}>Googleでログイン</button>
            )}
          </div>
        )}

        <div className="wizard-body">
          {step === 1 && (
            <div className="wizard-panel">
              <h2>イベント名を入力</h2>
              <label className="field">
                <span className="field__label">イベント名</span>
                <input
                  autoFocus
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="例: 箱根旅行"
                  maxLength={60}
                  autoComplete="off"
                />
              </label>
              <p className="field-hint">
                共有リンクを開いた参加者に表示されます。作成後にURLをLINEに貼るだけで招待できます。
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="wizard-panel">
              <h2>期間はどのくらい？</h2>
              <fieldset className="choice-stack">
                <legend className="sr-only">イベントの期間</legend>
                {([
                  ['single', '終日', '日帰りの飲み会・イベント'],
                  ['one_night', '1泊2日', '週末の旅行など'],
                  ['multi_night', '2泊以上', '長めの旅行・合宿'],
                ] as const).map(([value, label, description]) => (
                  <label className={`radio-card ${duration === value ? 'is-selected' : ''}`} key={value}>
                    <input
                      type="radio"
                      name="duration"
                      value={value}
                      checked={duration === value}
                      onChange={() => setDurationChoice(value)}
                    />
                    <span className="radio-card__mark" aria-hidden="true" />
                    <span>
                      <strong>{label}</strong>
                      <small>{description}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className="date-grid">
                <label className="field">
                  <span className="field__label">開始日</span>
                  <input type="date" value={startDate} onChange={(event) => updateStartDate(event.target.value)} />
                </label>
                <label className="field">
                  <span className="field__label">終了日</span>
                  <input
                    type="date"
                    value={duration === 'single' ? startDate : endDate}
                    min={startDate}
                    disabled={duration === 'single'}
                    onChange={(event) => setEndDate(event.target.value)}
                  />
                </label>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="wizard-panel">
              <h2>何人くらいで使う？</h2>
              <p className="panel-description">定員はあとから変更できます。</p>
              <div className="capacity-picker">
                <button
                  type="button"
                  className="round-button"
                  aria-label="定員を1人減らす"
                  disabled={capacity <= 2}
                  onClick={() => setCapacity((current) => Math.max(2, current - 1))}
                >
                  −
                </button>
                <output aria-live="polite">
                  {capacity}<small>人</small>
                </output>
                <button
                  type="button"
                  className="round-button round-button--primary"
                  aria-label="定員を1人増やす"
                  disabled={capacity >= 50}
                  onClick={() => setCapacity((current) => Math.min(50, current + 1))}
                >
                  ＋
                </button>
              </div>
            </div>
          )}
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="wizard-actions">
          <button
            type="button"
            className="button button--secondary"
            disabled={step === 1}
            onClick={() => {
              setError('')
              setStep((current) => Math.max(1, current - 1))
            }}
          >
            戻る
          </button>
          <button type="button" className="button button--primary button--grow" disabled={submitting} onClick={() => void goNext()}>
            {submitting ? '処理中…' : step === 3 ? '作成する' : '次へ'}
          </button>
        </div>
      </section>

      <div className="demo-links" aria-label="テスト用テンプレート">
        <button type="button" className="demo-link demo-link--primary" onClick={loadFourPersonDemo}>
          4人・2泊3日・全件金額指定テンプレート
          <span aria-hidden="true">→</span>
        </button>
        <button type="button" className="demo-link" onClick={loadDemo}>
          箱根旅行のデモを見る
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </main>
  )
}
