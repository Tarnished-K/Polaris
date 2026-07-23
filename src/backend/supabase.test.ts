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
})
