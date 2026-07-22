import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type {
  AddExpenseInput,
  AddExpenseResult,
  ClaimMemberResult,
  EventState,
  ExpenseMutationInput,
  JoinEventResult,
  WarikanBackend,
  UnfinalizeEventResult,
} from './types'
import type { SettlementStatus } from '../domain/types'
import type { EventDraft } from '../domain/types'

export interface SupabaseConfig {
  url: string
  publishableKey: string
}

let sharedClient: SupabaseClient | null = null
let sharedClientKey = ''

function requireData<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message)
  if (data === null) throw new Error('バックエンドからデータが返されませんでした')
  return data
}

function requireSuccess(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

function expenseParams(input: AddExpenseInput | ExpenseMutationInput) {
  return {
    p_share_token: input.shareToken,
    p_device_token: input.deviceToken || null,
    p_category: input.category,
    p_title: input.title,
    p_amount: input.amount,
    p_payer_member_id: input.payerMemberId,
    p_split_method: input.splitMethod,
    p_day_index: input.dayIndex ?? null,
    p_targets: input.targets,
  }
}

export function readSupabaseConfig(): SupabaseConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  return url && publishableKey ? { url, publishableKey } : null
}

export function getSupabaseClient(config = readSupabaseConfig()): SupabaseClient | null {
  if (!config) return null
  const key = `${config.url}\n${config.publishableKey}`
  if (!sharedClient || sharedClientKey !== key) {
    sharedClient = createClient(config.url, config.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
    sharedClientKey = key
  }
  return sharedClient
}

export function generateDeviceToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const binary = String.fromCharCode(...bytes)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

export function createWarikanBackend(config: SupabaseConfig, client?: SupabaseClient): WarikanBackend {
  const supabase = client ?? getSupabaseClient(config)
  if (!supabase) throw new Error('Supabaseの接続設定がありません')

  return {
    async createEvent(draft: EventDraft) {
      const { data, error } = await supabase.rpc('create_event', {
        p_title: draft.title.trim(),
        p_event_type: draft.eventType,
        p_start_date: draft.startDate,
        p_end_date: draft.eventType === 'single_day' ? draft.startDate : draft.endDate,
        p_capacity: draft.capacity,
      })
      return requireData(data as EventState | null, error)
    },
    async getEventState(shareToken) {
      const { data, error } = await supabase.rpc('get_event_state', { p_share_token: shareToken })
      return requireData(data as EventState | null, error)
    },

    async joinEvent(shareToken, deviceToken, name) {
      const { data, error } = await supabase.rpc('join_event', {
        p_share_token: shareToken,
        p_device_token: deviceToken,
        p_name: name,
      })
      return requireData(data as JoinEventResult | null, error)
    },

    async claimMember(shareToken, claimToken, deviceToken) {
      const { data, error } = await supabase.rpc('claim_member', {
        p_share_token: shareToken,
        p_claim_token: claimToken,
        p_device_token: deviceToken,
      })
      return requireData(data as ClaimMemberResult | null, error)
    },

    async addExpense(input: AddExpenseInput) {
      const { data, error } = await supabase.rpc('add_expense', expenseParams(input))
      return requireData(data as AddExpenseResult | null, error)
    },

    async updateExpense(input: ExpenseMutationInput) {
      const { data, error } = await supabase.rpc('update_expense', {
        ...expenseParams(input),
        p_expense_id: input.expenseId,
      })
      return requireData(data as AddExpenseResult | null, error)
    },

    async saveOwnFixedAmount(shareToken, deviceToken, expenseId, fixedAmount) {
      const { error } = await supabase.rpc('save_own_fixed_amount', {
        p_share_token: shareToken,
        p_device_token: deviceToken,
        p_expense_id: expenseId,
        p_fixed_amount: fixedAmount ?? null,
      })
      requireSuccess(error)
    },

    async finalizeExpense(shareToken, deviceToken, expenseId) {
      const { error } = await supabase.rpc('finalize_expense', {
        p_share_token: shareToken,
        p_device_token: deviceToken ?? null,
        p_expense_id: expenseId,
      })
      requireSuccess(error)
    },

    async deleteExpense(shareToken, deviceToken, expenseId) {
      const { error } = await supabase.rpc('delete_expense', {
        p_share_token: shareToken,
        p_device_token: deviceToken ?? null,
        p_expense_id: expenseId,
      })
      requireSuccess(error)
    },

    async finalizeEvent(eventId) {
      const { data, error } = await supabase.rpc('finalize_event', { p_event_id: eventId })
      return requireData(data as EventState | null, error)
    },

    async unfinalizeEvent(eventId, force = false) {
      const { data, error } = await supabase.rpc('unfinalize_event', { p_event_id: eventId, p_force: force })
      return requireData(data as UnfinalizeEventResult | null, error)
    },

    async reportSettlement(shareToken, deviceToken, settlementId) {
      const { error } = await supabase.rpc('report_settlement', {
        p_share_token: shareToken,
        p_device_token: deviceToken ?? null,
        p_settlement_id: settlementId,
      })
      requireSuccess(error)
    },

    async confirmSettlement(shareToken, deviceToken, settlementId) {
      const { error } = await supabase.rpc('confirm_settlement', {
        p_share_token: shareToken,
        p_device_token: deviceToken ?? null,
        p_settlement_id: settlementId,
      })
      requireSuccess(error)
    },

    async revertSettlement(shareToken, deviceToken, settlementId) {
      const { data, error } = await supabase.rpc('revert_settlement', {
        p_share_token: shareToken,
        p_device_token: deviceToken ?? null,
        p_settlement_id: settlementId,
      })
      return requireData(data as SettlementStatus | null, error)
    },
  }
}
