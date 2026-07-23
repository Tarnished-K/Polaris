import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import { createDemoData, createFourPersonDemoData } from '../data/demo'
import {
  calculateBalances,
  generatePairwiseSettlements,
  splitExpense,
} from '../domain/settlement'
import type {
  EventDraft,
  Expense,
  Member,
  Settlement,
  WarikanEvent,
} from '../domain/types'
import { nextAvailableMemberName } from '../lib/validation'
import { CATEGORY_IDS } from '../domain/types'
import { createRandomId, createShareToken } from '../lib/random'
import type { EventState } from '../backend/types'

export type AppView = 'create' | 'home' | 'expense' | 'dashboard' | 'settlement' | 'payment' | 'settings'

export interface NewExpenseInput {
  category: Expense['category']
  title: string
  amount: number
  payerMemberId: string
  targetMemberIds: string[]
  splitMethod: Expense['splitMethod']
  fixedAmounts?: Record<string, number>
  dayIndex?: number
}

export interface AppState {
  event: WarikanEvent | null
  members: Member[]
  currentMemberId: string | null
  expenses: Expense[]
  settlements: Settlement[]
  view: AppView
  persistence: 'local' | 'remote'
}

export interface WarikanAppState {
  event: WarikanEvent | null
  members: Member[]
  currentMemberId: string | null
  expenses: Expense[]
  settlements: Settlement[]
  displaySettlements: Settlement[]
  balances: Record<string, number>
  totalSpent: number
  draftExpenseCount: number
  view: AppView
  setView: Dispatch<SetStateAction<AppView>>
  setCurrentMember: (memberId: string) => void
  loadRemoteEvent: (remote: EventState, currentMemberId?: string | null) => void
  createEvent: (draft: EventDraft) => void
  updateEvent: (draft: EventDraft) => void
  addMember: (name: string) => void
  removeMember: (memberId: string) => void
  loadDemo: () => void
  loadFourPersonDemo: () => void
  addExpense: (input: NewExpenseInput) => void
  updateExpense: (expenseId: string, input: NewExpenseInput) => void
  saveDraftExpense: (expenseId: string, input: NewExpenseInput) => void
  finalizeExpense: (expenseId: string, input: NewExpenseInput) => void
  deleteExpense: (expenseId: string) => void
  finalizeEvent: () => void
  unfinalizeEvent: () => void
  reportSettlement: (id: string) => void
  confirmSettlement: (id: string) => void
  revertSettlement: (id: string) => void
  resetApp: () => void
}

export const LOCAL_STATE_STORAGE_KEY = 'warikan.web.mvp.v1'
const APP_VIEWS: AppView[] = ['create', 'home', 'expense', 'dashboard', 'settlement', 'payment', 'settings']

