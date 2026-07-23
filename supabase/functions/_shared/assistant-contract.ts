export type AssistantStatusRequest = {
  action: 'status'
  shareToken: string
}

export type AssistantSettlementStatus = {
  eventStatus: 'active' | 'finalized'
  totalCount: number
  pendingCount: number
  reportedCount: number
  completedCount: number
  remainingAmount: number
  allPaid: boolean
  url: string
}

function integer(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

export function parseAssistantStatusRequest(value: unknown): AssistantStatusRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_REQUEST')
  }
  const record = value as Record<string, unknown>
  if (record.action !== 'status') throw new Error('UNSUPPORTED_ACTION')
  const shareToken = typeof record.shareToken === 'string' ? record.shareToken.trim() : ''
  if (!/^[A-Za-z0-9_-]{24,128}$/.test(shareToken)) throw new Error('INVALID_SHARE_TOKEN')
  return { action: 'status', shareToken }
}

export function normalizeAssistantStatus(value: unknown): AssistantSettlementStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_STATUS_RESPONSE')
  }
  const record = value as Record<string, unknown>
  const eventStatus = record.eventStatus === 'finalized' ? 'finalized' : 'active'
  const url = typeof record.url === 'string' && /^https:\/\/polaris-warikan\.netlify\.app\/e\/[A-Za-z0-9_-]+(?:\?.*)?$/.test(record.url)
    ? record.url
    : ''
  if (!url) throw new Error('INVALID_STATUS_URL')

  return {
    eventStatus,
    totalCount: integer(record.totalCount),
    pendingCount: integer(record.pendingCount),
    reportedCount: integer(record.reportedCount),
    completedCount: integer(record.completedCount),
    remainingAmount: integer(record.remainingAmount),
    allPaid: record.allPaid === true,
    url,
  }
}

export function settlementStatusMessage(status: AssistantSettlementStatus): string {
  if (status.eventStatus !== 'finalized') {
    return `精算はまだ確定していません。\n${status.url}`
  }
  if (status.allPaid) {
    return `精算は全${status.totalCount}件完了しています。\n${status.url}`
  }
  return [
    `精算状況：完了${status.completedCount}件、報告済み${status.reportedCount}件、未払い${status.pendingCount}件`,
    `未完了の残額：${status.remainingAmount.toLocaleString('ja-JP')}円`,
    status.url,
  ].join('\n')
}
