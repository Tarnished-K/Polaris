import { describe, expect, it } from 'vitest'

import type { Member } from '../domain/types'
import { allocatePercentages, memberColor, memberDisplayName } from './ui'

describe('allocatePercentages', () => {
  it('最大剰余法で合計を100%にする', () => {
    const percentages = allocatePercentages([1, 1, 1])
    expect(percentages).toEqual([34, 33, 33])
    expect(percentages.reduce((sum, percentage) => sum + percentage, 0)).toBe(100)
  })

  it('微小項目と無効な値を安全に扱う', () => {
    const percentages = allocatePercentages([999, 1, 0, -1, Number.NaN])
    expect(percentages).toEqual([100, 0, 0, 0, 0])
  })

  it('合計が0なら全項目を0%にする', () => {
    expect(allocatePercentages([0, 0])).toEqual([0, 0])
    expect(allocatePercentages([])).toEqual([])
  })
})

describe('memberColor', () => {
  it('最大定員50人にそれぞれ異なる色を割り当てる', () => {
    const colors = Array.from({ length: 50 }, (_, index) => memberColor(index).solid)
    expect(new Set(colors).size).toBe(50)
  })
})

describe('memberDisplayName', () => {
  const members: Member[] = [
    { id: 'organizer', name: 'あなた', isOrganizer: true },
    { id: 'mina', name: 'ミナ' },
    { id: 'named-you', name: 'あなた' },
  ]

  it('現在の参加者は元の表示名に関係なく「あなた」と表示する', () => {
    expect(memberDisplayName(members, 'mina', 'mina')).toBe('あなた')
  })

  it('別の参加者視点では名前ではなくフラグで幹事を判定する', () => {
    expect(memberDisplayName(members, 'organizer', 'mina')).toBe('幹事')
  })

  it('「あなた」という名前だけで参加者を幹事扱いしない', () => {
    expect(memberDisplayName(members, 'named-you', 'mina')).toBe('あなた')
  })
})
