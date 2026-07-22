import { useMemo, useState, type CSSProperties } from 'react'

import { paidCounterpartyIds, splitExpense } from '../domain/settlement'
import { CATEGORY_META, type Expense, type Member, type Settlement, type WarikanEvent } from '../domain/types'
import { EventHeader } from './EventHeader'
import { allocatePercentages, formatYen, memberColor, memberName } from './ui'

interface AdvanceDashboardViewProps {
  event: WarikanEvent
  members: Member[]
  currentMemberId: string | null
  expenses: Expense[]
  settlements: Settlement[]
  onOpenExpenses: () => void
  onOpenSettlements: () => void
  onOpenPayment: () => void
  onOpenSettings: () => void
}

interface ChartItem {
  id: string
  label: string
  amount: number
  color: string
}

type ChartMode = 'bar' | 'pie'
type BreakdownMode = 'expense' | 'member'

interface ChartDataset {
  title: string
  description: string
  items: ChartItem[]
}

function pieGradient(items: ChartItem[], total: number) {
  if (items.length === 0 || total <= 0) return 'var(--canvas)'

  let start = 0
  const stops = items.map((item) => {
    const end = start + (item.amount / total) * 100
    const stop = `${item.color} ${start}% ${end}%`
    start = end
    return stop
  })

  return `conic-gradient(${stops.join(', ')})`
}

function percentageLabel(amount: number, percentage: number) {
  return amount > 0 && percentage === 0 ? '1%未満' : `${percentage}%`
}

function pieAnnotationPositions(items: ChartItem[], total: number) {
  let startAngle = 0

  return items.map((item) => {
    const sweepAngle = total > 0 ? (item.amount / total) * 360 : 0
    const middleAngle = startAngle + sweepAngle / 2
    const radians = (middleAngle * Math.PI) / 180
    startAngle += sweepAngle

    return {
      left: `${50 + Math.sin(radians) * 36}%`,
      top: `${50 - Math.cos(radians) * 36}%`,
    }
  })
}

