create function warikan_private.require_actor(p_share_token text, p_device_token text default null)
returns public.members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_actor public.members;
begin
  select * into v_event from public.events where share_token = p_share_token;
  if v_event.id is null then raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if (select auth.uid()) = v_event.organizer_user_id then
    select * into v_actor from public.members where event_id = v_event.id and is_organizer;
    if v_actor.id is null then raise exception 'ORGANIZER_MEMBER_NOT_FOUND' using errcode = 'P0002'; end if;
    return v_actor;
  end if;
  return warikan_private.require_member(p_share_token, p_device_token);
end;
$$;

create function warikan_private.replace_expense_targets(
  p_expense_id uuid,
  p_event_id uuid,
  p_split_method public.split_method,
  p_amount integer,
  p_targets jsonb
)
returns public.expense_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target jsonb;
  v_target_count integer;
  v_distinct_count integer;
  v_fixed_count integer;
  v_fixed_sum bigint;
  v_status public.expense_status;
begin
  if p_targets is null or jsonb_typeof(p_targets) <> 'array' or jsonb_array_length(p_targets) = 0 then
    raise exception 'TARGETS_REQUIRED' using errcode = '22023';
  end if;
  select count(*), count(distinct value->>'memberId'), count(value->>'fixedAmount'), coalesce(sum((value->>'fixedAmount')::integer), 0)
    into v_target_count, v_distinct_count, v_fixed_count, v_fixed_sum
  from jsonb_array_elements(p_targets);
  if v_target_count <> v_distinct_count then raise exception 'DUPLICATE_TARGET' using errcode = '22023'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_targets) target
    where not exists (select 1 from public.members m where m.id = (target->>'memberId')::uuid and m.event_id = p_event_id)
  ) then raise exception 'INVALID_TARGET' using errcode = '22023'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_targets) target
    where target ? 'fixedAmount' and (target->>'fixedAmount')::integer < 0
  ) then raise exception 'INVALID_FIXED_AMOUNT' using errcode = '22023'; end if;

  v_status := case
    when p_split_method = 'equal' then 'finalized'
    when v_fixed_count = v_target_count and v_fixed_sum = p_amount then 'finalized'
    else 'draft'
  end;

  delete from public.expense_targets where expense_id = p_expense_id;
  for v_target in select value from jsonb_array_elements(p_targets) loop
    insert into public.expense_targets(expense_id, member_id, fixed_amount)
    values (
      p_expense_id,
      (v_target->>'memberId')::uuid,
      case when p_split_method = 'fixed' and v_target ? 'fixedAmount' then (v_target->>'fixedAmount')::integer else null end
    );
  end loop;
  return v_status;
end;
$$;

create function warikan_private.event_charges(p_event_id uuid)
returns table(expense_id uuid, from_member_id uuid, to_member_id uuid, amount integer)
language sql
security definer
stable
set search_path = ''
as $$
  select calculated.expense_id, calculated.from_member_id, calculated.to_member_id, calculated.amount
  from (
    select
      x.id as expense_id,
      t.member_id as from_member_id,
      x.payer_member_id as to_member_id,
      case
        when x.split_method = 'fixed' then t.fixed_amount
        else floor(x.amount::numeric / count(*) over (partition by x.id))::integer
      end as amount
    from public.expenses x
    join public.expense_targets t on t.expense_id = x.id
    where x.event_id = p_event_id and x.status = 'finalized'
  ) calculated
  where calculated.from_member_id <> calculated.to_member_id and coalesce(calculated.amount, 0) > 0
$$;

