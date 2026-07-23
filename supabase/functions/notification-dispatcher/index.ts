import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decryptIntegrationSecret, type EncryptedSecret } from '../_shared/integration-secrets.ts'
import { matchesServiceRoleAuthorization } from '../_shared/internal-auth.ts'

type Job = {
  id: string
  integration_id: string | null
  notification_type: string
  payload: Record<string, unknown>
  attempts: number
  max_attempts: number
}

type Integration = {
  id: string
  provider: 'discord' | 'line'
  external_space_id: string
  config: Record<string, unknown>
}

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

type SupabaseClient = ReturnType<typeof createClient>

function messageFromPayload(payload: Record<string, unknown>): string {
  const message = typeof payload.message === 'string' ? payload.message.trim() : ''
  if (message) return message
  const title = typeof payload.title === 'string' ? payload.title.trim() : ''
  const url = typeof payload.url === 'string' ? payload.url.trim() : ''
  return [title, url].filter(Boolean).join('\n')
}

function backoff(attempt: number): string {
  const seconds = Math.min(3600, 2 ** Math.max(0, attempt - 1) * 30)
  return new Date(Date.now() + seconds * 1000).toISOString()
}

async function deliver(job: Job, integration: Integration) {
  const message = messageFromPayload(job.payload)
  if (!message) throw new Error('EMPTY_NOTIFICATION_MESSAGE')

  if (integration.provider === 'discord') {
    const encryptedSecret = integration.config.webhook_secret as EncryptedSecret | undefined
    const encodedKey = Deno.env.get('INTEGRATION_ENCRYPTION_KEY') ?? ''
    if (!encryptedSecret) throw new Error('DISCORD_WEBHOOK_SECRET_MISSING')
    const webhookUrl = await decryptIntegrationSecret(encryptedSecret, encodedKey)
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: message.slice(0, 2000), allowed_mentions: { parse: [] } })
    })
    if (!response.ok) throw new Error(`DISCORD_HTTP_${response.status}`)
    return { providerMessageId: response.headers.get('x-ratelimit-bucket') }
  }

  if (integration.provider === 'line') {
    const channelAccessToken = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') ?? ''
    if (!channelAccessToken) throw new Error('LINE_CHANNEL_ACCESS_TOKEN_MISSING')
    if (!integration.external_space_id) throw new Error('LINE_TARGET_MISSING')
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${channelAccessToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        to: integration.external_space_id,
        messages: [{ type: 'text', text: message.slice(0, 5000) }]
      })
    })
    if (!response.ok) throw new Error(`LINE_HTTP_${response.status}`)
    return { providerMessageId: response.headers.get('x-line-request-id') }
  }

  throw new Error(`UNSUPPORTED_PROVIDER_${integration.provider.toUpperCase()}`)
}

async function processJob(job: Job, supabase: SupabaseClient) {
  const attempt = job.attempts

  const { data: integration, error: integrationError } = await supabase
    .from('event_integrations')
    .select('id, provider, external_space_id, config')
    .eq('id', job.integration_id ?? '')
    .maybeSingle()
  if (integrationError || !integration) throw new Error('INTEGRATION_NOT_FOUND')

  try {
    const result = await deliver(job, integration as Integration)
    await supabase.from('notification_deliveries').insert({
      job_id: job.id,
      provider: integration.provider,
      attempt,
      status: 'sent',
      provider_message_id: result.providerMessageId,
      response: { notificationType: job.notification_type }
    })
    await supabase.from('notification_jobs').update({ status: 'sent', processed_at: new Date().toISOString(), last_error: null }).eq('id', job.id)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const terminal = attempt >= job.max_attempts
    await supabase.from('notification_deliveries').insert({ job_id: job.id, provider: integration.provider, attempt, status: terminal ? 'failed' : 'pending', error_message: message })
    await supabase.from('notification_jobs').update({ status: terminal ? 'failed' : 'pending', scheduled_for: terminal ? new Date().toISOString() : backoff(attempt), last_error: message }).eq('id', job.id)
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  if (!matchesServiceRoleAuthorization(request.headers.get('authorization'), serviceRoleKey)) {
    return Response.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const { data: jobs, error } = await supabase.rpc('claim_notification_jobs', { p_limit: 20 })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  for (const job of (jobs ?? []) as Job[]) await processJob(job, supabase)
  return Response.json({ processed: jobs?.length ?? 0 })
})
