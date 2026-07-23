import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { parseDiscordAction } from '../_shared/assistant-actions.ts'
import { performAssistantAction } from '../_shared/assistant-service.ts'
import {
  discordTimestampMilliseconds,
  externalUserHash,
  isFreshTimestamp,
  sha256Hex,
  verifyDiscordSignature,
} from '../_shared/webhook-security.ts'

type DiscordInteraction = {
  id?: string
  type?: number
  user?: { id?: string }
  member?: { user?: { id?: string } }
  data?: unknown
}

function interactionResponse(content: string): Response {
  return Response.json({
    type: 4,
    data: {
      content: content.slice(0, 2000),
      flags: 64,
      allowed_mentions: { parse: [] },
    },
  })
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  const rawBody = await request.text()
  const signature = request.headers.get('x-signature-ed25519') ?? ''
  const timestamp = request.headers.get('x-signature-timestamp') ?? ''
  const timestampMs = discordTimestampMilliseconds(timestamp)
  const publicKey = Deno.env.get('DISCORD_APPLICATION_PUBLIC_KEY') ?? ''
  if (
    timestampMs === null
    || !isFreshTimestamp(timestampMs)
    || !await verifyDiscordSignature(rawBody, signature, timestamp, publicKey)
  ) {
    return new Response('invalid request signature', { status: 401 })
  }

  let interaction: DiscordInteraction
  try {
    interaction = JSON.parse(rawBody) as DiscordInteraction
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }
  if (interaction.type === 1) return Response.json({ type: 1 })

  const interactionId = interaction.id
  const userId = interaction.member?.user?.id ?? interaction.user?.id
  if (!interactionId || !userId) return interactionResponse('ユーザーを確認できませんでした。')

  const lookupSecret = Deno.env.get('EXTERNAL_ACCOUNT_HMAC_KEY') ?? ''
  if (!lookupSecret) return interactionResponse('BOTの連携設定が完了していません。')
  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )
  const { data: claimed, error: claimError } = await serviceClient.rpc('claim_webhook_event', {
    p_provider: 'discord',
    p_external_event_id: interactionId,
    p_timestamp_ms: timestampMs,
    p_payload_hash: await sha256Hex(rawBody),
    p_max_age_seconds: 300,
  })
  if (claimError) return interactionResponse('操作を受け付けられませんでした。')
  if (claimed !== true) return interactionResponse('この操作はすでに受け付けています。')

  const userHash = await externalUserHash('discord', userId, lookupSecret)
  const { data: withinLimit, error: limitError } = await serviceClient.rpc('consume_assistant_rate_limit', {
    p_provider: 'discord',
    p_external_user_hash: userHash,
    p_limit: 10,
    p_window_seconds: 300,
  })
  if (limitError || withinLimit !== true) {
    return interactionResponse('操作が多すぎます。5分ほど待ってからもう一度お試しください。')
  }
  const message = await performAssistantAction(
    serviceClient,
    'discord',
    userHash,
    parseDiscordAction(interaction),
  )
  return interactionResponse(message)
})
