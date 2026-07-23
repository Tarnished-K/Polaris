import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import { createWarikanBackend, generateDeviceToken } from './supabase'

describe('generateDeviceToken', () => {
  it('creates a URL-safe token backed by 32 random bytes', () => {
    const token = generateDeviceToken()

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('does not reuse tokens', () => {
    expect(generateDeviceToken()).not.toBe(generateDeviceToken())
  })
})

describe('expense mutation transport', () => {
  it('sends an idempotency key only when adding an expense', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { expenseId: 'expense-a', status: 'finalized' },
      error: null,
    })
    const backend = createWarikanBackend(
      { url: 'https://example.supabase.co', publishableKey: 'test-key' },
      { rpc } as unknown as SupabaseClient,
    )
    const input = {
      shareToken: 'share-token',
      deviceToken: 'device-token',
      category: 'food' as const,
      title: 'Lunch',
      amount: 1200,
      payerMemberId: 'member-a',
      splitMethod: 'equal' as const,
      targets: [{ memberId: 'member-a' }],
    }

    await backend.addExpense({
      ...input,
      idempotencyKey: '9b77bf66-9655-4e75-85e4-a855f16f5f8f',
    })
    await backend.updateExpense({
      ...input,
      expenseId: 'expense-a',
    })

    expect(rpc.mock.calls[0]).toEqual([
      'add_expense',
      {
        p_share_token: 'share-token',
        p_device_token: 'device-token',
        p_category: 'food',
        p_title: 'Lunch',
        p_note: null,
        p_amount: 1200,
        p_payer_member_id: 'member-a',
        p_split_method: 'equal',
        p_day_index: null,
        p_targets: [{ memberId: 'member-a' }],
        p_idempotency_key: '9b77bf66-9655-4e75-85e4-a855f16f5f8f',
      },
    ])
    expect(rpc.mock.calls[1]).toEqual([
      'update_expense',
      {
        p_share_token: 'share-token',
        p_device_token: 'device-token',
        p_category: 'food',
        p_title: 'Lunch',
        p_note: null,
        p_amount: 1200,
        p_payer_member_id: 'member-a',
        p_split_method: 'equal',
        p_day_index: null,
        p_targets: [{ memberId: 'member-a' }],
        p_expense_id: 'expense-a',
      },
    ])
  })
})

describe('share URL rotation', () => {
  it('uses the authenticated organizer RPC and returns the new event state', async () => {
    const state = {
      event: { id: 'event-a', shareToken: 'new-token' },
      members: [],
      expenses: [],
      settlements: [],
    }
    const rpc = vi.fn().mockResolvedValue({ data: state, error: null })
    const backend = createWarikanBackend(
      { url: 'https://example.supabase.co', publishableKey: 'test-key' },
      { rpc } as unknown as SupabaseClient,
    )

    await expect(backend.organizerRegenerateShareToken('event-a')).resolves.toBe(state)
    expect(rpc).toHaveBeenCalledWith('organizer_regenerate_share_token', { p_event_id: 'event-a' })
  })
})

describe('event deletion', () => {
  it('uses the authenticated organizer RPC and does not hide a backend rejection', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'ORGANIZER_REQUIRED' } })
    const backend = createWarikanBackend(
      { url: 'https://example.supabase.co', publishableKey: 'test-key' },
      { rpc } as unknown as SupabaseClient,
    )

    await expect(backend.organizerDeleteEvent('event-a')).resolves.toBeUndefined()
    await expect(backend.organizerDeleteEvent('event-b')).rejects.toThrow('ORGANIZER_REQUIRED')
    expect(rpc.mock.calls).toEqual([
      ['organizer_delete_event', { p_event_id: 'event-a' }],
      ['organizer_delete_event', { p_event_id: 'event-b' }],
    ])
  })
})

describe('claim invitation handoff', () => {
  it('issues a seven-day one-time invitation through the authenticated organizer RPC', async () => {
    const invitation = {
      memberId: 'member-a',
      claimToken: 'claim-token',
      expiresAt: '2026-07-31T00:00:00Z',
    }
    const rpc = vi.fn().mockResolvedValue({ data: invitation, error: null })
    const backend = createWarikanBackend(
      { url: 'https://example.supabase.co', publishableKey: 'test-key' },
      { rpc } as unknown as SupabaseClient,
    )

    await expect(backend.organizerIssueClaimToken('event-a', 'member-a')).resolves.toBe(invitation)
    expect(rpc).toHaveBeenCalledWith('organizer_issue_claim_token', {
      p_event_id: 'event-a',
      p_member_id: 'member-a',
    })
  })

  it('does not hide the backend rejection for a claimed or unrelated member', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'MEMBER_NOT_CLAIMABLE' },
    })
    const backend = createWarikanBackend(
      { url: 'https://example.supabase.co', publishableKey: 'test-key' },
      { rpc } as unknown as SupabaseClient,
    )

    await expect(backend.organizerIssueClaimToken('event-a', 'claimed-member'))
      .rejects.toThrow('MEMBER_NOT_CLAIMABLE')
  })
})

