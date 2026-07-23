import { describe, expect, it } from 'vitest'
import {
  RESERVED_MEMBER_NAME_ERROR,
  validateDiscordWebhookUrl,
  validateLineDestination,
  validateMemberName,
} from './validation'

describe('validateMemberName', () => {
  it.each(['あなた', ' あなた ', '幹事'])('rejects reserved member name %s', (name) => {
    expect(validateMemberName(name)).toEqual({ valid: false, error: RESERVED_MEMBER_NAME_ERROR })
  })
  it.each(['あなたさん', 'アナタ', '幹事さん', 'Alice'])('allows unambiguous member name %s', (name) => {
    expect(validateMemberName(name)).toEqual({ valid: true })
  })
  it('rejects blank names', () => {
    expect(validateMemberName('  ').valid).toBe(false)
  })
})

describe('notification destination validation', () => {
  it('accepts only official HTTPS Discord webhook URLs', () => {
    expect(validateDiscordWebhookUrl('https://discord.com/api/webhooks/123456/abc_DEF-123').valid).toBe(true)
    expect(validateDiscordWebhookUrl('https://example.com/api/webhooks/123456/abc').valid).toBe(false)
    expect(validateDiscordWebhookUrl('http://discord.com/api/webhooks/123456/abc').valid).toBe(false)
  })

  it('accepts LINE destination identifiers without treating them as secrets', () => {
    expect(validateLineDestination(`U${'a'.repeat(32)}`).valid).toBe(true)
    expect(validateLineDestination('short').valid).toBe(false)
    expect(validateLineDestination('contains spaces and symbols!').valid).toBe(false)
  })
})
