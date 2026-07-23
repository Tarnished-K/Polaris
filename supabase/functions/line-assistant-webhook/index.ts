import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { parsePostbackAction, parseTextAction, type AssistantAction } from '../_shared/assistant-actions.ts'
import { performAssistantAction } from '../_shared/assistant-service.ts'
import { externalUserHash, sha256Hex, verifyLineSignature } from '../_shared/webhook-security.ts'

type LineEvent = {
  type?: string
  mode?: string
  timestamp?: number
  webhookEventId?: string
  replyToken?: string
  source?: { userId?: string }
  message?: { type?: string; text?: string }
  postback?: { data?: string }
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
}

function actionFor(event: LineEvent): AssistantAction {
  if (event.type === 'message' && event.message?.type === 'text') {
    return parseTextAction(event.message.text ?? '')
  }
  if (event.type === 'postback') return parsePostbackAction(event.postback?.data ?? '')
  return { kind: 'help' }
}

async function reply(replyToken: string, message: string, channelAccessToken: string): Promise<boolean> {
  const response = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${channelAccessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text: message.slice(0, 5000) }],
    }),
  })
  return response.ok
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  const rawBody = await request.text()
  const channelSecret = Deno.env.get('LINE_CHANNEL_SECRET') ?? ''
  const signature = request.headers.get('x-line-signature') ?? ''
  if (!await verifyLineSignature(rawBody, signature, channelSecret)) {
    return json({ error: 'INVALID_SIGNATURE' }, 401)
  }

  let payload: { events?: LineEvent[] }
  try {
    payload = JSON.parse(rawBody) as { events?: LineEvent[] }
  } catch {
    return json({ error: 'INVALID_JSON' }, 400)
  }

  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )
  const lookupSecret = Deno.env.get('EXTERNAL_ACCOUNT_HMAC_KEY') ?? ''
  const channelAccessToken = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') ?? ''
  if (!lookupSecret || !channelAccessToken) return json({ error: 'SERVER_NOT_CONFIGURED' }, 503)

  const payloadHash = await sha256Hex(rawBody)
  let processed = 0
  for (const event of payload.events ?? []) {
    if (
      event.mode === 'standby'
      || typeof event.webhookEventId !== 'string'
      || typeof event.timestamp !== 'number'
      || typeof event.source?.userId !== 'string'
      || typeof event.replyToken !== 'string'
    ) continue

    const { data: claimed, error: claimError } = await serviceClient.rpc('claim_webhook_event', {
      p_provider: 'line',
      p_external_event_id: event.webhookEventId,
      p_timestamp_ms: event.timestamp,
      p_payload_hash: payloadHash,
      p_max_age_seconds: 86400,
    })
    if (claimError || claimed !== true) continue

    const userHash = await externalUserHash('line', event.source.userId, lookupSecret)
    const { data: withinLimit, error: limitError } = await serviceClient.rpc('consume_assistant_rate_limit', {
      p_provider: 'line',
      p_external_user_hash: userHash,
      p_limit: 10,
      p_window_seconds: 300,
    })
    const message = limitError || withinLimit !== true
      ? '操作が多すぎます。5分ほど待ってからもう一度お試しください。'
      : await performAssistantAction(serviceClient, 'line', userHash, actionFor(event))
    if (!await reply(event.replyToken, message, channelAccessToken)) {
      return json({ error: 'LINE_REPLY_FAILED' }, 502)
    }
    processed += 1
  }
  return json({ processed })
})
