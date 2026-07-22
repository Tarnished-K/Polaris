import { useMemo } from 'react'

import type {
  Expense,
  Member,
  Settlement,
  SettlementBreakdownItem,
  WarikanEvent,
} from '../domain/types'
import { CATEGORY_META } from '../domain/types'
import { OrganizerControls } from './OrganizerControls'
import { EventHeader } from './EventHeader'
import { formatYen, memberName, memberPillStyle, SETTLEMENT_STATUS_META } from './ui'

interface SettlementViewProps {
  event: WarikanEvent
  members: Member[]
  currentMemberId: string | null
  expenses: Expense[]
  settlements: Settlement[]
  totalSpent: number
  draftExpenseCount: number
  onBack: () => void
  onOpenDashboard: () => void
  onOpenSettings: () => void
  onFinalize: () => void
  onUnfinalize: () => void
  onReset: () => void
}

function StatusBadge({ status, amount }: Pick<Settlement, 'status' | 'amount'>) {
  if (amount === 0) {
    return <span className="settlement-status settlement-status--success">全額相殺</span>
  }
  const meta = SETTLEMENT_STATUS_META[status]
  return <span className={`settlement-status settlement-status--${meta.tone}`}>{meta.label}</span>
}

function BreakdownRows({
  items,
  members,
  negative = false,
}: {
  items: SettlementBreakdownItem[]
  members: Member[]
  negative?: boolean
}) {
  return (
    <div className="breakdown-rows">
      {items.map((item) => (
        <div className="breakdown-row" key={`${item.expenseId}:${item.fromMemberId}`}>
          <div>
            <strong>{item.expenseTitle}</strong>
            <small>
              {memberName(members, item.toMemberId)}が立て替え
              {item.dayIndex ? `・${item.dayIndex}日目` : ''}
            </small>
          </div>
          <strong className={negative ? 'breakdown-row__negative' : ''}>
            {negative ? '−' : ''}{formatYen(item.amount)}
          </strong>
        </div>
      ))}
    </div>
  )
}

function SettlementBreakdown({
  settlement,
  members,
}: {
  settlement: Settlement
  members: Member[]
}) {
  return (
    <details className="settlement-breakdown">
      <summary>精算の内訳を見る</summary>
      <div className="settlement-breakdown__body">
        <section>
          <h4>
            {memberName(members, settlement.toMemberId)}が
            {memberName(members, settlement.fromMemberId)}の分を立て替えた支出
          </h4>
          <BreakdownRows items={settlement.charges} members={members} />
          <p className="breakdown-subtotal">
            小計 <strong>{formatYen(settlement.grossAmount)}</strong>
          </p>
        </section>

        {settlement.offsets.length > 0 && (
          <section className="offset-section">
            <h4>
              {memberName(members, settlement.fromMemberId)}が
              {memberName(members, settlement.toMemberId)}の分を立て替えた支出
            </h4>
            <p>
              反対方向の立て替えとして差し引きます。
            </p>
            <BreakdownRows items={settlement.offsets} members={members} negative />
            <p className="breakdown-subtotal breakdown-subtotal--offset">
              差し引き <strong>−{formatYen(settlement.offsetAmount)}</strong>
            </p>
          </section>
        )}

        <div className="breakdown-equation" aria-label="差し引き後の精算額">
          <small>立替が多い側</small>
          <span>{formatYen(settlement.grossAmount)}</span>
          <span aria-hidden="true">−</span>
          <small>少ない側</small>
          <span>{formatYen(settlement.offsetAmount)}</span>
          <span aria-hidden="true">＝</span>
          <strong>{formatYen(settlement.amount)}</strong>
        </div>
      </div>
    </details>
  )
}

interface BarSide {
  memberId: string
  amount: number
  items: SettlementBreakdownItem[]
}

