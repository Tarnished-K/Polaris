import { describe, expect, it } from 'vitest'

import type { Member } from '../domain/types'
import { memberColor, memberDisplayName } from './ui'

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
