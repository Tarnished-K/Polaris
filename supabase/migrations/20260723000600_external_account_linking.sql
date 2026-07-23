alter table public.member_external_accounts
  rename column external_user_id to external_user_hash;

update public.member_external_accounts
set external_user_hash = warikan_private.hash_token(provider::text || ':' || external_user_hash)
where external_user_hash !~ '^[0-9a-f]{64}$';

alter table public.member_external_accounts
  add constraint member_external_accounts_hash_format
  check (external_user_hash ~ '^[0-9a-f]{64}$');

create table public.member_link_codes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  provider public.integration_provider not null,
  code_hash text not null unique,
  attempts integer not null default 0 check (attempts between 0 and 5),
  max_attempts integer not null default 5 check (max_attempts between 1 and 5),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint member_link_codes_provider check (provider in ('line', 'discord')),
  constraint member_link_codes_hash_format check (code_hash ~ '^[0-9a-f]{64}$'),
  constraint member_link_codes_expiry check (expires_at > created_at)
);

create unique index member_link_codes_one_active
  on public.member_link_codes(member_id, provider)
  where consumed_at is null;
create index member_link_codes_expiry
  on public.member_link_codes(expires_at)
  where consumed_at is null;

create table public.webhook_receipts (
  id bigint generated always as identity primary key,
  provider public.integration_provider not null,
  external_event_id text not null,
  event_timestamp timestamptz not null,
  payload_hash text not null,
  received_at timestamptz not null default now(),
  constraint webhook_receipts_provider check (provider in ('line', 'discord')),
  constraint webhook_receipts_event_id_length check (char_length(external_event_id) between 8 and 160),
  constraint webhook_receipts_payload_hash check (payload_hash ~ '^[0-9a-f]{64}$'),
  unique (provider, external_event_id)
);

create index webhook_receipts_received_at on public.webhook_receipts(received_at);

create table public.assistant_rate_limit_events (
  id bigint generated always as identity primary key,
  provider public.integration_provider not null,
  external_user_hash text not null,
  occurred_at timestamptz not null default now(),
  constraint assistant_rate_limit_provider check (provider in ('line', 'discord')),
  constraint assistant_rate_limit_hash check (external_user_hash ~ '^[0-9a-f]{64}$')
);

create index assistant_rate_limit_lookup
  on public.assistant_rate_limit_events(provider, external_user_hash, occurred_at);

alter table public.member_link_codes enable row level security;
alter table public.webhook_receipts enable row level security;
alter table public.assistant_rate_limit_events enable row level security;
revoke all on public.member_external_accounts from authenticated;
revoke all on public.member_link_codes, public.webhook_receipts, public.assistant_rate_limit_events from public, anon, authenticated;
revoke all on sequence public.webhook_receipts_id_seq, public.assistant_rate_limit_events_id_seq from public, anon, authenticated;

create or replace function warikan_private.require_external_member(
  p_provider public.integration_provider,
  p_external_user_hash text
)
returns public.members
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_member public.members;
begin
  if p_provider not in ('line', 'discord') or p_external_user_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_EXTERNAL_ACCOUNT' using errcode = '22023';
  end if;

  select m.* into v_member
  from public.member_external_accounts account
  join public.members m on m.id = account.member_id
  where account.provider = p_provider
    and account.external_user_hash = p_external_user_hash
    and account.verified_at is not null;

  if v_member.id is null then
    raise exception 'EXTERNAL_ACCOUNT_NOT_LINKED' using errcode = '42501';
  end if;
  return v_member;
end;
$$;

create or replace function public.create_member_link_code(
  p_share_token text,
  p_device_token text,
  p_provider public.integration_provider
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.members := warikan_private.require_actor(p_share_token, p_device_token);
  v_code text;
  v_expires_at timestamptz := now() + interval '5 minutes';
begin
  if p_provider not in ('line', 'discord') then
    raise exception 'UNSUPPORTED_LINK_PROVIDER' using errcode = '22023';
  end if;

  update public.member_link_codes
  set consumed_at = now()
  where member_id = v_actor.id and provider = p_provider and consumed_at is null;

  loop
    v_code := upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 8));
    begin
      insert into public.member_link_codes(event_id, member_id, provider, code_hash, expires_at)
      values (
        v_actor.event_id,
        v_actor.id,
        p_provider,
        warikan_private.hash_token(v_code),
        v_expires_at
      );
      exit;
    exception when unique_violation then
      null;
    end;
  end loop;

  perform warikan_private.write_log(
    v_actor.event_id,
    v_actor.id,
    'create_member_link_code',
    jsonb_build_object('provider', p_provider, 'expiresAt', v_expires_at)
  );
  return jsonb_build_object(
    'provider', p_provider,
    'code', v_code,
    'expiresAt', v_expires_at
  );
