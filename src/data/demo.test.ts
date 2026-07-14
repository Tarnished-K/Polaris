import { describe, expect, it } from 'vitest'

import { createFourPersonDemoData } from './demo'

describe('createFourPersonDemoData', () => {
  it('すべての支出を金額指定として用意する', () => {
    const demo = createFourPersonDemoData()

    expect(demo.expenses).toHaveLength(8)
    expect(demo.expenses.every((expense) => expense.splitMethod === 'fixed')).toBe(true)
  })

  it('確定済み支出は指定額の合計が支出額と一致する', () => {
    const demo = createFourPersonDemoData()

    for (const expense of demo.expenses.filter((item) => item.status === 'finalized')) {
      const total = Object.values(expense.fixedAmounts ?? {}).reduce((sum, amount) => sum + amount, 0)
      expect(total).toBe(expense.amount)
    }
  })
})
