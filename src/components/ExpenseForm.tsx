import { useEffect, useMemo, useState, type FormEvent, type MouseEvent } from 'react'
import {
  CATEGORY_IDS,
  CATEGORY_META,
  type CategoryId,
  type Expense,
  type Member,
  type SplitMethod,
  type WarikanEvent,
} from '../domain/types'
import { CategoryMonogram } from './CategoryMonogram'
import { formatYen, getEventDayOptions } from './ui'

export interface ExpenseDraftInput {
  category: CategoryId
  title: string
  note?: string
  amount: number
  payerMemberId: string
  targetMemberIds: string[]
  splitMethod: SplitMethod
  fixedAmounts?: Record<string, number>
  dayIndex?: number
}

interface ExpenseFormProps {
  event: WarikanEvent
  members: Member[]
  currentMemberId: string | null
  initialExpense?: Expense
  offline?: boolean
  onClose: () => void
  onSubmit: (input: ExpenseDraftInput) => void | Promise<void>
  onSaveDraft?: (input: ExpenseDraftInput) => void | Promise<void>
  onDelete?: () => void | Promise<void>
}

export function ExpenseForm({ event, members, currentMemberId, initialExpense, offline = false, onClose, onSubmit, onSaveDraft, onDelete }: ExpenseFormProps) {
  const initialCategory: CategoryId = initialExpense?.category ?? 'food'
  const [category, setCategory] = useState<CategoryId>(initialCategory)
  const [dayIndex, setDayIndex] = useState<number | undefined>(initialExpense?.dayIndex)
  const [title, setTitle] = useState(initialExpense?.title ?? '')
  const [note, setNote] = useState(initialExpense?.note ?? '')
  const [amountInput, setAmountInput] = useState(initialExpense ? String(initialExpense.amount) : '')
  const [payerMemberId, setPayerMemberId] = useState(initialExpense?.payerMemberId ?? currentMemberId ?? members[0]?.id ?? '')
  const [targetMemberIds, setTargetMemberIds] = useState(() =>
    initialExpense ? [...initialExpense.targetMemberIds] : members.map((member) => member.id),
  )
  const [splitMethod, setSplitMethod] = useState<SplitMethod>(initialExpense?.splitMethod ?? 'equal')
  const [fixedAmountInputs, setFixedAmountInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(initialExpense?.fixedAmounts ?? {}).map(([id, value]) => [id, String(value)]),
    ),
  )
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const currentMember = members.find((member) => member.id === currentMemberId)
  const canManageAllocation = Boolean(currentMember?.isOrganizer || payerMemberId === currentMemberId)
  const canEditOwnAmount = Boolean(initialExpense?.targetMemberIds.includes(currentMemberId ?? ''))

  const amount = Number.parseInt(amountInput, 10) || 0
  const dayOptions = useMemo(() => getEventDayOptions(event), [event])
  const fixedTotal = targetMemberIds.reduce(
    (sum, id) => sum + (Number.parseInt(fixedAmountInputs[id] ?? '', 10) || 0),
    0,
  )
  const perPerson = targetMemberIds.length > 0 ? Math.floor(amount / targetMemberIds.length) : 0
  const remainder = targetMemberIds.length > 0 ? amount % targetMemberIds.length : 0
  const fixedComplete =
    splitMethod === 'fixed' &&
    targetMemberIds.length > 0 &&
    targetMemberIds.every((id) => (fixedAmountInputs[id] ?? '').trim() !== '') &&
    fixedTotal === amount
  const allocationComplete =
    splitMethod === 'equal' ? targetMemberIds.length > 0 : fixedComplete

  useEffect(() => {
    const closeOnEscape = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const toggleTarget = (memberId: string) => {
    setTargetMemberIds((current) => {
      if (current.includes(memberId)) {
        if (splitMethod === 'equal' && current.length === 1) {
          setError('割る相手を1人以上選択してください。')
          return current
        }
        return current.filter((id) => id !== memberId)
      }
      setError('')
      return [...current, memberId]
    })
  }

  const buildInput = (): ExpenseDraftInput => {
    const fixedAmounts = splitMethod === 'fixed'
      ? Object.fromEntries(
          targetMemberIds
            .filter((id) => (fixedAmountInputs[id] ?? '').trim() !== '')
            .map((id) => [id, Number.parseInt(fixedAmountInputs[id], 10)]),
        )
      : undefined
    return { category, title: title.trim(), note: note.trim() || undefined, amount, payerMemberId, targetMemberIds, splitMethod, fixedAmounts, dayIndex }
  }

  const validateBase = (requireComplete: boolean) => {
    if (!title.trim()) {
      setError('内容を入力してください。')
      return false
    }
    if (note.trim().length > 500) {
      setError('メモは500文字以内で入力してください。')
      return false
    }
    if (amount <= 0) {
      setError('1円以上の金額を入力してください。')
      return false
    }
    if (!payerMemberId) {
      setError('支払った人を選択してください。')
      return false
    }
    if (splitMethod === 'equal' && targetMemberIds.length === 0) {
      setError('割る相手を1人以上選択してください。')
      return false
    }
    if (requireComplete && initialExpense && !allocationComplete) {
      setError(`金額指定の合計を${formatYen(amount)}に合わせてください。`)
      return false
    }
    return true
  }

  const submit = async (submitEvent: FormEvent) => {
    submitEvent.preventDefault()
    if (!validateBase(true)) return
    setSubmitting(true)
    setError('')
    try {
      await onSubmit(buildInput())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '支出を保存できませんでした。')
      setSubmitting(false)
    }
  }

  const saveDraft = async () => {
    if (!validateBase(false)) return
    setSubmitting(true)
    setError('')
    try {
      await onSaveDraft?.(buildInput())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '途中保存できませんでした。')
      setSubmitting(false)
    }
  }

  const deleteExpense = async () => {
    if (!onDelete) return
    setSubmitting(true)
    setError('')
    try {
      await onDelete()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '支出を削除できませんでした。')
      setSubmitting(false)
    }
  }

  const closeFromBackdrop = (mouseEvent: MouseEvent<HTMLDivElement>) => {
    if (mouseEvent.target === mouseEvent.currentTarget) onClose()
  }

  return (
    <div className="expense-overlay" onMouseDown={closeFromBackdrop}>
      <section
        className="expense-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="expense-dialog-title"
      >
        <header className="expense-dialog__header">
          <button type="button" className="icon-button mobile-only" aria-label="ホームへ戻る" onClick={onClose}>‹</button>
          <div>
            <p className="eyebrow">{event.title}</p>
            <h1 id="expense-dialog-title">
              {initialExpense
                ? initialExpense.status === 'finalized'
                  ? '支出を編集'
                  : canManageAllocation ? '暫定支出の内訳を確定' : '自分の負担額を入力'
                : '支出を追加'}
            </h1>
          </div>
          <button type="button" className="icon-button desktop-only" aria-label="閉じる" onClick={onClose}>×</button>
        </header>

        <form className="expense-form" onSubmit={submit} noValidate>
          <fieldset className="form-section">
            <legend>カテゴリ</legend>
            <div className="choice-chips" role="group">
              {CATEGORY_IDS.map((item) => (
                <button
                  type="button"
                  key={item}
                  className={`choice-chip choice-chip--category ${category === item ? 'is-selected' : ''}`}
                  aria-pressed={category === item}
                  disabled={Boolean(initialExpense) && !canManageAllocation}
                  onClick={() => setCategory(item)}
                >
                  <CategoryMonogram category={item} size="small" />
                  {CATEGORY_META[item].label}
                </button>
              ))}
            </div>
          </fieldset>

          {event.eventType === 'overnight' && (
            <fieldset className="form-section">
              <legend>日付</legend>
              <div className="choice-chips" role="radiogroup" aria-label="支出の日付">
                {dayOptions.map((option) => {
                  const selected = dayIndex === option.dayIndex
                  return (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`choice-chip ${selected ? 'is-selected' : ''}`}
                      disabled={Boolean(initialExpense) && !canManageAllocation}
                      key={option.dayIndex ?? 'unspecified'}
                      onClick={() => setDayIndex(option.dayIndex)}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
            </fieldset>
          )}

          <div className="form-two-column">
            <label className="field">
              <span className="field__label">内容</span>
              <input
                autoFocus
                value={title}
                maxLength={80}
                placeholder="例: 昼食・そば処"
                autoComplete="off"
                disabled={Boolean(initialExpense) && !canManageAllocation}
                onChange={(changeEvent) => setTitle(changeEvent.target.value)}
              />
            </label>
            <label className="field amount-field">
              <span className="field__label">金額</span>
              <span className="amount-input-wrap">
                <span aria-hidden="true">¥</span>
                <input
                  value={amountInput}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="0"
                  aria-label="金額（円）"
                  disabled={Boolean(initialExpense) && !canManageAllocation}
                  onChange={(changeEvent) => setAmountInput(changeEvent.target.value.replace(/[^0-9]/g, '').slice(0, 9))}
                />
              </span>
            </label>
          </div>

          <label className="field expense-note-field">
            <span className="field__label">メモ（任意）</span>
            <textarea
              value={note}
              maxLength={500}
              rows={3}
              placeholder="集合場所、予約番号、支出の補足など"
              disabled={Boolean(initialExpense) && !canManageAllocation}
              onChange={(changeEvent) => setNote(changeEvent.target.value)}
            />
            <small>{note.length} / 500文字</small>
          </label>

          <fieldset className="form-section">
            <legend>支払った人</legend>
            <div className="choice-chips" role="radiogroup" aria-label="支払った人">
              {members.map((member) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={payerMemberId === member.id}
                  disabled={Boolean(initialExpense)}
                  className={`choice-chip ${payerMemberId === member.id ? 'is-selected' : ''}`}
                  key={member.id}
                  onClick={() => {
                    setPayerMemberId(member.id)
                    if (!currentMember?.isOrganizer && member.id !== currentMemberId) {
                      setTargetMemberIds(members.map((item) => item.id))
                      setSplitMethod('fixed')
                      setFixedAmountInputs({})
                    }
                  }}
                >
                  {member.name}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="form-section">
            <legend className="legend-row">
              <span>割る相手（{targetMemberIds.length}人）</span>
              <small>{canManageAllocation ? '立替え者・幹事が変更できます' : '立替え者または幹事が設定します'}</small>
            </legend>
            <div className="choice-chips" aria-label="割る相手">
              {members.map((member) => {
                const selected = targetMemberIds.includes(member.id)
                return (
                  <button
                    type="button"
                    className={`choice-chip ${selected ? 'is-selected' : 'is-excluded'}`}
                    aria-pressed={selected}
                    disabled={!canManageAllocation}
                    key={member.id}
                    onClick={() => toggleTarget(member.id)}
                  >
                    {member.name}
                  </button>
                )
              })}
            </div>
          </fieldset>

          <fieldset className="form-section">
            <legend>割り方</legend>
            <div className="segmented-control">
              <label className={splitMethod === 'equal' ? 'is-selected' : ''}>
                <input type="radio" name="split-method" value="equal" checked={splitMethod === 'equal'} disabled={Boolean(initialExpense) || !canManageAllocation} onChange={() => setSplitMethod('equal')} />
                均等
              </label>
              <label className={splitMethod === 'fixed' ? 'is-selected' : ''}>
                <input type="radio" name="split-method" value="fixed" checked={splitMethod === 'fixed'} disabled={Boolean(initialExpense) || !canManageAllocation} onChange={() => setSplitMethod('fixed')} />
                金額指定
              </label>
            </div>
          </fieldset>

          {splitMethod === 'fixed' && (
            <fieldset className="fixed-amounts">
              <legend>参加者ごとの負担額</legend>
              <p className="draft-help">
                {initialExpense
                  ? canManageAllocation
                    ? '途中保存できます。全員分が揃ったら立替え者または幹事が確定します。'
                    : '自分の負担額だけ入力して保存できます。対象者の変更と最終確定は立替え者または幹事が行います。'
                  : '対象者や負担額がまだ分からない場合は、未入力のまま暫定支出として追加できます。'}
              </p>
              <div className="fixed-amounts__list">
                {members.filter((member) => targetMemberIds.includes(member.id)).map((member) => (
                  <label key={member.id}>
                    <span>{member.name}</span>
                    <span className="mini-amount-input">
                      <span aria-hidden="true">¥</span>
                      <input
                        inputMode="numeric"
                        pattern="[0-9]*"
                        aria-label={`${member.name}の負担額`}
                        disabled={!canManageAllocation && member.id !== currentMemberId}
                        value={fixedAmountInputs[member.id] ?? ''}
                        onChange={(changeEvent) => setFixedAmountInputs((current) => ({
                          ...current,
                          [member.id]: changeEvent.target.value.replace(/[^0-9]/g, '').slice(0, 9),
                        }))}
                      />
                    </span>
                  </label>
                ))}
              </div>
              <p className={fixedComplete && amount > 0 ? 'fixed-total is-valid' : 'fixed-total'}>
                入力合計 {formatYen(fixedTotal)} / 支出 {formatYen(amount)}
              </p>
            </fieldset>
          )}

          {splitMethod === 'equal' && amount > 0 && (
            <p className="split-preview">
              1人あたり <strong>{formatYen(perPerson)}</strong>
              {remainder > 0 && <small>端数 {formatYen(remainder)} は支払者負担</small>}
            </p>
          )}

          {error && <p className="form-error" role="alert">{error}</p>}
          {offline && <p className="offline-notice" role="status">オフライン中です。新しい支出はこの端末に保存し、オンライン復帰後に自動送信します。</p>}

          {confirmingDelete && (
            <div className="expense-delete-confirm" role="alert">
              <span>この支出を削除しますか？元に戻せません。</span>
              <button type="button" className="button button--secondary button--small" disabled={submitting} onClick={() => setConfirmingDelete(false)}>戻る</button>
              <button type="button" className="button button--small text-button--danger" disabled={submitting} onClick={() => void deleteExpense()}>{submitting ? '削除しています…' : '削除する'}</button>
            </div>
          )}

          {!confirmingDelete && <div className="expense-form__actions">
            {initialExpense && onDelete && (
              <button type="button" className="button button--secondary text-button--danger" disabled={submitting || confirmingDelete} onClick={() => setConfirmingDelete(true)}>削除</button>
            )}
            <button type="button" className="button button--secondary desktop-only" disabled={submitting} onClick={onClose}>キャンセル</button>
            {initialExpense && onSaveDraft && (canManageAllocation || canEditOwnAmount) && (
              <button type="button" className="button button--secondary" disabled={submitting} onClick={() => void saveDraft()}>
                {canManageAllocation ? '途中保存' : '自分の金額を保存'}
              </button>
            )}
            <button
              type="submit"
              className="button button--primary button--grow"
              disabled={
                !title.trim() ||
                amount <= 0 ||
                submitting ||
                (splitMethod === 'equal' && targetMemberIds.length === 0) ||
                (Boolean(initialExpense) && (!allocationComplete || !canManageAllocation))
              }
            >
              <span>
                {initialExpense
                  ? initialExpense.status === 'finalized'
                    ? submitting ? '保存しています…' : '変更を保存'
                    : canManageAllocation ? submitting ? '保存しています…' : '内訳を確定する' : '立替え者の確定待ち'
                  : splitMethod === 'fixed' && !fixedComplete
                    ? submitting ? '追加しています…' : '暫定として追加'
                    : submitting ? '追加しています…' : '追加する'}
              </span>
              {splitMethod === 'equal' && amount > 0 && (
                <><span className="button-divider" aria-hidden="true" /><span>1人あたり {formatYen(perPerson)}</span></>
              )}
            </button>
          </div>}
        </form>
      </section>
    </div>
  )
}
