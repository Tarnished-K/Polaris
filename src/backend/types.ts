import type { EventDraft, Expense, Member, Settlement, WarikanEvent } from '../domain/types'
import type { SettlementStatus } from '../domain/types'
import type { Database } from './database.types'

export type PublicTableName = keyof Database['public']['Tables']
export type PublicRpcName = keyof Database['public']['Functions']

export interface BackendMember extends Member {
  isClaimed: boolean
}

export interface EventState {
  event: WarikanEvent
  members: BackendMember[]
  expenses: Expense[]
  settlements: Settlement[]
  currentMemberId?: string | null
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

export type IntegrationProvider = 'discord' | 'line'

export interface NotificationIntegration {
  id: string
  provider: IntegrationProvider
  externalSpaceName?: string | null
  status: 'active' | 'disabled' | 'error'
  connectedAt?: string | null
}

export interface WarikanBackend {
  createEvent(draft: EventDraft): Promise<EventState>
  getEventState(shareToken: string, deviceToken?: string): Promise<EventState>
  joinEvent(shareToken: string, deviceToken: string, name: string): Promise<JoinEventResult>
  claimMember(shareToken: string, claimToken: string, deviceToken: string): Promise<ClaimMemberResult>
  organizerUpdateEvent(eventId: string, draft: EventDraft): Promise<EventState>
  organizerAddMember(eventId: string, name: string): Promise<BackendMember>
  organizerRemoveMember(eventId: string, memberId: string): Promise<void>
  organizerRegenerateShareToken(eventId: string): Promise<EventState>
  listNotificationIntegrations(eventId: string): Promise<NotificationIntegration[]>
  saveNotificationIntegration(eventId: string, provider: IntegrationProvider, destination: string): Promise<NotificationIntegration>
  deleteNotificationIntegration(eventId: string, provider: IntegrationProvider): Promise<void>
  queueTestNotification(eventId: string, integrationId: string, message: string): Promise<string>
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
  subscribeToEventChanges(shareToken: string, onChange: () => void): () => void
  broadcastEventChange(shareToken: string): Promise<void>
}
