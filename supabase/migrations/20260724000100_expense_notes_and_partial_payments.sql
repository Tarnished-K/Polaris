alter table public.expenses
  add column note text,
  add constraint expenses_note_length check (note is null or char_length(note) <= 500);

alter table public.settlement_items
  add column payable_amount integer not null default 0,
  add column payment_status public.settlement_status not null default 'paid',
  add constraint settlement_items_payable_amount check (payable_amount >= 0 and payable_amount <= amount);

create function warikan_private.initialize_settlement_item_payments(p_settlement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settlement public.settlements;
  v_unallocated integer;
begin
  select * into v_settlement
  from public.settlements
  where id = p_settlement_id;

  if v_settlement.id is null then
    raise exception 'SETTLEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.settlement_items
  set payable_amount = 0,
      payment_status = 'paid'
  where settlement_id = p_settlement_id;

  if v_settlement.amount = 0 or v_settlement.gross_amount = 0 then
    return;
  end if;

  with shares as (
    select
      item.expense_id,
      floor((item.amount::numeric * v_settlement.amount) / v_settlement.gross_amount)::integer as base_amount,
      ((item.amount::bigint * v_settlement.amount) % v_settlement.gross_amount)::integer as remainder
    from public.settlement_items item
    where item.settlement_id = p_settlement_id
      and item.direction = 'charge'
  )
  select v_settlement.amount - coalesce(sum(base_amount), 0)
  into v_unallocated
  from shares;

  with shares as (
    select
      item.expense_id,
      floor((item.amount::numeric * v_settlement.amount) / v_settlement.gross_amount)::integer as base_amount,
      ((item.amount::bigint * v_settlement.amount) % v_settlement.gross_amount)::integer as remainder
    from public.settlement_items item
    where item.settlement_id = p_settlement_id
      and item.direction = 'charge'
  ),
  ranked as (
    select
      shares.*,
      row_number() over (order by remainder desc, expense_id) as allocation_order
    from shares
  )
  update public.settlement_items item
  set payable_amount = ranked.base_amount + case when ranked.allocation_order <= v_unallocated then 1 else 0 end,
      payment_status = case
        when ranked.base_amount + case when ranked.allocation_order <= v_unallocated then 1 else 0 end = 0
          then 'paid'::public.settlement_status
        else v_settlement.status
      end
  from ranked
  where item.settlement_id = p_settlement_id
    and item.expense_id = ranked.expense_id
    and item.direction = 'charge';
end;
$$;

create function warikan_private.settlement_status_from_items(p_settlement_id uuid)
returns public.settlement_status
language sql
security definer
stable
set search_path = ''
as $$
  select case
    when count(*) filter (where item.payable_amount > 0) = 0
      or count(*) filter (where item.payable_amount > 0 and item.payment_status = 'paid') =
         count(*) filter (where item.payable_amount > 0)
      then 'paid'::public.settlement_status
    when count(*) filter (where item.payable_amount > 0 and item.payment_status = 'pending') > 0
      then 'pending'::public.settlement_status
    else 'reported'::public.settlement_status
  end
  from public.settlement_items item
  where item.settlement_id = p_settlement_id
    and item.direction = 'charge'
$$;

do $$
declare
  v_settlement record;
begin
  for v_settlement in select id from public.settlements loop
    perform warikan_private.initialize_settlement_item_payments(v_settlement.id);
  end loop;
end;
$$;

create or replace function public.get_event_state(p_share_token text)
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
        'id', member.id,
        'name', member.name,
        'isOrganizer', member.is_organizer,
        'isClaimed', member.device_token_hash is not null
      ) order by member.created_at, member.id)
      from public.members member where member.event_id = v_event.id
    ), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', expense.id,
        'category', expense.category,
        'title', expense.title,
        'note', expense.note,
        'amount', expense.amount,
        'payerMemberId', expense.payer_member_id,
        'targetMemberIds', coalesce((select jsonb_agg(target.member_id order by target.member_id) from public.expense_targets target where target.expense_id = expense.id), '[]'::jsonb),
        'splitMethod', expense.split_method,
        'fixedAmounts', coalesce((select jsonb_object_agg(target.member_id::text, target.fixed_amount) from public.expense_targets target where target.expense_id = expense.id and target.fixed_amount is not null), '{}'::jsonb),
        'status', expense.status,
        'dayIndex', expense.day_index,
        'createdByMemberId', expense.created_by_member_id,
        'createdAt', expense.created_at
      )) order by expense.created_at, expense.id)
      from public.expenses expense where expense.event_id = v_event.id
    ), '[]'::jsonb),
    'settlements', case when v_event.status = 'finalized' then coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', settlement.id,
        'fromMemberId', settlement.from_member_id,
        'toMemberId', settlement.to_member_id,
        'amount', settlement.amount,
        'grossAmount', settlement.gross_amount,
        'offsetAmount', settlement.offset_amount,
        'status', settlement.status,
        'reportedByMemberId', settlement.reported_by_member_id,
        'confirmedByMemberId', settlement.confirmed_by_member_id,
        'charges', coalesce((
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'expenseId', item.expense_id,
            'expenseTitle', expense.title,
            'category', expense.category,
            'amount', item.amount,
            'payableAmount', item.payable_amount,
            'paymentStatus', item.payment_status,
            'fromMemberId', settlement.from_member_id,
            'toMemberId', settlement.to_member_id,
            'dayIndex', expense.day_index
          )) order by expense.created_at, expense.id)
          from public.settlement_items item
          join public.expenses expense on expense.id = item.expense_id
          where item.settlement_id = settlement.id and item.direction = 'charge'
        ), '[]'::jsonb),
        'offsets', coalesce((
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'expenseId', item.expense_id,
            'expenseTitle', expense.title,
            'category', expense.category,
            'amount', item.amount,
            'payableAmount', 0,
            'paymentStatus', 'paid',
            'fromMemberId', settlement.to_member_id,
            'toMemberId', settlement.from_member_id,
            'dayIndex', expense.day_index
          )) order by expense.created_at, expense.id)
          from public.settlement_items item
          join public.expenses expense on expense.id = item.expense_id
          where item.settlement_id = settlement.id and item.direction = 'offset'
        ), '[]'::jsonb)
      )) order by settlement.created_at, settlement.id)
      from public.settlements settlement where settlement.event_id = v_event.id
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

