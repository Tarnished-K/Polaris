import * as Sentry from '@sentry/react'
import type { ErrorEvent, EventHint } from '@sentry/react'

const sensitiveKey = /(?:name|member|participant|token|secret|password|authorization|cookie|webhook|destination|externalSpace)/i

export function redactSensitiveText(value: string): string {
  return value
    .replace(/\/e\/[A-Za-z0-9_-]+/g, '/e/[REDACTED]')
    .replace(/([?&](?:claim|token|deviceToken)=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(/https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/[^\s"'<>]+/gi, 'https://discord.com/api/webhooks/[REDACTED]')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
}

function scrub(value: unknown, key = ''): unknown {
  if (sensitiveKey.test(key)) return '[REDACTED]'
  if (typeof value === 'string') return redactSensitiveText(value)
  if (Array.isArray(value)) return value.map((item) => scrub(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, scrub(child, childKey)]))
  }
  return value
}

export function scrubSentryEvent(event: ErrorEvent, _hint?: EventHint): ErrorEvent {
  return scrub(event) as ErrorEvent
}

export function initializeErrorMonitoring(): boolean {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim()
  if (!dsn) return false
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    beforeSend: scrubSentryEvent
  })
  return true
}

export { Sentry }
