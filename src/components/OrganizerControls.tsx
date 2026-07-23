import { useState } from 'react'

import type { UnfinalizeEventResult } from '../backend/types'
import type { Member, WarikanEvent } from '../domain/types'
import { formatYen } from './ui'

interface OrganizerControlsProps {
  event: WarikanEvent
  members: Member[]
  expenseCount: number
  draftExpenseCount: number
  totalSpent: number
  onFinalize: () => void | Promise<void>
  onUnfinalize: (force?: boolean) => void | UnfinalizeEventResult | Promise<void | UnfinalizeEventResult>
}

export function OrganizerControls({
  event,
  members,
  expenseCount,
  draftExpenseCount,
  totalSpent,
  onFinalize,
  onUnfinalize,
}: OrganizerControlsProps) {
  const [confirmation, setConfirmation] = useState<'finalize' | 'unfinalize' | 'force' | null>(null)
  const [changedSettlementCount, setChangedSettlementCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const runFinalize = async () => {
    setBusy(true)
    setError('')
    try {
      await onFinalize()
      setConfirmation(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '精算を確定できませんでした。')
    } finally {
      setBusy(false)
    }
  }

  const runUnfinalize = async (force: boolean) => {
    setBusy(true)
    setError('')
    try {
      const result = await onUnfinalize(force)
      if (result?.requiresConfirmation) {
        setChangedSettlementCount(result.changedSettlementCount ?? 0)
        setConfirmation('force')
      } else {
        setConfirmation(null)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '精算確定を解除できませんでした。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="organizer-card" open={confirmation !== null}>
      <summary>
        <span>幹事メニュー</span>
        <span className="organizer-card__summary-state">
          {event.status === 'finalized' ? '精算確定済み' : '設定・精算確定'}
        </span>
      </summary>
      <div className="organizer-card__body">
        <p className="settlement-method-note">
          精算は支払い相手ごとにまとめ、反対方向の立て替えを差し引いて内訳を表示します。
        </p>

        {draftExpenseCount > 0 && event.status === 'active' && (
          <p className="draft-blocker" role="status">
            暫定支出が{draftExpenseCount}件あります。すべて確定すると全体の精算を確定できます。
          </p>
        )}

        {confirmation === 'finalize' && (
          <div className="organizer-confirm" role="alert">
            <p>支出{expenseCount}件・合計{formatYen(totalSpent)}・{members.length}人で精算を確定します。</p>
            <button type="button" className="button button--secondary button--small" disabled={busy} onClick={() => setConfirmation(null)}>戻る</button>
            <button type="button" className="button button--dark button--small" disabled={busy} onClick={() => void runFinalize()}>{busy ? '確定中…' : '確定する'}</button>
          </div>
        )}

        {confirmation === 'unfinalize' && (
          <div className="organizer-confirm" role="alert">
            <p>精算確定を解除して、支出を編集できる状態へ戻します。</p>
            <button type="button" className="button button--secondary button--small" disabled={busy} onClick={() => setConfirmation(null)}>戻る</button>
            <button type="button" className="button button--dark button--small" disabled={busy} onClick={() => void runUnfinalize(false)}>{busy ? '確認中…' : '解除する'}</button>
          </div>
        )}

        {confirmation === 'force' && (
          <div className="organizer-confirm organizer-confirm--danger" role="alert">
            <p>報告済み・支払い済みの精算が{changedSettlementCount}件あります。状態を破棄して解除しますか？</p>
            <button type="button" className="button button--secondary button--small" disabled={busy} onClick={() => setConfirmation(null)}>中止</button>
            <button type="button" className="button button--small text-button--danger" disabled={busy} onClick={() => void runUnfinalize(true)}>{busy ? '解除中…' : '状態を破棄して解除'}</button>
          </div>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}

        {event.status === 'active' ? (
          <button
            type="button"
            className="button button--dark button--full"
            disabled={expenseCount === 0 || draftExpenseCount > 0 || busy}
            onClick={() => setConfirmation('finalize')}
          >
            精算を確定する
          </button>
        ) : (
          <button type="button" className="button button--secondary button--full" disabled={busy} onClick={() => setConfirmation('unfinalize')}>
            確定を解除する
          </button>
        )}
      </div>
    </details>
  )
}
