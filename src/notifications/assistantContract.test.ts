import { describe, expect, it } from 'vitest'

import {
  normalizeAssistantStatus,
  parseAssistantStatusRequest,
  settlementStatusMessage,
} from '../../supabase/functions/_shared/assistant-contract'

const shareToken = 'a'.repeat(43)
const url = `https://polaris-warikan.netlify.app/e/${shareToken}?view=payment`

describe('event assistant status contract', () => {
  it('accepts only a status request with a URL-safe share token', () => {
    expect(parseAssistantStatusRequest({ action: 'status', shareToken })).toEqual({
      action: 'status',
      shareToken,
    })
    expect(() => parseAssistantStatusRequest(null)).toThrow('INVALID_REQUEST')
    expect(() => parseAssistantStatusRequest({ action: 'pay', shareToken })).toThrow('UNSUPPORTED_ACTION')
    expect(() => parseAssistantStatusRequest({ action: 'status', shareToken: '../../secret' })).toThrow('INVALID_SHARE_TOKEN')
  })

  it('normalizes aggregate status without accepting arbitrary URLs or personal fields', () => {
    const status = normalizeAssistantStatus({
      eventStatus: 'finalized',
      totalCount: 3,
      pendingCount: 1,
      reportedCount: 1,
      completedCount: 1,
      remainingAmount: 4800,
      allPaid: false,
      url,
      memberNames: ['should', 'not', 'escape'],
    })
    expect(status).toEqual({
      eventStatus: 'finalized',
      totalCount: 3,
      pendingCount: 1,
      reportedCount: 1,
      completedCount: 1,
      remainingAmount: 4800,
      allPaid: false,
      url,
    })
    expect(() => normalizeAssistantStatus({ url: 'https://evil.example/e/token' })).toThrow('INVALID_STATUS_URL')
  })

  it('formats a concise read-only response for open settlements', () => {
    const message = settlementStatusMessage(normalizeAssistantStatus({
      eventStatus: 'finalized',
      totalCount: 3,
      pendingCount: 1,
      reportedCount: 1,
      completedCount: 1,
      remainingAmount: 4800,
      allPaid: false,
      url,
    }))
    expect(message).toContain('完了1件')
    expect(message).toContain('未払い1件')
    expect(message).toContain('4,800円')
    expect(message).toContain(url)
  })

  it('does not imply completion before finalization', () => {
    expect(settlementStatusMessage(normalizeAssistantStatus({
      eventStatus: 'active',
      totalCount: 0,
      pendingCount: 0,
      reportedCount: 0,
      completedCount: 0,
      remainingAmount: 0,
      allPaid: false,
      url,
    }))).toBe(`精算はまだ確定していません。\n${url}`)
  })

  it('returns a short completion response when every settlement is paid', () => {
    expect(settlementStatusMessage(normalizeAssistantStatus({
      eventStatus: 'finalized',
      totalCount: 2,
      pendingCount: 0,
      reportedCount: 0,
      completedCount: 2,
      remainingAmount: 0,
      allPaid: true,
      url,
    }))).toContain('全2件完了')
  })
})
