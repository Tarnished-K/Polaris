# discord-assistant-webhook

- Verifies Ed25519 over `X-Signature-Timestamp + raw body` using `DISCORD_APPLICATION_PUBLIC_KEY`.
- Rejects timestamps outside five minutes and deduplicates the interaction ID in `webhook_receipts`.
- Responds to PING with PONG and returns ephemeral interaction responses.
- Transforms the Discord user ID with `EXTERNAL_ACCOUNT_HMAC_KEY` before any database call.
- Limits each HMAC identity to 10 accepted assistant actions per five minutes.
- Supports `/link`, `/status`, `/report`, and `/confirm`; settlement mutations remain actor-scoped in Postgres.