function ChartCard({
  datasets,
  breakdown,
  onBreakdownChange,
  total,
  animationIndex,
  mode,
}: {
  datasets: Record<BreakdownMode, ChartDataset>
  breakdown: BreakdownMode
  onBreakdownChange: (mode: BreakdownMode) => void
  total: number
  animationIndex: number
  mode: ChartMode
}) {
  const { title, description, items } = datasets[breakdown]
  const sortedItems = [...items].sort((left, right) => right.amount - left.amount)
  const maxAmount = Math.max(...sortedItems.map((item) => item.amount), 1)
  const percentages = allocatePercentages(sortedItems.map((item) => item.amount))
  const pieAnnotations = pieAnnotationPositions(sortedItems, total)

  return (
    <section className="dashboard-chart-card" style={{ '--chart-delay': `${animationIndex * 90}ms` } as CSSProperties}>
      <div className="dashboard-chart-card__heading">
        <div><h3>{title}</h3><p>{description}</p></div>
        {mode === 'bar' && <div className="dashboard-chart-total"><span>合計</span><strong>{formatYen(total)}</strong></div>}
      </div>
      <div className="dashboard-breakdown-mode" role="group" aria-label="内訳の集計単位">
        <button type="button" className={breakdown === 'expense' ? 'is-active' : ''} aria-pressed={breakdown === 'expense'} onClick={() => onBreakdownChange('expense')}>イベント別</button>
        <button type="button" className={breakdown === 'member' ? 'is-active' : ''} aria-pressed={breakdown === 'member'} onClick={() => onBreakdownChange('member')}>相手別</button>
      </div>
      {mode === 'bar' ? (
        <div className="dashboard-vertical-chart" role="group" aria-label={`${title}、縦棒グラフ、合計${formatYen(total)}`}>
          {sortedItems.length === 0 ? <p className="dashboard-chart__empty">確定済みの対象支出はありません</p> : (
            <div
              className="dashboard-vertical-chart__plot"
              style={{ '--bar-count': sortedItems.length } as CSSProperties}
            >
              {sortedItems.map((item, index) => (
                <div className="dashboard-vertical-bar" key={item.id}>
                  <div className="dashboard-vertical-bar__track" aria-hidden="true">
                    <span
                      style={{
                        '--bar-height': `${(item.amount / maxAmount) * 100}%`,
                        background: item.color,
                      } as CSSProperties}
                    />
                  </div>
                  <strong>{formatYen(item.amount)} <small>· {percentageLabel(item.amount, percentages[index])}</small></strong>
                  <span title={item.label}>{item.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="dashboard-pie-chart" role="group" aria-label={`${title}、ドーナツグラフ、合計${formatYen(total)}`}>
          {sortedItems.length === 0 ? <p className="dashboard-chart__empty">確定済みの対象支出はありません</p> : (
            <>
              <div className="dashboard-pie-chart__donut" aria-hidden="true">
                <div className="dashboard-pie-chart__visual" style={{ background: pieGradient(sortedItems, total) }} />
                <div className="dashboard-pie-chart__annotations">
                  {sortedItems.map((item, index) => (
                    <span key={item.id} style={{ ...pieAnnotations[index], borderColor: item.color }}>
                      {percentageLabel(item.amount, percentages[index])}
                    </span>
                  ))}
                </div>
                <div className="dashboard-pie-chart__center"><span>合計</span><strong>{formatYen(total)}</strong></div>
              </div>
              <div className="dashboard-pie-chart__legend">
                {sortedItems.map((item, index) => (
                  <div key={item.id}>
                    <i style={{ background: item.color }} />
                    <span title={item.label}>{item.label}</span>
                    <strong>{formatYen(item.amount)}</strong>
                    <small>{percentageLabel(item.amount, percentages[index])}</small>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}

export function AdvanceDashboardView({
  event,
  members,
  currentMemberId,
  expenses,
  settlements,
  onOpenExpenses,
  onOpenSettlements,
  onOpenPayment,
  onOpenSettings,
}: AdvanceDashboardViewProps) {
  const [chartMode, setChartMode] = useState<ChartMode>('bar')
  const [outgoingBreakdown, setOutgoingBreakdown] = useState<BreakdownMode>('expense')
  const [incomingBreakdown, setIncomingBreakdown] = useState<BreakdownMode>('expense')
  const summary = useMemo(() => {
    const outgoingByExpense: ChartItem[] = []
    const incomingByExpense: ChartItem[] = []
    const outgoingMembers = new Map<string, number>()
    const incomingPayers = new Map<string, number>()
    let outgoingTotal = 0
    let incomingTotal = 0
    const paidPairMemberIds = paidCounterpartyIds(settlements, currentMemberId)

    if (currentMemberId) {
      for (const expense of expenses.filter((item) => item.status === 'finalized')) {
        const burdens = splitExpense(expense)
        if (expense.payerMemberId === currentMemberId) {
          const advanced = Object.entries(burdens).reduce((sum, [memberId, amount]) => {
            if (memberId === currentMemberId || amount <= 0 || paidPairMemberIds.has(memberId)) return sum
            outgoingMembers.set(memberId, (outgoingMembers.get(memberId) ?? 0) + amount)
            return sum + amount
          }, 0)
          if (advanced > 0) {
            outgoingTotal += advanced
            outgoingByExpense.push({ id: expense.id, label: expense.title, amount: advanced, color: CATEGORY_META[expense.category].color })
          }
        } else {
          const received = burdens[currentMemberId] ?? 0
          if (received > 0 && !paidPairMemberIds.has(expense.payerMemberId)) {
            incomingTotal += received
            incomingPayers.set(expense.payerMemberId, (incomingPayers.get(expense.payerMemberId) ?? 0) + received)
            incomingByExpense.push({ id: expense.id, label: expense.title, amount: received, color: CATEGORY_META[expense.category].color })
          }
        }
      }
    }

    const memberItems = (amounts: Map<string, number>) => members
      .filter((member) => amounts.has(member.id))
      .map((member) => ({
        id: member.id,
        label: member.name,
        amount: amounts.get(member.id) ?? 0,
        color: memberColor(members.findIndex((item) => item.id === member.id)).solid,
      }))

    return {
      outgoingByExpense,
      outgoingByMember: memberItems(outgoingMembers),
      incomingByExpense,
      incomingByPayer: memberItems(incomingPayers),
      outgoingTotal,
      incomingTotal,
      draftCount: expenses.filter((expense) => expense.status === 'draft' && (expense.payerMemberId === currentMemberId || expense.targetMemberIds.includes(currentMemberId ?? ''))).length,
    }
  }, [currentMemberId, expenses, members, settlements])

  const currentName = memberName(members, currentMemberId ?? '')
  const organizer = Boolean(members.find((member) => member.id === currentMemberId)?.isOrganizer)
  const net = summary.outgoingTotal - summary.incomingTotal

  return (
    <div className="app-shell advance-dashboard-page">
      <EventHeader
        event={event}
        members={members}
        activeTab="dashboard"
        onTabChange={(tab) => tab === 'expenses' ? onOpenExpenses() : tab === 'settlements' ? onOpenSettlements() : tab === 'payment' && onOpenPayment()}
        onOpenSettings={organizer ? onOpenSettings : undefined}
      />

      <main className="advance-dashboard-layout">
        <div className="advance-dashboard-heading">
          <div><p className="eyebrow">{currentName}の視点</p><h2>立替ダッシュボード</h2></div>
          <div className="dashboard-chart-mode" role="group" aria-label="すべてのグラフの表示形式">
            <span>グラフ表示</span>
            <div>
              <button type="button" className={chartMode === 'bar' ? 'is-active' : ''} aria-pressed={chartMode === 'bar'} onClick={() => setChartMode('bar')}>縦棒</button>
              <button type="button" className={chartMode === 'pie' ? 'is-active' : ''} aria-pressed={chartMode === 'pie'} onClick={() => setChartMode('pie')}>円グラフ</button>
            </div>
          </div>
        </div>

        <section className="dashboard-metrics" aria-label="立替の集計">
          <article><span>自分が立て替え中</span><strong>{formatYen(summary.outgoingTotal)}</strong><small>ほかの参加者の負担分</small></article>
          <article><span>立て替えてもらった</span><strong>{formatYen(summary.incomingTotal)}</strong><small>自分が負担する分</small></article>
          <button type="button" className={`dashboard-net-card ${net >= 0 ? 'is-receivable' : 'is-payable'}`} onClick={onOpenSettlements}>
            <span>差し引き</span>
            <strong>{net >= 0 ? '+' : '−'}{formatYen(Math.abs(net))}</strong>
            <small>{net >= 0 ? '受け取り側' : '支払い側'}の目安</small>
            <em>精算を見る <b aria-hidden="true">→</b></em>
          </button>
        </section>

        {summary.draftCount > 0 && <p className="dashboard-draft-note">暫定支出{summary.draftCount}件は、内訳が確定するとグラフに反映されます。</p>}

        <section className="dashboard-chart-section" aria-labelledby="advanced-heading">
          <div className="dashboard-section-heading"><h2 id="advanced-heading">自分が立て替えた金額の内訳</h2></div>
          <div className="dashboard-chart-grid">
            <ChartCard
              datasets={{
                expense: { title: '支出イベントごとの金額', description: 'どの支出の立て替えが重かったか', items: summary.outgoingByExpense },
                member: { title: '立替相手ごとの金額', description: '誰の分を多く立て替えたか', items: summary.outgoingByMember },
              }}
              breakdown={outgoingBreakdown}
              onBreakdownChange={setOutgoingBreakdown}
              total={summary.outgoingTotal}
              animationIndex={0}
              mode={chartMode}
            />
          </div>
        </section>

        <section className="dashboard-chart-section" aria-labelledby="received-heading">
          <div className="dashboard-section-heading dashboard-section-heading--received"><h2 id="received-heading">立て替えてもらった金額の内訳</h2></div>
          <div className="dashboard-chart-grid">
            <ChartCard
              datasets={{
                expense: { title: '支出イベントごとの金額', description: '何の支出を多く立て替えてもらったか', items: summary.incomingByExpense },
                member: { title: '立替者ごとの金額', description: '誰にいくら立て替えてもらったか', items: summary.incomingByPayer },
              }}
              breakdown={incomingBreakdown}
              onBreakdownChange={setIncomingBreakdown}
              total={summary.incomingTotal}
              animationIndex={1}
              mode={chartMode}
            />
          </div>
        </section>
      </main>
    </div>
  )
}
