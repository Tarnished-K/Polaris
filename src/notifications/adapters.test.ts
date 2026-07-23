import { describe, expect, it } from 'vitest'
import { INTEGRATION_TEST_MESSAGE, notificationMessage, toDiscordWebhookBody, toLinePushBody } from './adapters'

describe('notification adapters', () => {
  it('uses a short provider-neutral integration test message', () => {
    expect(INTEGRATION_TEST_MESSAGE).toBe('Warikanの通知設定が完了しました。')
  })
  it('prefers a trimmed message and does not allow Discord mentions', () => {
    expect(toDiscordWebhookBody({ message: '  精算を確認してください  ' })).toEqual({
      content: '精算を確認してください',
      allowed_mentions: { parse: [] }
    })
  })

  it('builds a fallback message from title and URL', () => {
    expect(notificationMessage({ title: '参加確認', url: 'https://example.test/e/abc' })).toBe(
      '参加確認\nhttps://example.test/e/abc'
    )
  })

  it('creates a LINE text message and handles empty payloads', () => {
    expect(toLinePushBody({})).toEqual({ messages: [{ type: 'text', text: '' }] })
  })

  it('enforces provider message length limits', () => {
    const message = 'x'.repeat(6000)
    expect(toDiscordWebhookBody({ message }).content).toHaveLength(2000)
    expect(toLinePushBody({ message }).messages[0].text).toHaveLength(5000)
  })
})
