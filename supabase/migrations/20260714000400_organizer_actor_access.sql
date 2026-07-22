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
