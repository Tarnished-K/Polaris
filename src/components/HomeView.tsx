import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  CATEGORY_IDS,
  CATEGORY_META,
  type CategoryId,
  type Expense,
  type Member,
  type Settlement,
  type WarikanEvent,
} from '../domain/types'
import type { PendingExpense } from '../state/pendingExpenseQueue'
import { CategoryMonogram } from './CategoryMonogram'
import { EventHeader } from './EventHeader'
import {
  expenseDayLabel,
  formatYen,
  getEventDayOptions,
  memberName,
  memberPillStyle,
} from './ui'

interface HomeViewProps {
  event: WarikanEvent
  members: Member[]
  currentMemberId: string | null
  expenses: Expense[]
  settlements: Settlement[]
  totalSpent: number
  onAddExpense: () => void
  onOpenSettlement: () => void
  onOpenPayment: () => void
  onOpenDashboard: () => void
  onOpenSettings: () => void
  onEditExpense: (expenseId: string) => void
  pendingExpenses?: PendingExpense[]
  onRetryPendingExpense?: (pendingId: string) => void
  onRemovePendingExpense?: (pendingId: string) => void
}

type CategoryFilter = 'all' | CategoryId

function ExpenseRow({
  expense,
  members,
  currentMemberId,
  settlements,
  eventFinalized,
  canEditExpense,
  onEditExpense,
}: {
  expense: Expense
  members: Member[]
  currentMemberId: string | null
  settlements: Settlement[]
  eventFinalized: boolean
  canEditExpense: boolean
  onEditExpense: (expenseId: string) => void
}) {
  const payer = memberName(members, expense.payerMemberId)
  const targetMembers = expense.targetMemberIds
    .map((id) => members.find((member) => member.id === id))
    .filter((member): member is Member => Boolean(member))
  const perPerson = expense.targetMemberIds.length > 0
    ? Math.floor(expense.amount / expense.targetMemberIds.length)
    : 0
  const enteredCount = Object.keys(expense.fixedAmounts ?? {}).filter((id) => expense.targetMemberIds.includes(id)).length
  const meta = CATEGORY_META[expense.category]
  const paymentMeta = (targetMemberId: string) => {
    if (targetMemberId === expense.payerMemberId) return { label: '立替者分', tone: 'self' }
    if (expense.status === 'draft') return { label: '内訳未確定', tone: 'draft' }
    if (!eventFinalized) return { label: '精算前', tone: 'draft' }
    const charge = settlements
      .filter((settlement) =>
        settlement.fromMemberId === targetMemberId &&
        settlement.toMemberId === expense.payerMemberId)
      .flatMap((settlement) => settlement.charges)
      .find((item) => item.expenseId === expense.id)
    if (charge) {
      const payableAmount = charge.payableAmount ?? charge.amount
      if (payableAmount === 0) return { label: '相殺済み', tone: 'paid' }
      if (charge.paymentStatus === 'paid') return { label: '受取確認済み', tone: 'paid' }
      if (charge.paymentStatus === 'reported') return { label: '支払報告済み', tone: 'reported' }
      return { label: '支払い前', tone: 'pending' }
    }
    const offset = settlements
      .flatMap((settlement) => settlement.offsets)
      .find((item) =>
        item.expenseId === expense.id &&
        item.fromMemberId === targetMemberId &&
        item.toMemberId === expense.payerMemberId)
    if (offset) return { label: '相殺に反映', tone: 'offset' }
    return { label: '精算前', tone: 'draft' }
  }
  const rowStyle = { '--expense-accent': meta.color, '--expense-tint': meta.background } as CSSProperties
  return (
    <article className="expense-row" style={rowStyle}>
      <CategoryMonogram category={expense.category} size="large" />
      <div className="expense-row__body">
        <div className="expense-row__title-line">
          <div><span className="expense-row__category">{meta.label}</span><h3>{expense.title}</h3></div>
          {expense.status === 'draft' && <span className="draft-badge">暫定</span>}
          <strong className="expense-row__amount">{formatYen(expense.amount)}</strong>
        </div>
        <div className="expense-row__meta-line">
          <span className="expense-row__meta-label">立替者</span>
          <span className="expense-member-pill" style={memberPillStyle(Math.max(0, members.findIndex((member) => member.id === expense.payerMemberId)))}>{payer}</span>
          <span className="expense-row__split">
          {expense.splitMethod === 'equal'
            ? `${targetMembers.length}人で均等割り・1人あたり ${formatYen(perPerson)}`
            : `金額指定・${enteredCount}/${targetMembers.length}人入力済み`}
          </span>
        </div>
        {expense.note && <p className="expense-row__note"><span>メモ</span>{expense.note}</p>}
        <div className="expense-row__targets">
          <span className="expense-row__meta-label">立替対象</span>
          <div className="expense-row__member-pills">
            {targetMembers.length > 0 ? targetMembers.map((target) => {
              const index = members.findIndex((member) => member.id === target.id)
              const payment = paymentMeta(target.id)
              return (
                <span className="expense-target-payment" style={memberPillStyle(index)} key={target.id}>
                  <b>{target.name}</b>
                  <small className={`expense-target-payment__status is-${payment.tone}`}>{payment.label}</small>
                </span>
              )
            }) : <em>未設定</em>}
          </div>
        </div>
        {expense.splitMethod === 'fixed' && (
          <details className="expense-allocation-details">
            <summary>金額内訳を見る</summary>
            <div>
              {expense.targetMemberIds.map((memberId) => (
                <p key={memberId}>
                  <span>{memberName(members, memberId)}</span>
                  <strong>{expense.fixedAmounts?.[memberId] === undefined ? '未入力' : formatYen(expense.fixedAmounts[memberId])}</strong>
                </p>
              ))}
            </div>
          </details>
        )}
        {canEditExpense && (
          <button
            type="button"
            className="draft-finalize-link"
            onClick={() => onEditExpense(expense.id)}
          >
            {expense.status === 'finalized'
              ? '支出を編集'
              : expense.payerMemberId === currentMemberId || members.find((member) => member.id === currentMemberId)?.isOrganizer
                ? '内訳を入力・確定'
                : '自分の負担額を入力'}
          </button>
        )}
      </div>
    </article>
  )
}

