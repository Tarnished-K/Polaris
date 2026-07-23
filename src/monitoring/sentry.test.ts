import { describe, expect, it } from 'vitest'
import {
  redactSensitiveText,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  scrubSentryTransaction,
} from './sentry'

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

  it('redacts PayPay IDs and request links from structured event data', () => {
    const scrubbed = scrubSentryEvent({
      message: 'PayPay ID: alice_123; https://qr.paypay.ne.jp/secret-request-code',
      request: {
        data: JSON.stringify({
          paypayId: 'alice_123',
          paypayRequestUrl: 'https://paypay.ne.jp/request/secret-code',
        }),
      },
      extra: {
        paypayId: 'alice_123',
        nested: {
          p_paypay_request_url: 'https://paypay.ne.jp/request/secret-code',
          safe: 'kept',
        },
      },
    } as unknown as Parameters<typeof scrubSentryEvent>[0])

    expect(scrubbed.message).toBe('PayPay ID: [REDACTED]; https://qr.paypay.ne.jp/[REDACTED]')
    expect(scrubbed.request?.data).toBe(
      '{"paypayId":"[REDACTED]","paypayRequestUrl":"[REDACTED]"}',
    )
    expect(scrubbed.extra).toEqual({
      paypayId: '[REDACTED]',
      nested: {
        p_paypay_request_url: '[REDACTED]',
        safe: 'kept',
      },
    })
  })

  it('redacts PayPay query parameters and breadcrumbs before they enter an event', () => {
    expect(
      redactSensitiveText(
        'POST /rpc?p_paypay_id=alice_123&paypayRequestUrl=https%3A%2F%2Fpaypay.ne.jp%2Frequest%2Fsecret',
      ),
    ).toBe(
      'POST /rpc?p_paypay_id=[REDACTED]&paypayRequestUrl=[REDACTED]',
    )

    const breadcrumb = scrubSentryBreadcrumb({
      category: 'fetch',
      message: 'PayPay ID=alice_123',
      data: {
        paypayRequestUrl: 'https://paypay.ne.jp/request/secret-code',
        safe: 'kept',
      },
    })
    expect(breadcrumb.message).toBe('PayPay ID=[REDACTED]')
    expect(breadcrumb.data).toEqual({
      paypayRequestUrl: '[REDACTED]',
      safe: 'kept',
    })
    expect(redactSensitiveText('/rpc?paypay%20id=encoded_user&safe=kept')).toBe(
      '/rpc?paypay%20id=[REDACTED]&safe=kept',
    )
  })

  it('redacts shared routes from performance transactions and spans', () => {
    const scrubbed = scrubSentryTransaction({
      type: 'transaction',
      transaction: '/e/shareTokenValue?claim=claim-value',
      request: { url: 'https://polaris-warikan.netlify.app/e/shareTokenValue?claim=claim-value' },
      spans: [{
        data: {
          url: 'https://polaris-warikan.netlify.app/e/shareTokenValue?deviceToken=device-value',
          paypayId: 'alice_123',
        },
      }],
    } as unknown as Parameters<typeof scrubSentryTransaction>[0])

    expect(scrubbed.transaction).toBe('/e/[REDACTED]?claim=[REDACTED]')
    expect(scrubbed.request?.url).toBe('https://polaris-warikan.netlify.app/e/[REDACTED]?claim=[REDACTED]')
    expect(scrubbed.spans?.[0]?.data).toEqual({
      url: 'https://polaris-warikan.netlify.app/e/[REDACTED]?deviceToken=[REDACTED]',
      paypayId: '[REDACTED]',
    })
  })
})
