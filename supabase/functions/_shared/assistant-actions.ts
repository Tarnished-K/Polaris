export type AssistantAction =
  | { kind: 'link'; code: string }
  | { kind: 'status' }
  | { kind: 'report'; settlementId: string }
  | { kind: 'confirm'; settlementId: string }
  | { kind: 'help' }

export type LinkedSettlementStatus = {
  eventStatus: 'active' | 'finalized'
  pendingCount: number
  reportedCount: number
  completedCount: number
  remainingAmount: number
  settlements: Array<{
    settlementId: string
    direction: 'outgoing' | 'incoming'
    counterpartyName: string
    amount: number
    status: 'pending' | 'reported' | 'paid'
    url: string
  }>
}

const SETTLEMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function safeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

export function parseTextAction(text: string): AssistantAction {
  const trimmed = text.trim()
  const link = trimmed.match(/^(?:link|連携)\s+([0-9a-f]{8})$/i)
  if (link) return { kind: 'link', code: link[1].toUpperCase() }
  if (/^(?:status|状況|精算状況)$/i.test(trimmed)) return { kind: 'status' }
  return { kind: 'help' }
}

export function parsePostbackAction(data: string): AssistantAction {
  const params = new URLSearchParams(data)
  const action = params.get('action')
  const settlementId = params.get('settlement') ?? ''
  if ((action === 'report' || action === 'confirm') && SETTLEMENT_ID.test(settlementId)) {
    return { kind: action, settlementId }
  }
  return { kind: 'help' }
}

export function parseDiscordAction(value: unknown): AssistantAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { kind: 'help' }
  const data = (value as Record<string, unknown>).data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { kind: 'help' }
  const command = data as Record<string, unknown>
  const name = command.name
  const options = Array.isArray(command.options) ? command.options : []
  const optionValue = (optionName: string) => {
    const option = options.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>).name === optionName)
    return option && typeof option === 'object' ? (option as Record<string, unknown>).value : undefined
  }
  if (name === 'link') {
    const code = optionValue('code')
    return typeof code === 'string' ? parseTextAction(`link ${code}`) : { kind: 'help' }
  }
  if (name === 'status') return { kind: 'status' }
  if (name === 'report' || name === 'confirm') {
    const settlementId = optionValue('settlement')
    return typeof settlementId === 'string' && SETTLEMENT_ID.test(settlementId)
      ? { kind: name, settlementId }
      : { kind: 'help' }
  }
  return { kind: 'help' }
}

export function normalizeLinkedStatus(value: unknown): LinkedSettlementStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_MEMBER_STATUS')
  const record = value as Record<string, unknown>
  const settlements = Array.isArray(record.settlements)
    ? record.settlements.flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return []
        const settlement = item as Record<string, unknown>
        if (
          typeof settlement.settlementId !== 'string'
          || !SETTLEMENT_ID.test(settlement.settlementId)
          || (settlement.direction !== 'incoming' && settlement.direction !== 'outgoing')
          || typeof settlement.counterpartyName !== 'string'
          || settlement.counterpartyName.length > 60
          || (settlement.status !== 'pending' && settlement.status !== 'reported' && settlement.status !== 'paid')
          || typeof settlement.url !== 'string'
          || !settlement.url.startsWith('https://polaris-warikan.netlify.app/e/')
        ) return []
        return [{
          settlementId: settlement.settlementId,
          direction: settlement.direction as 'incoming' | 'outgoing',
          counterpartyName: settlement.counterpartyName,
          amount: safeInteger(settlement.amount),
          status: settlement.status as 'pending' | 'reported' | 'paid',
          url: settlement.url,
        }]
      })
    : []
  return {
    eventStatus: record.eventStatus === 'finalized' ? 'finalized' : 'active',
    pendingCount: safeInteger(record.pendingCount),
    reportedCount: safeInteger(record.reportedCount),
    completedCount: safeInteger(record.completedCount),
    remainingAmount: safeInteger(record.remainingAmount),
    settlements,
  }
}

export function linkedStatusMessage(status: LinkedSettlementStatus): string {
  if (status.eventStatus !== 'finalized') return '精算はまだ確定していません。'
  const header = `あなたの精算：未払い${status.pendingCount}件、報告済み${status.reportedCount}件、完了${status.completedCount}件`
  const open = status.settlements
    .filter((settlement) => settlement.status !== 'paid')
    .slice(0, 5)
    .map((settlement) => {
      const direction = settlement.direction === 'outgoing'
        ? `${settlement.counterpartyName}さんへ支払う`
        : `${settlement.counterpartyName}さんから受け取る`
      return `${direction} ${settlement.amount.toLocaleString('ja-JP')}円\n${settlement.url}`
    })
  return [header, `未完了の残額：${status.remainingAmount.toLocaleString('ja-JP')}円`, ...open].join('\n')
}

export function linkResultMessage(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '連携できませんでした。'
  const result = value as Record<string, unknown>
  if (result.linked === true) return 'アプリの参加者と連携しました。'
  const messages: Record<string, string> = {
    INVALID_LINK_CODE: '連携コードが正しくありません。',
    LINK_CODE_ALREADY_USED: 'この連携コードは使用済みです。',
    LINK_CODE_LOCKED: '試行回数を超えました。アプリでコードを再発行してください。',
    LINK_CODE_EXPIRED: '連携コードの有効期限が切れました。アプリで再発行してください。',
    EXTERNAL_ACCOUNT_ALREADY_LINKED: 'このアカウントは別の参加者と連携済みです。',
  }
  return messages[String(result.error)] ?? '連携できませんでした。'
}

export const ASSISTANT_HELP_MESSAGE = 'アプリで連携コードを発行し「連携 ABCD1234」と送るか、「状況」と送ってください。'
