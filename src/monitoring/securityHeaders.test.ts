import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const netlifyConfig = readFileSync(new URL('../../netlify.toml', import.meta.url), 'utf8')

function headerValue(name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = netlifyConfig.match(new RegExp(`^\\s*${escapedName}\\s*=\\s*"([^"]+)"`, 'm'))
  if (!match) throw new Error(`${name} is missing from netlify.toml`)
  return match[1]
}

describe('Netlify security headers', () => {
  it('locks scripts and framing to the application origin', () => {
    const policy = headerValue('Content-Security-Policy')

    expect(policy).toContain("default-src 'self'")
    expect(policy).toContain("script-src 'self'")
    expect(policy).not.toContain("script-src 'unsafe-inline'")
    expect(policy).not.toContain("'unsafe-eval'")
    expect(policy).toContain("object-src 'none'")
    expect(policy).toContain("frame-ancestors 'none'")
    expect(policy).toContain("frame-src 'none'")
    expect(headerValue('X-Frame-Options')).toBe('DENY')
  })

  it('allows only the production data and monitoring transports', () => {
    const policy = headerValue('Content-Security-Policy')

    expect(policy).toContain(
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://*.ingest.sentry.io https://*.ingest.de.sentry.io",
    )
    expect(policy).not.toContain('paypay.ne.jp')
    expect(policy).not.toContain('accounts.google.com')
  })

  it('prevents token-bearing routes from being sent as cross-origin referrers', () => {
    expect(headerValue('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(headerValue('X-Content-Type-Options')).toBe('nosniff')
    expect(headerValue('Permissions-Policy')).toContain('camera=()')
    expect(headerValue('Permissions-Policy')).toContain('geolocation=()')
    expect(headerValue('Permissions-Policy')).toContain('microphone=()')
    expect(headerValue('Permissions-Policy')).toContain('payment=()')
  })
})
