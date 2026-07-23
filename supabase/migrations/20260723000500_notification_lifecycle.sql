create or replace function warikan_private.payment_deep_link(
  p_share_token text,
  p_settlement_id uuid default null
)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'https://polaris-warikan.netlify.app/e/' || p_share_token
    || '?view=payment'
    || case when p_settlement_id is null then '' else '&settlement=' || p_settlement_id::text end
$$;

create or replace function warikan_private.queue_lifecycle_notification(
  p_event_id uuid,
  p_member_id uuid,
  p_notification_type text,
  p_payload jsonb,
  p_dedupe_key text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_integration public.event_integrations;
  v_inserted integer;
  v_count integer := 0;
begin
  for v_integration in
    select i.*
    from public.event_integrations i
    where i.event_id = p_event_id and i.status = 'active'
    order by i.provider, i.id
  loop
    insert into public.notification_jobs(
      event_id,
      integration_id,
      member_id,
      notification_type,
      payload,
      scheduled_for,
      dedupe_key
    )
    values (
      p_event_id,
      v_integration.id,
      p_member_id,
      p_notification_type,
      coalesce(p_payload, '{}'::jsonb),
      now(),
      p_dedupe_key || ':' || v_integration.id::text
    )
    on conflict (event_id, dedupe_key) where dedupe_key is not null do nothing;
    get diagnostics v_inserted = row_count;
    v_count := v_count + v_inserted;
  end loop;
  return v_count;
end;
$$;

create or replace function warikan_private.notify_event_finalized()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open_count integer;
  v_remaining integer;
begin
  if old.status = new.status or new.status <> 'finalized' then return new; end if;

  select
    count(*) filter (where s.amount > 0 and s.status <> 'paid'),
    coalesce(sum(s.amount) filter (where s.amount > 0 and s.status <> 'paid'), 0)
  into v_open_count, v_remaining
  from public.settlements s
  where s.event_id = new.id;

  perform warikan_private.queue_lifecycle_notification(
    new.id,
    null,
    'settlement_finalized',
    jsonb_build_object(
      'message', new.title || ' の精算が確定しました。未完了 ' || v_open_count || '件・残額 ' || v_remaining || '円です。',
      'title', '精算が確定しました',
      'url', warikan_private.payment_deep_link(new.share_token),
      'eventId', new.id,
      'openCount', v_open_count,
      'remainingAmount', v_remaining
    ),
    'settlement-finalized:' || extract(epoch from new.finalized_at)::bigint::text
  );
  return new;
end;
$$;

create or replace function warikan_private.notify_settlement_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_payer public.members;
  v_receiver public.members;
  v_open_count integer;
begin
  if old.status = new.status then return new; end if;

  select * into v_event from public.events where id = new.event_id;
  select * into v_payer from public.members where id = new.from_member_id;
  select * into v_receiver from public.members where id = new.to_member_id;

  if new.status = 'reported' then
    perform warikan_private.queue_lifecycle_notification(
      new.event_id,
      new.to_member_id,
      'payment_reported',
      jsonb_build_object(
        'message', v_payer.name || 'さんが' || new.amount || '円の支払い完了を報告しました。' || v_receiver.name || 'さんは受け取りを確認してください。',
        'title', '支払い完了の報告',
        'url', warikan_private.payment_deep_link(v_event.share_token, new.id),
        'eventId', new.event_id,
        'settlementId', new.id,
        'amount', new.amount
      ),
      'payment-reported:' || new.id::text || ':' || extract(epoch from new.reported_at)::bigint::text
    );
  elsif new.status = 'paid' then
    perform warikan_private.queue_lifecycle_notification(
      new.event_id,
      new.from_member_id,
      'payment_confirmed',
      jsonb_build_object(
        'message', v_receiver.name || 'さんが' || new.amount || '円の受け取りを確認しました。',
        'title', '受け取り確認',
        'url', warikan_private.payment_deep_link(v_event.share_token, new.id),
        'eventId', new.event_id,
        'settlementId', new.id,
        'amount', new.amount
      ),
      'payment-confirmed:' || new.id::text || ':' || extract(epoch from new.confirmed_at)::bigint::text
    );

    select count(*) into v_open_count
    from public.settlements
    where event_id = new.event_id and amount > 0 and status <> 'paid';

    if v_open_count = 0 then
      perform warikan_private.queue_lifecycle_notification(
        new.event_id,
        null,
        'settlement_completed',
        jsonb_build_object(
          'message', v_event.title || ' の精算がすべて完了しました。',
          'title', '全員の精算が完了しました',
          'url', warikan_private.payment_deep_link(v_event.share_token),
          'eventId', new.event_id
        ),
        'settlement-completed:' || extract(epoch from new.confirmed_at)::bigint::text
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists events_notify_finalized on public.events;
create trigger events_notify_finalized
after update of status on public.events
for each row execute function warikan_private.notify_event_finalized();

drop trigger if exists settlements_notify_transition on public.settlements;
create trigger settlements_notify_transition
after update of status on public.settlements
for each row execute function warikan_private.notify_settlement_transition();

create or replace function public.schedule_settlement_reminders(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events := warikan_private.require_organizer(p_event_id);
  v_settlement public.settlements;
  v_payer public.members;
  v_receiver public.members;
  v_count integer := 0;
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  if v_event.status <> 'finalized' then
    raise exception 'EVENT_NOT_FINALIZED' using errcode = '55000';
  end if;

  for v_settlement in
    select s.*
    from public.settlements s
    where s.event_id = p_event_id and s.amount > 0 and s.status = 'pending'
    order by s.created_at, s.id
  loop
    select * into v_payer from public.members where id = v_settlement.from_member_id;
    select * into v_receiver from public.members where id = v_settlement.to_member_id;
    v_count := v_count + warikan_private.queue_lifecycle_notification(
      p_event_id,
      v_settlement.from_member_id,
      'payment_reminder',
      jsonb_build_object(
        'message', v_payer.name || 'さんへ：' || v_receiver.name || 'さんへの' || v_settlement.amount || '円が未払いです。',
        'title', '未払いの確認',
        'url', warikan_private.payment_deep_link(v_event.share_token, v_settlement.id),
        'eventId', p_event_id,
        'settlementId', v_settlement.id,
        'amount', v_settlement.amount
      ),
      'payment-reminder:' || v_today::text || ':' || v_settlement.id::text
    );
  end loop;

  perform warikan_private.write_log(
    p_event_id,
    null,
    'schedule_settlement_reminders',
    jsonb_build_object('queuedCount', v_count, 'date', v_today)
  );
  return v_count;
end;
$$;

create or replace function public.get_settlement_status_for_bot(p_share_token text)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_event public.events;
  v_total integer;
  v_pending integer;
  v_reported integer;
  v_paid integer;
  v_remaining integer;
begin
  select * into v_event from public.events where share_token = p_share_token;
  if v_event.id is null then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  select
    count(*) filter (where amount > 0),
    count(*) filter (where amount > 0 and status = 'pending'),
    count(*) filter (where amount > 0 and status = 'reported'),
    count(*) filter (where amount > 0 and status = 'paid'),
    coalesce(sum(amount) filter (where amount > 0 and status <> 'paid'), 0)
  into v_total, v_pending, v_reported, v_paid, v_remaining
  from public.settlements
  where event_id = v_event.id;

  return jsonb_build_object(
    'eventStatus', v_event.status,
    'totalCount', v_total,
    'pendingCount', v_pending,
    'reportedCount', v_reported,
    'completedCount', v_paid,
    'remainingAmount', v_remaining,
    'allPaid', v_event.status = 'finalized' and v_total > 0 and v_paid = v_total,
    'url', warikan_private.payment_deep_link(v_event.share_token)
  );
end;
$$;

revoke execute on function public.schedule_settlement_reminders(uuid) from public, anon;
grant execute on function public.schedule_settlement_reminders(uuid) to authenticated;
revoke execute on function public.get_settlement_status_for_bot(text) from public, anon, authenticated;
grant execute on function public.get_settlement_status_for_bot(text) to service_role;

comment on function public.schedule_settlement_reminders(uuid) is
  'Queues at most one reminder per pending settlement, active integration, and calendar day.';
comment on function public.get_settlement_status_for_bot(text) is
  'Service-role-only aggregate status for unlinked read-only assistant conversations. Returns no member names or payment profile data.';
