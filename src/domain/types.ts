export type CategoryId =
  | 'lodging'
  | 'transport'
  | 'food'
  | 'activity'
  | 'shopping'
  | 'other'

export type SplitMethod = 'equal' | 'fixed'
export type SettlementMode = 'minimal' | 'treasurer'
export type EventStatus = 'active' | 'finalized'
export type ExpenseStatus = 'draft' | 'finalized'
export type SettlementStatus = 'pending' | 'reported' | 'paid'

export interface WarikanEvent {
  id: string
  shareToken: string
  title: string
  eventType: 'single_day' | 'overnight'
  startDate: string
  endDate: string
  capacity: number
  status: EventStatus
}

export interface Member {
  id: string
  name: string
  isOrganizer?: boolean
}

export interface Expense {
  id: string
  category: CategoryId
  title: string
  note?: string
  amount: number
  payerMemberId: string
  targetMemberIds: string[]
  splitMethod: SplitMethod
  fixedAmounts?: Record<string, number>
  status: ExpenseStatus
  dayIndex?: number
  createdByMemberId: string
  createdAt: string
}

export interface SettlementBreakdownItem {
  expenseId: string
  expenseTitle: string
  category: CategoryId
  amount: number
  payableAmount?: number
  paymentStatus?: SettlementStatus
  fromMemberId: string
  toMemberId: string
  dayIndex?: number
}

export interface Settlement {
  id: string
  fromMemberId: string
  toMemberId: string
  amount: number
  grossAmount: number
  offsetAmount: number
  charges: SettlementBreakdownItem[]
  offsets: SettlementBreakdownItem[]
  status: SettlementStatus
  reportedByMemberId?: string
  confirmedByMemberId?: string
}

export interface PaymentProfile {
  memberId: string
  paypayId?: string | null
  acceptsCash: boolean
}

export interface SettlementPaymentLink {
  settlementId: string
  paypayRequestUrl: string
}

export interface EventDraft {
  title: string
  eventType: WarikanEvent['eventType']
  startDate: string
  endDate: string
  capacity: number
}

export const CATEGORY_IDS: CategoryId[] = [
  'lodging',
  'transport',
  'food',
  'activity',
  'shopping',
  'other',
]

export const CATEGORY_META: Record<
  CategoryId,
  { label: string; monogram: string; color: string; background: string }
> = {
  lodging: { label: '宿泊', monogram: '宿', color: '#3b6fd4', background: '#eaf1ff' },
  transport: { label: '交通', monogram: '交', color: '#288f8b', background: '#e7f6f4' },
  food: { label: '食事', monogram: '食', color: '#e4602f', background: '#fff0e8' },
  activity: { label: '観光', monogram: '観', color: '#7959c7', background: '#f1ecff' },
  shopping: { label: '買い出し', monogram: '買', color: '#2c9663', background: '#e8f7ef' },
  other: { label: 'その他', monogram: '他', color: '#6c6965', background: '#efeeec' },
}
