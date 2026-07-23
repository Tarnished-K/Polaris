import { describe, expect, it } from 'vitest'
import { redactSensitiveText, scrubSentryEvent, scrubSentryTransaction } from './sentry'

describe('Sentry privacy scrubbing', () => {
  it('redacts shared routes, claim values, and bearer credentials', () => {
    expect(redactSensitiveText('https://app.test/e/abc_123?claim=secret Bearer credential')).toBe(
      'https://app.test/e/[REDACTED]?claim=[REDACTED] Bearer [REDACTED]'
    )
  })

  it('redacts Discord webhook secrets and integration destinations', () => {
    expect(redactSensitiveText('POST https://discord.com/api/webhooks/123456/secret-token failed')).toBe(
      'POST https://discord.com/api/webhooks/[REDACTED] failed'
    )
    const scrubbed = scrubSentryEvent({
      extra: { destination: 'U1234567890', webhookUrl: 'https://discord.com/api/webhooks/123/secret' },
    } as unknown as Parameters<typeof scrubSentryEvent>[0])
    expect(scrubbed.extra).toEqual({ destination: '[REDACTED]', webhookUrl: '[REDACTED]' })
  })

  it('redacts participant data and nested tokens', () => {
    const scrubbed = scrubSentryEvent({
      message: 'failed at /e/shareTokenValue',
      extra: { participantName: 'Alice', nested: { deviceToken: 'token-value', safe: 'kept' } }
    } as unknown as Parameters<typeof scrubSentryEvent>[0])
    expect(scrubbed.message).toBe('failed at /e/[REDACTED]')
    expect(scrubbed.extra).toEqual({ participantName: '[REDACTED]', nested: { deviceToken: '[REDACTED]', safe: 'kept' } })
  })

  it('redacts shared routes from performance transactions and spans', () => {
    const scrubbed = scrubSentryTransaction({
      type: 'transaction',
      transaction: '/e/shareTokenValue?claim=claim-value',
      request: { url: 'https://polaris-warikan.netlify.app/e/shareTokenValue?claim=claim-value' },
      spans: [{
        data: { url: 'https://polaris-warikan.netlify.app/e/shareTokenValue?deviceToken=device-value' },
      }],
    } as unknown as Parameters<typeof scrubSentryTransaction>[0])

    expect(scrubbed.transaction).toBe('/e/[REDACTED]?claim=[REDACTED]')
    expect(scrubbed.request?.url).toBe('https://polaris-warikan.netlify.app/e/[REDACTED]?claim=[REDACTED]')
    expect(scrubbed.spans?.[0]?.data).toEqual({
      url: 'https://polaris-warikan.netlify.app/e/[REDACTED]?deviceToken=[REDACTED]',
    })
  })
})
