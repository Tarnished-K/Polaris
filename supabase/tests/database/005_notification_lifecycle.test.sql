begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(18);

select has_function(
  'public',
  'schedule_settlement_reminders',
  array['uuid'],
  'organizer reminder RPC exists'
);
select has_function(
  'public',
  'get_settlement_status_for_bot',
  array['text'],
  'service-only assistant status RPC exists'
);

insert into auth.users(id, email, created_at, updated_at)
values
  ('40000000-0000-0000-0000-000000000001', 'notification-owner@example.com', now(), now()),
  ('40000000-0000-0000-0000-000000000002', 'notification-outsider@example.com', now(), now());

select set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000001', true);
select public.create_event('通知ライフサイクルテスト', 'single_day', '2026-08-20', '2026-08-20', 4);
select public.organizer_upsert_integration(
  (select id from public.events where title = '通知ライフサイクルテスト'),
  'discord',
  'notification-channel',
  '通知テスト'
);

select set_config('request.jwt.claim.sub', '', true);
select public.join_event(
  (select share_token from public.events where title = '通知ライフサイクルテスト'),
  repeat('p', 43),
  '支払う人'
);
select public.join_event(
  (select share_token from public.events where title = '通知ライフサイクルテスト'),
  repeat('r', 43),
  '受け取る人'
);
select public.add_expense(
  event.share_token,
  repeat('r', 43),
  'food',
  '通知対象の立て替え',
  5000,
  receiver.id,
  'fixed',
  null,
  jsonb_build_array(jsonb_build_object('memberId', payer.id, 'fixedAmount', 5000))
)
from public.events event
join public.members payer on payer.event_id = event.id and payer.name = '支払う人'
join public.members receiver on receiver.event_id = event.id and receiver.name = '受け取る人'
where event.title = '通知ライフサイクルテスト';

select set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000001', true);
select public.finalize_event((select id from public.events where title = '通知ライフサイクルテスト'));
select set_config(
  'test.share_token',
  (select share_token from public.events where title = '通知ライフサイクルテスト'),
  true
);

select is(
  (select count(*)::integer from public.notification_jobs where notification_type = 'settlement_finalized'),
  1,
  'finalization queues one job per active integration'
);
select is(
  (select (payload->>'remainingAmount')::integer from public.notification_jobs where notification_type = 'settlement_finalized'),
  5000,
  'finalization payload carries only the aggregate remaining amount'
);
select matches(
  (select payload->>'url' from public.notification_jobs where notification_type = 'settlement_finalized'),
  '^https://polaris-warikan[.]netlify[.]app/e/[A-Za-z0-9_-]+[?]view=payment$',
  'notification contains the safe payment deep link'
);
select is(
  public.schedule_settlement_reminders((select id from public.events where title = '通知ライフサイクルテスト')),
  1,
  'first reminder queues the pending settlement'
);
select is(
  public.schedule_settlement_reminders((select id from public.events where title = '通知ライフサイクルテスト')),
  0,
  'same-day reminder is deduplicated'
);

select set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000002', true);
select throws_ok(
  format(
    'select public.schedule_settlement_reminders(%L::uuid)',
    (select id from public.events where title = '通知ライフサイクルテスト')
  ),
  '42501',
  'ORGANIZER_REQUIRED',
  'another authenticated user cannot schedule reminders'
);

set local role service_role;
select is(
  (public.get_settlement_status_for_bot(current_setting('test.share_token'))->>'pendingCount')::integer,
  1,
  'assistant status reports the pending count'
);
select is(
  (public.get_settlement_status_for_bot(current_setting('test.share_token'))->>'remainingAmount')::integer,
  5000,
  'assistant status reports the aggregate remaining amount'
);
select ok(
  not (public.get_settlement_status_for_bot(current_setting('test.share_token')) ? 'members'),
  'assistant status contains no member list'
);
set local role postgres;

set local role anon;
select throws_ok(
  format('select public.get_settlement_status_for_bot(%L)', current_setting('test.share_token')),
  '42501',
  'permission denied for function get_settlement_status_for_bot',
  'anonymous callers cannot invoke the assistant status RPC directly'
);
set local role postgres;

select set_config('request.jwt.claim.sub', '', true);
select public.report_settlement(
  event.share_token,
  repeat('p', 43),
  settlement.id
)
from public.events event
join public.settlements settlement on settlement.event_id = event.id
where event.title = '通知ライフサイクルテスト';

select is(
  (select count(*)::integer from public.notification_jobs where notification_type = 'payment_reported'),
  1,
  'payment report queues a receiver notification'
);

select set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000001', true);
select is(
  public.schedule_settlement_reminders((select id from public.events where title = '通知ライフサイクルテスト')),
  0,
  'reported settlements are excluded from reminders'
);

select set_config('request.jwt.claim.sub', '', true);
select public.confirm_settlement(
  event.share_token,
  repeat('r', 43),
  settlement.id
)
from public.events event
join public.settlements settlement on settlement.event_id = event.id
where event.title = '通知ライフサイクルテスト';

select is(
  (select count(*)::integer from public.notification_jobs where notification_type = 'payment_confirmed'),
  1,
  'receipt confirmation queues a payer notification'
);
select is(
  (select count(*)::integer from public.notification_jobs where notification_type = 'settlement_completed'),
  1,
  'last receipt confirmation queues the event completion notification'
);

set local role service_role;
select ok(
  (public.get_settlement_status_for_bot(current_setting('test.share_token'))->>'allPaid')::boolean,
  'assistant status reports all paid after final confirmation'
);
select throws_ok(
  'select public.get_settlement_status_for_bot(''missing-share-token-that-is-long-enough'')',
  'P0002',
  'EVENT_NOT_FOUND',
  'assistant status rejects an unknown event'
);
set local role postgres;

select * from finish();
rollback;
