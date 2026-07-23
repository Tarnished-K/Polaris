import { generateDeviceToken } from './supabase'

const STORAGE_KEY = 'warikan.web.event-sessions.v1'

export interface SharedEventRoute {
  shareToken: string
  claimToken: string | null
  initialView: 'payment' | null
  settlementId: string | null
}

export interface EventDeviceSession {
  deviceToken: string
  memberId: string | null
}

type SessionMap = Record<string, EventDeviceSession>

export function parseSharedEventRoute(
  pathname: string,
  search = '',
): SharedEventRoute | null {
  const match = pathname.match(/^\/e\/([A-Za-z0-9_-]+)\/?$/)
  if (!match) return null

  const params = new URLSearchParams(search)
  const claimToken = params.get('claim')?.trim() || null
  const initialView = params.get('view') === 'payment' ? 'payment' : null
  const settlementCandidate = params.get('settlement')?.trim() ?? ''
  const settlementId = initialView && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(settlementCandidate)
    ? settlementCandidate
    : null
  return { shareToken: match[1], claimToken, initialView, settlementId }
}

export function buildPaymentDeepLink(shareToken: string, settlementId?: string): string {
  const params = new URLSearchParams({ view: 'payment' })
  if (settlementId) params.set('settlement', settlementId)
  return `/e/${shareToken}?${params.toString()}`
}

function readSessions(storage: Storage): SessionMap {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as SessionMap
  } catch {
    return {}
  }
}

export function getOrCreateEventSession(
  storage: Storage,
  shareToken: string,
): EventDeviceSession {
  const sessions = readSessions(storage)
  const existing = sessions[shareToken]
  if (
    existing &&
    typeof existing.deviceToken === 'string' &&
    existing.deviceToken.length >= 32
  ) {
    return {
      deviceToken: existing.deviceToken,
      memberId: typeof existing.memberId === 'string' ? existing.memberId : null,
    }
  }

  const created = { deviceToken: generateDeviceToken(), memberId: null }
  storage.setItem(STORAGE_KEY, JSON.stringify({ ...sessions, [shareToken]: created }))
  return created
}

export function saveEventMember(
  storage: Storage,
  shareToken: string,
  memberId: string,
): EventDeviceSession {
  const session = getOrCreateEventSession(storage, shareToken)
  const updated = { ...session, memberId }
  const sessions = readSessions(storage)
  storage.setItem(STORAGE_KEY, JSON.stringify({ ...sessions, [shareToken]: updated }))
  return updated
}
