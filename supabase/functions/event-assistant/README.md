# event-assistant

Internal, read-only boundary for the first assistant rollout.

- Accepts only `POST {"action":"status","shareToken":"..."}`.
- Requires `x-assistant-key` matching the `ASSISTANT_INTERNAL_KEY` Function secret.
- Calls the service-role-only aggregate RPC and returns counts, remaining amount, completion state, and a payment deep link.
- Does not return member names, payment profiles, device tokens, claim tokens, or integration secrets.
- LINE/Discord webhook signature verification and linked-user mutations belong to the next rollout and must not reuse this internal key as a platform signature.
