import { describe, expect, it } from 'vitest'

import { memberColor } from './ui'

describe('memberColor', () => {
  it('最大定員50人にそれぞれ異なる色を割り当てる', () => {
    const colors = Array.from({ length: 50 }, (_, index) => memberColor(index).solid)
    expect(new Set(colors).size).toBe(50)
  })
})
