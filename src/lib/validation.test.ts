import { describe, expect, it } from 'vitest'
import {
  RESERVED_MEMBER_NAME_ERROR,
  validateDiscordWebhookUrl,
  validateLineDestination,
  validateMemberName,
  validatePayPayId,
  validatePayPayRequestUrl,
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

describe('payment handoff validation', () => {
  it('accepts the documented PayPay ID format and an empty optional ID', () => {
    expect(validatePayPayId('').valid).toBe(true)
    expect(validatePayPayId('alice_123').valid).toBe(true)
    expect(validatePayPayId('Alice').valid).toBe(false)
    expect(validatePayPayId('1alice').valid).toBe(false)
    expect(validatePayPayId('ab').valid).toBe(false)
    expect(validatePayPayId('a'.repeat(16)).valid).toBe(false)
  })

  it('allows only HTTPS links on PayPay official domains', () => {
    expect(validatePayPayRequestUrl('').valid).toBe(true)
    expect(validatePayPayRequestUrl('https://paypay.ne.jp/request/example').valid).toBe(true)
    expect(validatePayPayRequestUrl('https://qr.paypay.ne.jp/example').valid).toBe(true)
    expect(validatePayPayRequestUrl('http://paypay.ne.jp/example').valid).toBe(false)
    expect(validatePayPayRequestUrl('https://paypay.ne.jp.evil.example/request').valid).toBe(false)
    expect(validatePayPayRequestUrl('https://user@paypay.ne.jp/request').valid).toBe(false)
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
