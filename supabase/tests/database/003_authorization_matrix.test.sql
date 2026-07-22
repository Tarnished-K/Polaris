begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(12);

insert into auth.users(id, email, created_at, updated_at)
values
  ('20000000-0000-0000-0000-000000000001', 'authorization-owner@example.com', now(), now()),
  ('20000000-0000-0000-0000-000000000002', 'authorization-outsider@example.com', now(), now());

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
select public.create_event('権限テスト旅行', 'overnight', '2026-08-01', '2026-08-02', 5);
select public.organizer_add_member(
  (select id from public.events where title = '権限テスト旅行'),
  '代理参加者'
);

select set_config('request.jwt.claim.sub', '', true);
select public.join_event(
  (select share_token from public.events where title = '権限テスト旅行'),
  repeat('p', 43),
  '支払者'
);
select public.join_event(
  (select share_token from public.events where title = '権限テスト旅行'),
  repeat('o', 43),
  '他の参加者'
);

select public.add_expense(
  e.share_token,
  repeat('p', 43),
  'food',
  '権限確認用の暫定支出',
  5000,
  payer.id,
  'fixed',
  1,
  jsonb_build_array(
    jsonb_build_object('memberId', payer.id, 'fixedAmount', 2000),
    jsonb_build_object('memberId', proxy.id)
  )
)
from public.events e
join public.members payer on payer.event_id = e.id and payer.name = '支払者'
join public.members proxy on proxy.event_id = e.id and proxy.name = '代理参加者'
where e.title = '権限テスト旅行';

select throws_ok(
  format(
    'select public.update_expense(%L,%L,%L::uuid,%L,%L,%s,%L::uuid,%L,%s,%L::jsonb)',
    e.share_token, repeat('o', 43), x.id, 'food', '不正編集', 5000, payer.id, 'fixed', 1,
    jsonb_build_array(
      jsonb_build_object('memberId', payer.id, 'fixedAmount', 2000),
      jsonb_build_object('memberId', proxy.id, 'fixedAmount', 3000)
    )::text
  ),
  '42501', 'PAYER_OR_ORGANIZER_REQUIRED', 'another participant cannot update the payer expense'
)
from public.events e
join public.expenses x on x.event_id = e.id and x.title = '権限確認用の暫定支出'
join public.members payer on payer.event_id = e.id and payer.name = '支払者'
join public.members proxy on proxy.event_id = e.id and proxy.name = '代理参加者';

select throws_ok(
  format('select public.delete_expense(%L,%L,%L::uuid)', e.share_token, repeat('o', 43), x.id),
  '42501', 'PAYER_OR_ORGANIZER_REQUIRED', 'another participant cannot delete the payer expense'
)
from public.events e join public.expenses x on x.event_id = e.id and x.title = '権限確認用の暫定支出';

select throws_ok(
  format('select public.finalize_expense(%L,%L,%L::uuid)', e.share_token, repeat('o', 43), x.id),
  '42501', 'PAYER_OR_ORGANIZER_REQUIRED', 'another participant cannot finalize the payer expense'
)
from public.events e join public.expenses x on x.event_id = e.id and x.title = '権限確認用の暫定支出';

select throws_ok(
  format('select public.save_own_fixed_amount(%L,%L,%L::uuid,%s)', e.share_token, repeat('o', 43), x.id, 1000),
  '42501', 'MEMBER_NOT_TARGET', 'a non-target participant cannot save a fixed amount'
)
from public.events e join public.expenses x on x.event_id = e.id and x.title = '権限確認用の暫定支出';

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);

select throws_ok(
  format('select public.finalize_event(%L::uuid)', e.id),
  '42501', 'ORGANIZER_REQUIRED', 'another organizer cannot finalize the event'
)
from public.events e where e.title = '権限テスト旅行';

select throws_ok(
  format('select public.unfinalize_event(%L::uuid,false)', e.id),
  '42501', 'ORGANIZER_REQUIRED', 'another organizer cannot unfinalize the event'
)
from public.events e where e.title = '権限テスト旅行';

select throws_ok(
  format(
    'select public.organizer_update_event(%L::uuid,%L,%L,%L::date,%L::date,%s)',
    e.id, '不正変更', 'overnight', '2026-08-01', '2026-08-02', 5
  ),
  '42501', 'ORGANIZER_REQUIRED', 'another organizer cannot update event settings'
)
from public.events e where e.title = '権限テスト旅行';

select throws_ok(
  format('select public.organizer_remove_member(%L::uuid,%L::uuid)', e.id, proxy.id),
  '42501', 'ORGANIZER_REQUIRED', 'another organizer cannot remove a member'
)
from public.events e
join public.members proxy on proxy.event_id = e.id and proxy.name = '代理参加者'
where e.title = '権限テスト旅行';

select public.create_event('別イベント', 'single_day', '2026-08-03', '2026-08-03', 2);
select public.add_expense(
  e.share_token, null, 'transport', '別イベントの支出', 1000, organizer.id, 'equal', null,
  jsonb_build_array(jsonb_build_object('memberId', organizer.id))
)
from public.events e
join public.members organizer on organizer.event_id = e.id and organizer.is_organizer
where e.title = '別イベント';

select set_config('request.jwt.claim.sub', '', true);

select throws_ok(
  format(
    'select public.update_expense(%L,%L,%L::uuid,%L,%L,%s,%L::uuid,%L,null,%L::jsonb)',
    source_event.share_token, repeat('o', 43), foreign_expense.id, 'transport', '越境編集', 1000,
    foreign_organizer.id, 'equal',
    jsonb_build_array(jsonb_build_object('memberId', foreign_organizer.id))::text
  ),
  'P0002', 'EXPENSE_NOT_FOUND', 'a participant cannot update an expense from another event'
)
from public.events source_event
cross join public.events foreign_event
join public.expenses foreign_expense on foreign_expense.event_id = foreign_event.id and foreign_expense.title = '別イベントの支出'
join public.members foreign_organizer on foreign_organizer.event_id = foreign_event.id and foreign_organizer.is_organizer
where source_event.title = '権限テスト旅行' and foreign_event.title = '別イベント';

select throws_ok(
  format('select public.delete_expense(%L,%L,%L::uuid)', source_event.share_token, repeat('o', 43), foreign_expense.id),
  'P0002', 'EXPENSE_NOT_FOUND', 'a participant cannot delete an expense from another event'
)
from public.events source_event
cross join public.events foreign_event
join public.expenses foreign_expense on foreign_expense.event_id = foreign_event.id and foreign_expense.title = '別イベントの支出'
where source_event.title = '権限テスト旅行' and foreign_event.title = '別イベント';

set local role anon;
select throws_ok(
  'select count(*) from public.events',
  '42501', 'permission denied for table events', 'anon cannot read events directly'
);
select throws_ok(
  'select count(*) from public.expenses',
  '42501', 'permission denied for table expenses', 'anon cannot read expenses directly'
);
set local role postgres;

select * from finish();
rollback;
