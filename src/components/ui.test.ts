import { describe, expect, it } from 'vitest'

import type { Member } from '../domain/types'
import {
  allocatePercentages,
  amountToStrokeWidth,
  getSettlementRelationshipMapMode,
  layoutAnnotationGrid,
  memberColor,
  memberDisplayName,
} from './ui'

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

describe('amountToStrokeWidth', () => {
  it('最大金額を5px、0以下を最小の1.5pxにする', () => {
    expect(amountToStrokeWidth(10_000, 10_000)).toBe(5)
    expect(amountToStrokeWidth(0, 10_000)).toBe(1.5)
    expect(amountToStrokeWidth(-1, 10_000)).toBe(1.5)
  })

  it('平方根補間で金額差を緩和し、最大幅を超えない', () => {
    expect(amountToStrokeWidth(2_500, 10_000)).toBeCloseTo(3.25)
    expect(amountToStrokeWidth(20_000, 10_000)).toBe(5)
    expect(amountToStrokeWidth(Number.NaN, 10_000)).toBe(1.5)
  })
})

describe('getSettlementRelationshipMapMode', () => {
  it('6人までは円形、7人以上はエゴセントリック表示にする', () => {
    expect(getSettlementRelationshipMapMode(0)).toBe('circular')
    expect(getSettlementRelationshipMapMode(6)).toBe('circular')
    expect(getSettlementRelationshipMapMode(7)).toBe('egocentric')
    expect(getSettlementRelationshipMapMode(50)).toBe('egocentric')
  })
})

describe('layoutAnnotationGrid', () => {
  it('箱根旅行の15組を重ならないセルへ配置する', () => {
    const widths = [142, 131, 136, 128, 140, 135, 129, 141, 132, 138, 127, 139, 134, 130, 137]
    const layout = layoutAnnotationGrid(widths, 656)

    expect(layout.rows).toBeGreaterThan(1)
    for (let left = 0; left < widths.length; left += 1) {
      for (let right = left + 1; right < widths.length; right += 1) {
        const a = layout.points[left]
        const b = layout.points[right]
        const sameRow = a.row === b.row
        const horizontalOverlap = Math.abs(a.x - b.x) < (widths[left] + widths[right]) / 2
        expect(sameRow && horizontalOverlap).toBe(false)
      }
    }
  })
})
