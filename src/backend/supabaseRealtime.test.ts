import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import { createWarikanBackend } from './supabase'

describe('event Realtime broadcast', () => {
  it('shares one channel for subscription and change notifications, then removes it', async () => {
    let receiveBroadcast: (() => void) | undefined
    const send = vi.fn().mockResolvedValue('ok')
    const channel = {
      on: vi.fn((_type, _filter, callback: () => void) => {
        receiveBroadcast = callback
        return channel
      }),
      subscribe: vi.fn((callback: (status: string) => void) => {
        callback('SUBSCRIBED')
        return channel
      }),
      send,
    }
    const client = {
      channel: vi.fn().mockReturnValue(channel),
      removeChannel: vi.fn().mockResolvedValue('ok'),
    }
    const backend = createWarikanBackend(
      { url: 'https://example.supabase.co', publishableKey: 'test-key' },
      client as unknown as SupabaseClient,
    )
    const onChange = vi.fn()

    const unsubscribe = backend.subscribeToEventChanges('shared-token', onChange)
    receiveBroadcast?.()
    await backend.broadcastEventChange('shared-token')

    expect(client.channel).toHaveBeenCalledOnce()
    expect(client.channel).toHaveBeenCalledWith('event:shared-token', {
      config: { broadcast: { self: false, ack: true } },
    })
    expect(onChange).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith({
      type: 'broadcast',
      event: 'event_changed',
      payload: {},
    })

    unsubscribe()
    expect(client.removeChannel).toHaveBeenCalledWith(channel)
  })
})
