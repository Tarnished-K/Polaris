import { describe, expect, it } from 'vitest'

import {
  LOCAL_STATE_STORAGE_KEY,
  persistStoredState,
  readStoredState,
  type AppState,
} from './useWarikanApp'

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  removeItem(key: string) {
    this.values.delete(key)
  }
}

const localState = (): AppState => ({
  event: {
    id: 'event-id',
    shareToken: 'local-share-token',
    title: 'ローカル旅行',
    eventType: 'single_day',
    startDate: '2026-07-23',
    endDate: '2026-07-23',
    capacity: 4,
    status: 'active',
  },
  members: [{ id: 'member-id', name: 'あなた', isOrganizer: true }],
  currentMemberId: 'member-id',
  expenses: [],
  settlements: [],
  view: 'home',
  persistence: 'local',
})

describe('local app state persistence boundary', () => {
  it('keeps local-only events available across reloads', () => {
    const storage = new MemoryStorage()
    persistStoredState(storage, localState())

    expect(readStoredState(storage)).toEqual(localState())
  })

  it('removes cloud event snapshots instead of duplicating server state', () => {
    const storage = new MemoryStorage()
    persistStoredState(storage, localState())

    persistStoredState(storage, { ...localState(), persistence: 'remote' })

    expect(storage.getItem(LOCAL_STATE_STORAGE_KEY)).toBeNull()
    expect(readStoredState(storage).event).toBeNull()
  })

  it('does not restore a remote snapshot if one was written by an older build', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      LOCAL_STATE_STORAGE_KEY,
      JSON.stringify({ ...localState(), persistence: 'remote' }),
    )

    expect(readStoredState(storage).event).toBeNull()
  })

  it('migrates legacy local data but rejects an unmarked cloud snapshot', () => {
    const storage = new MemoryStorage()
    const { persistence: _persistence, ...legacyLocal } = {
      ...localState(),
      event: { ...localState().event!, shareToken: '0123456789abcdef0123456789abcdef0123' },
    }
    storage.setItem(LOCAL_STATE_STORAGE_KEY, JSON.stringify(legacyLocal))
    expect(readStoredState(storage).event?.title).toBe('ローカル旅行')

    storage.setItem(
      LOCAL_STATE_STORAGE_KEY,
      JSON.stringify({
        ...legacyLocal,
        event: { ...legacyLocal.event, shareToken: 'e9UroCb0tKc3NzEg0bUf_wy2OJkhmS2A' },
      }),
    )
    expect(readStoredState(storage).event).toBeNull()
  })
})
