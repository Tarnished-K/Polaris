import { useMemo, type CSSProperties } from 'react'

import { splitExpense } from '../domain/settlement'
import { CATEGORY_META, type Expense, type Member, type WarikanEvent } from '../domain/types'
import { EventHeader } from './EventHeader'
import { formatYen, memberColor, memberName } from './ui'

interface AdvanceDashboardViewProps {
  event: WarikanEvent
  members: Member[]
  currentMemberId: string | null
  expenses: Expense[]
  onOpenExpenses: () => void
  onOpenSettlements: () => void
  onOpenSettings: () => void
  onReset: () => void
}

interface PieItem {
  id: string
  label: string
  amount: number
  color: string
}

function DonutChart({ title, description, items, total, animationIndex }: { title: string; description: string; items: PieItem[]; total: number; animationIndex: number }) {
  let cursor = 0
  const stops = items.map((item) => {
    const start = cursor
    cursor += total > 0 ? (item.amount / total) * 100 : 0
    return `${item.color} ${start}% ${cursor}%`
  })
  const background = total > 0 ? `conic-gradient(${stops.join(', ')})` : '#ece8e1'

  return (
    <section className="dashboard-chart-card" style={{ '--chart-delay': `${animationIndex * 90}ms` } as CSSProperties}>
      <div className="dashboard-chart-card__heading"><h3>{title}</h3><p>{description}</p></div>
      <div className="dashboard-chart-card__body">
        <div className="dashboard-donut" style={{ background }} role="img" aria-label={`${title}、合計${formatYen(total)}`}>
          <div><span>合計</span><strong>{formatYen(total)}</strong></div>
        </div>
        <div className="dashboard-donut-legend">
          {items.length === 0 ? <p>確定済みの対象支出はありません</p> : items.map((item) => (
            <div key={item.id}>
              <i style={{ background: item.color }} />
              <span>{item.label}</span>
              <em>{Math.round((item.amount / total) * 100)}%</em>
              <strong>{formatYen(item.amount)}</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function AdvanceDashboardView({
  event,
  members,
  currentMemberId,
  expenses,
  onOpenExpenses,
  onOpenSettlements,
  onOpenSettings,
  onReset,
}: AdvanceDashboardViewProps) {
  const summary = useMemo(() => {
    const outgoingByExpense: PieItem[] = []
    const incomingByExpense: PieItem[] = []
    const outgoingMembers = new Map<string, number>()
    const incomingPayers = new Map<string, number>()
    let outgoingTotal = 0
    let incomingTotal = 0

    if (currentMemberId) {
      for (const expense of expenses.filter((item) => item.status === 'finalized')) {
        const burdens = splitExpense(expense)
        if (expense.payerMemberId === currentMemberId) {
          const advanced = Object.entries(burdens).reduce((sum, [memberId, amount]) => {
            if (memberId === currentMemberId || amount <= 0) return sum
            outgoingMembers.set(memberId, (outgoingMembers.get(memberId) ?? 0) + amount)
            return sum + amount
          }, 0)
          if (advanced > 0) {
            outgoingTotal += advanced
            outgoingByExpense.push({ id: expense.id, label: expense.title, amount: advanced, color: CATEGORY_META[expense.category].color })
          }
        } else {
          const received = burdens[currentMemberId] ?? 0
          if (received > 0) {
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
  }, [currentMemberId, expenses, members])

  const currentName = memberName(members, currentMemberId ?? '')
  const organizer = Boolean(members.find((member) => member.id === currentMemberId)?.isOrganizer)
  const net = summary.outgoingTotal - summary.incomingTotal

  return (
    <div className="app-shell advance-dashboard-page">
      <EventHeader
        event={event}
        members={members}
        activeTab="dashboard"
        onTabChange={(tab) => tab === 'expenses' ? onOpenExpenses() : tab === 'settlements' && onOpenSettlements()}
        onOpenSettings={organizer ? onOpenSettings : undefined}
        onReset={onReset}
      />

      <main className="advance-dashboard-layout">
        <div className="advance-dashboard-heading">
          <div><p className="eyebrow">{currentName}の視点</p><h2>立替ダッシュボード</h2></div>
          <p>自分が立て替えた分と、立て替えてもらった分を分けて確認できます。</p>
        </div>

        <section className="dashboard-metrics" aria-label="立替の集計">
          <article><span>自分が立て替え中</span><strong>{formatYen(summary.outgoingTotal)}</strong><small>ほかの参加者の負担分</small></article>
          <article><span>立て替えてもらった</span><strong>{formatYen(summary.incomingTotal)}</strong><small>自分が負担する分</small></article>
          <article className={net >= 0 ? 'is-receivable' : 'is-payable'}><span>差し引き</span><strong>{net >= 0 ? '+' : '−'}{formatYen(Math.abs(net))}</strong><small>{net >= 0 ? '受け取り側' : '支払い側'}の目安</small></article>
        </section>

        {summary.draftCount > 0 && <p className="dashboard-draft-note">暫定支出{summary.draftCount}件は、内訳が確定するとグラフに反映されます。</p>}

        <section className="dashboard-chart-section" aria-labelledby="advanced-heading">
          <div className="dashboard-section-heading"><span>自分が立て替えた</span><h2 id="advanced-heading">受け取る側の内訳</h2></div>
          <div className="dashboard-chart-grid">
            <DonutChart title="支出イベントごとの割合" description="どの支出で立て替えたか" items={summary.outgoingByExpense} total={summary.outgoingTotal} animationIndex={0} />
            <DonutChart title="立替相手ごとの割合" description="誰の分を立て替えたか" items={summary.outgoingByMember} total={summary.outgoingTotal} animationIndex={1} />
          </div>
        </section>

        <section className="dashboard-chart-section" aria-labelledby="received-heading">
          <div className="dashboard-section-heading dashboard-section-heading--received"><span>立て替えてもらった</span><h2 id="received-heading">支払う側の内訳</h2></div>
          <div className="dashboard-chart-grid">
            <DonutChart title="支出イベントごとの割合" description="何の支出で立て替えてもらったか" items={summary.incomingByExpense} total={summary.incomingTotal} animationIndex={2} />
            <DonutChart title="立替者ごとの割合" description="誰にいくら立て替えてもらったか" items={summary.incomingByPayer} total={summary.incomingTotal} animationIndex={3} />
          </div>
        </section>
      </main>
    </div>
  )
}