function PendingExpenseRow({
  pending,
  members,
  onRetry,
  onRemove,
}: {
  pending: PendingExpense
  members: Member[]
  onRetry?: (pendingId: string) => void
  onRemove?: (pendingId: string) => void
}) {
  const meta = CATEGORY_META[pending.input.category]
  const payer = memberName(members, pending.input.payerMemberId)
  const statusLabel = pending.status === 'sending'
    ? '送信中…'
    : pending.status === 'failed'
      ? '送信に失敗しました'
      : 'オフラインのため待機中'
  return (
    <article className={`pending-expense pending-expense--${pending.status}`} aria-live="polite">
      <CategoryMonogram category={pending.input.category} size="large" />
      <div className="pending-expense__body">
        <div className="pending-expense__heading">
          <div><span>{meta.label}</span><h3>{pending.input.title}</h3></div>
          <strong>{formatYen(pending.input.amount)}</strong>
        </div>
        <p>立替者: {payer}</p>
        {pending.input.note && <p className="pending-expense__note">メモ: {pending.input.note}</p>}
        <p className="pending-expense__status">
          {pending.status === 'sending' && <span className="pending-expense__spinner" aria-hidden="true" />}
          {statusLabel}
          {pending.status === 'failed' && pending.lastError ? `（${pending.lastError}）` : ''}
        </p>
        <div className="pending-expense__actions">
          {pending.status === 'failed' && onRetry && (
            <button type="button" className="button button--secondary" onClick={() => onRetry(pending.id)}>リトライ</button>
          )}
          {pending.status !== 'sending' && onRemove && (
            <button type="button" className="button button--ghost" onClick={() => onRemove(pending.id)}>未送信データを削除</button>
          )}
        </div>
      </div>
    </article>
  )
}

