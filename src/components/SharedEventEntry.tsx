import { useState } from 'react'

import type { EventState } from '../backend/types'
import { validateMemberName } from '../lib/validation'

interface SharedEventEntryProps {
  state?: EventState
  loading?: boolean
  error?: string
  onJoin?: (name: string) => Promise<void>
  onRetry?: () => void
}

export function SharedEventEntry({
  state,
  loading = false,
  error,
  onJoin,
  onRetry,
}: SharedEventEntryProps) {
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const join = async () => {
    const normalized = name.trim()
    const validation = validateMemberName(normalized)
    if (!validation.valid) {
      setSubmitError(validation.error ?? '参加者名を確認してください')
      return
    }

    setSubmitting(true)
    setSubmitError('')
    try {
      await onJoin?.(normalized)
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : 'イベントに参加できませんでした')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="create-page">
      <section className="create-card shared-entry" aria-labelledby="shared-entry-title">
        <header className="create-card__header">
          <div>
            <p className="eyebrow">共有イベント</p>
            <h1 id="shared-entry-title">
              {loading ? 'イベントを読み込み中…' : error ? 'イベントを開けませんでした' : state?.event.title}
            </h1>
          </div>
        </header>

        {loading && <div className="shared-entry__loading" role="status"><span aria-hidden="true" />共有データを確認しています</div>}

        {error && (
          <div className="shared-entry__body">
            <p className="form-error" role="alert">{error}</p>
            {onRetry && <button type="button" className="button button--primary button--full" onClick={onRetry}>もう一度読み込む</button>}
          </div>
        )}

        {!loading && !error && state && (
          <div className="shared-entry__body">
            <div className="shared-entry__summary">
              <span>{state.event.startDate} 〜 {state.event.endDate}</span>
              <strong>{state.members.length}人が参加中</strong>
            </div>
            {state.event.status === 'active' ? (
              <>
                <label className="field">
                  <span className="field__label">あなたの名前</span>
                  <input
                    autoFocus
                    value={name}
                    maxLength={40}
                    autoComplete="name"
                    aria-invalid={Boolean(submitError)}
                    placeholder="例: いしはら"
                    disabled={submitting}
                    onChange={(event) => setName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void join()
                    }}
                  />
                </label>
                <p className="field-hint">ログインは不要です。同じ名前の人がいる場合は末尾に番号が付きます。</p>
                {submitError && <p className="form-error" role="alert">{submitError}</p>}
                <button type="button" className="button button--primary button--full" disabled={submitting} onClick={() => void join()}>
                  {submitting ? '参加しています…' : 'このイベントに参加する'}
                </button>
              </>
            ) : (
              <p className="form-error" role="alert">このイベントは精算確定済みのため、新しく参加できません。</p>
            )}
          </div>
        )}
      </section>
    </main>
  )
}