function AdvanceBar({ side, members, maxAmount, position }: { side: BarSide; members: Member[]; maxAmount: number; position: 'left' | 'right' }) {
  const memberIndex = Math.max(0, members.findIndex((member) => member.id === side.memberId))
  return (
    <div className="advance-bar-side">
      <div className={`advance-bar-side__visual advance-bar-side__visual--${position}`}>
        <div className="advance-bar-column">
          <div className="advance-bar-amount"><span>立替額</span><strong>{formatYen(side.amount)}</strong></div>
          <div className="advance-bar-track" aria-label={`${memberName(members, side.memberId)}の立替額${formatYen(side.amount)}`}>
            {side.items.map((item) => (
              <span
                className="advance-bar-segment"
                key={`${item.expenseId}:${item.fromMemberId}`}
                style={{
                  height: `${(item.amount / maxAmount) * 100}%`,
                  background: CATEGORY_META[item.category ?? 'other'].color,
                }}
                title={`${item.expenseTitle} ${formatYen(item.amount)}`}
              />
            ))}
          </div>
          <span className="advance-bar-member" style={memberPillStyle(memberIndex)}>{memberName(members, side.memberId)}</span>
        </div>
        <div className="advance-bar-legend">
          {side.items.length === 0 ? (
            <span className="advance-bar-legend__empty">立て替えなし</span>
          ) : side.items.map((item) => (
            <span key={`legend:${item.expenseId}:${item.fromMemberId}`}>
              <i style={{ background: CATEGORY_META[item.category ?? 'other'].color }} />
              <b>{item.expenseTitle}</b>
              <em>{formatYen(item.amount)}</em>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function PairAdvanceBars({ settlement, members, currentMemberId, organizer }: { settlement: Settlement; members: Member[]; currentMemberId: string | null; organizer: boolean }) {
  const fromName = memberName(members, settlement.fromMemberId)
  const toName = memberName(members, settlement.toMemberId)
  const maxAmount = Math.max(settlement.grossAmount, settlement.offsetAmount, 1)
  const fromSide: BarSide = { memberId: settlement.fromMemberId, amount: settlement.offsetAmount, items: settlement.offsets }
  const toSide: BarSide = { memberId: settlement.toMemberId, amount: settlement.grossAmount, items: settlement.charges }
  const currentOnRight = !organizer && currentMemberId === toSide.memberId
  const leftSide = currentOnRight ? toSide : fromSide
  const rightSide = currentOnRight ? fromSide : toSide
  const isCurrentPaying = !organizer && currentMemberId === settlement.fromMemberId
  const isCurrentReceiving = !organizer && currentMemberId === settlement.toMemberId
  const resultTone = settlement.amount === 0 ? 'even' : isCurrentPaying ? 'pay' : isCurrentReceiving ? 'receive' : 'neutral'
  const participantFacingFromName = fromName === 'あなた' ? '幹事' : fromName
  const participantFacingToName = toName === 'あなた' ? '幹事' : toName
  const resultLabel = organizer
    ? `${fromName} → ${toName} に支払う`
    : isCurrentPaying
      ? `あなた → ${participantFacingToName} に支払う`
      : `${participantFacingFromName} → あなたが受け取る`

  return (
    <div className="pair-comparison">
      <div className={`pair-result pair-result--${resultTone}`}>
        {settlement.amount === 0 ? (
          <><strong>差額なし</strong><span>お互いの立て替えが相殺されています</span></>
        ) : (
          <>
            <span className="pair-result__direction">{resultLabel}</span>
            <strong>{formatYen(settlement.amount)}</strong>
            <small>{formatYen(settlement.grossAmount)} − {formatYen(settlement.offsetAmount)}</small>
          </>
        )}
      </div>
      <p className="pair-comparison__caption">同じ基準で、相手の分を立て替えた金額を比較</p>
      <div className="pair-bars">
        <AdvanceBar side={leftSide} members={members} maxAmount={maxAmount} position="left" />
        <span className="pair-bars__versus">比較</span>
        <AdvanceBar side={rightSide} members={members} maxAmount={maxAmount} position="right" />
      </div>
    </div>
  )
}

export function SettlementView({
  event,
  members,
  currentMemberId,
  expenses,
  settlements,
  totalSpent,
  draftExpenseCount,
  onBack,
  onOpenDashboard,
  onOpenSettings,
  onFinalize,
  onUnfinalize,
  onReset,
}: SettlementViewProps) {
  const currentMember = members.find((member) => member.id === currentMemberId)
  const organizer = Boolean(currentMember?.isOrganizer)
  const finalized = event.status === 'finalized'
  const visibleSettlements = useMemo(
    () =>
      organizer
        ? settlements
        : settlements.filter(
            (settlement) =>
              settlement.fromMemberId === currentMemberId ||
              settlement.toMemberId === currentMemberId,
          ),
    [currentMemberId, organizer, settlements],
  )
  const completedCount = visibleSettlements.filter(
    (settlement) => settlement.status === 'paid',
  ).length
  const sortedSettlements = useMemo(() => {
    const rank = { pending: 0, reported: 1, paid: 2 }
    return [...visibleSettlements].sort(
      (left, right) => rank[left.status] - rank[right.status],
    )
  }, [visibleSettlements])

  return (
    <div className="app-shell settlement-page">
      <EventHeader
        event={event}
        members={members}
        activeTab="settlements"
        onTabChange={(tab) => tab === 'expenses' ? onBack() : tab === 'dashboard' && onOpenDashboard()}
        onOpenSettings={organizer ? onOpenSettings : undefined}
        onReset={onReset}
      />

      <div className="settlement-page-intro">
        <span className="mode-badge">相手ごと精算</span>
        <span className={`status-pill ${finalized ? 'status-pill--success' : 'status-pill--warning'}`}>
          {finalized ? '確定済み' : '暫定プレビュー'}
        </span>
      </div>

      {!finalized && (
        <div className={`preview-banner ${draftExpenseCount > 0 ? 'preview-banner--blocked' : ''}`} role="status">
          <span aria-hidden="true">i</span>
          <p>
            {draftExpenseCount > 0 ? (
              <><strong>暫定支出が{draftExpenseCount}件あります。</strong>イベント合計には含まれますが、負担額と精算にはまだ反映されません。</>
            ) : (
              <><strong>まだ暫定の精算です。</strong>相手ごとにまとめ、反対方向の立て替えを差し引いています。</>
            )}
          </p>
        </div>
      )}

      <main className="settlement-layout">
        <div className="settlement-center">
          <section className="all-settlements pair-settlements" aria-labelledby="all-settlements-heading">
            <div className="section-heading-row section-heading-row--compact">
              <div>
                <p className="eyebrow">{currentMember?.name ?? 'あなた'}の視点</p>
                <h2 id="all-settlements-heading">{organizer ? '全員の精算状況' : '関係する精算状況'}</h2>
              </div>
              <span className="count-label">完了 {completedCount} / {visibleSettlements.length}</span>
            </div>

            <div className="settlement-list">
              {sortedSettlements.length === 0 ? (
                <div className="subtle-empty subtle-empty--large">
                  確定済みの支出が追加されると、相手ごとの精算が表示されます。
                </div>
              ) : (
                sortedSettlements.map((settlement) => {
                  return (
                  <article className="pair-settlement-card" key={settlement.id}>
                    <header className="pair-settlement-card__header">
                      <strong>相手ごとの立替比較</strong>
                      <StatusBadge status={settlement.status} amount={settlement.amount} />
                    </header>
                    <PairAdvanceBars settlement={settlement} members={members} currentMemberId={currentMemberId} organizer={organizer} />
                    <div className="pair-settlement-card__footer">
                      <SettlementBreakdown settlement={settlement} members={members} />
                    </div>
                  </article>
                  )
                })
              )}
            </div>
          </section>
          {organizer && (
            <OrganizerControls
              event={event}
              members={members}
              expenseCount={expenses.length}
              draftExpenseCount={draftExpenseCount}
              totalSpent={totalSpent}
              onFinalize={onFinalize}
              onUnfinalize={onUnfinalize}
              onReset={onReset}
            />
          )}
        </div>
      </main>
    </div>
  )
}