export function HomeView({
  event,
  members,
  currentMemberId,
  expenses,
  settlements,
  totalSpent,
  onAddExpense,
  onOpenSettlement,
  onOpenPayment,
  onOpenDashboard,
  onOpenSettings,
  onEditExpense,
  pendingExpenses = [],
  onRetryPendingExpense,
  onRemovePendingExpense,
}: HomeViewProps) {
  const [filter, setFilter] = useState<CategoryFilter>('all')
  const [memberFilter, setMemberFilter] = useState('all')
  const currentMember = members.find((member) => member.id === currentMemberId)
  const isOrganizer = Boolean(currentMember?.isOrganizer)
  const relevantExpenses = useMemo(
    () =>
      isOrganizer
        ? expenses
        : expenses.filter(
            (expense) =>
              expense.payerMemberId === currentMemberId ||
              expense.createdByMemberId === currentMemberId ||
              expense.targetMemberIds.includes(currentMemberId ?? ''),
          ),
    [currentMemberId, expenses, isOrganizer],
  )
  const availableCategories = CATEGORY_IDS.filter((category) =>
    relevantExpenses.some((expense) => expense.category === category),
  )

  useEffect(() => {
    if (filter !== 'all' && !availableCategories.includes(filter)) setFilter('all')
  }, [availableCategories, filter])

  useEffect(() => {
    if (memberFilter !== 'all' && !members.some((member) => member.id === memberFilter)) setMemberFilter('all')
  }, [memberFilter, members])

  const visibleExpenses = useMemo(
    () => relevantExpenses.filter((expense) =>
      (filter === 'all' || expense.category === filter) &&
      (memberFilter === 'all' || expense.payerMemberId === memberFilter || expense.targetMemberIds.includes(memberFilter))),
    [filter, memberFilter, relevantExpenses],
  )
  const relevantTotal = isOrganizer
    ? totalSpent
    : relevantExpenses.reduce((sum, expense) => sum + expense.amount, 0)
  const groupedExpenses = useMemo(() => {
    if (event.eventType !== 'overnight') return []
    return getEventDayOptions(event)
      .map((option) => ({
        label: option.label,
        expenses: visibleExpenses.filter((expense) => expenseDayLabel(event, expense) === option.label),
      }))
      .filter((group) => group.expenses.length > 0)
  }, [event, visibleExpenses])

  const addDisabled = event.status === 'finalized'

  return (
    <div className="app-shell">
      <EventHeader
        event={event}
        members={members}
        activeTab="expenses"
        onTabChange={(tab) => tab === 'dashboard' ? onOpenDashboard() : tab === 'settlements' ? onOpenSettlement() : tab === 'payment' && onOpenPayment()}
        onOpenSettings={isOrganizer ? onOpenSettings : undefined}
      />

      <main className="home-layout">
        <div className="home-grid home-grid--expenses">
          <section className="expense-list-column" aria-labelledby="expenses-heading">
            <div className="section-heading-row">
              <div>
                <p className="eyebrow">支出一覧</p>
                <h2 id="expenses-heading">みんなの支出</h2>
              </div>
              <span className="count-label">{visibleExpenses.length + pendingExpenses.length}件</span>
            </div>

            <div className="expense-filter-toolbar">
              <div className="category-tabs" role="group" aria-label="カテゴリで絞り込む">
                <button
                  type="button"
                  className={filter === 'all' ? 'is-active' : ''}
                  aria-pressed={filter === 'all'}
                  onClick={() => setFilter('all')}
                >
                  すべて
                </button>
                {availableCategories.map((category) => (
                  <button
                    type="button"
                    key={category}
                    className={filter === category ? 'is-active' : ''}
                    aria-pressed={filter === category}
                    onClick={() => setFilter(category)}
                  >
                    {CATEGORY_META[category].label}
                  </button>
                ))}
              </div>
              <button type="button" className="button button--primary expense-toolbar-add" disabled={addDisabled} onClick={onAddExpense}>
                <span aria-hidden="true">＋</span>{addDisabled ? '精算確定済み' : '支出を追加'}
              </button>
            </div>

            <div className="participant-filter" role="group" aria-label="参加者で支出を絞り込む">
              <span>参加者</span>
              <button type="button" className={memberFilter === 'all' ? 'is-active' : ''} onClick={() => setMemberFilter('all')}>すべて</button>
              {members.map((member, index) => (
                <button
                  type="button"
                  style={memberFilter === member.id ? memberPillStyle(index) : undefined}
                  className={memberFilter === member.id ? 'is-active is-member' : ''}
                  onClick={() => setMemberFilter(member.id)}
                  key={member.id}
                >{member.name}</button>
              ))}
            </div>

            {pendingExpenses.length > 0 && (
              <div className="pending-expenses" aria-label="未送信の支出">
                {pendingExpenses.map((pending) => (
                  <PendingExpenseRow
                    key={pending.id}
                    pending={pending}
                    members={members}
                    onRetry={onRetryPendingExpense}
                    onRemove={onRemovePendingExpense}
                  />
                ))}
              </div>
            )}

            {visibleExpenses.length === 0 ? (
              <div className="empty-card">
                <span className="empty-card__icon" aria-hidden="true">¥</span>
                <h3>{relevantExpenses.length === 0 ? '最初の支出を追加しましょう' : 'このカテゴリの支出はありません'}</h3>
                <p>{relevantExpenses.length === 0 ? '誰が、何に、いくら払ったかを記録します。' : '別のカテゴリを選んでください。'}</p>
                {relevantExpenses.length === 0 && !addDisabled && (
                  <button type="button" className="button button--primary" onClick={onAddExpense}>支出を追加</button>
                )}
              </div>
            ) : event.eventType === 'overnight' ? (
              <div className="day-groups">
                {groupedExpenses.map((group) => (
                  <section className="day-group" key={group.label} aria-label={group.label}>
                    <div className="day-group__heading">
                      <h3>{group.label}</h3>
                      <span />
                    </div>
                    <div className="expense-rows">
                      {group.expenses.map((expense) => (
                        <ExpenseRow
                          expense={expense}
                          members={members}
                          currentMemberId={currentMemberId}
                          settlements={settlements}
                          eventFinalized={event.status === 'finalized'}
                          canEditExpense={event.status === 'active' && (isOrganizer || expense.payerMemberId === currentMemberId || (expense.status === 'draft' && expense.targetMemberIds.includes(currentMemberId ?? '')))}
                          onEditExpense={onEditExpense}
                          key={expense.id}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="expense-rows expense-rows--flat">
                {visibleExpenses.map((expense) => (
                  <ExpenseRow
                    expense={expense}
                    members={members}
                    currentMemberId={currentMemberId}
                    settlements={settlements}
                    eventFinalized={event.status === 'finalized'}
                    canEditExpense={event.status === 'active' && (isOrganizer || expense.payerMemberId === currentMemberId || (expense.status === 'draft' && expense.targetMemberIds.includes(currentMemberId ?? '')))}
                    onEditExpense={onEditExpense}
                    key={expense.id}
                  />
                ))}
              </div>
            )}

            <p className="event-total">
              {isOrganizer ? 'イベント合計' : '関係する支出合計'} <strong>{formatYen(relevantTotal)}</strong>
            </p>
          </section>

        </div>
      </main>
    </div>
  )
}
