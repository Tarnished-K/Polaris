import { describe, expect, it } from 'vitest'

import type { Expense, Member, Settlement } from './types'
import {
  allocateSettlementChargePayments,
  calculateBalances,
  generatePairwiseSettlements,
  generateSettlements,
  settlementStatusFromCharges,
  paidCounterpartyIds,
  splitExpense,
} from './settlement'

describe('settlement item payments', () => {
  const charge = (expenseId: string, amount: number) => ({
    expenseId,
    expenseTitle: expenseId,
    category: 'food' as const,
    amount,
    fromMemberId: 'a',
    toMemberId: 'b',
  })

  it('相殺後の支払総額を支出ごとに最大剰余法で按分する', () => {
    const charges = allocateSettlementChargePayments(
      [charge('one', 2), charge('two', 1)],
      2,
      3,
    )

    expect(charges.map(({ payableAmount, paymentStatus }) => ({ payableAmount, paymentStatus }))).toEqual([
      { payableAmount: 1, paymentStatus: 'pending' },
      { payableAmount: 1, paymentStatus: 'pending' },
    ])
    expect(charges.reduce((sum, item) => sum + (item.payableAmount ?? 0), 0)).toBe(2)
  })

  it('一部支払いでは親精算を未払い、全報告で報告済み、全確認で完了にする', () => {
    const charges = allocateSettlementChargePayments(
      [charge('one', 600), charge('two', 400)],
      800,
      1_000,
    )
    expect(settlementStatusFromCharges(charges)).toBe('pending')
    expect(settlementStatusFromCharges(charges.map((item, index) => ({
      ...item,
      paymentStatus: index === 0 ? 'reported' : item.paymentStatus,
    })))).toBe('pending')
    expect(settlementStatusFromCharges(charges.map((item) => ({ ...item, paymentStatus: 'reported' })))).toBe('reported')
    expect(settlementStatusFromCharges(charges.map((item) => ({ ...item, paymentStatus: 'paid' })))).toBe('paid')
  })
})

const members: Member[] = [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'B' },
  { id: 'c', name: 'C' },
  { id: 'd', name: 'D' },
]

function expense(
  overrides: Partial<Expense> & Pick<Expense, 'amount' | 'payerMemberId'>,
): Expense {
  return {
    id: 'expense-1',
    category: 'food',
    title: '食事',
    targetMemberIds: members.map((member) => member.id),
    splitMethod: 'equal',
    status: 'finalized',
    createdByMemberId: overrides.payerMemberId,
    createdAt: '2026-07-12T00:00:00.000Z',
    ...overrides,
  }
}

function settlement(overrides: Partial<Settlement> & Pick<Settlement, 'fromMemberId' | 'toMemberId' | 'status'>): Settlement {
  return {
    id: `${overrides.fromMemberId}-${overrides.toMemberId}`,
    amount: 1000,
    grossAmount: 1000,
    offsetAmount: 0,
    charges: [],
    offsets: [],
    ...overrides,
  }
}

describe('paidCounterpartyIds', () => {
  it('指定メンバーと支払い済みになった相手だけを返す', () => {
    const result = paidCounterpartyIds([
      settlement({ fromMemberId: 'a', toMemberId: 'b', status: 'paid' }),
      settlement({ fromMemberId: 'c', toMemberId: 'a', status: 'paid' }),
      settlement({ fromMemberId: 'a', toMemberId: 'd', status: 'reported' }),
      settlement({ fromMemberId: 'b', toMemberId: 'd', status: 'paid' }),
    ], 'a')

    expect([...result].sort()).toEqual(['b', 'c'])
  })

  it('視点メンバーが未指定なら空集合を返す', () => {
    expect(paidCounterpartyIds([], null).size).toBe(0)
  })
})

describe('splitExpense', () => {
  it('均等割りが割り切れる', () => {
    expect(
      splitExpense(
        expense({ amount: 1_200, payerMemberId: 'a', targetMemberIds: ['a', 'b', 'c'] }),
      ),
    ).toEqual({ a: 400, b: 400, c: 400 })
  })

  it('均等割りの端数を対象者に含まれる支払者が負担する', () => {
    expect(
      splitExpense(
        expense({ amount: 1_001, payerMemberId: 'a', targetMemberIds: ['a', 'b', 'c'] }),
      ),
    ).toEqual({ a: 335, b: 333, c: 333 })
  })

  it('支払者が対象外でも均等割りの端数だけは支払者負担にする', () => {
    expect(
      splitExpense(
        expense({ amount: 1_001, payerMemberId: 'd', targetMemberIds: ['a', 'b', 'c'] }),
      ),
    ).toEqual({ a: 333, b: 333, c: 333, d: 2 })
  })

  it('fixed の合計が支出額と一致しなければ拒否する', () => {
    const invalidExpense = expense({
      amount: 1_000,
      payerMemberId: 'a',
      targetMemberIds: ['a', 'b'],
      splitMethod: 'fixed',
      fixedAmounts: { a: 400, b: 500 },
    })

    expect(() => splitExpense(invalidExpense)).toThrow(/must equal expense amount/)
  })
})