describe('notification integration settings', () => {
  it('uses the authenticated Edge Function without exposing saved destinations', async () => {
    const integration = {
      id: 'integration-a',
      provider: 'discord',
      externalSpaceName: 'Discord Webhook …123456',
      status: 'active',
    }
    const invoke = vi.fn()
      .mockResolvedValueOnce({ data: { integrations: [integration] }, error: null })
      .mockResolvedValueOnce({ data: { integration }, error: null })
      .mockResolvedValueOnce({ data: { ok: true }, error: null })
    const backend = createWarikanBackend(
      { url: 'https://example.supabase.co', publishableKey: 'test-key' },
      { functions: { invoke } } as unknown as SupabaseClient,
    )

    await expect(backend.listNotificationIntegrations('event-a')).resolves.toEqual([integration])
    await expect(backend.saveNotificationIntegration('event-a', 'discord', 'https://discord.com/api/webhooks/123/token')).resolves.toEqual(integration)
    await expect(backend.deleteNotificationIntegration('event-a', 'discord')).resolves.toBeUndefined()
    expect(invoke.mock.calls).toEqual([
      ['integration-settings', { body: { action: 'list', eventId: 'event-a' } }],
      ['integration-settings', { body: { action: 'save', eventId: 'event-a', provider: 'discord', destination: 'https://discord.com/api/webhooks/123/token' } }],
      ['integration-settings', { body: { action: 'delete', eventId: 'event-a', provider: 'discord' } }],
    ])
  })

  it('queues a provider-neutral test notification through the organizer RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'job-a', error: null })
    const backend = createWarikanBackend(
      { url: 'https://example.supabase.co', publishableKey: 'test-key' },
      { rpc } as unknown as SupabaseClient,
    )
    await expect(backend.queueTestNotification('event-a', 'integration-a', 'Test')).resolves.toBe('job-a')
    expect(rpc).toHaveBeenCalledWith('organizer_queue_notification', expect.objectContaining({
      p_event_id: 'event-a',
      p_integration_id: 'integration-a',
      p_notification_type: 'integration_test',
      p_payload: { message: 'Test' },
    }))
  })

  it('schedules only server-selected pending settlement reminders', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 2, error: null })
    const backend = createWarikanBackend(
      { url: 'https://example.supabase.co', publishableKey: 'test-key' },
      { rpc } as unknown as SupabaseClient,
    )
    await expect(backend.scheduleSettlementReminders('event-a')).resolves.toBe(2)
    expect(rpc).toHaveBeenCalledWith('schedule_settlement_reminders', { p_event_id: 'event-a' })
  })
})

describe('payment handoff backend', () => {
  it('loads actor-scoped payment data and saves profile and request-link changes', async () => {
    const paymentState = {
      currentMemberId: 'member-a',
      profiles: [{ memberId: 'member-a', paypayId: 'alice_123', acceptsCash: true }],
      links: [{ settlementId: 'settlement-a', paypayRequestUrl: 'https://paypay.ne.jp/request/example' }],
    }
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: paymentState, error: null })
      .mockResolvedValueOnce({ data: paymentState.profiles[0], error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
    const backend = createWarikanBackend(
      { url: 'https://example.supabase.co', publishableKey: 'test-key' },
      { rpc } as unknown as SupabaseClient,
    )

    await expect(backend.getPaymentState('share-token', 'device-token')).resolves.toEqual(paymentState)
    await expect(backend.savePaymentProfile('share-token', 'device-token', {
      paypayId: 'alice_123',
      acceptsCash: true,
    })).resolves.toEqual(paymentState.profiles[0])
    await expect(backend.saveSettlementPaymentLink(
      'share-token',
      'device-token',
      'settlement-a',
      'https://paypay.ne.jp/request/example',
    )).resolves.toBeUndefined()
    await expect(backend.deletePaymentProfile('share-token', 'device-token')).resolves.toBeUndefined()

    expect(rpc.mock.calls).toEqual([
      ['get_payment_state', {
        p_share_token: 'share-token',
        p_device_token: 'device-token',
      }],
      ['upsert_payment_profile', {
        p_share_token: 'share-token',
        p_device_token: 'device-token',
        p_paypay_id: 'alice_123',
        p_accepts_cash: true,
      }],
      ['set_settlement_payment_link', {
        p_share_token: 'share-token',
        p_device_token: 'device-token',
        p_settlement_id: 'settlement-a',
        p_paypay_request_url: 'https://paypay.ne.jp/request/example',
      }],
      ['delete_payment_profile', {
        p_share_token: 'share-token',
        p_device_token: 'device-token',
      }],
    ])
  })

  it('issues, lists, and removes actor-scoped external account links', async () => {
    const links = [{ provider: 'line', verifiedAt: '2026-07-23T00:00:00Z' }]
    const code = { provider: 'discord', code: 'ABCD1234', expiresAt: '2026-07-23T00:05:00Z' }
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: links, error: null })
      .mockResolvedValueOnce({ data: code, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
    const backend = createWarikanBackend(
      { url: 'https://example.supabase.co', publishableKey: 'test-key' },
      { rpc } as unknown as SupabaseClient,
    )

    await expect(backend.getExternalAccountLinks('share-token', 'device-token')).resolves.toEqual(links)
    await expect(backend.createExternalAccountLinkCode('share-token', 'device-token', 'discord')).resolves.toEqual(code)
    await expect(backend.unlinkExternalAccount('share-token', 'device-token', 'line')).resolves.toBe(true)
    expect(rpc.mock.calls).toEqual([
      ['get_external_account_links', {
        p_share_token: 'share-token',
        p_device_token: 'device-token',
      }],
      ['create_member_link_code', {
        p_share_token: 'share-token',
        p_device_token: 'device-token',
        p_provider: 'discord',
      }],
      ['unlink_external_account', {
        p_share_token: 'share-token',
        p_device_token: 'device-token',
        p_provider: 'line',
      }],
    ])
  })
})
