import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRandomId, createShareToken } from './random'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('random identifiers', () => {
  it('uses randomUUID when the browser provides it', () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => '00000000-0000-4000-8000-000000000001',
      getRandomValues: (bytes: Uint8Array) => bytes,
    })

    expect(createRandomId()).toBe('00000000-0000-4000-8000-000000000001')
  })

  it('works on LAN HTTP where randomUUID is unavailable', () => {
    let nextByte = 0
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        for (let index = 0; index < bytes.length; index += 1) {
          bytes[index] = nextByte
          nextByte = (nextByte + 1) % 256
        }
        return bytes
      },
    })

    expect(createRandomId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(createShareToken()).toMatch(/^[0-9a-f]{36}$/)
  })
})
