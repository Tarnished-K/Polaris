-- Keep every browser write behind an explicitly granted SECURITY DEFINER RPC.
-- Older Supabase projects can retain legacy default ACLs that expose newly
-- created public objects to the Data API roles, so remove both current and
-- future direct grants.
revoke all privileges on all tables in schema public
  from public, anon, authenticated;
revoke all privileges on all sequences in schema public
  from public, anon, authenticated;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

alter default privileges for role postgres in schema public
  revoke all privileges on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- Integration credentials and destination validation now live exclusively in
-- the integration-settings Edge Function.
revoke execute on function public.organizer_upsert_integration(
  uuid,
  public.integration_provider,
  text,
  text
) from public, anon, authenticated;

create or replace function warikan_private.next_member_name(
  p_event_id uuid,
  p_name text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text := btrim(p_name);
  v_name text := btrim(p_name);
  v_suffix integer := 1;
begin
  if char_length(v_base) not between 1 and 50
    or v_base in ('あなた', '幹事')
    or v_base ~ '[[:cntrl:]]'
    or exists (
      select 1
      from unnest(array[8234, 8235, 8236, 8237, 8238, 8294, 8295, 8296, 8297]) code_point
      where strpos(v_base, chr(code_point)) > 0
    )
  then
    raise exception 'INVALID_MEMBER_NAME' using errcode = '22023';
  end if;

  while exists (
    select 1
    from public.members
    where event_id = p_event_id
      and name = v_name
  ) loop
    v_name := v_base || '(' || v_suffix || ')';
    v_suffix := v_suffix + 1;
  end loop;

  return v_name;
end;
$$;

alter table public.expenses
  add column idempotency_key uuid;

alter table public.expenses
  add constraint expenses_event_id_idempotency_key_key
  unique (event_id, idempotency_key);

comment on column public.expenses.idempotency_key is
  'Optional client-generated UUID that makes queued add_expense retries event-scoped and idempotent.';

drop function public.add_expense(
  text,
  text,
  public.expense_category,
  text,
  integer,
  uuid,
  public.split_method,
  integer,
  jsonb,
  text
);

create function public.add_expense(
  p_share_token text,
  p_device_token text,
  p_category public.expense_category,
  p_title text,
  p_amount integer,
  p_payer_member_id uuid,
  p_split_method public.split_method,
  p_day_index integer,
  p_targets jsonb,
  p_note text default null,
  p_idempotency_key uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.members := warikan_private.require_actor(p_share_token, p_device_token);
  v_event public.events;
  v_expense public.expenses;
  v_target jsonb;
  v_status public.expense_status;
  v_target_count integer;
  v_distinct_count integer;
  v_fixed_count integer;
  v_fixed_sum bigint;
  v_day_count integer;
  v_note text := nullif(btrim(p_note), '');
begin
  select *
  into v_event
  from public.events
  where id = v_actor.event_id
  for update;

  if p_idempotency_key is not null then
    select *
    into v_expense
    from public.expenses
    where event_id = v_event.id
      and idempotency_key = p_idempotency_key;

    if v_expense.id is not null then
      if v_expense.created_by_member_id <> v_actor.id then
        raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
      end if;
      return jsonb_build_object('expenseId', v_expense.id, 'status', v_expense.status);
    end if;
  end if;

  if v_event.status <> 'active' then
    raise exception 'EVENT_FINALIZED' using errcode = '55000';
  end if;
  if p_amount <= 0 or char_length(btrim(p_title)) not between 1 and 120 then
    raise exception 'INVALID_EXPENSE' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'INVALID_EXPENSE_NOTE' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.members
    where id = p_payer_member_id
      and event_id = v_event.id
  ) then
    raise exception 'INVALID_PAYER' using errcode = '22023';
  end if;
  if p_targets is null
    or jsonb_typeof(p_targets) <> 'array'
    or jsonb_array_length(p_targets) = 0
  then
    raise exception 'TARGETS_REQUIRED' using errcode = '22023';
  end if;

  select
    count(*),
    count(distinct value->>'memberId'),
    count(value->>'fixedAmount'),
    coalesce(sum((value->>'fixedAmount')::integer), 0)
  into v_target_count, v_distinct_count, v_fixed_count, v_fixed_sum
  from jsonb_array_elements(p_targets);

  if v_target_count <> v_distinct_count then
    raise exception 'DUPLICATE_TARGET' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_targets) target
    where not exists (
      select 1
      from public.members member
      where member.id = (target->>'memberId')::uuid
        and member.event_id = v_event.id
    )
  ) then
    raise exception 'INVALID_TARGET' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_targets) target
    where target ? 'fixedAmount'
      and (target->>'fixedAmount')::integer < 0
  ) then
    raise exception 'INVALID_FIXED_AMOUNT' using errcode = '22023';
  end if;

  v_day_count := (v_event.end_date - v_event.start_date) + 1;
  if p_day_index is not null
    and (
      v_event.event_type = 'single_day'
      or p_day_index < 1
      or p_day_index > v_day_count
    )
  then
    raise exception 'INVALID_DAY_INDEX' using errcode = '22023';
  end if;

  v_status := case
    when p_split_method = 'equal'
      or (v_fixed_count = v_target_count and v_fixed_sum = p_amount)
    then 'finalized'
    else 'draft'
  end;

  insert into public.expenses(
    event_id,
    category,
    title,
    note,
    amount,
    payer_member_id,
    split_method,
    status,
    day_index,
    created_by_member_id,
    idempotency_key
  )
  values (
    v_event.id,
    p_category,
    btrim(p_title),
    v_note,
    p_amount,
    p_payer_member_id,
    p_split_method,
    v_status,
    p_day_index,
    v_actor.id,
    p_idempotency_key
  )
  on conflict on constraint expenses_event_id_idempotency_key_key
    do nothing
  returning * into v_expense;

  if v_expense.id is null then
    select *
    into v_expense
    from public.expenses
    where event_id = v_event.id
      and idempotency_key = p_idempotency_key;

    if v_expense.id is null or v_expense.created_by_member_id <> v_actor.id then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    return jsonb_build_object('expenseId', v_expense.id, 'status', v_expense.status);
  end if;

  for v_target in
    select value
    from jsonb_array_elements(p_targets)
  loop
    insert into public.expense_targets(expense_id, member_id, fixed_amount)
    values (
      v_expense.id,
      (v_target->>'memberId')::uuid,
      case
        when v_target ? 'fixedAmount'
        then (v_target->>'fixedAmount')::integer
        else null
      end
    );
  end loop;

  perform warikan_private.write_log(
    v_event.id,
    v_actor.id,
    'add_expense',
    jsonb_build_object('expenseId', v_expense.id, 'status', v_status)
  );
  return jsonb_build_object('expenseId', v_expense.id, 'status', v_status);
