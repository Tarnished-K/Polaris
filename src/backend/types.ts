import type { Expense, Member, Settlement, WarikanEvent } from '../domain/types'
import type { SettlementStatus } from '../domain/types'

export interface BackendMember extends Member {
  isClaimed: boolean
}

export interface EventState {
  event: WarikanEvent
  members: BackendMember[]
  expenses: Expense[]
  settlements: Settlement[]
}

export interface JoinEventResult {
  memberId: string
  state: EventState
}

export interface ClaimMemberResult extends JoinEventResult {}

export interface AddExpenseInput {
  shareToken: string
  deviceToken: string
  category: Expense['category']
  title: string
  amount: number
  payerMemberId: string
  splitMethod: Expense['splitMethod']
  dayIndex?: number
  targets: Array<{ memberId: string; fixedAmount?: number }>
}

export interface AddExpenseResult {
  expenseId: string
  status: Expense['status']
}

export interface ExpenseMutationInput extends AddExpenseInput {
  expenseId: string
}

export interface UnfinalizeEventResult {
  requiresConfirmation: boolean
  changedSettlementCount?: number
  state?: EventState
}

export interface WarikanBackend {
  getEventState(shareToken: string): Promise<EventState>
  joinEvent(shareToken: string, deviceToken: string, name: string): Promise<JoinEventResult>
  claimMember(shareToken: string, claimToken: string, deviceToken: string): Promise<ClaimMemberResult>
  addExpense(input: AddExpenseInput): Promise<AddExpenseResult>
  updateExpense(input: ExpenseMutationInput): Promise<AddExpenseResult>
  saveOwnFixedAmount(shareToken: string, deviceToken: string, expenseId: string, fixedAmount?: number): Promise<void>
  finalizeExpense(shareToken: string, deviceToken: string | undefined, expenseId: string): Promise<void>
  deleteExpense(shareToken: string, deviceToken: string | undefined, expenseId: string): Promise<void>
  finalizeEvent(eventId: string): Promise<EventState>
  unfinalizeEvent(eventId: string, force?: boolean): Promise<UnfinalizeEventResult>
  reportSettlement(shareToken: string, deviceToken: string | undefined, settlementId: string): Promise<void>
  confirmSettlement(shareToken: string, deviceToken: string | undefined, settlementId: string): Promise<void>
  revertSettlement(shareToken: string, deviceToken: string | undefined, settlementId: string): Promise<SettlementStatus>
}
