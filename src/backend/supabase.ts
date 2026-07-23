import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'

import type { Database } from './database.types'
import type {
  AddExpenseInput,
  AddExpenseResult,
  BackendMember,
  ClaimMemberResult,
  EventState,
  ExpenseMutationInput,
  JoinEventResult,
  NotificationIntegration,
  PaymentState,
  WarikanBackend,
  UnfinalizeEventResult,
  ExternalAccountLink,
  ExternalAccountLinkCode,
} from './types'
import type { SettlementStatus } from '../domain/types'
import type { EventDraft } from '../domain/types'

export interface SupabaseConfig {
  url: string
  publishableKey: string
}

type PublicFunctions = Database['public']['Functions']
type RpcName = keyof PublicFunctions
type RpcArgs<Name extends RpcName> = PublicFunctions[Name] extends { Args: infer Args }
  ? Args
  : never
type WithSqlNull<Args, Keys extends keyof Args> = Omit<Args, Keys> & {
  [Key in Keys]: Args[Key] | null
}

/**
 * The CLI generator does not mark nullable SQL function parameters as nullable.
 * Keep the generated signature for every other field and widen only parameters
 * whose functions intentionally accept SQL NULL.
 */
function allowSqlNull<Name extends RpcName, Keys extends keyof RpcArgs<Name>>(
  args: WithSqlNull<RpcArgs<Name>, Keys>,
): RpcArgs<Name> {
  return args as unknown as RpcArgs<Name>
}

export type WarikanSupabaseClient = SupabaseClient<Database>

let sharedClient: WarikanSupabaseClient | null = null
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

