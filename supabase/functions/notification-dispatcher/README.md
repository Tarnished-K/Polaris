# notification-dispatcher

Service-role-only Edge Function for processing due notification outbox jobs.

- Invoke with `POST` from Supabase Cron or a trusted scheduler, setting `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`.
- The function keeps the Supabase gateway JWT check enabled and additionally requires an exact service-role bearer match before claiming any jobs.
- A missing or invalid bearer token returns `401` with `{"error":"AUTHENTICATION_REQUIRED"}`.
- Discord decrypts `event_integrations.config.webhook_secret` with `INTEGRATION_ENCRYPTION_KEY` and disables mention expansion.
- LINE reads `LINE_CHANNEL_ACCESS_TOKEN` from Function secrets and sends only to the registered integration target.
- The function never exposes integration config to the browser and records every attempt in `notification_deliveries`.
- `claim_notification_jobs` atomically claims due work so concurrent invocations do not process the same job.
