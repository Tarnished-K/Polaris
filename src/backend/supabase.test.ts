import { describe, expect, it } from 'vitest'

import { generateDeviceToken } from './supabase'

describe('generateDeviceToken', () => {
  it('creates a URL-safe token backed by 32 random bytes', () => {
    const token = generateDeviceToken()

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('does not reuse tokens', () => {
    expect(generateDeviceToken()).not.toBe(generateDeviceToken())
  })
})
