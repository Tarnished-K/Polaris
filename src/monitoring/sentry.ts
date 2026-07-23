import type { Breadcrumb, ErrorEvent, EventHint } from '@sentry/react'

const sensitiveKey = /(?:name|member|participant|claim|token|secret|password|authorization|cookie|webhook|destination|externalSpace|paypay)/i
type SentryModule = typeof import('@sentry/react')
type SentryInitOptions = Parameters<SentryModule['init']>[0]
type BeforeSendTransaction = NonNullable<SentryInitOptions['beforeSendTransaction']>
type TransactionEvent = Parameters<BeforeSendTransaction>[0]
let sentryModulePromise: Promise<SentryModule> | undefined
let earlyListenersAttached = false

function decodeKey(key: string): string {
  try {
    return decodeURIComponent(key.replace(/\+/g, ' '))
  } catch {
    return key
  }
}

function isSensitiveKey(key: string): boolean {
  return sensitiveKey.test(key) || sensitiveKey.test(decodeKey(key))
}

function redactSensitiveQueryParameters(value: string): string {
  return value.replace(/([?&])([^&#\s]+)/g, (match, separator: string, segment: string) => {
    const literalEquals = segment.indexOf('=')
    if (literalEquals >= 0) {
      const key = segment.slice(0, literalEquals)
      return isSensitiveKey(key)
        ? `${separator}${key}=[REDACTED]`
        : match
    }

    const encodedEquals = /%3d/i.exec(segment)
    if (!encodedEquals || encodedEquals.index === undefined) return match
    const key = segment.slice(0, encodedEquals.index)
    return isSensitiveKey(key)
      ? `${separator}${segment.slice(0, encodedEquals.index + encodedEquals[0].length)}[REDACTED]`
      : match
  })
}

export function redactSensitiveText(value: string): string {
  return redactSensitiveQueryParameters(value)
    .replace(/\/e\/[A-Za-z0-9_-]+/g, '/e/[REDACTED]')
    .replace(
      /((?:"?p?_?paypay(?:_?id|_?request_?(?:url|link))"?|PayPay\s+(?:ID|request\s+(?:URL|link)))\s*(?::|=|=>)\s*["']?)[^,;\s}"'&]+/gi,
      '$1[REDACTED]',
    )
    .replace(
      /(https:\/\/(?:[a-z0-9-]+\.)*paypay\.ne\.jp)(?:\/[^\s"'<>]*)?/gi,
      '$1/[REDACTED]',
    )
    .replace(/https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/[^\s"'<>]+/gi, 'https://discord.com/api/webhooks/[REDACTED]')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
}

function scrub(value: unknown, key = ''): unknown {
  if (isSensitiveKey(key)) return '[REDACTED]'
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return JSON.stringify(scrub(JSON.parse(trimmed)))
      } catch {
        // Malformed JSON is still scrubbed as ordinary text below.
      }
    }
    return redactSensitiveText(value)
  }
  if (Array.isArray(value)) return value.map((item) => scrub(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, scrub(child, childKey)]))
  }
  return value
}

export function scrubSentryEvent(event: ErrorEvent, _hint?: EventHint): ErrorEvent {
  return scrub(event) as ErrorEvent
}

export function scrubSentryTransaction(event: TransactionEvent): TransactionEvent {
  return scrub(event) as TransactionEvent
}

export function scrubSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  return scrub(breadcrumb) as Breadcrumb
}

function detachEarlyErrorListeners(): void {
  if (!earlyListenersAttached || typeof window === 'undefined') return
  window.removeEventListener('error', captureEarlyError)
  window.removeEventListener('unhandledrejection', captureEarlyRejection)
  earlyListenersAttached = false
}

function loadSentry(): Promise<SentryModule> | undefined {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim()
  if (!dsn) return undefined
  if (sentryModulePromise) return sentryModulePromise

  sentryModulePromise = import('@sentry/react')
    .then((Sentry) => {
      detachEarlyErrorListeners()
      Sentry.init({
        dsn,
        environment: import.meta.env.MODE,
        sendDefaultPii: false,
        dataCollection: {
          userInfo: false,
          httpBodies: [],
        },
        integrations: [
          Sentry.browserTracingIntegration(),
        ],
        tracesSampleRate: 0.1,
        tracePropagationTargets: [
          'localhost',
          /^https:\/\/polaris-warikan\.netlify\.app(?:\/|$)/,
        ],
        beforeBreadcrumb: scrubSentryBreadcrumb,
        beforeSend: scrubSentryEvent,
        beforeSendTransaction: scrubSentryTransaction,
      })
      return Sentry
    })
    .catch((error) => {
      sentryModulePromise = undefined
      throw error
    })
  return sentryModulePromise
}

function captureEarlyError(event: globalThis.ErrorEvent): void {
  void captureMonitoringException(event.error ?? new Error(event.message))
}

function captureEarlyRejection(event: PromiseRejectionEvent): void {
  void captureMonitoringException(event.reason)
}

export function captureMonitoringException(error: unknown, extra?: Record<string, unknown>): void {
  const loading = loadSentry()
  if (!loading) return
  void loading
    .then((Sentry) => {
      Sentry.captureException(error, extra ? { extra } : undefined)
    })
    .catch(() => {
      // Monitoring must never create a second unhandled rejection.
    })
}

export function initializeErrorMonitoring(): boolean {
  if (!import.meta.env.VITE_SENTRY_DSN?.trim()) return false
  if (typeof window !== 'undefined' && !earlyListenersAttached) {
    window.addEventListener('error', captureEarlyError)
    window.addEventListener('unhandledrejection', captureEarlyRejection)
    earlyListenersAttached = true
  }
  return true
}

export function scheduleBrowserTracing(): boolean {
  if (!import.meta.env.VITE_SENTRY_DSN?.trim() || typeof window === 'undefined') return false

  let timeoutId: number | undefined
  const enable = () => {
    window.removeEventListener('pointerdown', enable, true)
    window.removeEventListener('keydown', enable, true)
    if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    void loadSentry()?.catch(() => {
      // A future error can retry loading the monitoring SDK.
    })
  }

  window.addEventListener('pointerdown', enable, { capture: true, once: true, passive: true })
  window.addEventListener('keydown', enable, { capture: true, once: true })
  timeoutId = window.setTimeout(enable, 12_000)
  return true
}
