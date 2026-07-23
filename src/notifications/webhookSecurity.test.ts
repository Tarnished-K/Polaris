import { describe, expect, it } from 'vitest'

import {
  discordTimestampMilliseconds,
  externalUserHash,
  isFreshTimestamp,
  sha256Hex,
  verifyDiscordSignature,
  verifyLineSignature,
} from '../../supabase/functions/_shared/webhook-security'

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

describe('assistant webhook security', () => {
  it('verifies LINE HMAC-SHA256 over the untouched raw body', async () => {
    const body = '{"events":[{"type":"message"}]}'
    const secret = 'line-channel-secret'
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))).toString('base64')
    await expect(verifyLineSignature(body, signature, secret)).resolves.toBe(true)
    await expect(verifyLineSignature(`${body}\n`, signature, secret)).resolves.toBe(false)
    await expect(verifyLineSignature(body, 'not-base64!', secret)).resolves.toBe(false)
  })

  it('verifies Discord Ed25519 over timestamp concatenated with the raw body', async () => {
    const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
    const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey))
    const timestamp = '1784736000'
    const body = '{"id":"interaction-a","type":1}'
    const signature = new Uint8Array(await crypto.subtle.sign(
      'Ed25519',
      keys.privateKey,
      new TextEncoder().encode(timestamp + body),
    ))
    await expect(verifyDiscordSignature(body, bytesToHex(signature), timestamp, bytesToHex(publicKey))).resolves.toBe(true)
    await expect(verifyDiscordSignature(`${body} `, bytesToHex(signature), timestamp, bytesToHex(publicKey))).resolves.toBe(false)
  })

  it('rejects malformed Discord signatures, keys, and timestamps', async () => {
    await expect(verifyDiscordSignature('{}', '00', 'bad', '00')).resolves.toBe(false)
    await expect(verifyDiscordSignature('{}', 'z'.repeat(128), '1784736000', 'a'.repeat(64))).resolves.toBe(false)
  })

  it('creates deterministic provider-separated HMAC lookup hashes', async () => {
    const line = await externalUserHash('line', 'user-123', 'lookup-secret')
    expect(line).toMatch(/^[0-9a-f]{64}$/)
    await expect(externalUserHash('line', 'user-123', 'lookup-secret')).resolves.toBe(line)
    await expect(externalUserHash('discord', 'user-123', 'lookup-secret')).resolves.not.toBe(line)
    await expect(externalUserHash('line', 'user-456', 'lookup-secret')).resolves.not.toBe(line)
  })

  it('never accepts missing lookup secrets or invalid user IDs', async () => {
    await expect(externalUserHash('line', 'user-123', '')).rejects.toThrow('INVALID_EXTERNAL_USER')
    await expect(externalUserHash('line', '', 'secret')).rejects.toThrow('INVALID_EXTERNAL_USER')
  })

  it('hashes webhook payloads without retaining their raw content', async () => {
    await expect(sha256Hex('sensitive body')).resolves.toMatch(/^[0-9a-f]{64}$/)
    await expect(sha256Hex('sensitive body')).resolves.not.toBe(await sha256Hex('different body'))
  })

  it('parses Discord seconds and enforces a five-minute replay window', () => {
    expect(discordTimestampMilliseconds('1784736000')).toBe(1_784_736_000_000)
    expect(discordTimestampMilliseconds('1784736000000')).toBeNull()
    expect(discordTimestampMilliseconds('not-a-time')).toBeNull()
    expect(isFreshTimestamp(1_000_000, 1_100_000)).toBe(true)
    expect(isFreshTimestamp(700_000, 1_100_001)).toBe(false)
    expect(isFreshTimestamp(1_500_001, 1_100_000)).toBe(false)
  })
})
