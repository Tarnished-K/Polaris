export type NotificationPayload = {
  message?: unknown
  title?: unknown
  url?: unknown
}

export type DiscordWebhookBody = {
  content: string
  allowed_mentions: { parse: string[] }
}

export type LinePushBody = {
  messages: Array<{ type: 'text'; text: string }>
}

export const INTEGRATION_TEST_MESSAGE = 'Warikanの通知設定が完了しました。'

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function notificationMessage(payload: NotificationPayload): string {
  const message = textValue(payload.message)
  if (message) return message

  const title = textValue(payload.title)
  const url = textValue(payload.url)
  return [title, url].filter(Boolean).join('\n')
}

export function toDiscordWebhookBody(payload: NotificationPayload): DiscordWebhookBody {
  return {
    content: notificationMessage(payload).slice(0, 2000),
    allowed_mentions: { parse: [] }
  }
}

export function toLinePushBody(payload: NotificationPayload): LinePushBody {
  return { messages: [{ type: 'text', text: notificationMessage(payload).slice(0, 5000) }] }
}
