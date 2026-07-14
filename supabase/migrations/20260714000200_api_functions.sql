create schema if not exists warikan_private;
revoke all on schema warikan_private from public, anon, authenticated;

create function warikan_private.hash_token(p_token text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
$$;

create function warikan_private.random_token(p_bytes integer default 24)
returns text
language sql
volatile
set search_path = ''
as $$
  select pg_catalog.translate(pg_catalog.encode(extensions.gen_random_bytes(p_bytes), 'base64'), '+/=', '-_')
$$;

create function warikan_private.require_organizer(p_event_id uuid)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
begin
  select * into v_event from public.events where id = p_event_id;
  if v_event.id is null then raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if (select auth.uid()) is null or v_event.organizer_user_id <> (select auth.uid()) then
    raise exception 'ORGANIZER_REQUIRED' using errcode = '42501';
  end if;
  return v_event;
end;
$$;

create function warikan_private.require_member(p_share_token text, p_device_token text)
returns public.members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members;
begin
  if p_device_token is null or char_length(p_device_token) < 32 then
    raise exception 'INVALID_DEVICE_TOKEN' using errcode = '22023';
  end if;
  select m.* into v_member
  from public.events e
  join public.members m on m.event_id = e.id
  where e.share_token = p_share_token
    and m.device_token_hash = warikan_private.hash_token(p_device_token);
  if v_member.id is null then raise exception 'PARTICIPANT_NOT_FOUND' using errcode = '42501'; end if;
  return v_member;
end;
$$;

create function warikan_private.next_member_name(p_event_id uuid, p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text := btrim(p_name);
  v_name text := btrim(p_name);
  v_suffix integer := 2;
begin
  if char_length(v_base) not between 1 and 50 then raise exception 'INVALID_MEMBER_NAME' using errcode = '22023'; end if;
  while exists (select 1 from public.members where event_id = p_event_id and name = v_name) loop
    v_name := v_base || '(' || v_suffix || ')';
    v_suffix := v_suffix + 1;
  end loop;
  return v_name;
end;
$$;

create function warikan_private.write_log(p_event_id uuid, p_member_id uuid, p_action text, p_detail jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.activity_logs(event_id, member_id, actor_user_id, action, detail)
  values (p_event_id, p_member_id, (select auth.uid()), p_action, coalesce(p_detail, '{}'::jsonb))
$$;

create function public.get_event_state(p_share_token text)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_event public.events;
begin
  select * into v_event from public.events where share_token = p_share_token;
  if v_event.id is null then raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002'; end if;

  return jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id,
      'shareToken', v_event.share_token,
      'title', v_event.title,
      'eventType', v_event.event_type,
      'startDate', v_event.start_date,
      'endDate', v_event.end_date,
      'capacity', v_event.capacity,
      'status', v_event.status
    ),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'name', m.name,
        'isOrganizer', m.is_organizer,
        'isClaimed', m.device_token_hash is not null
      ) order by m.created_at, m.id)
      from public.members m where m.event_id = v_event.id
    ), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', x.id,
        'category', x.category,
        'title', x.title,
        'amount', x.amount,
        'payerMemberId', x.payer_member_id,
        'targetMemberIds', coalesce((select jsonb_agg(t.member_id order by t.member_id) from public.expense_targets t where t.expense_id = x.id), '[]'::jsonb),
        'splitMethod', x.split_method,
        'fixedAmounts', coalesce((select jsonb_object_agg(t.member_id::text, t.fixed_amount) from public.expense_targets t where t.expense_id = x.id and t.fixed_amount is not null), '{}'::jsonb),
        'status', x.status,
        'dayIndex', x.day_index,
        'createdByMemberId', x.created_by_member_id,
        'createdAt', x.created_at
      )) order by x.created_at, x.id)
      from public.expenses x where x.event_id = v_event.id
    ), '[]'::jsonb),
    'settlements', case when v_event.status = 'finalized' then coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', s.id,
        'fromMemberId', s.from_member_id,
        'toMemberId', s.to_member_id,
        'amount', s.amount,
        'grossAmount', s.gross_amount,
        'offsetAmount', s.offset_amount,
        'status', s.status,
        'reportedByMemberId', s.reported_by_member_id,
        'confirmedByMemberId', s.confirmed_by_member_id,
        'charges', coalesce((
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'expenseId', i.expense_id, 'expenseTitle', x.title, 'category', x.category,
            'amount', i.amount, 'fromMemberId', s.from_member_id, 'toMemberId', s.to_member_id, 'dayIndex', x.day_index
          )) order by x.created_at)
          from public.settlement_items i join public.expenses x on x.id = i.expense_id
          where i.settlement_id = s.id and i.direction = 'charge'
        ), '[]'::jsonb),
        'offsets', coalesce((
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'expenseId', i.expense_id, 'expenseTitle', x.title, 'category', x.category,
            'amount', i.amount, 'fromMemberId', s.to_member_id, 'toMemberId', s.from_member_id, 'dayIndex', x.day_index
          )) order by x.created_at)
          from public.settlement_items i join public.expenses x on x.id = i.expense_id
          where i.settlement_id = s.id and i.direction = 'offset'
        ), '[]'::jsonb)
      )) order by s.created_at, s.id)
      from public.settlements s where s.event_id = v_event.id
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