export function getSupabaseClient(config = readSupabaseConfig()): WarikanSupabaseClient | null {
  if (!config) return null
  const key = `${config.url}\n${config.publishableKey}`
  if (!sharedClient || sharedClientKey !== key) {
    sharedClient = createClient<Database>(config.url, config.publishableKey, {
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

export function createWarikanBackend(config: SupabaseConfig, client?: WarikanSupabaseClient): WarikanBackend {
  const supabase = client ?? getSupabaseClient(config)
  if (!supabase) throw new Error('Supabaseの接続設定がありません')

  const realtimeChannels = new Map<string, {
    channel: RealtimeChannel
    listeners: Set<() => void>
    subscribed: Promise<boolean>
  }>()

  const eventTopic = (shareToken: string) => `event:${shareToken}`
  const ensureEventChannel = (shareToken: string) => {
    const existing = realtimeChannels.get(shareToken)
    if (existing) return existing

    const listeners = new Set<() => void>()
    const channel = supabase
      .channel(eventTopic(shareToken), {
        config: { broadcast: { self: false, ack: true } },
      })
      .on('broadcast', { event: 'event_changed' }, () => {
        for (const listener of listeners) listener()
      })
    const subscribed = new Promise<boolean>((resolve) => {
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') resolve(true)
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          resolve(false)
        }
      })
    })
    const managed = { channel, listeners, subscribed }
    realtimeChannels.set(shareToken, managed)
    return managed
  }

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
    async getEventState(shareToken, deviceToken) {
      const { data, error } = deviceToken
        ? await supabase.rpc('get_event_state', {
            p_share_token: shareToken,
            p_device_token: deviceToken,
          })
        : await supabase.rpc('get_event_state', { p_share_token: shareToken })
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

    async organizerUpdateEvent(eventId, draft) {
      const { data, error } = await supabase.rpc('organizer_update_event', {
        p_event_id: eventId,
        p_title: draft.title.trim(),
        p_event_type: draft.eventType,
        p_start_date: draft.startDate,
        p_end_date: draft.eventType === 'single_day' ? draft.startDate : draft.endDate,
        p_capacity: draft.capacity,
      })
      return requireData(data as EventState | null, error)
    },

    async organizerAddMember(eventId, name) {
      const { data, error } = await supabase.rpc('organizer_add_member', {
        p_event_id: eventId,
        p_name: name.trim(),
      })
      return requireData(data as BackendMember | null, error)
    },

    async organizerRemoveMember(eventId, memberId) {
      const { error } = await supabase.rpc('organizer_remove_member', {
        p_event_id: eventId,
        p_member_id: memberId,
      })
      requireSuccess(error)
    },

    async organizerRegenerateShareToken(eventId) {
      const { data, error } = await supabase.rpc('organizer_regenerate_share_token', {
        p_event_id: eventId,
      })
      return requireData(data as EventState | null, error)
    },

    async listNotificationIntegrations(eventId) {
      const { data, error } = await supabase.functions.invoke('integration-settings', {
        body: { action: 'list', eventId },
      })
      return requireData((data?.integrations ?? null) as NotificationIntegration[] | null, error)
    },

    async saveNotificationIntegration(eventId, provider, destination) {
      const { data, error } = await supabase.functions.invoke('integration-settings', {
        body: { action: 'save', eventId, provider, destination },
      })
      return requireData((data?.integration ?? null) as NotificationIntegration | null, error)
    },

    async deleteNotificationIntegration(eventId, provider) {
      const { error } = await supabase.functions.invoke('integration-settings', {
        body: { action: 'delete', eventId, provider },
      })
      requireSuccess(error)
    },

    async queueTestNotification(eventId, integrationId, message) {
      const { data, error } = await supabase.rpc('organizer_queue_notification', {
        p_event_id: eventId,
        p_notification_type: 'integration_test',
        p_payload: { message },
        p_integration_id: integrationId,
        p_scheduled_for: new Date().toISOString(),
        p_dedupe_key: `integration-test:${integrationId}:${crypto.randomUUID()}`,
      })
      return requireData(data as string | null, error)
    },

    async getPaymentState(shareToken, deviceToken) {
      const { data, error } = await supabase.rpc(
        'get_payment_state',
        allowSqlNull<'get_payment_state', 'p_device_token'>({
          p_share_token: shareToken,
          p_device_token: deviceToken ?? null,
        }),
      )
      return requireData(data as PaymentState | null, error)
    },

    async savePaymentProfile(shareToken, deviceToken, profile) {
      const { data, error } = await supabase.rpc(
        'upsert_payment_profile',
        allowSqlNull<'upsert_payment_profile', 'p_device_token' | 'p_paypay_id'>({
          p_share_token: shareToken,
          p_device_token: deviceToken ?? null,
          p_paypay_id: profile.paypayId?.trim() || null,
          p_accepts_cash: profile.acceptsCash,
        }),
      )
      return requireData(data as PaymentState['profiles'][number] | null, error)
    },

    async saveSettlementPaymentLink(shareToken, deviceToken, settlementId, paypayRequestUrl) {
      const { error } = await supabase.rpc(
        'set_settlement_payment_link',
        allowSqlNull<'set_settlement_payment_link', 'p_device_token' | 'p_paypay_request_url'>({
          p_share_token: shareToken,
          p_device_token: deviceToken ?? null,
          p_settlement_id: settlementId,
          p_paypay_request_url: paypayRequestUrl?.trim() || null,
        }),
      )
      requireSuccess(error)
    },

    async getExternalAccountLinks(shareToken, deviceToken) {
      const { data, error } = await supabase.rpc(
        'get_external_account_links',
        allowSqlNull<'get_external_account_links', 'p_device_token'>({
          p_share_token: shareToken,
          p_device_token: deviceToken ?? null,
        }),
      )
      return requireData(data as ExternalAccountLink[] | null, error)
    },

    async createExternalAccountLinkCode(shareToken, deviceToken, provider) {
      const { data, error } = await supabase.rpc(
        'create_member_link_code',
        allowSqlNull<'create_member_link_code', 'p_device_token'>({
          p_share_token: shareToken,
          p_device_token: deviceToken ?? null,
          p_provider: provider,
        }),
      )
      return requireData(data as ExternalAccountLinkCode | null, error)
    },

    async unlinkExternalAccount(shareToken, deviceToken, provider) {
      const { data, error } = await supabase.rpc(
        'unlink_external_account',
        allowSqlNull<'unlink_external_account', 'p_device_token'>({
          p_share_token: shareToken,
          p_device_token: deviceToken ?? null,
          p_provider: provider,
        }),
      )
      return requireData(data as boolean | null, error)
    },

    async addExpense(input: AddExpenseInput) {
      const { data, error } = await supabase.rpc(
        'add_expense',
        allowSqlNull<'add_expense', 'p_device_token' | 'p_day_index'>(expenseParams(input)),
      )
      return requireData(data as AddExpenseResult | null, error)
    },

    async updateExpense(input: ExpenseMutationInput) {
      const { data, error } = await supabase.rpc('update_expense', {
        ...allowSqlNull<'update_expense', 'p_device_token' | 'p_day_index'>({
          ...expenseParams(input),
          p_expense_id: input.expenseId,
        }),
      })
      return requireData(data as AddExpenseResult | null, error)
    },

    async saveOwnFixedAmount(shareToken, deviceToken, expenseId, fixedAmount) {
      const { error } = await supabase.rpc(
        'save_own_fixed_amount',
        allowSqlNull<'save_own_fixed_amount', 'p_fixed_amount'>({
          p_share_token: shareToken,
          p_device_token: deviceToken,
          p_expense_id: expenseId,
          p_fixed_amount: fixedAmount ?? null,
        }),
      )
      requireSuccess(error)
    },

    async finalizeExpense(shareToken, deviceToken, expenseId) {
      const { error } = await supabase.rpc(
        'finalize_expense',
        allowSqlNull<'finalize_expense', 'p_device_token'>({
          p_share_token: shareToken,
          p_device_token: deviceToken ?? null,
          p_expense_id: expenseId,
        }),
      )
      requireSuccess(error)
    },

    async deleteExpense(shareToken, deviceToken, expenseId) {
      const { error } = await supabase.rpc(
        'delete_expense',
        allowSqlNull<'delete_expense', 'p_device_token'>({
          p_share_token: shareToken,
          p_device_token: deviceToken ?? null,
          p_expense_id: expenseId,
        }),
      )
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

    async scheduleSettlementReminders(eventId) {
      const { data, error } = await supabase.rpc('schedule_settlement_reminders', { p_event_id: eventId })
      return requireData(data as number | null, error)
    },

    async reportSettlement(shareToken, deviceToken, settlementId) {
      const { error } = await supabase.rpc(
        'report_settlement',
        allowSqlNull<'report_settlement', 'p_device_token'>({
          p_share_token: shareToken,
          p_device_token: deviceToken ?? null,
          p_settlement_id: settlementId,
        }),
      )
      requireSuccess(error)
    },

    async confirmSettlement(shareToken, deviceToken, settlementId) {
      const { error } = await supabase.rpc(
        'confirm_settlement',
        allowSqlNull<'confirm_settlement', 'p_device_token'>({
          p_share_token: shareToken,
          p_device_token: deviceToken ?? null,
          p_settlement_id: settlementId,
        }),
      )
      requireSuccess(error)
    },

    async revertSettlement(shareToken, deviceToken, settlementId) {
      const { data, error } = await supabase.rpc(
        'revert_settlement',
        allowSqlNull<'revert_settlement', 'p_device_token'>({
          p_share_token: shareToken,
          p_device_token: deviceToken ?? null,
          p_settlement_id: settlementId,
        }),
      )
      return requireData(data as SettlementStatus | null, error)
    },

    subscribeToEventChanges(shareToken, onChange) {
      const managed = ensureEventChannel(shareToken)
      managed.listeners.add(onChange)

      return () => {
        managed.listeners.delete(onChange)
        if (managed.listeners.size === 0 && realtimeChannels.get(shareToken) === managed) {
          realtimeChannels.delete(shareToken)
          void supabase.removeChannel(managed.channel)
        }
      }
    },

    async broadcastEventChange(shareToken) {
      const managed = ensureEventChannel(shareToken)
      if (!await managed.subscribed) {
        console.warn('Realtimeチャンネルへ接続できなかったため、自動同期通知を送信できませんでした。')
        return
      }
      const response = await managed.channel.send({
        type: 'broadcast',
        event: 'event_changed',
        payload: {},
      })
      if (response !== 'ok') {
        console.warn(`自動同期通知の送信に失敗しました: ${response}`)
      }
    },
  }
}
