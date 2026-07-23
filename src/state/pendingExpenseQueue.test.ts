import { describe, expect, it } from 'vitest'
import {
  enqueuePendingExpense,
  flushPendingExpenses,
  pendingExpensesForEvent,
  pendingExpenseIdempotencyKey,
  readPendingExpenses,
  removePendingExpense,
  retryPendingExpense,
} from './pendingExpenseQueue'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

describe('pending expense queue', () => {
  it('stores event-scoped operations without a device token and removes successful items', () => {
    const storage = new MemoryStorage()
    const pending = enqueuePendingExpense(storage, 'event-a', {
      category: 'food', title: 'Offline lunch', amount: 1200, payerMemberId: 'member-a', splitMethod: 'equal', targets: []
    })
    expect(JSON.stringify(readPendingExpenses(storage))).not.toContain('deviceToken')
    expect(JSON.stringify(readPendingExpenses(storage))).not.toContain('idempotencyKey')
    expect(pendingExpensesForEvent(storage, 'event-a')).toHaveLength(1)
    expect(pendingExpensesForEvent(storage, 'event-b')).toHaveLength(0)
    removePendingExpense(storage, pending.id)
    expect(readPendingExpenses(storage)).toHaveLength(0)
  })

  it('ignores invalid stored JSON', () => {
    const storage = new MemoryStorage()
    storage.setItem('warikan.web.pending-expenses.v1', '{')
    expect(readPendingExpenses(storage)).toEqual([])
  })

  it('restores legacy queued items with retry defaults', () => {
    const storage = new MemoryStorage()
    storage.setItem('warikan.web.pending-expenses.v1', JSON.stringify([{
      id: 'legacy', shareToken: 'event-a', queuedAt: '2026-07-23T00:00:00.000Z', input: { title: 'Lunch' },
    }]))
    expect(readPendingExpenses(storage)[0]).toMatchObject({ status: 'pending', attempts: 0 })
    expect(pendingExpenseIdempotencyKey('legacy')).toBeUndefined()
  })

  it('uses only valid UUID queue IDs as idempotency keys', () => {
    const id = '9b77bf66-9655-4e75-85e4-a855f16f5f8f'
    expect(pendingExpenseIdempotencyKey(id)).toBe(id)
    expect(pendingExpenseIdempotencyKey('manually-corrupted')).toBeUndefined()
  })

  it('sends event items in registration order and removes successes', async () => {
    const storage = new MemoryStorage()
    enqueuePendingExpense(storage, 'event-a', { category: 'food', title: 'First', amount: 100, payerMemberId: 'a', splitMethod: 'equal', targets: [] })
    enqueuePendingExpense(storage, 'event-b', { category: 'food', title: 'Other event', amount: 200, payerMemberId: 'b', splitMethod: 'equal', targets: [] })
    enqueuePendingExpense(storage, 'event-a', { category: 'food', title: 'Second', amount: 300, payerMemberId: 'a', splitMethod: 'equal', targets: [] })
    const sent: string[] = []

    const count = await flushPendingExpenses({
      storage,
      shareToken: 'event-a',
      send: async (pending) => { sent.push(pending.input.title) },
    })

    expect(count).toBe(2)
    expect(sent).toEqual(['First', 'Second'])
    expect(readPendingExpenses(storage).map((item) => item.shareToken)).toEqual(['event-b'])
  })

  it('retries with 3 and 9 second backoff before succeeding', async () => {
    const storage = new MemoryStorage()
    enqueuePendingExpense(storage, 'event-a', { category: 'food', title: 'Retry', amount: 100, payerMemberId: 'a', splitMethod: 'equal', targets: [] })
    const delays: number[] = []
    let attempts = 0

    await flushPendingExpenses({
      storage,
      shareToken: 'event-a',
      send: async () => {
        attempts += 1
        if (attempts < 3) throw new Error('temporary')
      },
      sleep: async (milliseconds) => { delays.push(milliseconds) },
    })

    expect(attempts).toBe(3)
    expect(delays).toEqual([3000, 9000])
    expect(readPendingExpenses(storage)).toEqual([])
  })

  it('marks an item failed after three attempts and allows manual retry', async () => {
    const storage = new MemoryStorage()
    const pending = enqueuePendingExpense(storage, 'event-a', { category: 'food', title: 'Failure', amount: 100, payerMemberId: 'a', splitMethod: 'equal', targets: [] })
    await flushPendingExpenses({
      storage,
      shareToken: 'event-a',
      send: async () => { throw new Error('network unavailable') },
      sleep: async () => undefined,
    })

    expect(readPendingExpenses(storage)[0]).toMatchObject({
      status: 'failed',
      attempts: 3,
      lastError: 'network unavailable',
    })
    retryPendingExpense(storage, pending.id)
    expect(readPendingExpenses(storage)[0]).toMatchObject({
      status: 'pending',
      attempts: 0,
    })
  })

  it('reports sending and failure state changes to the UI', async () => {
    const storage = new MemoryStorage()
    enqueuePendingExpense(storage, 'event-a', { category: 'food', title: 'Visible', amount: 100, payerMemberId: 'a', splitMethod: 'equal', targets: [] })
    const statuses: string[] = []
    await flushPendingExpenses({
      storage,
      shareToken: 'event-a',
      send: async () => { throw new Error('no') },
      sleep: async () => undefined,
      onChange: (items) => { statuses.push(items[0]?.status ?? 'removed') },
    })
    expect(statuses).toContain('sending')
    expect(statuses.at(-1)).toBe('failed')
  })
})