create function public.create_event(
  p_title text,
  p_event_type public.event_type,
  p_start_date date,
  p_end_date date,
  p_capacity integer default 8
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_member public.members;
begin
  if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if char_length(btrim(p_title)) not between 1 and 120 then raise exception 'INVALID_TITLE' using errcode = '22023'; end if;
  if p_capacity not between 2 and 50 then raise exception 'INVALID_CAPACITY' using errcode = '22023'; end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then raise exception 'INVALID_DATE_RANGE' using errcode = '22023'; end if;
  if p_event_type = 'single_day' then p_end_date := p_start_date; end if;

  insert into public.events(share_token, organizer_user_id, title, event_type, start_date, end_date, capacity)
  values (warikan_private.random_token(), (select auth.uid()), btrim(p_title), p_event_type, p_start_date, p_end_date, p_capacity)
  returning * into v_event;
  insert into public.members(event_id, name, is_organizer) values (v_event.id, 'あなた', true) returning * into v_member;
  perform warikan_private.write_log(v_event.id, v_member.id, 'create_event');
  return public.get_event_state(v_event.share_token);
end;
$$;

create function public.join_event(p_share_token text, p_device_token text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_member public.members;
begin
  if p_device_token is null or char_length(p_device_token) < 32 then raise exception 'INVALID_DEVICE_TOKEN' using errcode = '22023'; end if;
  select * into v_event from public.events where share_token = p_share_token for update;
  if v_event.id is null then raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_event.status <> 'active' then raise exception 'EVENT_FINALIZED' using errcode = '55000'; end if;
  if exists (select 1 from public.members where event_id = v_event.id and device_token_hash = warikan_private.hash_token(p_device_token)) then
    raise exception 'DEVICE_ALREADY_JOINED' using errcode = '23505';
  end if;
  if (select count(*) from public.members where event_id = v_event.id) >= v_event.capacity then
    raise exception 'EVENT_CAPACITY_REACHED' using errcode = '54000';
  end if;
  insert into public.members(event_id, name, device_token_hash, claimed_at)
  values (v_event.id, warikan_private.next_member_name(v_event.id, p_name), warikan_private.hash_token(p_device_token), now())
  returning * into v_member;
  perform warikan_private.write_log(v_event.id, v_member.id, 'join');
  return jsonb_build_object('memberId', v_member.id, 'state', public.get_event_state(p_share_token));
end;
$$;

create function public.organizer_add_member(p_event_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events := warikan_private.require_organizer(p_event_id);
  v_member public.members;
  v_count integer;
begin
  if v_event.status <> 'active' then raise exception 'EVENT_FINALIZED' using errcode = '55000'; end if;
  select count(*) into v_count from public.members where event_id = p_event_id;
  if v_count >= 50 then raise exception 'EVENT_CAPACITY_REACHED' using errcode = '54000'; end if;
  if v_count >= v_event.capacity then update public.events set capacity = v_count + 1 where id = p_event_id; end if;
  insert into public.members(event_id, name)
  values (p_event_id, warikan_private.next_member_name(p_event_id, p_name)) returning * into v_member;
  perform warikan_private.write_log(p_event_id, v_member.id, 'organizer_add_member');
  return jsonb_build_object('id', v_member.id, 'name', v_member.name, 'isOrganizer', false, 'isClaimed', false);
end;
$$;

create function public.organizer_issue_claim_token(p_event_id uuid, p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events := warikan_private.require_organizer(p_event_id);
  v_token text := warikan_private.random_token(32);
begin
  if not exists (select 1 from public.members where id = p_member_id and event_id = v_event.id and not is_organizer and device_token_hash is null) then
    raise exception 'MEMBER_NOT_CLAIMABLE' using errcode = '22023';
  end if;
  delete from public.member_claim_tokens where member_id = p_member_id and claimed_at is null;
  insert into public.member_claim_tokens(event_id, member_id, token_hash, expires_at)
  values (p_event_id, p_member_id, warikan_private.hash_token(v_token), now() + interval '7 days');
  perform warikan_private.write_log(p_event_id, p_member_id, 'issue_claim_token');
  return jsonb_build_object('memberId', p_member_id, 'claimToken', v_token, 'expiresAt', now() + interval '7 days');
end;
$$;

create function public.claim_member(p_share_token text, p_claim_token text, p_device_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.member_claim_tokens;
  v_event public.events;
begin
  if p_device_token is null or char_length(p_device_token) < 32 then raise exception 'INVALID_DEVICE_TOKEN' using errcode = '22023'; end if;
  select c.* into v_claim
  from public.member_claim_tokens c join public.events e on e.id = c.event_id
  where e.share_token = p_share_token and c.token_hash = warikan_private.hash_token(p_claim_token)
  for update of c;
  if v_claim.id is null or v_claim.claimed_at is not null or v_claim.expires_at <= now() then
    raise exception 'INVALID_CLAIM_TOKEN' using errcode = '42501';
  end if;
  select * into v_event from public.events where id = v_claim.event_id;
  if exists (select 1 from public.members where event_id = v_claim.event_id and device_token_hash = warikan_private.hash_token(p_device_token)) then
    raise exception 'DEVICE_ALREADY_JOINED' using errcode = '23505';
  end if;
  update public.members set device_token_hash = warikan_private.hash_token(p_device_token), claimed_at = now() where id = v_claim.member_id;
  update public.member_claim_tokens set claimed_at = now() where id = v_claim.id;
  perform warikan_private.write_log(v_claim.event_id, v_claim.member_id, 'claim_member');
  return jsonb_build_object('memberId', v_claim.member_id, 'state', public.get_event_state(p_share_token));
end;
$$;

create function public.organizer_update_event(
  p_event_id uuid,
  p_title text,
  p_event_type public.event_type,
  p_start_date date,
  p_end_date date,
  p_capacity integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events := warikan_private.require_organizer(p_event_id);
  v_member_count integer;
  v_day_count integer;
begin
  select count(*) into v_member_count from public.members where event_id = p_event_id;
  if char_length(btrim(p_title)) not between 1 and 120 or p_capacity not between greatest(2, v_member_count) and 50 then
    raise exception 'INVALID_EVENT_SETTINGS' using errcode = '22023';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then raise exception 'INVALID_DATE_RANGE' using errcode = '22023'; end if;
  if p_event_type = 'single_day' then p_end_date := p_start_date; end if;
  v_day_count := (p_end_date - p_start_date) + 1;
  update public.events set title = btrim(p_title), event_type = p_event_type, start_date = p_start_date, end_date = p_end_date, capacity = p_capacity where id = p_event_id;
  update public.expenses set day_index = null where event_id = p_event_id and (p_event_type = 'single_day' or day_index > v_day_count);
  perform warikan_private.write_log(p_event_id, null, 'organizer_update_event');
  return public.get_event_state(v_event.share_token);
end;
$$;

create function public.organizer_remove_member(p_event_id uuid, p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events := warikan_private.require_organizer(p_event_id);
begin
  if v_event.status <> 'active' then raise exception 'EVENT_FINALIZED' using errcode = '55000'; end if;
  if not exists (select 1 from public.members where id = p_member_id and event_id = p_event_id and not is_organizer) then raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0002'; end if;
  if exists (select 1 from public.expenses where payer_member_id = p_member_id or created_by_member_id = p_member_id)
    or exists (select 1 from public.expense_targets where member_id = p_member_id)
    or exists (select 1 from public.settlements where from_member_id = p_member_id or to_member_id = p_member_id) then
    raise exception 'MEMBER_REFERENCED' using errcode = '23503';
  end if;
  perform warikan_private.write_log(p_event_id, p_member_id, 'organizer_remove_member');
  delete from public.members where id = p_member_id;
end;
$$;

create function public.add_expense(
  p_share_token text,
  p_device_token text,
  p_category public.expense_category,
  p_title text,
  p_amount integer,
  p_payer_member_id uuid,
  p_split_method public.split_method,
  p_day_index integer,
  p_targets jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.members := warikan_private.require_member(p_share_token, p_device_token);
  v_event public.events;
  v_expense public.expenses;
  v_target jsonb;
  v_status public.expense_status;
  v_target_count integer;
  v_distinct_count integer;
  v_fixed_count integer;
  v_fixed_sum bigint;
  v_day_count integer;
begin
  select * into v_event from public.events where id = v_actor.event_id for update;
  if v_event.status <> 'active' then raise exception 'EVENT_FINALIZED' using errcode = '55000'; end if;
  if p_amount <= 0 or char_length(btrim(p_title)) not between 1 and 120 then raise exception 'INVALID_EXPENSE' using errcode = '22023'; end if;
  if not exists (select 1 from public.members where id = p_payer_member_id and event_id = v_event.id) then raise exception 'INVALID_PAYER' using errcode = '22023'; end if;
  if p_targets is null or jsonb_typeof(p_targets) <> 'array' or jsonb_array_length(p_targets) = 0 then raise exception 'TARGETS_REQUIRED' using errcode = '22023'; end if;
  select count(*), count(distinct value->>'memberId'), count(value->>'fixedAmount'), coalesce(sum((value->>'fixedAmount')::integer), 0)
    into v_target_count, v_distinct_count, v_fixed_count, v_fixed_sum
  from jsonb_array_elements(p_targets);
  if v_target_count <> v_distinct_count then raise exception 'DUPLICATE_TARGET' using errcode = '22023'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_targets) target
    where not exists (select 1 from public.members m where m.id = (target->>'memberId')::uuid and m.event_id = v_event.id)
  ) then raise exception 'INVALID_TARGET' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_targets) target where target ? 'fixedAmount' and (target->>'fixedAmount')::integer < 0) then raise exception 'INVALID_FIXED_AMOUNT' using errcode = '22023'; end if;
  v_day_count := (v_event.end_date - v_event.start_date) + 1;
  if p_day_index is not null and (v_event.event_type = 'single_day' or p_day_index < 1 or p_day_index > v_day_count) then raise exception 'INVALID_DAY_INDEX' using errcode = '22023'; end if;
  v_status := case when p_split_method = 'equal' or (v_fixed_count = v_target_count and v_fixed_sum = p_amount) then 'finalized' else 'draft' end;
  insert into public.expenses(event_id, category, title, amount, payer_member_id, split_method, status, day_index, created_by_member_id)
  values (v_event.id, p_category, btrim(p_title), p_amount, p_payer_member_id, p_split_method, v_status, p_day_index, v_actor.id)
  returning * into v_expense;
  for v_target in select value from jsonb_array_elements(p_targets) loop
    insert into public.expense_targets(expense_id, member_id, fixed_amount)
    values (v_expense.id, (v_target->>'memberId')::uuid, case when v_target ? 'fixedAmount' then (v_target->>'fixedAmount')::integer else null end);
  end loop;
  perform warikan_private.write_log(v_event.id, v_actor.id, 'add_expense', jsonb_build_object('expenseId', v_expense.id, 'status', v_status));
  return jsonb_build_object('expenseId', v_expense.id, 'status', v_status);
end;
$$;

create function public.organizer_upsert_integration(
  p_event_id uuid,
  p_provider public.integration_provider,
  p_external_space_id text,
  p_external_space_name text default null
)
returns public.event_integrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events := warikan_private.require_organizer(p_event_id);
  v_integration public.event_integrations;
begin
  insert into public.event_integrations(event_id, provider, external_space_id, external_space_name, status, connected_at)
  values (v_event.id, p_provider, p_external_space_id, p_external_space_name, 'active', now())
  on conflict (event_id, provider) do update set external_space_id = excluded.external_space_id, external_space_name = excluded.external_space_name, status = 'active', connected_at = now()
  returning * into v_integration;
  perform warikan_private.write_log(p_event_id, null, 'upsert_integration', jsonb_build_object('provider', p_provider));
  return v_integration;
end;
$$;

create function public.organizer_queue_notification(
  p_event_id uuid,
  p_notification_type text,
  p_payload jsonb default '{}'::jsonb,
  p_integration_id uuid default null,
  p_member_id uuid default null,
  p_scheduled_for timestamptz default now(),
  p_dedupe_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events := warikan_private.require_organizer(p_event_id);
  v_job_id uuid;
begin
  if p_integration_id is not null and not exists (select 1 from public.event_integrations where id = p_integration_id and event_id = v_event.id) then raise exception 'INVALID_INTEGRATION' using errcode = '22023'; end if;
  if p_member_id is not null and not exists (select 1 from public.members where id = p_member_id and event_id = v_event.id) then raise exception 'INVALID_MEMBER' using errcode = '22023'; end if;
  insert into public.notification_jobs(event_id, integration_id, member_id, notification_type, payload, scheduled_for, dedupe_key)
  values (v_event.id, p_integration_id, p_member_id, p_notification_type, coalesce(p_payload, '{}'::jsonb), coalesce(p_scheduled_for, now()), p_dedupe_key)
  on conflict (event_id, dedupe_key) where dedupe_key is not null do update set payload = excluded.payload, scheduled_for = excluded.scheduled_for, status = 'pending', last_error = null
  returning id into v_job_id;
  perform warikan_private.write_log(p_event_id, p_member_id, 'queue_notification', jsonb_build_object('jobId', v_job_id, 'type', p_notification_type));
  return v_job_id;
end;
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.get_event_state(text) to anon, authenticated;
grant execute on function public.join_event(text, text, text) to anon, authenticated;
grant execute on function public.claim_member(text, text, text) to anon, authenticated;
grant execute on function public.add_expense(text, text, public.expense_category, text, integer, uuid, public.split_method, integer, jsonb) to anon, authenticated;
grant execute on function public.create_event(text, public.event_type, date, date, integer) to authenticated;
grant execute on function public.organizer_add_member(uuid, text) to authenticated;
grant execute on function public.organizer_issue_claim_token(uuid, uuid) to authenticated;
grant execute on function public.organizer_update_event(uuid, text, public.event_type, date, date, integer) to authenticated;
grant execute on function public.organizer_remove_member(uuid, uuid) to authenticated;
grant execute on function public.organizer_upsert_integration(uuid, public.integration_provider, text, text) to authenticated;
grant execute on function public.organizer_queue_notification(uuid, text, jsonb, uuid, uuid, timestamptz, text) to authenticated;
