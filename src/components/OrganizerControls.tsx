import type { Member, WarikanEvent } from '../domain/types'
import { formatYen } from './ui'

interface OrganizerControlsProps {
  event: WarikanEvent
  members: Member[]
  expenseCount: number
  draftExpenseCount: number
  totalSpent: number
  onFinalize: () => void
  onUnfinalize: () => void
  onReset: () => void
}

export function OrganizerControls({
  event,
  members,
  expenseCount,
  draftExpenseCount,
  totalSpent,
  onFinalize,
  onUnfinalize,
  onReset,
}: OrganizerControlsProps) {
  const finalize = () => {
    const confirmed = window.confirm(
      `支出${expenseCount}件・イベント合計${formatYen(totalSpent)}・メンバー${members.length}人。\n\n支出の登録漏れがないか確認してから確定してください。`,
    )
    if (confirmed) onFinalize()
  }

  const unfinalize = () => {
    const confirmed = window.confirm(
      '精算確定を解除します。報告済み・支払い済みの記録がある場合も状態がリセットされることがあります。続けますか？',
    )
    if (confirmed) onUnfinalize()
  }

  const reset = () => {
    if (window.confirm('この端末のイベントデータをリセットして、作成画面へ戻りますか？')) {
      onReset()
    }
  }

  return (
    <details className="organizer-card">
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

        {event.status === 'active' ? (
          <button
            type="button"
            className="button button--dark button--full"
            disabled={expenseCount === 0 || draftExpenseCount > 0}
            onClick={finalize}
          >
            精算を確定する
          </button>
        ) : (
          <button type="button" className="button button--secondary button--full" onClick={unfinalize}>
            確定を解除する
          </button>
        )}

        <button type="button" className="text-button text-button--danger" onClick={reset}>
          イベントをリセット
        </button>
      </div>
    </details>
  )
}
