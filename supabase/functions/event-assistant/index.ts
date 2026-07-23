import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  normalizeAssistantStatus,
  parseAssistantStatusRequest,
  settlementStatusMessage,
} from '../_shared/assistant-contract.ts'

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function sameSecret(actual: string, expected: string): boolean {
  const encoder = new TextEncoder()
  const actualBytes = encoder.encode(actual)
  const expectedBytes = encoder.encode(expected)
  let difference = actualBytes.length ^ expectedBytes.length
  const length = Math.max(actualBytes.length, expectedBytes.length)
  for (let index = 0; index < length; index += 1) {
    difference |= (actualBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0)
  }
  return difference === 0
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  const expectedKey = Deno.env.get('ASSISTANT_INTERNAL_KEY') ?? ''
  const actualKey = request.headers.get('x-assistant-key') ?? ''
  if (!expectedKey || !sameSecret(actualKey, expectedKey)) {
    return json({ error: 'AUTHENTICATION_REQUIRED' }, 401)
  }

  try {
    const body = parseAssistantStatusRequest(await request.json())
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    )
    const { data, error } = await supabase.rpc('get_settlement_status_for_bot', {
      p_share_token: body.shareToken,
    })
    if (error) {
      const status = error.message.includes('EVENT_NOT_FOUND') ? 404 : 500
      return json({ error: status === 404 ? 'EVENT_NOT_FOUND' : 'STATUS_LOOKUP_FAILED' }, status)
    }
    const settlementStatus = normalizeAssistantStatus(data)
    return json({
      message: settlementStatusMessage(settlementStatus),
      status: settlementStatus,
    })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'INVALID_REQUEST'
    const clientErrors = new Set([
      'INVALID_REQUEST',
      'UNSUPPORTED_ACTION',
      'INVALID_SHARE_TOKEN',
      'INVALID_STATUS_RESPONSE',
      'INVALID_STATUS_URL',
    ])
    return json({ error: clientErrors.has(message) ? message : 'ASSISTANT_FAILED' }, clientErrors.has(message) ? 400 : 500)
  }
})