function createEmptyState(): AppState {
  return {
    event: null,
    members: [],
    currentMemberId: null,
    expenses: [],
    settlements: [],
    view: 'create',
    persistence: 'local',
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

type StateStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function readStoredState(
  storage: StateStorage | null = typeof window === 'undefined' ? null : window.localStorage,
): AppState {
  if (!storage) return createEmptyState()

  try {
    const raw = storage.getItem(LOCAL_STATE_STORAGE_KEY)
    if (!raw) return createEmptyState()

    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return createEmptyState()
    if (parsed.persistence === 'remote') return createEmptyState()

    const { event, members, currentMemberId, expenses, settlements, view } = parsed
    const validEvent = event === null || isRecord(event)
    const validCurrentMemberId =
      currentMemberId === null || typeof currentMemberId === 'string'
    const validView =
      typeof view === 'string' && APP_VIEWS.includes(view as AppView)

    if (
      !validEvent ||
      !Array.isArray(members) ||
      !validCurrentMemberId ||
      !Array.isArray(expenses) ||
      !Array.isArray(settlements) ||
      !validView
    ) {
      return createEmptyState()
    }

    const normalizedExpenses = (expenses as Expense[]).map((expense) => ({
      ...expense,
      status: expense.status ?? ('finalized' as const),
    }))
    const storedSettlements = settlements as Settlement[]
    const hasLegacySettlements = storedSettlements.some(
      (settlement) =>
        !Array.isArray(settlement.charges) ||
        !Array.isArray(settlement.offsets),
    )
    const normalizedEvent = event as unknown as WarikanEvent | null
    const isLegacyLocalState =
      parsed.persistence === undefined &&
      normalizedEvent !== null &&
      /^[0-9a-f]{36}$/.test(normalizedEvent.shareToken)
    if (parsed.persistence !== 'local' && !isLegacyLocalState) {
      return createEmptyState()
    }

    return {
      event:
        normalizedEvent && hasLegacySettlements
          ? { ...normalizedEvent, status: 'active' }
          : normalizedEvent,
      members: members as Member[],
      currentMemberId,
      expenses: normalizedExpenses,
      settlements: hasLegacySettlements ? [] : storedSettlements,
      view: view as AppView,
      persistence: 'local',
    }
  } catch {
    return createEmptyState()
  }
}

export function persistStoredState(storage: StateStorage, state: AppState): void {
  if (state.event === null || state.persistence !== 'local') {
    storage.removeItem(LOCAL_STATE_STORAGE_KEY)
  } else {
    storage.setItem(LOCAL_STATE_STORAGE_KEY, JSON.stringify(state))
  }
}

function isOrganizer(state: AppState): boolean {
  return state.members.some(
    (member) =>
      member.id === state.currentMemberId && member.isOrganizer === true,
  )
}

function validateEventDraft(draft: EventDraft): void {
  if (!draft.title.trim()) throw new Error('イベント名を入力してください')
  if (!draft.startDate || !draft.endDate || draft.endDate < draft.startDate) {
    throw new Error('イベントの日程が正しくありません')
  }
  if (!Number.isInteger(draft.capacity) || draft.capacity < 2 || draft.capacity > 50) {
    throw new Error('定員は2〜50人で指定してください')
  }
}

function validateExpenseInput(
  input: NewExpenseInput,
  event: WarikanEvent,
  members: Member[],
): void {
  const memberIds = new Set(members.map(({ id }) => id))
  const uniqueTargetIds = new Set(input.targetMemberIds)

  if (!input.title.trim()) throw new Error('支出の内容を入力してください')
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error('金額は1円以上の整数で入力してください')
  }
  if (!CATEGORY_IDS.includes(input.category)) {
    throw new Error('カテゴリが正しくありません')
  }
  if (!memberIds.has(input.payerMemberId)) {
    throw new Error('支払った人がメンバーにいません')
  }
  if (
    uniqueTargetIds.size !== input.targetMemberIds.length ||
    input.targetMemberIds.some((id) => !memberIds.has(id))
  ) {
    throw new Error('割る相手を正しく選んでください')
  }
  if (
    input.dayIndex !== undefined &&
    (!Number.isInteger(input.dayIndex) ||
      input.dayIndex < 1 ||
      input.dayIndex >
        Math.floor(
          (Date.parse(event.endDate) - Date.parse(event.startDate)) /
            (24 * 60 * 60 * 1_000),
        ) +
          1)
  ) {
    throw new Error('日付の指定が正しくありません')
  }

  if (input.splitMethod === 'fixed') {
    const fixedAmounts = input.fixedAmounts ?? {}
    const fixedIds = Object.keys(fixedAmounts)
    if (
      fixedIds.some((id) => !uniqueTargetIds.has(id)) ||
      fixedIds.some((id) => {
        const amount = fixedAmounts[id]
        return !Number.isInteger(amount) || amount < 0
      })
    ) {
      throw new Error('金額指定の内訳が正しくありません')
    }
  } else if (input.targetMemberIds.length === 0) {
    throw new Error('均等割りの相手を1人以上選んでください')
  }
}

function isCompleteAllocation(input: NewExpenseInput): boolean {
  if (input.splitMethod === 'equal') return input.targetMemberIds.length > 0

  const fixedAmounts = input.fixedAmounts ?? {}
  return (
    input.targetMemberIds.length > 0 &&
    Object.keys(fixedAmounts).length === input.targetMemberIds.length &&
    input.targetMemberIds.every((id) =>
      Object.prototype.hasOwnProperty.call(fixedAmounts, id),
    ) &&
    Object.values(fixedAmounts).reduce((sum, amount) => sum + amount, 0) ===
      input.amount
  )
}

export function useWarikanApp(): WarikanAppState {
  const [state, setState] = useState<AppState>(readStoredState)

  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      persistStoredState(window.localStorage, state)
    } catch {
      // The app remains usable in private browsing or when storage is full.
    }
  }, [state])

  const finalizedExpenses = useMemo(
    () => state.expenses.filter((expense) => expense.status === 'finalized'),
    [state.expenses],
  )

  const balances = useMemo(
    () => calculateBalances(state.members, finalizedExpenses),
    [state.members, finalizedExpenses],
  )

  const previewSettlements = useMemo<Settlement[]>(() => {
    if (!state.event || state.event.status === 'finalized') return []

    return generatePairwiseSettlements(state.members, finalizedExpenses).map(
      (transfer) => ({
      ...transfer,
      id: `preview:${transfer.fromMemberId}:${transfer.toMemberId}`,
      status: transfer.amount === 0 ? ('paid' as const) : ('pending' as const),
      }),
    )
  }, [finalizedExpenses, state.event, state.members])

  const displaySettlements =
    state.event?.status === 'finalized'
      ? state.settlements
      : previewSettlements

  const totalSpent = useMemo(
    () => state.expenses.reduce((total, expense) => total + expense.amount, 0),
    [state.expenses],
  )

  const draftExpenseCount = useMemo(
    () => state.expenses.filter((expense) => expense.status === 'draft').length,
    [state.expenses],
  )

  const setView = useCallback<Dispatch<SetStateAction<AppView>>>((nextView) => {
    setState((current) => ({
      ...current,
      view:
        typeof nextView === 'function'
          ? nextView(current.view)
          : nextView,
    }))
  }, [])

  const setCurrentMember = useCallback((memberId: string) => {
    setState((current) =>
      current.members.some((member) => member.id === memberId)
        ? { ...current, currentMemberId: memberId, view: current.view === 'expense' || current.view === 'settings' ? 'home' : current.view }
        : current,
    )
  }, [])

  const loadRemoteEvent = useCallback((remote: EventState, memberId?: string | null) => {
    const resolvedMemberId = memberId && remote.members.some((member) => member.id === memberId)
      ? memberId
      : null
    setState({
      event: remote.event,
      members: remote.members,
      currentMemberId: resolvedMemberId,
      expenses: remote.expenses,
      settlements: remote.settlements,
      view: 'home',
      persistence: 'remote',
    })
  }, [])

  const createEvent = useCallback((draft: EventDraft) => {
    validateEventDraft(draft)

    const organizerId = createRandomId()
    const event: WarikanEvent = {
      id: createRandomId(),
      shareToken: createShareToken(),
      title: draft.title.trim(),
      eventType: draft.eventType,
      startDate: draft.startDate,
      endDate: draft.endDate,
      capacity: draft.capacity,
      status: 'active',
    }

    setState({
      event,
      members: [{ id: organizerId, name: 'あなた', isOrganizer: true }],
      currentMemberId: organizerId,
      expenses: [],
      settlements: [],
      view: 'home',
      persistence: 'local',
    })
  }, [])

  const updateEvent = useCallback((draft: EventDraft) => {
    setState((current) => {
      if (!current.event || !isOrganizer(current)) return current
      const normalized = { ...draft, capacity: Math.max(draft.capacity, current.members.length) }
      validateEventDraft(normalized)
      const dayCount = normalized.eventType === 'single_day'
        ? 1
        : Math.floor((Date.parse(normalized.endDate) - Date.parse(normalized.startDate)) / 86_400_000) + 1
      return {
        ...current,
        event: {
          ...current.event,
          title: normalized.title.trim(),
          eventType: normalized.eventType,
          startDate: normalized.startDate,
          endDate: normalized.eventType === 'single_day' ? normalized.startDate : normalized.endDate,
          capacity: normalized.capacity,
        },
        expenses: current.expenses.map((expense) => ({
          ...expense,
          dayIndex: normalized.eventType === 'single_day' || (expense.dayIndex ?? 0) > dayCount
            ? undefined
            : expense.dayIndex,
        })),
      }
    })
  }, [])

  const addMember = useCallback((name: string) => {
    setState((current) => {
      const trimmed = name.trim()
      if (
        !current.event ||
        current.event.status !== 'active' ||
        !isOrganizer(current) ||
        !trimmed ||
        current.members.length >= 50
      ) return current
      const availableName = nextAvailableMemberName(current.members.map((member) => member.name), trimmed)
      return {
        ...current,
        event: { ...current.event, capacity: Math.max(current.event.capacity, current.members.length + 1) },
        members: [...current.members, { id: createRandomId(), name: availableName }],
      }
    })
  }, [])

  const removeMember = useCallback((memberId: string) => {
    setState((current) => {
      if (!current.event || current.event.status !== 'active' || !isOrganizer(current)) return current
      const member = current.members.find((item) => item.id === memberId)
      if (!member || member.isOrganizer) return current
      const isReferenced = current.expenses.some((expense) =>
        expense.payerMemberId === memberId ||
        expense.createdByMemberId === memberId ||
        expense.targetMemberIds.includes(memberId),
      )
      if (isReferenced) return current
      return { ...current, members: current.members.filter((item) => item.id !== memberId) }
    })
  }, [])

  const loadDemo = useCallback(() => {
    const demo = createDemoData()
    setState({
      ...demo,
      settlements: [],
      view: 'home',
      persistence: 'local',
    })
  }, [])

  const loadFourPersonDemo = useCallback(() => {
    const demo = createFourPersonDemoData()
    setState({
      ...demo,
      settlements: [],
      view: 'home',
      persistence: 'local',
    })
  }, [])

  const addExpense = useCallback((input: NewExpenseInput) => {
    setState((current) => {
      if (
        !current.event ||
        current.event.status !== 'active' ||
        !current.currentMemberId
      ) {
        return current
      }

      const organizer = isOrganizer(current)
      const canManageAllocation = organizer || input.payerMemberId === current.currentMemberId
      const effectiveInput: NewExpenseInput = canManageAllocation
        ? input
        : {
            ...input,
            targetMemberIds: current.members.map((member) => member.id),
            splitMethod: 'fixed',
            fixedAmounts: {},
          }

      validateExpenseInput(effectiveInput, current.event, current.members)

      const expense: Expense = {
        id: createRandomId(),
        category: effectiveInput.category,
        title: effectiveInput.title.trim(),
        amount: effectiveInput.amount,
        payerMemberId: effectiveInput.payerMemberId,
        targetMemberIds: [...effectiveInput.targetMemberIds],
        splitMethod: effectiveInput.splitMethod,
        fixedAmounts:
          effectiveInput.splitMethod === 'fixed' && effectiveInput.fixedAmounts
            ? { ...effectiveInput.fixedAmounts }
            : undefined,
        status: isCompleteAllocation(effectiveInput) ? 'finalized' : 'draft',
        dayIndex: effectiveInput.dayIndex,
        createdByMemberId: current.currentMemberId,
        createdAt: new Date().toISOString(),
      }

      if (expense.status === 'finalized') splitExpense(expense)

      return {
        ...current,
        expenses: [...current.expenses, expense],
        view: 'home',
      }
    })
  }, [])

  const updateExpense = useCallback((expenseId: string, input: NewExpenseInput) => {
    setState((current) => {
      if (!current.event || current.event.status !== 'active' || !current.currentMemberId) return current
      const existing = current.expenses.find((expense) => expense.id === expenseId)
      if (!existing) return current
      const organizer = isOrganizer(current)
      if (!organizer && existing.payerMemberId !== current.currentMemberId) return current
      if (!organizer && input.payerMemberId !== existing.payerMemberId) {
        throw new Error('立替え者は変更できません')
      }

      validateExpenseInput(input, current.event, current.members)
      if (!isCompleteAllocation(input)) {
        throw new Error('対象者全員の負担額を入力し、合計を支出額に合わせてください')
      }

      const updated: Expense = {
        ...existing,
        category: input.category,
        title: input.title.trim(),
        amount: input.amount,
        payerMemberId: input.payerMemberId,
        targetMemberIds: [...input.targetMemberIds],
        splitMethod: input.splitMethod,
        fixedAmounts: input.splitMethod === 'fixed' && input.fixedAmounts
          ? { ...input.fixedAmounts }
          : undefined,
        dayIndex: input.dayIndex,
        status: 'finalized',
      }
      splitExpense(updated)
      return {
        ...current,
        expenses: current.expenses.map((expense) => expense.id === expenseId ? updated : expense),
        view: 'home',
      }
    })
  }, [])

  const deleteExpense = useCallback((expenseId: string) => {
    setState((current) => {
      if (!current.event || current.event.status !== 'active' || !current.currentMemberId) return current
      const existing = current.expenses.find((expense) => expense.id === expenseId)
      if (!existing || (!isOrganizer(current) && existing.payerMemberId !== current.currentMemberId)) return current
      return {
        ...current,
        expenses: current.expenses.filter((expense) => expense.id !== expenseId),
        view: 'home',
      }
    })
  }, [])

  const finalizeExpense = useCallback(
    (expenseId: string, input: NewExpenseInput) => {
      setState((current) => {
        if (
          !current.event ||
          current.event.status !== 'active' ||
          !current.currentMemberId
        ) {
          return current
        }

        const existing = current.expenses.find(
          (expense) => expense.id === expenseId,
        )
        if (!existing || existing.status !== 'draft') return current

        const organizer = isOrganizer(current)
        if (
          !organizer &&
          existing.payerMemberId !== current.currentMemberId
        ) {
          return current
        }
        if (input.payerMemberId !== existing.payerMemberId) {
          throw new Error('暫定支出の立替え者は変更できません')
        }

        validateExpenseInput(input, current.event, current.members)
        if (!isCompleteAllocation(input)) {
          throw new Error('対象者全員の負担額を入力し、合計を支出額に合わせてください')
        }

        const finalized: Expense = {
          ...existing,
          category: input.category,
          title: input.title.trim(),
          amount: input.amount,
          targetMemberIds: [...input.targetMemberIds],
          splitMethod: input.splitMethod,
          fixedAmounts:
            input.splitMethod === 'fixed' && input.fixedAmounts
              ? { ...input.fixedAmounts }
              : undefined,
          dayIndex: input.dayIndex,
          status: 'finalized',
        }
        splitExpense(finalized)

        return {
          ...current,
          expenses: current.expenses.map((expense) =>
            expense.id === expenseId ? finalized : expense,
          ),
          view: 'home',
        }
      })
    },
    [],
  )

  const saveDraftExpense = useCallback(
    (expenseId: string, input: NewExpenseInput) => {
      setState((current) => {
        if (!current.event || current.event.status !== 'active' || !current.currentMemberId) return current
        const existing = current.expenses.find((expense) => expense.id === expenseId)
        if (!existing || existing.status !== 'draft' || existing.splitMethod !== 'fixed') return current

        const organizer = isOrganizer(current)
        const payer = existing.payerMemberId === current.currentMemberId
        const ownTarget = existing.targetMemberIds.includes(current.currentMemberId)
        if (!organizer && !payer && !ownTarget) return current

        let saved: Expense
        if (organizer || payer) {
          if (input.payerMemberId !== existing.payerMemberId) throw new Error('暫定支出の立替え者は変更できません')
          validateExpenseInput(input, current.event, current.members)
          saved = {
            ...existing,
            category: input.category,
            title: input.title.trim(),
            amount: input.amount,
            targetMemberIds: [...input.targetMemberIds],
            fixedAmounts: { ...(input.fixedAmounts ?? {}) },
            dayIndex: input.dayIndex,
          }
        } else {
          const ownAmount = input.fixedAmounts?.[current.currentMemberId]
          if (ownAmount !== undefined && (!Number.isInteger(ownAmount) || ownAmount < 0)) {
            throw new Error('負担額は0円以上の整数で入力してください')
          }
          const fixedAmounts = { ...(existing.fixedAmounts ?? {}) }
          if (ownAmount === undefined) delete fixedAmounts[current.currentMemberId]
          else fixedAmounts[current.currentMemberId] = ownAmount
          saved = { ...existing, fixedAmounts }
        }

        return {
          ...current,
          expenses: current.expenses.map((expense) => expense.id === expenseId ? saved : expense),
          view: 'home',
        }
      })
    },
    [],
  )

  const finalizeEvent = useCallback(() => {
    setState((current) => {
      if (
        !current.event ||
        current.event.status !== 'active' ||
        !isOrganizer(current) ||
        current.expenses.some((expense) => expense.status === 'draft')
      ) {
        return current
      }

      const settlements = generatePairwiseSettlements(
        current.members,
        current.expenses,
      ).map<Settlement>((transfer) => ({
        ...transfer,
        id: createRandomId(),
        status: transfer.amount === 0 ? 'paid' : 'pending',
      }))

      return {
        ...current,
        event: { ...current.event, status: 'finalized' },
        settlements,
      }
    })
  }, [])

  const unfinalizeEvent = useCallback(() => {
    setState((current) => {
      if (
        !current.event ||
        current.event.status !== 'finalized' ||
        !isOrganizer(current)
      ) {
        return current
      }

      return {
        ...current,
        event: { ...current.event, status: 'active' },
        settlements: [],
      }
    })
  }, [])

  const reportSettlement = useCallback((id: string) => {
    setState((current) => {
      if (!current.event || current.event.status !== 'finalized') return current

      const organizer = isOrganizer(current)
      let changed = false
      const settlements = current.settlements.map((settlement) => {
        if (
          settlement.id !== id ||
          settlement.status !== 'pending' ||
          (!organizer && settlement.fromMemberId !== current.currentMemberId)
        ) {
          return settlement
        }

        changed = true
        return {
          ...settlement,
          status: 'reported' as const,
          reportedByMemberId: current.currentMemberId ?? undefined,
        }
      })

      return changed ? { ...current, settlements } : current
    })
  }, [])

  const confirmSettlement = useCallback((id: string) => {
    setState((current) => {
      if (!current.event || current.event.status !== 'finalized') return current

      const organizer = isOrganizer(current)
      let changed = false
      const settlements = current.settlements.map((settlement) => {
        if (
          settlement.id !== id ||
          settlement.status === 'paid' ||
          (!organizer && settlement.toMemberId !== current.currentMemberId)
        ) {
          return settlement
        }

        changed = true
        return {
          ...settlement,
          status: 'paid' as const,
          confirmedByMemberId: current.currentMemberId ?? undefined,
        }
      })

      return changed ? { ...current, settlements } : current
    })
  }, [])

  const revertSettlement = useCallback((id: string) => {
    setState((current) => {
      if (!current.event || current.event.status !== 'finalized') return current

      const organizer = isOrganizer(current)
      let changed = false
      const settlements = current.settlements.map((settlement) => {
        if (settlement.id !== id) return settlement

        if (
          settlement.status === 'paid' &&
          (organizer ||
            settlement.confirmedByMemberId === current.currentMemberId)
        ) {
          changed = true
          const { confirmedByMemberId: _confirmedByMemberId, ...rest } = settlement
          return { ...rest, status: 'reported' as const }
        }

        if (
          settlement.status === 'reported' &&
          (organizer || settlement.reportedByMemberId === current.currentMemberId)
        ) {
          changed = true
          const { reportedByMemberId: _reportedByMemberId, ...rest } = settlement
          return { ...rest, status: 'pending' as const }
        }

        return settlement
      })

      return changed ? { ...current, settlements } : current
    })
  }, [])

  const resetApp = useCallback(() => {
    setState(createEmptyState())
  }, [])

  return {
    event: state.event,
    members: state.members,
    currentMemberId: state.currentMemberId,
    expenses: state.expenses,
    settlements: state.settlements,
    displaySettlements,
    balances,
    totalSpent,
    draftExpenseCount,
    view: state.view,
    setView,
    setCurrentMember,
    loadRemoteEvent,
    createEvent,
    updateEvent,
    addMember,
    removeMember,
    loadDemo,
    loadFourPersonDemo,
    addExpense,
    updateExpense,
    saveDraftExpense,
    finalizeExpense,
    deleteExpense,
    finalizeEvent,
    unfinalizeEvent,
    reportSettlement,
    confirmSettlement,
    revertSettlement,
    resetApp,
  }
}
