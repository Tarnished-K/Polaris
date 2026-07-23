begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(27);

select has_table('public', 'events', 'events table exists');
select has_table('public', 'members', 'members table exists');
select has_table('public', 'expenses', 'expenses table exists');
select has_table('public', 'expense_targets', 'expense targets table exists');
select has_table('public', 'settlements', 'settlements table exists');
select has_table('public', 'event_integrations', 'event integrations table exists');
select has_table('public', 'notification_jobs', 'notification outbox exists');
select has_function('public', 'get_event_state', array['text'], 'public state RPC exists');
select has_function('public', 'get_event_state', array['text', 'text'], 'actor-aware state RPC exists');
select has_function('public', 'join_event', array['text', 'text', 'text'], 'join RPC exists');

insert into auth.users(id, email, created_at, updated_at)
values ('10000000-0000-0000-0000-000000000001', 'organizer@example.com', now(), now());
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.create_event('SQLテスト旅行', 'overnight', '2026-07-18', '2026-07-20', 4)$$,
  'authenticated organizer creates an event'
);
select is((select count(*)::integer from public.events where title = 'SQLテスト旅行'), 1, 'one event was created');
select is((select count(*)::integer from public.members m join public.events e on e.id = m.event_id where e.title = 'SQLテスト旅行' and m.is_organizer), 1, 'organizer member was created');

select lives_ok(
  format('select public.organizer_add_member(%L::uuid, %L)', e.id, '代理参加者')
  , 'organizer adds an unclaimed member'
)
from public.events e where e.title = 'SQLテスト旅行';

select lives_ok(
  format('select public.join_event(%L, %L, %L)', e.share_token, repeat('d', 43), '参加者')
  , 'accountless participant joins with a device token'
)
from public.events e where e.title = 'SQLテスト旅行';

select is((select count(*)::integer from public.members m join public.events e on e.id = m.event_id where e.title = 'SQLテスト旅行'), 3, 'event now has three members');
select is((select count(*)::integer from public.members where device_token_hash = repeat('d', 43)), 0, 'raw device token is never stored');

select lives_ok(
  format(
    'select public.add_expense(%L,%L,%L,%L,%s,%L::uuid,%L,null,%L::jsonb)',
    e.share_token, repeat('d', 43), 'food', '未確定の夕食', 5000, payer.id, 'fixed',
    jsonb_build_array(jsonb_build_object('memberId', payer.id, 'fixedAmount', 2000), jsonb_build_object('memberId', proxy.id))::text
  ),
  'partial fixed allocation is accepted as a draft'
)
from public.events e
join public.members payer on payer.event_id = e.id and payer.name = '参加者'
join public.members proxy on proxy.event_id = e.id and proxy.name = '代理参加者'
where e.title = 'SQLテスト旅行';

select is((select status::text from public.expenses where title = '未確定の夕食'), 'draft', 'partial fixed expense is draft');

select lives_ok(
  format(
    'select public.add_expense(%L,%L,%L,%L,%s,%L::uuid,%L,null,%L::jsonb)',
    e.share_token, repeat('d', 43), 'transport', '確定した交通費', 5000, payer.id, 'fixed',
    jsonb_build_array(jsonb_build_object('memberId', payer.id, 'fixedAmount', 2000), jsonb_build_object('memberId', proxy.id, 'fixedAmount', 3000))::text
  ),
  'complete fixed allocation is finalized'
)
from public.events e
join public.members payer on payer.event_id = e.id and payer.name = '参加者'
join public.members proxy on proxy.event_id = e.id and proxy.name = '代理参加者'
where e.title = 'SQLテスト旅行';

select is((select status::text from public.expenses where title = '確定した交通費'), 'finalized', 'complete fixed expense is finalized');
select is(jsonb_array_length(public.get_event_state((select share_token from public.events where title = 'SQLテスト旅行'))->'expenses'), 2, 'state RPC returns both expenses');

select lives_ok(
  format('select public.organizer_issue_claim_token(%L::uuid, %L::uuid)', e.id, m.id),
  'organizer issues a one-time claim token'
)
from public.events e join public.members m on m.event_id = e.id and m.name = '代理参加者'
where e.title = 'SQLテスト旅行';
select is((select count(*)::integer from public.member_claim_tokens), 1, 'claim token hash is stored');

select lives_ok(
  format('select public.organizer_upsert_integration(%L::uuid,%L,%L,%L)', e.id, 'discord', 'channel-123', '旅行チャンネル'),
  'organizer connects a Discord channel'
)
from public.events e where e.title = 'SQLテスト旅行';
select is((select count(*)::integer from public.event_integrations where provider = 'discord'), 1, 'one integration is stored');

select lives_ok(
  format('select public.organizer_queue_notification(%L::uuid,%L,%L::jsonb,null,null,now(),%L)', e.id, 'invite', '{"message":"join"}', 'invite:initial'),
  'organizer queues a notification'
)
from public.events e where e.title = 'SQLテスト旅行';
select is((select status::text from public.notification_jobs where dedupe_key = 'invite:initial'), 'pending', 'notification starts pending');

select * from finish();
rollback;
