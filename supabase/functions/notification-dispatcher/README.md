# notification-dispatcher

Service-role-only Edge Function for processing due notification outbox jobs.

- Invoke with `POST` from Supabase Cron or an authenticated scheduler.
- Discord uses `event_integrations.config.webhook_url` and disables mention expansion.
- LINE is intentionally rejected until its channel-token/user-target secret boundary is finalized.
- The function never exposes integration config to the browser and records every attempt in `notification_deliveries`.

Before enabling in production, add an atomic claim RPC (or equivalent row lock) so multiple cron invocations cannot process the same job concurrently.
