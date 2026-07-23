import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encryptIntegrationSecret } from '../_shared/integration-secrets.ts'

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
}

type Provider = 'discord' | 'line'
type RequestBody = {
  action?: 'list' | 'save' | 'delete'
  eventId?: string
  provider?: Provider
  destination?: string
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders })
}

function safeIntegration(row: Record<string, unknown>) {
  return {
    id: row.id,
    provider: row.provider,
    externalSpaceName: row.external_space_name,
    status: row.status,
    connectedAt: row.connected_at,
  }
}

function discordWebhook(value: string): { url: string; webhookId: string } {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('DISCORD_WEBHOOK_URL_INVALID')
  }
  const allowedHost = url.hostname === 'discord.com' || url.hostname === 'discordapp.com'
  const match = url.pathname.match(/^\/api\/webhooks\/([0-9]+)\/([A-Za-z0-9._-]+)$/)
  if (url.protocol !== 'https:' || !allowedHost || !match) throw new Error('DISCORD_WEBHOOK_URL_INVALID')
  url.search = ''
  url.hash = ''
  return { url: url.toString(), webhookId: match[1] }
}

function lineDestination(value: string): string {
  const destination = value.trim()
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(destination)) throw new Error('LINE_DESTINATION_INVALID')
  return destination
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const publishableKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const authorization = request.headers.get('authorization') ?? ''
    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { authorization } },
      auth: { persistSession: false },
    })
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) return json({ error: 'AUTHENTICATION_REQUIRED' }, 401)

    const body = await request.json() as RequestBody
    if (!body.eventId) return json({ error: 'EVENT_ID_REQUIRED' }, 400)
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
    const { data: event, error: eventError } = await serviceClient
      .from('events')
      .select('id, organizer_user_id')
      .eq('id', body.eventId)
      .maybeSingle()
    if (eventError || !event) return json({ error: 'EVENT_NOT_FOUND' }, 404)
    if (event.organizer_user_id !== user.id) return json({ error: 'ORGANIZER_REQUIRED' }, 403)

    if (body.action === 'list') {
      const { data, error } = await serviceClient
        .from('event_integrations')
        .select('id, provider, external_space_name, status, connected_at')
        .eq('event_id', body.eventId)
        .order('provider')
      if (error) throw error
      return json({ integrations: (data ?? []).map(safeIntegration) })
    }

    if (body.action === 'delete') {
      if (body.provider !== 'discord' && body.provider !== 'line') return json({ error: 'PROVIDER_REQUIRED' }, 400)
      const { error } = await serviceClient
        .from('event_integrations')
        .delete()
        .eq('event_id', body.eventId)
        .eq('provider', body.provider)
      if (error) throw error
      return json({ ok: true })
    }

    if (body.action === 'save') {
      if (body.provider !== 'discord' && body.provider !== 'line') return json({ error: 'PROVIDER_REQUIRED' }, 400)
      const destination = body.destination?.trim() ?? ''
      let externalSpaceId = ''
      let externalSpaceName = ''
      let config: Record<string, unknown> = {}

      if (body.provider === 'discord') {
        const webhook = discordWebhook(destination)
        const encodedKey = Deno.env.get('INTEGRATION_ENCRYPTION_KEY') ?? ''
        config = { webhook_secret: await encryptIntegrationSecret(webhook.url, encodedKey) }
        externalSpaceId = webhook.webhookId
        externalSpaceName = `Discord Webhook …${webhook.webhookId.slice(-6)}`
      } else {
        externalSpaceId = lineDestination(destination)
        externalSpaceName = `LINE送信先 …${externalSpaceId.slice(-6)}`
      }

      const { data, error } = await serviceClient
        .from('event_integrations')
        .upsert({
          event_id: body.eventId,
          provider: body.provider,
          external_space_id: externalSpaceId,
          external_space_name: externalSpaceName,
          config,
          status: 'active',
          connected_at: new Date().toISOString(),
        }, { onConflict: 'event_id,provider' })
        .select('id, provider, external_space_name, status, connected_at')
        .single()
      if (error) throw error
      await serviceClient.from('activity_logs').insert({
        event_id: body.eventId,
        actor_user_id: user.id,
        action: 'upsert_integration',
        detail: { provider: body.provider },
      })
      return json({ integration: safeIntegration(data) })
    }

    return json({ error: 'ACTION_REQUIRED' }, 400)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'INTEGRATION_SETTINGS_FAILED'
    const clientError = message.endsWith('_INVALID')
    return json({ error: message }, clientError ? 400 : 500)
  }
})