drop function public.add_expense(text, text, public.expense_category, text, integer, uuid, public.split_method, integer, jsonb);

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
  p_note text default null
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
  select * into v_event from public.events where id = v_actor.event_id for update;
  if v_event.status <> 'active' then raise exception 'EVENT_FINALIZED' using errcode = '55000'; end if;
  if p_amount <= 0 or char_length(btrim(p_title)) not between 1 and 120 then raise exception 'INVALID_EXPENSE' using errcode = '22023'; end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'INVALID_EXPENSE_NOTE' using errcode = '22023'; end if;
  if not exists (select 1 from public.members where id = p_payer_member_id and event_id = v_event.id) then raise exception 'INVALID_PAYER' using errcode = '22023'; end if;
  if p_targets is null or jsonb_typeof(p_targets) <> 'array' or jsonb_array_length(p_targets) = 0 then raise exception 'TARGETS_REQUIRED' using errcode = '22023'; end if;
  select count(*), count(distinct value->>'memberId'), count(value->>'fixedAmount'), coalesce(sum((value->>'fixedAmount')::integer), 0)
    into v_target_count, v_distinct_count, v_fixed_count, v_fixed_sum
  from jsonb_array_elements(p_targets);
  if v_target_count <> v_distinct_count then raise exception 'DUPLICATE_TARGET' using errcode = '22023'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_targets) target
    where not exists (select 1 from public.members member where member.id = (target->>'memberId')::uuid and member.event_id = v_event.id)
  ) then raise exception 'INVALID_TARGET' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_targets) target where target ? 'fixedAmount' and (target->>'fixedAmount')::integer < 0) then raise exception 'INVALID_FIXED_AMOUNT' using errcode = '22023'; end if;
  v_day_count := (v_event.end_date - v_event.start_date) + 1;
  if p_day_index is not null and (v_event.event_type = 'single_day' or p_day_index < 1 or p_day_index > v_day_count) then raise exception 'INVALID_DAY_INDEX' using errcode = '22023'; end if;
  v_status := case when p_split_method = 'equal' or (v_fixed_count = v_target_count and v_fixed_sum = p_amount) then 'finalized' else 'draft' end;
  insert into public.expenses(event_id, category, title, note, amount, payer_member_id, split_method, status, day_index, created_by_member_id)
  values (v_event.id, p_category, btrim(p_title), v_note, p_amount, p_payer_member_id, p_split_method, v_status, p_day_index, v_actor.id)
  returning * into v_expense;
  for v_target in select value from jsonb_array_elements(p_targets) loop
    insert into public.expense_targets(expense_id, member_id, fixed_amount)
    values (v_expense.id, (v_target->>'memberId')::uuid, case when v_target ? 'fixedAmount' then (v_target->>'fixedAmount')::integer else null end);
  end loop;
  perform warikan_private.write_log(v_event.id, v_actor.id, 'add_expense', jsonb_build_object('expenseId', v_expense.id, 'status', v_status));
  return jsonb_build_object('expenseId', v_expense.id, 'status', v_status);
