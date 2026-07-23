# notification-dispatcher

Service-role-only Edge Function for processing due notification outbox jobs.

- Invoke with `POST` from Supabase Cron or an authenticated scheduler.
- Discord decrypts `event_integrations.config.webhook_secret` with `INTEGRATION_ENCRYPTION_KEY` and disables mention expansion.
- LINE reads `LINE_CHANNEL_ACCESS_TOKEN` from Function secrets and sends only to the registered integration target.
- The function never exposes integration config to the browser and records every attempt in `notification_deliveries`.
- `claim_notification_jobs` atomically claims due work so concurrent invocations do not process the same job.
