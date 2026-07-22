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

export const SETTLEMENT_RELATIONSHIP_MAP_MAX_MEMBERS = 6

export type SettlementRelationshipMapMode = 'circular' | 'egocentric'

/** Keeps small groups readable as a whole and large groups centered on one member. */
export const getSettlementRelationshipMapMode = (
  memberCount: number,
): SettlementRelationshipMapMode =>
  memberCount <= SETTLEMENT_RELATIONSHIP_MAP_MAX_MEMBERS ? 'circular' : 'egocentric'

/** Maps settlement amounts to a restrained 1.5–5px visual weight. */
export const amountToStrokeWidth = (amount: number, maxAmount: number) => {
  const minimumWidth = 1.5
  const maximumWidth = 5
  if (!Number.isFinite(amount) || !Number.isFinite(maxAmount) || amount <= 0 || maxAmount <= 0) {
    return minimumWidth
  }

  const normalizedAmount = Math.min(amount, maxAmount) / maxAmount
  return minimumWidth + Math.sqrt(normalizedAmount) * (maximumWidth - minimumWidth)
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

export function layoutAnnotationGrid(
  itemWidths: number[],
  preferredPoints: Array<{ x: number; y: number }>,
  containerWidth: number,
  containerHeight: number,
  itemHeight = 26,
  horizontalGap = 10,
  verticalGap = 8,
) {
  if (itemWidths.length === 0) return { columns: 1, rows: 0, cellWidth: containerWidth, points: [] }
  const safeWidth = Math.max(1, containerWidth)
  const safeHeight = Math.max(itemHeight, containerHeight)
  const maxItemWidth = Math.max(1, ...itemWidths.map((width) => Math.max(1, width)))
  const columns = Math.max(1, Math.floor(safeWidth / (maxItemWidth + horizontalGap)))
  const cellWidth = safeWidth / columns
  const rowHeight = itemHeight + verticalGap
  const rows = Math.max(1, Math.floor(safeHeight / rowHeight), Math.ceil(itemWidths.length / columns))
  const availableCells = Array.from({ length: columns * rows }, (_, index) => ({
    column: index % columns,
    row: Math.floor(index / columns),
    x: cellWidth * (index % columns + 0.5),
    y: itemHeight / 2 + Math.floor(index / columns) * rowHeight,
  }))
  const points = itemWidths.map((_, index) => {
    const preferred = preferredPoints[index] ?? { x: safeWidth / 2, y: safeHeight / 2 }
    let closestIndex = 0
    let closestDistance = Number.POSITIVE_INFINITY
    availableCells.forEach((cell, cellIndex) => {
      const distance = (cell.x - preferred.x) ** 2 + (cell.y - preferred.y) ** 2
      if (distance < closestDistance) {
        closestDistance = distance
        closestIndex = cellIndex
      }
    })
    return availableCells.splice(closestIndex, 1)[0]
  })
  return {
    columns,
    rows,
    cellWidth,
    points,
  }
}

export function layoutNearbyAnnotations(
  items: Array<{
    width: number
    height: number
    candidates: Array<{ x: number; y: number }>
  }>,
  containerWidth: number,
  containerHeight: number,
  gap = 7,
) {
  const placed: Array<{ x: number; y: number; width: number; height: number }> = []
  const safeWidth = Math.max(1, containerWidth)
  const safeHeight = Math.max(1, containerHeight)
  const maxWidth = Math.max(1, ...items.map((item) => item.width))
  const maxHeight = Math.max(1, ...items.map((item) => item.height))
  const columns = Math.max(1, Math.floor((safeWidth - gap) / (maxWidth + gap)))
  const rows = Math.max(1, Math.ceil(items.length / columns), Math.floor((safeHeight - gap) / (maxHeight + gap)))
  const cellWidth = safeWidth / columns
  const cellHeight = safeHeight / rows
  const fallbackCells = Array.from({ length: columns * rows }, (_, index) => ({
    x: cellWidth * (index % columns + 0.5),
    y: cellHeight * (Math.floor(index / columns) + 0.5),
  }))

  const overlaps = (candidate: { x: number; y: number }, item: { width: number; height: number }) =>
    placed.some((box) =>
      Math.abs(candidate.x - box.x) < (item.width + box.width) / 2 + gap &&
      Math.abs(candidate.y - box.y) < (item.height + box.height) / 2 + gap,
    )
  const inside = (candidate: { x: number; y: number }, item: { width: number; height: number }) =>
    candidate.x - item.width / 2 >= gap &&
    candidate.x + item.width / 2 <= safeWidth - gap &&
    candidate.y - item.height / 2 >= gap &&
    candidate.y + item.height / 2 <= safeHeight - gap

  return items.map((item) => {
    const preferred = item.candidates[0] ?? { x: safeWidth / 2, y: safeHeight / 2 }
    const orderedFallbacks = [...fallbackCells].sort(
      (left, right) =>
        (left.x - preferred.x) ** 2 + (left.y - preferred.y) ** 2 -
        ((right.x - preferred.x) ** 2 + (right.y - preferred.y) ** 2),
    )
    const point = [...item.candidates, ...orderedFallbacks].find(
      (candidate) => inside(candidate, item) && !overlaps(candidate, item),
    ) ?? preferred
    placed.push({ ...point, width: item.width, height: item.height })
    return point
  })
}

export function settlementPerspective(
  fromMemberId: string,
  toMemberId: string,
  currentMemberId: string | null,
) {
  if (currentMemberId === fromMemberId) return 'pay' as const
  if (currentMemberId === toMemberId) return 'receive' as const
  return 'neutral' as const
}

export const SETTLEMENT_STATUS_META: Record<
  SettlementStatus,
  { label: string; tone: 'muted' | 'warning' | 'success' }
> = {
  pending: { label: '未払い', tone: 'muted' },
  reported: { label: '確認待ち', tone: 'warning' },
  paid: { label: '済', tone: 'success' },
}
