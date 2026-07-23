# line-assistant-webhook

- Verifies `x-line-signature` as Base64 HMAC-SHA256 over the untouched raw body using `LINE_CHANNEL_SECRET`.
- Uses the stable `webhookEventId` plus the original event timestamp for replay protection; redeliveries are deduplicated.
- Transforms `source.userId` with `EXTERNAL_ACCOUNT_HMAC_KEY` before any database call. The raw LINE user ID is never stored.
- Limits each linked or unlinked HMAC identity to 10 accepted assistant actions per five minutes.
- Supports `連携 ABCD1234`, `状況`, and opaque settlement-ID postbacks for report/confirm.
- Replies with `LINE_CHANNEL_ACCESS_TOKEN`; all secrets stay in Supabase Function secrets.