end;
$$;

drop function public.update_expense(text, text, uuid, public.expense_category, text, integer, uuid, public.split_method, integer, jsonb);

create function public.update_expense(
  p_share_token text,
  p_device_token text,
  p_expense_id uuid,
  p_category public.expense_category,
  p_title text,
  p_amount integer,
  p_payer_member_id uuid,
  p_split_method public.split_method,
  p_day_index integer,
  p_targets jsonb,
  p_note text default null
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
  v_status public.expense_status;
  v_day_count integer;
  v_note text := nullif(btrim(p_note), '');
begin
  select * into v_event from public.events where id = v_actor.event_id for update;
  select * into v_expense from public.expenses where id = p_expense_id and event_id = v_event.id for update;
  if v_expense.id is null then raise exception 'EXPENSE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_event.status <> 'active' then raise exception 'EVENT_FINALIZED' using errcode = '55000'; end if;
  if not v_actor.is_organizer and v_expense.payer_member_id <> v_actor.id then raise exception 'PAYER_OR_ORGANIZER_REQUIRED' using errcode = '42501'; end if;
  if not v_actor.is_organizer and p_payer_member_id <> v_expense.payer_member_id then raise exception 'PAYER_CANNOT_CHANGE' using errcode = '42501'; end if;
  if p_amount <= 0 or char_length(btrim(p_title)) not between 1 and 120 then raise exception 'INVALID_EXPENSE' using errcode = '22023'; end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'INVALID_EXPENSE_NOTE' using errcode = '22023'; end if;
  if not exists (select 1 from public.members where id = p_payer_member_id and event_id = v_event.id) then raise exception 'INVALID_PAYER' using errcode = '22023'; end if;
  v_day_count := (v_event.end_date - v_event.start_date) + 1;
  if p_day_index is not null and (v_event.event_type = 'single_day' or p_day_index < 1 or p_day_index > v_day_count) then raise exception 'INVALID_DAY_INDEX' using errcode = '22023'; end if;

  v_status := warikan_private.replace_expense_targets(p_expense_id, v_event.id, p_split_method, p_amount, p_targets);
  update public.expenses
  set category = p_category,
      title = btrim(p_title),
      note = v_note,
      amount = p_amount,
      payer_member_id = p_payer_member_id,
      split_method = p_split_method,
      status = v_status,
      day_index = p_day_index
  where id = p_expense_id;
  perform warikan_private.write_log(v_event.id, v_actor.id, 'update_expense', jsonb_build_object('expenseId', p_expense_id, 'status', v_status));
  return jsonb_build_object('expenseId', p_expense_id, 'status', v_status);
end;
$$;

create or replace function public.finalize_event(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events := warikan_private.require_organizer(p_event_id);
  v_pair record;
  v_settlement_id uuid;
  v_from uuid;
  v_to uuid;
  v_gross integer;
  v_offset integer;
begin
  if v_event.status <> 'active' then raise exception 'EVENT_ALREADY_FINALIZED' using errcode = '55000'; end if;
  if exists (select 1 from public.expenses where event_id = p_event_id and status = 'draft') then raise exception 'DRAFT_EXPENSES_REMAIN' using errcode = '55000'; end if;
  if exists (
    select 1 from public.expenses expense where expense.event_id = p_event_id and expense.status = 'finalized'
    and (not exists (select 1 from public.expense_targets target where target.expense_id = expense.id)
      or (expense.split_method = 'fixed' and ((select count(*) from public.expense_targets target where target.expense_id = expense.id and target.fixed_amount is null) > 0
        or (select coalesce(sum(target.fixed_amount), -1) from public.expense_targets target where target.expense_id = expense.id) <> expense.amount)))
  ) then raise exception 'INVALID_FINALIZED_EXPENSE' using errcode = '23514'; end if;

  delete from public.settlements where event_id = p_event_id;
  for v_pair in
    with charges as (select * from warikan_private.event_charges(p_event_id)), pairs as (
      select
        least(from_member_id::text, to_member_id::text)::uuid as pair_a,
        greatest(from_member_id::text, to_member_id::text)::uuid as pair_b,
        sum(amount) filter (where from_member_id::text < to_member_id::text) as a_to_b,
        sum(amount) filter (where from_member_id::text > to_member_id::text) as b_to_a
      from charges group by 1, 2
    )
    select pair_a, pair_b, coalesce(a_to_b, 0)::integer as a_to_b, coalesce(b_to_a, 0)::integer as b_to_a from pairs
  loop
    if v_pair.a_to_b >= v_pair.b_to_a then
      v_from := v_pair.pair_a; v_to := v_pair.pair_b; v_gross := v_pair.a_to_b; v_offset := v_pair.b_to_a;
    else
      v_from := v_pair.pair_b; v_to := v_pair.pair_a; v_gross := v_pair.b_to_a; v_offset := v_pair.a_to_b;
    end if;
    insert into public.settlements(event_id, from_member_id, to_member_id, amount, gross_amount, offset_amount, status)
    values (p_event_id, v_from, v_to, v_gross - v_offset, v_gross, v_offset,
      case when v_gross = v_offset then 'paid'::public.settlement_status else 'pending'::public.settlement_status end)
    returning id into v_settlement_id;
    insert into public.settlement_items(settlement_id, expense_id, direction, amount)
      select v_settlement_id, expense_id, 'charge', amount from warikan_private.event_charges(p_event_id)
      where from_member_id = v_from and to_member_id = v_to;
    insert into public.settlement_items(settlement_id, expense_id, direction, amount)
      select v_settlement_id, expense_id, 'offset', amount from warikan_private.event_charges(p_event_id)
      where from_member_id = v_to and to_member_id = v_from;
    perform warikan_private.initialize_settlement_item_payments(v_settlement_id);
  end loop;
  update public.events set status = 'finalized', finalized_at = now() where id = p_event_id;
  perform warikan_private.write_log(p_event_id, null, 'finalize_event');
  return public.get_event_state(v_event.share_token);
end;
$$;

create function public.report_settlement_items(
  p_share_token text,
  p_device_token text,
  p_settlement_id uuid,
  p_expense_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.members := warikan_private.require_actor(p_share_token, p_device_token);
  v_settlement public.settlements;
  v_changed integer;
  v_expected integer;
  v_status public.settlement_status;
begin
  select * into v_settlement from public.settlements
  where id = p_settlement_id and event_id = v_actor.event_id for update;
  if v_settlement.id is null or v_settlement.amount = 0 then raise exception 'SETTLEMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not v_actor.is_organizer and v_settlement.from_member_id <> v_actor.id then raise exception 'PAYER_OR_ORGANIZER_REQUIRED' using errcode = '42501'; end if;
  select count(distinct expense_id) into v_expected from unnest(coalesce(p_expense_ids, array[]::uuid[])) expense_id;
  if v_expected = 0 then raise exception 'PAYMENT_ITEMS_REQUIRED' using errcode = '22023'; end if;

  update public.settlement_items
  set payment_status = 'reported'
  where settlement_id = p_settlement_id
    and direction = 'charge'
    and payable_amount > 0
    and payment_status = 'pending'
    and expense_id = any(p_expense_ids);
  get diagnostics v_changed = row_count;
  if v_changed <> v_expected then raise exception 'PENDING_PAYMENT_ITEMS_REQUIRED' using errcode = '22023'; end if;

  v_status := warikan_private.settlement_status_from_items(p_settlement_id);
  update public.settlements
  set status = v_status,
      reported_at = case when v_status = 'reported' then now() else reported_at end,
      reported_by_member_id = case when v_status = 'reported' then v_actor.id else reported_by_member_id end
  where id = p_settlement_id;
  perform warikan_private.write_log(v_actor.event_id, v_actor.id, 'report_settlement_items',
    jsonb_build_object('settlementId', p_settlement_id, 'expenseIds', p_expense_ids));
end;
$$;

create function public.confirm_settlement_items(
  p_share_token text,
  p_device_token text,
  p_settlement_id uuid,
  p_expense_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.members := warikan_private.require_actor(p_share_token, p_device_token);
  v_settlement public.settlements;
  v_changed integer;
  v_expected integer;
  v_status public.settlement_status;
begin
  select * into v_settlement from public.settlements
  where id = p_settlement_id and event_id = v_actor.event_id for update;
  if v_settlement.id is null or v_settlement.amount = 0 then raise exception 'SETTLEMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not v_actor.is_organizer and v_settlement.to_member_id <> v_actor.id then raise exception 'RECEIVER_OR_ORGANIZER_REQUIRED' using errcode = '42501'; end if;
  select count(distinct expense_id) into v_expected from unnest(coalesce(p_expense_ids, array[]::uuid[])) expense_id;
  if v_expected = 0 then raise exception 'PAYMENT_ITEMS_REQUIRED' using errcode = '22023'; end if;

  update public.settlement_items
  set payment_status = 'paid'
  where settlement_id = p_settlement_id
    and direction = 'charge'
    and payable_amount > 0
    and payment_status = 'reported'
    and expense_id = any(p_expense_ids);
  get diagnostics v_changed = row_count;
  if v_changed <> v_expected then raise exception 'REPORTED_PAYMENT_ITEMS_REQUIRED' using errcode = '22023'; end if;

  v_status := warikan_private.settlement_status_from_items(p_settlement_id);
  update public.settlements
  set status = v_status,
      confirmed_at = case when v_status = 'paid' then now() else confirmed_at end,
      confirmed_by_member_id = case when v_status = 'paid' then v_actor.id else confirmed_by_member_id end
  where id = p_settlement_id;
  perform warikan_private.write_log(v_actor.event_id, v_actor.id, 'confirm_settlement_items',
    jsonb_build_object('settlementId', p_settlement_id, 'expenseIds', p_expense_ids));
end;
$$;

create or replace function public.report_settlement(p_share_token text, p_device_token text, p_settlement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expense_ids uuid[];
begin
  select array_agg(item.expense_id order by item.expense_id) into v_expense_ids
  from public.settlement_items item
  where item.settlement_id = p_settlement_id
    and item.direction = 'charge'
    and item.payable_amount > 0
    and item.payment_status = 'pending';
  perform public.report_settlement_items(p_share_token, p_device_token, p_settlement_id, v_expense_ids);
end;
$$;

create or replace function public.confirm_settlement(p_share_token text, p_device_token text, p_settlement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.members := warikan_private.require_actor(p_share_token, p_device_token);
  v_settlement public.settlements;
  v_expense_ids uuid[];
begin
  select * into v_settlement from public.settlements
  where id = p_settlement_id and event_id = v_actor.event_id for update;
  if v_settlement.id is null or v_settlement.amount = 0 then raise exception 'SETTLEMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not v_actor.is_organizer and v_settlement.to_member_id <> v_actor.id then raise exception 'RECEIVER_OR_ORGANIZER_REQUIRED' using errcode = '42501'; end if;

  select array_agg(item.expense_id order by item.expense_id) into v_expense_ids
  from public.settlement_items item
  where item.settlement_id = p_settlement_id
    and item.direction = 'charge'
    and item.payable_amount > 0
    and item.payment_status in ('pending', 'reported');

  update public.settlement_items
  set payment_status = 'paid'
  where settlement_id = p_settlement_id
    and direction = 'charge'
    and payable_amount > 0
    and payment_status in ('pending', 'reported');
  if not found then raise exception 'OPEN_SETTLEMENT_REQUIRED' using errcode = '22023'; end if;

  update public.settlements
  set status = 'paid',
      confirmed_at = now(),
      confirmed_by_member_id = v_actor.id
  where id = p_settlement_id;
  perform warikan_private.write_log(v_actor.event_id, v_actor.id, 'confirm_settlement',
    jsonb_build_object('settlementId', p_settlement_id, 'expenseIds', v_expense_ids));
end;
$$;

create or replace function public.revert_settlement(p_share_token text, p_device_token text, p_settlement_id uuid)
returns public.settlement_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.members := warikan_private.require_actor(p_share_token, p_device_token);
  v_settlement public.settlements;
  v_status public.settlement_status;
begin
  select * into v_settlement from public.settlements
  where id = p_settlement_id and event_id = v_actor.event_id for update;
  if v_settlement.id is null or v_settlement.amount = 0 then raise exception 'SETTLEMENT_NOT_REVERSIBLE' using errcode = '22023'; end if;

  if exists (
    select 1 from public.settlement_items
    where settlement_id = p_settlement_id and direction = 'charge' and payable_amount > 0 and payment_status = 'paid'
  ) then
    if not v_actor.is_organizer and v_settlement.to_member_id <> v_actor.id then raise exception 'RECEIVER_OR_ORGANIZER_REQUIRED' using errcode = '42501'; end if;
    update public.settlement_items set payment_status = 'reported'
    where settlement_id = p_settlement_id and direction = 'charge' and payable_amount > 0 and payment_status = 'paid';
  elsif exists (
    select 1 from public.settlement_items
    where settlement_id = p_settlement_id and direction = 'charge' and payable_amount > 0 and payment_status = 'reported'
  ) then
    if not v_actor.is_organizer and v_settlement.from_member_id <> v_actor.id then raise exception 'PAYER_OR_ORGANIZER_REQUIRED' using errcode = '42501'; end if;
    update public.settlement_items set payment_status = 'pending'
    where settlement_id = p_settlement_id and direction = 'charge' and payable_amount > 0 and payment_status = 'reported';
  else
    raise exception 'SETTLEMENT_NOT_REVERSIBLE' using errcode = '22023';
  end if;

  v_status := warikan_private.settlement_status_from_items(p_settlement_id);
  update public.settlements
  set status = v_status,
      reported_at = case when v_status = 'pending' then null else reported_at end,
      reported_by_member_id = case when v_status = 'pending' then null else reported_by_member_id end,
      confirmed_at = case when v_status <> 'paid' then null else confirmed_at end,
      confirmed_by_member_id = case when v_status <> 'paid' then null else confirmed_by_member_id end
  where id = p_settlement_id;
  perform warikan_private.write_log(v_actor.event_id, v_actor.id, 'revert_settlement',
    jsonb_build_object('settlementId', p_settlement_id, 'status', v_status));
  return v_status;
end;
$$;

create function warikan_private.sync_items_from_settlement_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = new.status then return new; end if;
  if new.status = 'reported' then
    update public.settlement_items
    set payment_status = 'reported'
    where settlement_id = new.id
      and direction = 'charge'
      and payable_amount > 0
      and payment_status = 'pending';
  elsif new.status = 'paid' then
    update public.settlement_items
    set payment_status = 'paid'
    where settlement_id = new.id
      and direction = 'charge'
      and payable_amount > 0
      and payment_status in ('pending', 'reported');
  end if;
  return new;
end;
$$;

drop trigger if exists settlements_sync_item_status on public.settlements;
create trigger settlements_sync_item_status
after update of status on public.settlements
for each row execute function warikan_private.sync_items_from_settlement_status();

revoke execute on function warikan_private.initialize_settlement_item_payments(uuid) from public, anon, authenticated;
revoke execute on function warikan_private.settlement_status_from_items(uuid) from public, anon, authenticated;
revoke execute on function warikan_private.sync_items_from_settlement_status() from public, anon, authenticated;
grant execute on function public.get_event_state(text) to anon, authenticated;
grant execute on function public.add_expense(text, text, public.expense_category, text, integer, uuid, public.split_method, integer, jsonb, text) to anon, authenticated;
grant execute on function public.update_expense(text, text, uuid, public.expense_category, text, integer, uuid, public.split_method, integer, jsonb, text) to anon, authenticated;
grant execute on function public.report_settlement_items(text, text, uuid, uuid[]) to anon, authenticated;
grant execute on function public.confirm_settlement_items(text, text, uuid, uuid[]) to anon, authenticated;
