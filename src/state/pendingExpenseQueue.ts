import type { AddExpenseInput } from '../backend/types'

const STORAGE_KEY = 'warikan.web.pending-expenses.v1'

export type PendingExpense = {
  id: string
  shareToken: string
  input: Omit<AddExpenseInput, 'deviceToken' | 'idempotencyKey' | 'shareToken'>
  queuedAt: string
  status: 'pending' | 'sending' | 'failed'
  attempts: number
  lastError?: string
}

type StoredPendingInput = PendingExpense['input'] & { idempotencyKey?: unknown }

function withoutStoredIdempotencyKey(input: StoredPendingInput): PendingExpense['input'] {
  const { idempotencyKey: _idempotencyKey, ...safeInput } = input
  return safeInput
}

export function pendingExpenseIdempotencyKey(id: string): string | undefined {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? id
    : undefined
}

export function readPendingExpenses(storage: Storage): PendingExpense[] {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed)
      ? parsed
          .filter((item) => Boolean(item?.id && item?.shareToken && item?.input))
          .map((item) => ({
            ...item,
            input: withoutStoredIdempotencyKey(item.input),
            status: item.status === 'failed' || item.status === 'sending' ? item.status : 'pending',
            attempts: Number.isInteger(item.attempts) ? item.attempts : 0,
          }))
      : []
  } catch {
    return []
  }
}

function writePendingExpenses(storage: Storage, items: PendingExpense[]): void {
  if (items.length === 0) storage.removeItem(STORAGE_KEY)
  else storage.setItem(STORAGE_KEY, JSON.stringify(items))
}

export function enqueuePendingExpense(storage: Storage, shareToken: string, input: PendingExpense['input']): PendingExpense {
  const pending: PendingExpense = {
    id: crypto.randomUUID(),
    shareToken,
    input: withoutStoredIdempotencyKey(input),
    queuedAt: new Date().toISOString(),
    status: 'pending',
    attempts: 0,
  }
  writePendingExpenses(storage, [...readPendingExpenses(storage), pending])
  return pending
}

export function pendingExpensesForEvent(storage: Storage, shareToken: string): PendingExpense[] {
  return readPendingExpenses(storage).filter((item) => item.shareToken === shareToken)
}

export function removePendingExpense(storage: Storage, id: string): void {
  writePendingExpenses(storage, readPendingExpenses(storage).filter((item) => item.id !== id))
}

function updatePendingExpense(storage: Storage, id: string, update: Partial<PendingExpense>): void {
  writePendingExpenses(storage, readPendingExpenses(storage).map((item) => item.id === id ? { ...item, ...update } : item))
}

export function retryPendingExpense(storage: Storage, id: string): void {
  updatePendingExpense(storage, id, { status: 'pending', attempts: 0, lastError: undefined })
}

export type FlushPendingExpensesOptions = {
  storage: Storage
  shareToken: string
  send: (pending: PendingExpense) => Promise<void>
  sleep?: (milliseconds: number) => Promise<void>
  onChange?: (items: PendingExpense[]) => void
}

const retryDelays = [3000, 9000]

export async function flushPendingExpenses({
  storage,
  shareToken,
  send,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  onChange,
}: FlushPendingExpensesOptions): Promise<number> {
  let sent = 0
  const notify = () => onChange?.(pendingExpensesForEvent(storage, shareToken))

  for (const queued of pendingExpensesForEvent(storage, shareToken)) {
    if (queued.status === 'failed') continue
    let pending = queued
    while (pending.attempts < 3) {
      updatePendingExpense(storage, pending.id, { status: 'sending', lastError: undefined })
      pending = { ...pending, status: 'sending' }
      notify()
      try {
        await send(pending)
        removePendingExpense(storage, pending.id)
        sent += 1
        notify()
        break
      } catch (cause) {
        const attempts = pending.attempts + 1
        const lastError = cause instanceof Error ? cause.message : '送信に失敗しました。'
        const status = attempts >= 3 ? 'failed' : 'pending'
        updatePendingExpense(storage, pending.id, { attempts, lastError, status })
        pending = { ...pending, attempts, lastError, status }
        notify()
        if (status === 'failed') break
        await sleep(retryDelays[attempts - 1])
      }
    }
    if (pending.status === 'failed') break
  }

  return sent
}