create or replace function public.add_expense(
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
  v_actor public.members := warikan_private.require_actor(p_share_token, p_device_token);
  v_event public.events;
  v_expense public.expenses;
  v_status public.expense_status;
  v_day_count integer;
begin
  select * into v_event from public.events where id = v_actor.event_id for update;
  if v_event.status <> 'active' then raise exception 'EVENT_FINALIZED' using errcode = '55000'; end if;
  if p_amount <= 0 or char_length(btrim(p_title)) not between 1 and 120 then raise exception 'INVALID_EXPENSE' using errcode = '22023'; end if;
  if not exists (select 1 from public.members where id = p_payer_member_id and event_id = v_event.id) then raise exception 'INVALID_PAYER' using errcode = '22023'; end if;
  v_day_count := (v_event.end_date - v_event.start_date) + 1;
  if p_day_index is not null and (v_event.event_type = 'single_day' or p_day_index < 1 or p_day_index > v_day_count) then raise exception 'INVALID_DAY_INDEX' using errcode = '22023'; end if;

  insert into public.expenses(event_id, category, title, amount, payer_member_id, split_method, status, day_index, created_by_member_id)
  values (v_event.id, p_category, btrim(p_title), p_amount, p_payer_member_id, p_split_method, 'draft', p_day_index, v_actor.id)
  returning * into v_expense;
  v_status := warikan_private.replace_expense_targets(v_expense.id, v_event.id, p_split_method, p_amount, p_targets);
  update public.expenses set status = v_status where id = v_expense.id;
  perform warikan_private.write_log(v_event.id, v_actor.id, 'add_expense', jsonb_build_object('expenseId', v_expense.id, 'status', v_status));
  return jsonb_build_object('expenseId', v_expense.id, 'status', v_status);
end;
$$;

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
  p_targets jsonb
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
begin
  select * into v_event from public.events where id = v_actor.event_id for update;
  select * into v_expense from public.expenses where id = p_expense_id and event_id = v_event.id for update;
  if v_expense.id is null then raise exception 'EXPENSE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_event.status <> 'active' then raise exception 'EVENT_FINALIZED' using errcode = '55000'; end if;
  if not v_actor.is_organizer and v_expense.payer_member_id <> v_actor.id then raise exception 'PAYER_OR_ORGANIZER_REQUIRED' using errcode = '42501'; end if;
  if not v_actor.is_organizer and p_payer_member_id <> v_expense.payer_member_id then raise exception 'PAYER_CANNOT_CHANGE' using errcode = '42501'; end if;
  if p_amount <= 0 or char_length(btrim(p_title)) not between 1 and 120 then raise exception 'INVALID_EXPENSE' using errcode = '22023'; end if;
  if not exists (select 1 from public.members where id = p_payer_member_id and event_id = v_event.id) then raise exception 'INVALID_PAYER' using errcode = '22023'; end if;
  v_day_count := (v_event.end_date - v_event.start_date) + 1;
  if p_day_index is not null and (v_event.event_type = 'single_day' or p_day_index < 1 or p_day_index > v_day_count) then raise exception 'INVALID_DAY_INDEX' using errcode = '22023'; end if;

  v_status := warikan_private.replace_expense_targets(p_expense_id, v_event.id, p_split_method, p_amount, p_targets);
  update public.expenses set category = p_category, title = btrim(p_title), amount = p_amount,
    payer_member_id = p_payer_member_id, split_method = p_split_method, status = v_status, day_index = p_day_index
  where id = p_expense_id;
  perform warikan_private.write_log(v_event.id, v_actor.id, 'update_expense', jsonb_build_object('expenseId', p_expense_id, 'status', v_status));
  return jsonb_build_object('expenseId', p_expense_id, 'status', v_status);
end;
$$;

create function public.save_own_fixed_amount(
  p_share_token text,
  p_device_token text,
  p_expense_id uuid,
  p_fixed_amount integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.members := warikan_private.require_member(p_share_token, p_device_token);
  v_expense public.expenses;
begin
  select x.* into v_expense from public.expenses x join public.events e on e.id = x.event_id
  where x.id = p_expense_id and x.event_id = v_actor.event_id and e.status = 'active' for update of x;
  if v_expense.id is null or v_expense.status <> 'draft' or v_expense.split_method <> 'fixed' then raise exception 'DRAFT_FIXED_EXPENSE_REQUIRED' using errcode = '22023'; end if;
  if p_fixed_amount is not null and p_fixed_amount < 0 then raise exception 'INVALID_FIXED_AMOUNT' using errcode = '22023'; end if;
  update public.expense_targets set fixed_amount = p_fixed_amount where expense_id = p_expense_id and member_id = v_actor.id;
  if not found then raise exception 'MEMBER_NOT_TARGET' using errcode = '42501'; end if;
  perform warikan_private.write_log(v_actor.event_id, v_actor.id, 'save_own_fixed_amount', jsonb_build_object('expenseId', p_expense_id));
end;
$$;

create function public.finalize_expense(p_share_token text, p_device_token text, p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.members := warikan_private.require_actor(p_share_token, p_device_token);
  v_expense public.expenses;
begin
  select x.* into v_expense from public.expenses x join public.events e on e.id = x.event_id
  where x.id = p_expense_id and x.event_id = v_actor.event_id and e.status = 'active' for update of x;
  if v_expense.id is null or v_expense.status <> 'draft' or v_expense.split_method <> 'fixed' then raise exception 'DRAFT_FIXED_EXPENSE_REQUIRED' using errcode = '22023'; end if;
  if not v_actor.is_organizer and v_expense.payer_member_id <> v_actor.id then raise exception 'PAYER_OR_ORGANIZER_REQUIRED' using errcode = '42501'; end if;
  if exists (select 1 from public.expense_targets where expense_id = p_expense_id and fixed_amount is null)
    or (select coalesce(sum(fixed_amount), -1) from public.expense_targets where expense_id = p_expense_id) <> v_expense.amount then
    raise exception 'FIXED_TOTAL_MISMATCH' using errcode = '22023';
  end if;
  update public.expenses set status = 'finalized' where id = p_expense_id;
  perform warikan_private.write_log(v_actor.event_id, v_actor.id, 'finalize_expense', jsonb_build_object('expenseId', p_expense_id));
end;
$$;

create function public.delete_expense(p_share_token text, p_device_token text, p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.members := warikan_private.require_actor(p_share_token, p_device_token);
  v_expense public.expenses;
begin
  select x.* into v_expense from public.expenses x join public.events e on e.id = x.event_id
  where x.id = p_expense_id and x.event_id = v_actor.event_id and e.status = 'active' for update of x;
  if v_expense.id is null then raise exception 'EXPENSE_NOT_FOUND' using errcode = 'P0002'; end if;
  if not v_actor.is_organizer and v_expense.payer_member_id <> v_actor.id then raise exception 'PAYER_OR_ORGANIZER_REQUIRED' using errcode = '42501'; end if;
  perform warikan_private.write_log(v_actor.event_id, v_actor.id, 'delete_expense', jsonb_build_object('expenseId', p_expense_id));
  delete from public.expenses where id = p_expense_id;
end;
$$;

create function public.finalize_event(p_event_id uuid)
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
    select 1 from public.expenses x where x.event_id = p_event_id and x.status = 'finalized'
    and (not exists (select 1 from public.expense_targets t where t.expense_id = x.id)
      or (x.split_method = 'fixed' and ((select count(*) from public.expense_targets t where t.expense_id = x.id and t.fixed_amount is null) > 0
        or (select coalesce(sum(t.fixed_amount), -1) from public.expense_targets t where t.expense_id = x.id) <> x.amount)))
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
  end loop;
  update public.events set status = 'finalized', finalized_at = now() where id = p_event_id;
  perform warikan_private.write_log(p_event_id, null, 'finalize_event');
  return public.get_event_state(v_event.share_token);
end;
$$;

create function public.unfinalize_event(p_event_id uuid, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events := warikan_private.require_organizer(p_event_id);
  v_changed_count integer;
begin
  if v_event.status = 'active' then return jsonb_build_object('requiresConfirmation', false, 'state', public.get_event_state(v_event.share_token)); end if;
  select count(*) into v_changed_count from public.settlements where event_id = p_event_id and amount > 0 and status <> 'pending';
  if v_changed_count > 0 and not p_force then
    return jsonb_build_object('requiresConfirmation', true, 'changedSettlementCount', v_changed_count);
  end if;
  delete from public.settlements where event_id = p_event_id;
  update public.events set status = 'active', finalized_at = null where id = p_event_id;
  perform warikan_private.write_log(p_event_id, null, 'unfinalize_event', jsonb_build_object('forced', p_force, 'changedSettlementCount', v_changed_count));
  return jsonb_build_object('requiresConfirmation', false, 'state', public.get_event_state(v_event.share_token));
end;
$$;

create function public.report_settlement(p_share_token text, p_device_token text, p_settlement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.members := warikan_private.require_actor(p_share_token, p_device_token);
  v_settlement public.settlements;
begin
  select * into v_settlement from public.settlements where id = p_settlement_id and event_id = v_actor.event_id for update;
  if v_settlement.id is null or v_settlement.status <> 'pending' or v_settlement.amount = 0 then raise exception 'PENDING_SETTLEMENT_REQUIRED' using errcode = '22023'; end if;
  if not v_actor.is_organizer and v_settlement.from_member_id <> v_actor.id then raise exception 'PAYER_OR_ORGANIZER_REQUIRED' using errcode = '42501'; end if;
  update public.settlements set status = 'reported', reported_at = now(), reported_by_member_id = v_actor.id where id = p_settlement_id;
  perform warikan_private.write_log(v_actor.event_id, v_actor.id, 'report_settlement', jsonb_build_object('settlementId', p_settlement_id));
end;
$$;

create function public.confirm_settlement(p_share_token text, p_device_token text, p_settlement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.members := warikan_private.require_actor(p_share_token, p_device_token);
  v_settlement public.settlements;
begin
  select * into v_settlement from public.settlements where id = p_settlement_id and event_id = v_actor.event_id for update;
  if v_settlement.id is null or v_settlement.status not in ('pending', 'reported') or v_settlement.amount = 0 then raise exception 'OPEN_SETTLEMENT_REQUIRED' using errcode = '22023'; end if;
  if not v_actor.is_organizer and v_settlement.to_member_id <> v_actor.id then raise exception 'RECEIVER_OR_ORGANIZER_REQUIRED' using errcode = '42501'; end if;
  update public.settlements set status = 'paid', confirmed_at = now(), confirmed_by_member_id = v_actor.id where id = p_settlement_id;
  perform warikan_private.write_log(v_actor.event_id, v_actor.id, 'confirm_settlement', jsonb_build_object('settlementId', p_settlement_id));
end;
$$;

create function public.revert_settlement(p_share_token text, p_device_token text, p_settlement_id uuid)
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
  select * into v_settlement from public.settlements where id = p_settlement_id and event_id = v_actor.event_id for update;
  if v_settlement.id is null or v_settlement.amount = 0 then raise exception 'SETTLEMENT_NOT_REVERSIBLE' using errcode = '22023'; end if;
  if v_settlement.status = 'paid' then
    if not v_actor.is_organizer and v_settlement.confirmed_by_member_id <> v_actor.id then raise exception 'CONFIRMER_OR_ORGANIZER_REQUIRED' using errcode = '42501'; end if;
    v_status := case when v_settlement.reported_at is null then 'pending' else 'reported' end;
    update public.settlements set status = v_status, confirmed_at = null, confirmed_by_member_id = null where id = p_settlement_id;
  elsif v_settlement.status = 'reported' then
    if not v_actor.is_organizer and v_settlement.reported_by_member_id <> v_actor.id then raise exception 'REPORTER_OR_ORGANIZER_REQUIRED' using errcode = '42501'; end if;
    v_status := 'pending';
    update public.settlements set status = 'pending', reported_at = null, reported_by_member_id = null where id = p_settlement_id;
  else
    raise exception 'SETTLEMENT_NOT_REVERSIBLE' using errcode = '22023';
  end if;
  perform warikan_private.write_log(v_actor.event_id, v_actor.id, 'revert_settlement', jsonb_build_object('settlementId', p_settlement_id, 'status', v_status));
  return v_status;
end;
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.get_event_state(text) to anon, authenticated;
grant execute on function public.join_event(text, text, text) to anon, authenticated;
grant execute on function public.claim_member(text, text, text) to anon, authenticated;
grant execute on function public.add_expense(text, text, public.expense_category, text, integer, uuid, public.split_method, integer, jsonb) to anon, authenticated;
grant execute on function public.update_expense(text, text, uuid, public.expense_category, text, integer, uuid, public.split_method, integer, jsonb) to anon, authenticated;
grant execute on function public.save_own_fixed_amount(text, text, uuid, integer) to anon, authenticated;
grant execute on function public.finalize_expense(text, text, uuid) to anon, authenticated;
grant execute on function public.delete_expense(text, text, uuid) to anon, authenticated;
grant execute on function public.report_settlement(text, text, uuid) to anon, authenticated;
grant execute on function public.confirm_settlement(text, text, uuid) to anon, authenticated;
grant execute on function public.revert_settlement(text, text, uuid) to anon, authenticated;
grant execute on function public.create_event(text, public.event_type, date, date, integer) to authenticated;
grant execute on function public.organizer_add_member(uuid, text) to authenticated;
grant execute on function public.organizer_issue_claim_token(uuid, uuid) to authenticated;
grant execute on function public.organizer_update_event(uuid, text, public.event_type, date, date, integer) to authenticated;
grant execute on function public.organizer_remove_member(uuid, uuid) to authenticated;
grant execute on function public.finalize_event(uuid) to authenticated;
grant execute on function public.unfinalize_event(uuid, boolean) to authenticated;
grant execute on function public.organizer_upsert_integration(uuid, public.integration_provider, text, text) to authenticated;
grant execute on function public.organizer_queue_notification(uuid, text, jsonb, uuid, uuid, timestamptz, text) to authenticated;