end;
$$;

create or replace function public.get_external_account_links(
  p_share_token text,
  p_device_token text
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_actor public.members := warikan_private.require_actor(p_share_token, p_device_token);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'provider', account.provider,
      'verifiedAt', account.verified_at
    ) order by account.provider)
    from public.member_external_accounts account
    where account.member_id = v_actor.id and account.verified_at is not null
  ), '[]'::jsonb);
end;
$$;

create or replace function public.unlink_external_account(
  p_share_token text,
  p_device_token text,
  p_provider public.integration_provider
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.members := warikan_private.require_actor(p_share_token, p_device_token);
  v_deleted integer;
begin
  if p_provider not in ('line', 'discord') then
    raise exception 'UNSUPPORTED_LINK_PROVIDER' using errcode = '22023';
  end if;
  delete from public.member_external_accounts
  where member_id = v_actor.id and provider = p_provider;
  get diagnostics v_deleted = row_count;
  if v_deleted > 0 then
    perform warikan_private.write_log(
      v_actor.event_id,
      v_actor.id,
      'unlink_external_account',
      jsonb_build_object('provider', p_provider)
    );
  end if;
  return v_deleted > 0;
end;
$$;

create or replace function public.consume_member_link_code(
  p_code text,
  p_provider public.integration_provider,
  p_external_user_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.member_link_codes;
  v_existing public.member_external_accounts;
begin
  if p_code !~ '^[0-9A-Fa-f]{8}$'
    or p_provider not in ('line', 'discord')
    or p_external_user_hash !~ '^[0-9a-f]{64}$'
  then
    return jsonb_build_object('linked', false, 'error', 'INVALID_LINK_CODE');
  end if;

  select * into v_link
  from public.member_link_codes
  where code_hash = warikan_private.hash_token(upper(p_code))
  for update;

  if v_link.id is null then
    return jsonb_build_object('linked', false, 'error', 'INVALID_LINK_CODE');
  end if;
  if v_link.consumed_at is not null then
    return jsonb_build_object('linked', false, 'error', 'LINK_CODE_ALREADY_USED');
  end if;
  if v_link.attempts >= v_link.max_attempts then
    update public.member_link_codes set consumed_at = now() where id = v_link.id;
    return jsonb_build_object('linked', false, 'error', 'LINK_CODE_LOCKED');
  end if;
  if v_link.expires_at <= now() then
    update public.member_link_codes
    set attempts = least(max_attempts, attempts + 1), consumed_at = now()
    where id = v_link.id;
    return jsonb_build_object('linked', false, 'error', 'LINK_CODE_EXPIRED');
  end if;
  if v_link.provider <> p_provider then
    update public.member_link_codes
    set attempts = least(max_attempts, attempts + 1),
        consumed_at = case when attempts + 1 >= max_attempts then now() else consumed_at end
    where id = v_link.id;
    return jsonb_build_object('linked', false, 'error', 'INVALID_LINK_CODE');
  end if;

  select * into v_existing
  from public.member_external_accounts
  where provider = p_provider and external_user_hash = p_external_user_hash;
  if v_existing.id is not null and v_existing.member_id <> v_link.member_id then
    update public.member_link_codes
    set attempts = least(max_attempts, attempts + 1)
    where id = v_link.id;
    return jsonb_build_object('linked', false, 'error', 'EXTERNAL_ACCOUNT_ALREADY_LINKED');
  end if;

  insert into public.member_external_accounts(
    member_id,
    provider,
    external_user_hash,
    display_name,
    verified_at
  )
  values (v_link.member_id, p_provider, p_external_user_hash, null, now())
  on conflict (member_id, provider) do update
  set external_user_hash = excluded.external_user_hash,
      display_name = null,
      verified_at = excluded.verified_at;

  update public.member_link_codes set consumed_at = now() where id = v_link.id;
  perform warikan_private.write_log(
    v_link.event_id,
    v_link.member_id,
    'link_external_account',
    jsonb_build_object('provider', p_provider)
  );
  return jsonb_build_object(
    'linked', true,
    'eventId', v_link.event_id,
    'memberId', v_link.member_id
  );
end;
$$;

create or replace function public.claim_webhook_event(
  p_provider public.integration_provider,
  p_external_event_id text,
  p_timestamp_ms bigint,
  p_payload_hash text,
  p_max_age_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timestamp timestamptz;
  v_inserted integer;
begin
  if p_provider not in ('line', 'discord')
    or char_length(p_external_event_id) not between 8 and 160
    or p_payload_hash !~ '^[0-9a-f]{64}$'
    or p_max_age_seconds not between 60 and 86400
  then
    raise exception 'INVALID_WEBHOOK_RECEIPT' using errcode = '22023';
  end if;
  v_timestamp := to_timestamp(p_timestamp_ms / 1000.0);
  if v_timestamp > now() + interval '5 minutes'
    or v_timestamp < now() - make_interval(secs => p_max_age_seconds)
  then
    return false;
  end if;

  insert into public.webhook_receipts(provider, external_event_id, event_timestamp, payload_hash)
  values (p_provider, p_external_event_id, v_timestamp, p_payload_hash)
  on conflict (provider, external_event_id) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$$;

create or replace function public.get_member_settlement_status_for_bot(
  p_provider public.integration_provider,
  p_external_user_hash text
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_actor public.members := warikan_private.require_external_member(p_provider, p_external_user_hash);
  v_event public.events;
begin
  select * into v_event from public.events where id = v_actor.event_id;
  return jsonb_build_object(
    'eventStatus', v_event.status,
    'pendingCount', (
      select count(*) from public.settlements
      where event_id = v_actor.event_id and amount > 0 and status = 'pending'
        and (from_member_id = v_actor.id or to_member_id = v_actor.id)
    ),
    'reportedCount', (
      select count(*) from public.settlements
      where event_id = v_actor.event_id and amount > 0 and status = 'reported'
        and (from_member_id = v_actor.id or to_member_id = v_actor.id)
    ),
    'completedCount', (
      select count(*) from public.settlements
      where event_id = v_actor.event_id and amount > 0 and status = 'paid'
        and (from_member_id = v_actor.id or to_member_id = v_actor.id)
    ),
    'remainingAmount', (
      select coalesce(sum(amount), 0) from public.settlements
      where event_id = v_actor.event_id and amount > 0 and status <> 'paid'
        and (from_member_id = v_actor.id or to_member_id = v_actor.id)
    ),
    'settlements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'settlementId', settlement.id,
        'direction', case when settlement.from_member_id = v_actor.id then 'outgoing' else 'incoming' end,
        'counterpartyName', counterpart.name,
        'amount', settlement.amount,
        'status', settlement.status,
        'url', warikan_private.payment_deep_link(v_event.share_token, settlement.id)
      ) order by settlement.created_at, settlement.id)
      from public.settlements settlement
      join public.members counterpart on counterpart.id = case
        when settlement.from_member_id = v_actor.id then settlement.to_member_id
        else settlement.from_member_id
      end
      where settlement.event_id = v_actor.event_id
        and settlement.amount > 0
        and (settlement.from_member_id = v_actor.id or settlement.to_member_id = v_actor.id)
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.consume_assistant_rate_limit(
  p_provider public.integration_provider,
  p_external_user_hash text,
  p_limit integer default 10,
  p_window_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_provider not in ('line', 'discord')
    or p_external_user_hash !~ '^[0-9a-f]{64}$'
    or p_limit not between 1 and 50
    or p_window_seconds not between 60 and 3600
  then
    raise exception 'INVALID_RATE_LIMIT' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_provider::text || ':' || p_external_user_hash));
  delete from public.assistant_rate_limit_events
  where provider = p_provider
    and external_user_hash = p_external_user_hash
    and occurred_at < now() - interval '24 hours';

  select count(*) into v_count
  from public.assistant_rate_limit_events
  where provider = p_provider
    and external_user_hash = p_external_user_hash
    and occurred_at >= now() - make_interval(secs => p_window_seconds);
  if v_count >= p_limit then return false; end if;

  insert into public.assistant_rate_limit_events(provider, external_user_hash)
  values (p_provider, p_external_user_hash);
  return true;
end;
$$;

create or replace function public.report_settlement_for_external_account(
  p_provider public.integration_provider,
  p_external_user_hash text,
  p_settlement_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.members := warikan_private.require_external_member(p_provider, p_external_user_hash);
  v_settlement public.settlements;
begin
  select * into v_settlement
  from public.settlements
  where id = p_settlement_id and event_id = v_actor.event_id
  for update;
  if v_settlement.id is null or v_settlement.status <> 'pending' or v_settlement.amount = 0 then
    raise exception 'PENDING_SETTLEMENT_REQUIRED' using errcode = '22023';
  end if;
  if v_settlement.from_member_id <> v_actor.id then
    raise exception 'PAYER_REQUIRED' using errcode = '42501';
  end if;
  update public.settlements
  set status = 'reported', reported_at = now(), reported_by_member_id = v_actor.id
  where id = p_settlement_id;
  perform warikan_private.write_log(
    v_actor.event_id,
    v_actor.id,
    'report_settlement_external',
    jsonb_build_object('provider', p_provider, 'settlementId', p_settlement_id)
  );
end;
$$;

create or replace function public.confirm_settlement_for_external_account(
  p_provider public.integration_provider,
  p_external_user_hash text,
  p_settlement_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.members := warikan_private.require_external_member(p_provider, p_external_user_hash);
  v_settlement public.settlements;
begin
  select * into v_settlement
  from public.settlements
  where id = p_settlement_id and event_id = v_actor.event_id
  for update;
  if v_settlement.id is null or v_settlement.status not in ('pending', 'reported') or v_settlement.amount = 0 then
    raise exception 'OPEN_SETTLEMENT_REQUIRED' using errcode = '22023';
  end if;
  if v_settlement.to_member_id <> v_actor.id then
    raise exception 'RECEIVER_REQUIRED' using errcode = '42501';
  end if;
  update public.settlements
  set status = 'paid', confirmed_at = now(), confirmed_by_member_id = v_actor.id
  where id = p_settlement_id;
  perform warikan_private.write_log(
    v_actor.event_id,
    v_actor.id,
    'confirm_settlement_external',
    jsonb_build_object('provider', p_provider, 'settlementId', p_settlement_id)
  );
end;
$$;

revoke execute on function public.create_member_link_code(text, text, public.integration_provider) from public;
revoke execute on function public.get_external_account_links(text, text) from public;
revoke execute on function public.unlink_external_account(text, text, public.integration_provider) from public;
grant execute on function public.create_member_link_code(text, text, public.integration_provider) to anon, authenticated;
grant execute on function public.get_external_account_links(text, text) to anon, authenticated;
grant execute on function public.unlink_external_account(text, text, public.integration_provider) to anon, authenticated;

revoke execute on function public.consume_member_link_code(text, public.integration_provider, text) from public, anon, authenticated;
revoke execute on function public.claim_webhook_event(public.integration_provider, text, bigint, text, integer) from public, anon, authenticated;
revoke execute on function public.get_member_settlement_status_for_bot(public.integration_provider, text) from public, anon, authenticated;
revoke execute on function public.consume_assistant_rate_limit(public.integration_provider, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.report_settlement_for_external_account(public.integration_provider, text, uuid) from public, anon, authenticated;
revoke execute on function public.confirm_settlement_for_external_account(public.integration_provider, text, uuid) from public, anon, authenticated;
grant execute on function public.consume_member_link_code(text, public.integration_provider, text) to service_role;
grant execute on function public.claim_webhook_event(public.integration_provider, text, bigint, text, integer) to service_role;
grant execute on function public.get_member_settlement_status_for_bot(public.integration_provider, text) to service_role;
grant execute on function public.consume_assistant_rate_limit(public.integration_provider, text, integer, integer) to service_role;
grant execute on function public.report_settlement_for_external_account(public.integration_provider, text, uuid) to service_role;
grant execute on function public.confirm_settlement_for_external_account(public.integration_provider, text, uuid) to service_role;

comment on column public.member_external_accounts.external_user_hash is
  'Provider user identifier transformed by an Edge Function HMAC. Raw platform user IDs are never stored.';
comment on table public.member_link_codes is
  'Five-minute, one-time participant-to-platform linking codes. Only the SHA-256 code hash is stored.';
comment on table public.webhook_receipts is
  'Service-only replay ledger keyed by provider event ID. Stores no raw webhook body.';
comment on table public.assistant_rate_limit_events is
  'HMAC-keyed assistant request timestamps used for a rolling per-account rate limit.';
