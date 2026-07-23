import { describe, expect, it } from 'vitest'

import {
  getOrCreateEventSession,
  buildClaimDeepLink,
  buildPaymentDeepLink,
  buildSettlementDeepLink,
  parseSharedEventRoute,
  saveEventMember,
} from './sharedEventSession'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()

  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

describe('parseSharedEventRoute', () => {
  it('reads a shared event and optional claim token', () => {
    expect(parseSharedEventRoute('/e/share_123', '?claim=claim_456')).toEqual({
      shareToken: 'share_123',
      claimToken: 'claim_456',
      initialView: null,
      settlementId: null,
    })
    expect(buildClaimDeepLink('share_123', 'claim_456')).toBe('/e/share_123?claim=claim_456')
  })

  it('encodes claim tokens without changing the shared event route', () => {
    const deepLink = buildClaimDeepLink('share_123', 'claim +/? value')
    expect(deepLink).toBe('/e/share_123?claim=claim+%2B%2F%3F+value')
    expect(parseSharedEventRoute('/e/share_123', deepLink.slice(deepLink.indexOf('?')))?.claimToken)
      .toBe('claim +/? value')
  })

  it('reads a safe payment deep link without accepting arbitrary settlement IDs', () => {
    const settlementId = '10000000-0000-4000-8000-000000000001'
    expect(parseSharedEventRoute('/e/share_123', `?view=payment&settlement=${settlementId}`)).toEqual({
      shareToken: 'share_123',
      claimToken: null,
      initialView: 'payment',
      settlementId,
    })
    expect(parseSharedEventRoute('/e/share_123', '?view=payment&settlement=../../secret')?.settlementId).toBeNull()
    expect(buildPaymentDeepLink('share_123', settlementId)).toBe(
      `/e/share_123?view=payment&settlement=${settlementId}`,
    )
    expect(buildSettlementDeepLink('share_123', settlementId)).toBe(
      `/e/share_123?view=settlement&settlement=${settlementId}`,
    )
    expect(parseSharedEventRoute('/e/share_123', `?view=settlement&settlement=${settlementId}`)?.initialView).toBe('settlement')
  })

  it('rejects unrelated and nested paths', () => {
    expect(parseSharedEventRoute('/')).toBeNull()
    expect(parseSharedEventRoute('/e/token/extra')).toBeNull()
  })
})

describe('event device sessions', () => {
  it('reuses one device token for the same event', () => {
    const storage = new MemoryStorage()
    const first = getOrCreateEventSession(storage, 'event-a')
    const second = getOrCreateEventSession(storage, 'event-a')

    expect(first.deviceToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(second).toEqual(first)
  })

  it('stores the joined member without changing the device token', () => {
    const storage = new MemoryStorage()
    const first = getOrCreateEventSession(storage, 'event-a')
    const joined = saveEventMember(storage, 'event-a', 'member-1')

    expect(joined).toEqual({ deviceToken: first.deviceToken, memberId: 'member-1' })
    expect(getOrCreateEventSession(storage, 'event-a')).toEqual(joined)
  })

  it('uses an unlinkable device token per event', () => {
    const storage = new MemoryStorage()
    expect(getOrCreateEventSession(storage, 'event-a').deviceToken)
      .not.toBe(getOrCreateEventSession(storage, 'event-b').deviceToken)
  })
})
