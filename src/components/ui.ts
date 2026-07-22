import type { CSSProperties } from 'react'
import type { Expense, Member, SettlementStatus, WarikanEvent } from '../domain/types'

export const formatYen = (amount: number) =>
  new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0)

/** Distributes whole percentages with the largest-remainder method. */
export const allocatePercentages = (amounts: number[]) => {
  const normalized = amounts.map((amount) => Number.isFinite(amount) && amount > 0 ? amount : 0)
  const total = normalized.reduce((sum, amount) => sum + amount, 0)
  if (total <= 0) return normalized.map(() => 0)

  const exact = normalized.map((amount) => (amount / total) * 100)
  const allocated = exact.map(Math.floor)
  const remainder = 100 - allocated.reduce((sum, percentage) => sum + percentage, 0)
  const order = exact
    .map((percentage, index) => ({ index, fraction: percentage - allocated[index] }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index)

  for (let index = 0; index < remainder; index += 1) {
    allocated[order[index].index] += 1
  }
  return allocated
}

const parseDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? null : date
}

export const formatEventDate = (value: string) => {
  const date = parseDate(value)
  if (!date) return value
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).format(date)
}

export const formatEventDateRange = (event: WarikanEvent) => {
  if (event.startDate === event.endDate) return formatEventDate(event.startDate)
  return `${formatEventDate(event.startDate)} – ${formatEventDate(event.endDate)}`
}

export const getDurationLabel = (event: WarikanEvent) => {
  if (event.eventType === 'single_day') return '終日'
  const start = parseDate(event.startDate)
  const end = parseDate(event.endDate)
  if (!start || !end) return '宿泊'
  const nights = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000))
  return `${nights}泊${nights + 1}日`
}

export interface EventDayOption {
  dayIndex?: number
  label: string
}

export const getEventDayOptions = (event: WarikanEvent): EventDayOption[] => {
  if (event.eventType !== 'overnight') return []
  const start = parseDate(event.startDate)
  const end = parseDate(event.endDate)
  if (!start || !end) return [{ label: '日付未指定' }]

  const days = Math.min(
    31,
    Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1),
  )
  const options = Array.from({ length: days }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return {
      dayIndex: index + 1,
      label: new Intl.DateTimeFormat('ja-JP', {
        month: 'numeric',
        day: 'numeric',
        weekday: 'short',
      }).format(date),
    }
  })
  return [...options, { label: '日付未指定' }]
}

export const expenseDayLabel = (event: WarikanEvent, expense: Expense) => {
  if (!expense.dayIndex) return '日付未指定'
  return (
    getEventDayOptions(event).find((option) => option.dayIndex === expense.dayIndex)?.label ??
    '日付未指定'
  )
}

export const memberName = (members: Member[], id: string) =>
  members.find((member) => member.id === id)?.name ?? '不明な参加者'

export const memberDisplayName = (
  members: Member[],
  id: string,
  currentMemberId: string | null,
) => {
  const member = members.find((item) => item.id === id)
  if (!member) return '不明な参加者'
  if (member.id === currentMemberId) return 'あなた'
  if (member.isOrganizer) return '幹事'
  return member.name
}

/** Golden-angle hues provide a stable palette for the maximum 50 participants. */
export const memberColor = (index: number) => {
  const hue = Math.round((18 + index * 137.508) % 360)
  return {
    solid: `hsl(${hue} 58% 44%)`,
    soft: `hsl(${hue} 72% 94%)`,
    border: `hsl(${hue} 48% 82%)`,
  }
}

export const memberPillStyle = (index: number): CSSProperties => {
  const color = memberColor(index)
  return { color: color.solid, backgroundColor: color.soft, borderColor: color.border }
}

export const SETTLEMENT_STATUS_META: Record<
  SettlementStatus,
  { label: string; tone: 'muted' | 'warning' | 'success' }
> = {
  pending: { label: '未払い', tone: 'muted' },
  reported: { label: '確認待ち', tone: 'warning' },
  paid: { label: '済', tone: 'success' },
}