describe('calculateBalances', () => {
  it('全員の balance 合計が常に0になる', () => {
    const balances = calculateBalances(members, [
      expense({ amount: 1_001, payerMemberId: 'a', targetMemberIds: ['a', 'b', 'c'] }),
      expense({ amount: 502, payerMemberId: 'd', targetMemberIds: ['b', 'c'] }),
      expense({
        id: 'expense-3',
        amount: 700,
        payerMemberId: 'b',
        targetMemberIds: ['a', 'd'],
        splitMethod: 'fixed',
        fixedAmounts: { a: 200, d: 500 },
      }),
    ])

    expect(Object.values(balances).reduce((total, balance) => total + balance, 0)).toBe(0)
  })

  it('途中参加者には対象になった支出だけを負担させる', () => {
    const balances = calculateBalances(members, [
      expense({ amount: 900, payerMemberId: 'a', targetMemberIds: ['a', 'b', 'c'] }),
      expense({ id: 'expense-2', amount: 800, payerMemberId: 'd' }),
    ])

    expect(balances).toEqual({ a: 400, b: -500, c: -500, d: 600 })
  })
})

describe('generateSettlements', () => {
  it('minimal は絶対額降順・同額はメンバー順で最大 n-1 件にする', () => {
    const transfers = generateSettlements(
      members,
      { a: -500, b: -500, c: 600, d: 400 },
      'minimal',
    )

    expect(transfers).toEqual([
      { fromMemberId: 'a', toMemberId: 'c', amount: 500 },
      { fromMemberId: 'b', toMemberId: 'd', amount: 400 },
      { fromMemberId: 'b', toMemberId: 'c', amount: 100 },
    ])
    expect(transfers.length).toBeLessThanOrEqual(members.length - 1)
  })

  it('treasurer 自身の立て替えをハブ送金で正しく相殺する', () => {
    const transfers = generateSettlements(
      members,
      { a: 700, b: -500, c: 300, d: -500 },
      'treasurer',
      'a',
    )

    expect(transfers).toEqual([
      { fromMemberId: 'b', toMemberId: 'a', amount: 500 },
      { fromMemberId: 'a', toMemberId: 'c', amount: 300 },
      { fromMemberId: 'd', toMemberId: 'a', amount: 500 },
    ])
    const treasurerNet = transfers.reduce((net, transfer) => {
      if (transfer.toMemberId === 'a') return net + transfer.amount
      if (transfer.fromMemberId === 'a') return net - transfer.amount
      return net
    }, 0)
    expect(treasurerNet).toBe(700)
  })

  it('支出0件では balance も送金も0件になる', () => {
    const balances = calculateBalances(members, [])

    expect(balances).toEqual({ a: 0, b: 0, c: 0, d: 0 })
    expect(generateSettlements(members, balances, 'minimal')).toEqual([])
  })
})

describe('generatePairwiseSettlements', () => {
  it('相手ごとにまとめ、反対方向の立て替えを内訳付きで差し引く', () => {
    const transfers = generatePairwiseSettlements(members, [
      expense({
        id: 'hotel',
        title: 'ホテル代',
        amount: 1_200,
        payerMemberId: 'b',
        targetMemberIds: ['a', 'b'],
      }),
      expense({
        id: 'taxi',
        title: 'タクシー代',
        amount: 400,
        payerMemberId: 'a',
        targetMemberIds: ['a', 'b'],
      }),
    ])

    expect(transfers).toEqual([
      {
        fromMemberId: 'a',
        toMemberId: 'b',
        amount: 400,
        grossAmount: 600,
        offsetAmount: 200,
        charges: [
          expect.objectContaining({
            expenseId: 'hotel',
            expenseTitle: 'ホテル代',
            amount: 600,
          }),
        ],
        offsets: [
          expect.objectContaining({
            expenseId: 'taxi',
            expenseTitle: 'タクシー代',
            amount: 200,
          }),
        ],
      },
    ])
  })

  it('暫定支出を精算計算から除外する', () => {
    const draft = expense({
      id: 'draft-dinner',
      amount: 10_000,
      payerMemberId: 'b',
      targetMemberIds: [],
      splitMethod: 'fixed',
      fixedAmounts: {},
      status: 'draft',
    })

    expect(generatePairwiseSettlements(members, [draft])).toEqual([])
  })

  it('全額相殺されたペアも内訳確認用に0円で残す', () => {
    const transfers = generatePairwiseSettlements(members, [
      expense({
        id: 'one',
        amount: 600,
        payerMemberId: 'a',
        targetMemberIds: ['a', 'b'],
      }),
      expense({
        id: 'two',
        amount: 600,
        payerMemberId: 'b',
        targetMemberIds: ['a', 'b'],
      }),
    ])

    expect(transfers).toHaveLength(1)
    expect(transfers[0]).toMatchObject({
      amount: 0,
      grossAmount: 300,
      offsetAmount: 300,
    })
  })
})