end;
$$;

revoke execute on function public.add_expense(
  text,
  text,
  public.expense_category,
  text,
  integer,
  uuid,
  public.split_method,
  integer,
  jsonb,
  text,
  uuid
) from public;
grant execute on function public.add_expense(
  text,
  text,
  public.expense_category,
  text,
  integer,
  uuid,
  public.split_method,
  integer,
  jsonb,
  text,
  uuid
) to anon, authenticated;

-- A failed job is terminal. Only due pending jobs with attempts remaining may
-- be claimed, preventing exhausted deliveries from looping on every dispatch.
create or replace function public.claim_notification_jobs(p_limit integer default 20)
returns table(
  id uuid,
  integration_id uuid,
  notification_type text,
  payload jsonb,
  attempts integer,
  max_attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select job.id
    from public.notification_jobs job
    where job.status = 'pending'
      and job.attempts < job.max_attempts
      and job.scheduled_for <= now()
    order by job.scheduled_for, job.created_at
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  ), claimed as (
    update public.notification_jobs job
    set status = 'processing',
        attempts = job.attempts + 1
    from candidates candidate
    where job.id = candidate.id
    returning
      job.id,
      job.integration_id,
      job.notification_type,
      job.payload,
      job.attempts,
      job.max_attempts
  )
  select * from claimed;
end;
$$;

drop index public.notification_jobs_dispatch;
create index notification_jobs_dispatch
  on public.notification_jobs(status, scheduled_for)
  where status = 'pending' and attempts < max_attempts;

revoke execute on function public.claim_notification_jobs(integer)
  from public, anon, authenticated;
grant execute on function public.claim_notification_jobs(integer)
  to service_role;

delete from public.settlement_payment_links
where paypay_request_url ~ '[[:cntrl:]]';

alter table public.settlement_payment_links
  drop constraint settlement_payment_links_paypay_https;
alter table public.settlement_payment_links
  add constraint settlement_payment_links_paypay_https
  check (
    paypay_request_url ~* '^https://(paypay\.ne\.jp|qr\.paypay\.ne\.jp)(/|$)'
    and paypay_request_url !~ '[[:cntrl:]]'
  );

create or replace function public.set_settlement_payment_link(
  p_share_token text,
  p_device_token text,
  p_settlement_id uuid,
  p_paypay_request_url text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.members := warikan_private.require_actor(p_share_token, p_device_token);
  v_settlement public.settlements;
  v_url text := nullif(btrim(p_paypay_request_url), '');
begin
  select *
  into v_settlement
  from public.settlements
  where id = p_settlement_id
    and event_id = v_actor.event_id
    and amount > 0
    and status in ('pending', 'reported')
  for update;

  if v_settlement.id is null then
    raise exception 'SETTLEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_settlement.to_member_id <> v_actor.id then
    raise exception 'RECEIVER_REQUIRED' using errcode = '42501';
  end if;

  if v_url is null then
    delete from public.settlement_payment_links
    where settlement_id = v_settlement.id;
  else
    if char_length(v_url) > 2048
      or v_url ~ '[[:cntrl:]]'
      or v_url !~* '^https://(paypay\.ne\.jp|qr\.paypay\.ne\.jp)(/|$)'
    then
      raise exception 'INVALID_PAYPAY_REQUEST_URL' using errcode = '22023';
    end if;

    insert into public.settlement_payment_links(
      settlement_id,
      created_by_member_id,
      paypay_request_url
    )
    values (v_settlement.id, v_actor.id, v_url)
    on conflict (settlement_id) do update
      set created_by_member_id = excluded.created_by_member_id,
          paypay_request_url = excluded.paypay_request_url;
  end if;

  perform warikan_private.write_log(
    v_actor.event_id,
    v_actor.id,
    'set_settlement_payment_link',
    jsonb_build_object(
      'settlementId',
      v_settlement.id,
      'configured',
      v_url is not null
    )
  );
end;
$$;

revoke execute on function public.set_settlement_payment_link(text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_settlement_payment_link(text, text, uuid, text)
  to anon, authenticated;
