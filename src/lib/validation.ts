const RESERVED_MEMBER_NAMES = new Set(['あなた', '幹事'])
export const RESERVED_MEMBER_NAME_ERROR = '「あなた」「幹事」は他の参加者と区別しやすくするため予約されています'

export function validateMemberName(name: string): { valid: boolean; error?: string } {
  const normalized = name.trim()
  if (!normalized) return { valid: false, error: '参加者名を入力してください' }
  if (RESERVED_MEMBER_NAMES.has(normalized)) return { valid: false, error: RESERVED_MEMBER_NAME_ERROR }
  return { valid: true }
}

export function nextAvailableMemberName(existingNames: string[], requestedName: string): string {
  const base = requestedName.trim()
  if (!existingNames.includes(base)) return base

  let suffix = 1
  while (existingNames.includes(`${base}(${suffix})`)) suffix += 1
  return `${base}(${suffix})`
}

export function validateDiscordWebhookUrl(value: string): { valid: boolean; error?: string } {
  try {
    const url = new URL(value.trim())
    const allowedHost = url.hostname === 'discord.com' || url.hostname === 'discordapp.com'
    const validPath = /^\/api\/webhooks\/[0-9]+\/[A-Za-z0-9._-]+$/.test(url.pathname)
    if (url.protocol === 'https:' && allowedHost && validPath) return { valid: true }
  } catch {
    // Use the same user-facing error for malformed and unsupported URLs.
  }
  return { valid: false, error: 'Discord公式のWebhook URLを入力してください。' }
}

export function validateLineDestination(value: string): { valid: boolean; error?: string } {
  const destination = value.trim()
  if (/^[A-Za-z0-9_-]{16,128}$/.test(destination)) return { valid: true }
  return { valid: false, error: 'LINEのUser／Group／Room IDを入力してください。' }
}

export function validatePayPayId(value: string): { valid: boolean; error?: string } {
  const paypayId = value.trim()
  if (!paypayId || /^[a-z][a-z0-9_]{2,14}$/.test(paypayId)) return { valid: true }
  return {
    valid: false,
    error: 'PayPay IDは英小文字で始まる3〜15文字の英小文字・数字・アンダーバーで入力してください。',
  }
}

export function validatePayPayRequestUrl(value: string): { valid: boolean; error?: string } {
  const requestUrl = value.trim()
  if (!requestUrl) return { valid: true }
  try {
    const url = new URL(requestUrl)
    const officialHost = url.hostname === 'paypay.ne.jp' || url.hostname.endsWith('.paypay.ne.jp')
    if (
      url.protocol === 'https:' &&
      officialHost &&
      !url.username &&
      !url.password &&
      !url.port &&
      requestUrl.length <= 2048
    ) {
      return { valid: true }
    }
  } catch {
    // Use one user-facing message for malformed and unsupported links.
  }
  return { valid: false, error: 'PayPay公式ドメインのHTTPS請求リンクを入力してください。' }
}
