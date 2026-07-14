import type {
  Expense,
  Member,
  SettlementBreakdownItem,
  SettlementMode,
} from './types'

export interface SettlementTransfer {
  fromMemberId: string
  toMemberId: string
  amount: number
}

export interface PairwiseSettlementTransfer extends SettlementTransfer {
  grossAmount: number
  offsetAmount: number
  charges: SettlementBreakdownItem[]
  offsets: SettlementBreakdownItem[]
}

export type MemberAmounts = Record<string, number>

function assertYenAmount(amount: number, label: string): void {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error(`${label} must be a non-negative safe integer`)
  }
}

function assertUniqueIds(ids: string[], label: string): void {
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${label} must not contain duplicate member IDs`)
  }
}

/**
 * Calculates how much each member must bear for one expense.
 *
 * For an equal split, a remainder is always assigned to the payer. The payer
 * is therefore included in the result when necessary even if they are not one
 * of the expense targets.
 */
export function splitExpense(expense: Expense): MemberAmounts {
  assertYenAmount(expense.amount, 'Expense amount')
  assertUniqueIds(expense.targetMemberIds, 'Expense targets')

  if (expense.targetMemberIds.length === 0) {
    throw new Error('An expense must have at least one target member')
  }

  if (expense.splitMethod === 'equal') {
    const targetCount = expense.targetMemberIds.length
    const amountPerTarget = Math.floor(expense.amount / targetCount)
    const remainder = expense.amount % targetCount
    const burdens: MemberAmounts = Object.fromEntries(
      expense.targetMemberIds.map((memberId) => [memberId, amountPerTarget]),
    )

    if (remainder > 0) {
      burdens[expense.payerMemberId] =
        (burdens[expense.payerMemberId] ?? 0) + remainder
    }

    return burdens
  }

  const fixedAmounts = expense.fixedAmounts
  if (fixedAmounts === undefined) {
    throw new Error('Fixed split amounts are required')
  }

  const targetIds = new Set(expense.targetMemberIds)
  const unexpectedMemberId = Object.keys(fixedAmounts).find(
    (memberId) => !targetIds.has(memberId),
  )
  if (unexpectedMemberId !== undefined) {
    throw new Error(`Fixed split contains a non-target member: ${unexpectedMemberId}`)
  }

  const burdens: MemberAmounts = {}
  let fixedTotal = 0

  for (const memberId of expense.targetMemberIds) {
    if (!Object.prototype.hasOwnProperty.call(fixedAmounts, memberId)) {
      throw new Error(`Fixed split amount is missing for member: ${memberId}`)
    }

    const amount = fixedAmounts[memberId]
    assertYenAmount(amount, `Fixed split amount for member ${memberId}`)
    burdens[memberId] = amount
    fixedTotal += amount
  }

  if (!Number.isSafeInteger(fixedTotal) || fixedTotal !== expense.amount) {
    throw new Error(
      `Fixed split total (${fixedTotal}) must equal expense amount (${expense.amount})`,
    )
  }

  return burdens
}

/** Calculates `paid total - burden total` for every member. */
export function calculateBalances(
  members: Member[],
  expenses: Expense[],
): MemberAmounts {
  const memberIds = members.map((member) => member.id)
  assertUniqueIds(memberIds, 'Members')

  const balances: MemberAmounts = Object.fromEntries(
    memberIds.map((memberId) => [memberId, 0]),
  )

  for (const expense of expenses) {
    if (!Object.prototype.hasOwnProperty.call(balances, expense.payerMemberId)) {
      throw new Error(`Unknown payer member: ${expense.payerMemberId}`)
    }

    balances[expense.payerMemberId] += expense.amount

    for (const [memberId, burden] of Object.entries(splitExpense(expense))) {
      if (!Object.prototype.hasOwnProperty.call(balances, memberId)) {
        throw new Error(`Unknown target member: ${memberId}`)
      }
      balances[memberId] -= burden
    }
  }

  return balances
}

interface BalanceEntry {
  memberId: string
  amount: number
  memberIndex: number
}

function compareByAmountThenMemberOrder(
  left: BalanceEntry,
  right: BalanceEntry,
): number {
  return right.amount - left.amount || left.memberIndex - right.memberIndex
}

/**
 * Converts balances into transfers using either the largest-first greedy
 * strategy or a fixed treasurer hub.
 */
export function generateSettlements(
  members: Member[],
  balances: MemberAmounts,
  mode: SettlementMode,
  treasurerMemberId?: string,
): SettlementTransfer[] {
  const memberIds = members.map((member) => member.id)
  assertUniqueIds(memberIds, 'Members')

  const knownMemberIds = new Set(memberIds)
  const unknownBalanceMemberId = Object.keys(balances).find(
    (memberId) => !knownMemberIds.has(memberId),
  )
  if (unknownBalanceMemberId !== undefined) {
    throw new Error(`Balance contains an unknown member: ${unknownBalanceMemberId}`)
  }

  const entries = members.map<BalanceEntry>((member, memberIndex) => {
    const balance = balances[member.id] ?? 0
    if (!Number.isSafeInteger(balance)) {
      throw new Error(`Balance for member ${member.id} must be a safe integer`)
    }
    return { memberId: member.id, amount: balance, memberIndex }
  })

  const balanceTotal = entries.reduce((total, entry) => total + entry.amount, 0)
  if (!Number.isSafeInteger(balanceTotal) || balanceTotal !== 0) {
    throw new Error(`Balance total must be 0 (received ${balanceTotal})`)
  }

  if (mode === 'treasurer') {
    if (
      treasurerMemberId === undefined ||
      !knownMemberIds.has(treasurerMemberId)
    ) {
      throw new Error('A valid treasurer member is required in treasurer mode')
    }

    const transfers: SettlementTransfer[] = []
    for (const entry of entries) {
      if (entry.memberId === treasurerMemberId || entry.amount === 0) {
        continue
      }

      if (entry.amount < 0) {
        transfers.push({
          fromMemberId: entry.memberId,
          toMemberId: treasurerMemberId,
          amount: -entry.amount,
        })
      } else {
        transfers.push({
          fromMemberId: treasurerMemberId,
          toMemberId: entry.memberId,
          amount: entry.amount,
        })
      }
    }
    return transfers
  }

  const debtors = entries
    .filter((entry) => entry.amount < 0)
    .map((entry) => ({ ...entry, amount: -entry.amount }))
  const creditors = entries
    .filter((entry) => entry.amount > 0)
    .map((entry) => ({ ...entry }))
  const transfers: SettlementTransfer[] = []

  while (debtors.length > 0 && creditors.length > 0) {
    debtors.sort(compareByAmountThenMemberOrder)
    creditors.sort(compareByAmountThenMemberOrder)

    const debtor = debtors[0]
    const creditor = creditors[0]
    const amount = Math.min(debtor.amount, creditor.amount)

    transfers.push({
      fromMemberId: debtor.memberId,
      toMemberId: creditor.memberId,
      amount,
    })

    debtor.amount -= amount
    creditor.amount -= amount

    if (debtor.amount === 0) {
      debtors.shift()
    }
    if (creditor.amount === 0) {
      creditors.shift()
    }
  }

  if (debtors.length > 0 || creditors.length > 0) {
    throw new Error('Could not fully settle balances')
  }

  return transfers
}

interface DirectedDebt {
  fromMemberId: string
  toMemberId: string
  amount: number
  items: SettlementBreakdownItem[]
}

/**
 * Groups finalized expenses by counterparty and offsets debts in the opposite
 * direction while retaining both sides as an explainable breakdown.
 */
export function generatePairwiseSettlements(
  members: Member[],
  expenses: Expense[],
): PairwiseSettlementTransfer[] {
  const memberOrder = new Map(members.map((member, index) => [member.id, index]))
  const memberIds = new Set(memberOrder.keys())
  const directedDebts = new Map<string, DirectedDebt>()

  for (const expense of expenses) {
    if (expense.status !== 'finalized') continue
    if (!memberIds.has(expense.payerMemberId)) {
      throw new Error(`Unknown payer member: ${expense.payerMemberId}`)
    }

    for (const [memberId, burden] of Object.entries(splitExpense(expense))) {
      if (!memberIds.has(memberId)) {
        throw new Error(`Unknown target member: ${memberId}`)
      }
      if (memberId === expense.payerMemberId || burden === 0) continue

      const key = `${memberId}->${expense.payerMemberId}`
      const current = directedDebts.get(key) ?? {
        fromMemberId: memberId,
        toMemberId: expense.payerMemberId,
        amount: 0,
        items: [],
      }
      current.amount += burden
      current.items.push({
        expenseId: expense.id,
        expenseTitle: expense.title,
        category: expense.category,
        amount: burden,
        fromMemberId: memberId,
        toMemberId: expense.payerMemberId,
        dayIndex: expense.dayIndex,
      })
      directedDebts.set(key, current)
    }
  }

  const handledPairs = new Set<string>()
  const transfers: PairwiseSettlementTransfer[] = []

  for (const debt of directedDebts.values()) {
    const leftIndex = memberOrder.get(debt.fromMemberId) ?? 0
    const rightIndex = memberOrder.get(debt.toMemberId) ?? 0
    const pairKey =
      leftIndex < rightIndex
        ? `${debt.fromMemberId}|${debt.toMemberId}`
        : `${debt.toMemberId}|${debt.fromMemberId}`
    if (handledPairs.has(pairKey)) continue
    handledPairs.add(pairKey)

    const reverse = directedDebts.get(`${debt.toMemberId}->${debt.fromMemberId}`)
    const forwardAmount = debt.amount
    const reverseAmount = reverse?.amount ?? 0
    const forwardWins = forwardAmount >= reverseAmount
    const charges = forwardWins ? debt : reverse
    const offsets = forwardWins ? reverse : debt

    if (!charges) continue

    transfers.push({
      fromMemberId: charges.fromMemberId,
      toMemberId: charges.toMemberId,
      amount: Math.abs(forwardAmount - reverseAmount),
      grossAmount: charges.amount,
      offsetAmount: offsets?.amount ?? 0,
      charges: charges.items,
      offsets: offsets?.items ?? [],
    })
  }

  return transfers.sort((left, right) => {
    const leftFrom = memberOrder.get(left.fromMemberId) ?? 0
    const rightFrom = memberOrder.get(right.fromMemberId) ?? 0
    return (
      leftFrom - rightFrom ||
      (memberOrder.get(left.toMemberId) ?? 0) -
        (memberOrder.get(right.toMemberId) ?? 0)
    )
  })
}
