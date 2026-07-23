begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

insert into auth.users(id, email, created_at, updated_at)
values
  ('30000000-0000-0000-0000-000000000001', 'payment-owner@example.com', now(), now()),
  ('30000000-0000-0000-0000-000000000002', 'payment-intruder@example.com', now(), now());

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
select public.create_event('支払い導線テスト', 'single_day', '2026-08-10', '2026-08-10', 5);

select set_config('request.jwt.claim.sub', '', true);
select public.join_event(
  (select share_token from public.events where title = '支払い導線テスト'),
  repeat('p', 43),
  '支払う人'
);
select public.join_event(
  (select share_token from public.events where title = '支払い導線テスト'),
  repeat('r', 43),
  '受け取る人'
);
select public.join_event(
  (select share_token from public.events where title = '支払い導線テスト'),
  repeat('u', 43),
  '無関係な人'
);

select public.add_expense(
  event.share_token,
  repeat('r', 43),
  'food',
  '受取人の立て替え',
  5000,
  receiver.id,
  'fixed',
  null,
  jsonb_build_array(jsonb_build_object('memberId', payer.id, 'fixedAmount', 5000)),
  '夕食会場で現地精算'
)
from public.events event
join public.members payer on payer.event_id = event.id and payer.name = '支払う人'
join public.members receiver on receiver.event_id = event.id and receiver.name = '受け取る人'
where event.title = '支払い導線テスト';

select public.add_expense(
  event.share_token,
  repeat('r', 43),
  'transport',
  '受取人の交通立て替え',
  3000,
  receiver.id,
  'fixed',
  null,
  jsonb_build_array(jsonb_build_object('memberId', payer.id, 'fixedAmount', 3000)),
  null
)
from public.events event
join public.members payer on payer.event_id = event.id and payer.name = '支払う人'
join public.members receiver on receiver.event_id = event.id and receiver.name = '受け取る人'
where event.title = '支払い導線テスト';

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
select public.finalize_event((select id from public.events where title = '支払い導線テスト'));

select public.create_event('精算なし保持テスト', 'single_day', '2026-08-11', '2026-08-11', 3);
select set_config('request.jwt.claim.sub', '', true);
select public.join_event(
  (select share_token from public.events where title = '精算なし保持テスト'),
  repeat('x', 43),
  '別イベント参加者'
);
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
select public.finalize_event((select id from public.events where title = '精算なし保持テスト'));

select public.create_event('イベント削除テスト', 'single_day', '2026-08-12', '2026-08-12', 3);
select set_config('request.jwt.claim.sub', '', true);
select public.join_event(
  (select share_token from public.events where title = 'イベント削除テスト'),
  repeat('d', 43),
  '削除イベント支払人'
);
select public.join_event(
  (select share_token from public.events where title = 'イベント削除テスト'),
  repeat('e', 43),
  '削除イベント受取人'
);
select public.add_expense(
  event.share_token,
  repeat('e', 43),
  'other',
  '削除対象イベントの立て替え',
  900,
  receiver.id,
  'fixed',
  null,
  jsonb_build_array(jsonb_build_object('memberId', payer.id, 'fixedAmount', 900)),
  null
)
from public.events event
join public.members payer on payer.event_id = event.id and payer.name = '削除イベント支払人'
join public.members receiver on receiver.event_id = event.id and receiver.name = '削除イベント受取人'
where event.title = 'イベント削除テスト';
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
select public.finalize_event((select id from public.events where title = 'イベント削除テスト'));
select set_config('request.jwt.claim.sub', '', true);

insert into public.settlements(
  event_id,
  from_member_id,
  to_member_id,
  amount,
  gross_amount,
  offset_amount
)
select event.id, unrelated.id, receiver.id, 0, 0, 0
from public.events event
join public.members unrelated on unrelated.event_id = event.id and unrelated.name = '無関係な人'
join public.members receiver on receiver.event_id = event.id and receiver.name = '受け取る人'
where event.title = '支払い導線テスト';

select lives_ok(
  format(
    'select public.upsert_payment_profile(%L,%L,%L,true)',
    event.share_token, repeat('r', 43), 'receiver_1'
  ),
  'receiver can save a PayPay ID and cash preference'
)
from public.events event where event.title = '支払い導線テスト';

select throws_ok(
  format(
    'select public.upsert_payment_profile(%L,%L,%L,true)',
    event.share_token, repeat('r', 43), 'Invalid-ID'
  ),
  '22023', 'INVALID_PAYPAY_ID', 'invalid PayPay IDs are rejected'
)
from public.events event where event.title = '支払い導線テスト';

select throws_ok(
  format(
    'select public.upsert_payment_profile(%L,%L,null,false)',
    event.share_token, repeat('r', 43)
  ),
  '22023', 'PAYMENT_METHOD_REQUIRED', 'at least one payment method is required'
)
from public.events event where event.title = '支払い導線テスト';

select lives_ok(
  format(
    'select public.upsert_payment_profile(%L,%L,%L,true)',
    event.share_token, repeat('p', 43), 'payer_1'
  ),
  'payer can save only their own payment profile'
)
from public.events event where event.title = '支払い導線テスト';

select lives_ok(
  format(
    'select public.upsert_payment_profile(%L,%L,%L,true)',
    event.share_token, repeat('u', 43), 'unrelated_1'
  ),
  'unrelated participant can save only their own payment profile'
)
from public.events event where event.title = '支払い導線テスト';

select lives_ok(
  format(
    'select public.upsert_payment_profile(%L,%L,%L,true)',
    event.share_token, repeat('x', 43), 'other_event_1'
  ),
  'participant in another event can save their own profile'
)
from public.events event where event.title = '精算なし保持テスト';

select lives_ok(
  format(
    'select public.upsert_payment_profile(%L,%L,%L,true)',
    event.share_token, repeat('d', 43), 'delete_event_1'
  ),
  'participant profile is present for event-cascade deletion'
)
from public.events event where event.title = 'イベント削除テスト';

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
select lives_ok(
  format(
    'select public.upsert_payment_profile(%L,null,%L,true)',
    event.share_token, 'organizer_1'
  ),
  'authenticated organizer can save their own profile without a device token'
)
from public.events event where event.title = '支払い導線テスト';

select is(
  jsonb_array_length(public.get_payment_state(event.share_token, null)->'profiles'),
  1,
  'organizer does not receive all event payment profiles'
)
from public.events event where event.title = '支払い導線テスト';

select is(
  public.get_payment_state(event.share_token, null)->'profiles'->0->>'paypayId',
  'organizer_1',
  'organizer receives only their own profile when not a settlement payer'
)
from public.events event where event.title = '支払い導線テスト';
select set_config('request.jwt.claim.sub', '', true);

select throws_ok(
  format('select public.get_payment_state(%L,null)', event.share_token),
  '22023', 'INVALID_DEVICE_TOKEN', 'share token alone does not authorize an anonymous caller'
)
from public.events event where event.title = '支払い導線テスト';

select throws_ok(
  format('select public.get_payment_state(%L,%L)', 'not-a-real-share-token-000000', repeat('p', 43)),
  'P0002', 'EVENT_NOT_FOUND', 'invalid share token is rejected before any payment data is returned'
);

select throws_ok(
  format(
    'select public.get_payment_state(%L,%L)',
    event.share_token, repeat('p', 43)
  ),
  '42501', 'PARTICIPANT_NOT_FOUND', 'a device token from another event cannot cross the event boundary'
)
from public.events event where event.title = '精算なし保持テスト';

select is(
  jsonb_array_length(public.get_payment_state(event.share_token, repeat('u', 43))->'profiles'),
  1,
  'unrelated participant receives exactly their own profile'
)
from public.events event where event.title = '支払い導線テスト';

select is(
  public.get_payment_state(event.share_token, repeat('u', 43))->'profiles'->0->>'paypayId',
  'unrelated_1',
  'unrelated participant cannot read the receiver PayPay ID'
)
from public.events event where event.title = '支払い導線テスト';

select is(
  jsonb_array_length(public.get_payment_state(event.share_token, repeat('p', 43))->'profiles'),
  2,
  'payer receives only self and the receiver of an open positive settlement'
)
from public.events event where event.title = '支払い導線テスト';

select is(
  (
    select profile->>'paypayId'
    from jsonb_array_elements(
      public.get_payment_state(event.share_token, repeat('p', 43))->'profiles'
    ) profile
    where profile->>'paypayId' = 'receiver_1'
  ),
  'receiver_1',
  'payer can read the PayPay ID of the open-settlement receiver'
)
from public.events event where event.title = '支払い導線テスト';

select is(
  jsonb_array_length(public.get_payment_state(event.share_token, repeat('x', 43))->'profiles'),
  1,
  'payment profiles stay isolated to the actor event'
)
from public.events event where event.title = '精算なし保持テスト';

select lives_ok(
  format(
    'select public.set_settlement_payment_link(%L,%L,%L::uuid,%L)',
    event.share_token,
    repeat('r', 43),
    settlement.id,
    'https://qr.paypay.ne.jp/request/payment-test'
  ),
  'receiver can save an exact-host qr.paypay.ne.jp request link'
)
from public.events event
join public.settlements settlement on settlement.event_id = event.id and settlement.amount > 0
where event.title = '支払い導線テスト';

select throws_ok(
  format(
    'select public.set_settlement_payment_link(%L,%L,%L::uuid,%L)',
    event.share_token, repeat('p', 43), settlement.id, 'https://paypay.ne.jp/request/impersonation'
  ),
  '42501', 'RECEIVER_REQUIRED', 'payer cannot configure the receiver request link'
)
from public.events event
join public.settlements settlement on settlement.event_id = event.id and settlement.amount > 0
where event.title = '支払い導線テスト';

select throws_ok(
  format(
    'select public.set_settlement_payment_link(%L,%L,%L::uuid,%L)',
    event.share_token, repeat('r', 43), settlement.id, 'https://sub.paypay.ne.jp/request'
  ),
  '22023', 'INVALID_PAYPAY_REQUEST_URL', 'PayPay subdomains outside the exact allowlist are rejected'
)
from public.events event
join public.settlements settlement on settlement.event_id = event.id and settlement.amount > 0
where event.title = '支払い導線テスト';

select throws_ok(
  format(
    'select public.set_settlement_payment_link(%L,%L,%L::uuid,%L)',
    event.share_token, repeat('r', 43), settlement.id, 'https://evil.example@paypay.ne.jp/request'
  ),
  '22023', 'INVALID_PAYPAY_REQUEST_URL', 'userinfo URL confusion is rejected'
)
from public.events event
join public.settlements settlement on settlement.event_id = event.id and settlement.amount > 0
where event.title = '支払い導線テスト';

select throws_ok(
  format(
    'select public.set_settlement_payment_link(%L,%L,%L::uuid,%L)',
    event.share_token, repeat('r', 43), settlement.id, 'https://paypay.ne.jp:443/request'
  ),
  '22023', 'INVALID_PAYPAY_REQUEST_URL', 'PayPay URLs with an explicit port are rejected'
)
from public.events event
join public.settlements settlement on settlement.event_id = event.id and settlement.amount > 0
where event.title = '支払い導線テスト';

select throws_ok(
  format(
    'select public.set_settlement_payment_link(%L,%L,%L::uuid,%L)',
    event.share_token, repeat('r', 43), settlement.id, 'https://paypay.ne.jp.evil.example/request'
  ),
  '22023', 'INVALID_PAYPAY_REQUEST_URL', 'lookalike PayPay domains are rejected'
)
from public.events event
join public.settlements settlement on settlement.event_id = event.id and settlement.amount > 0
where event.title = '支払い導線テスト';

select throws_ok(
  format(
    'select public.set_settlement_payment_link(%L,%L,%L::uuid,%L)',
    event.share_token, repeat('r', 43), settlement.id, 'https://paypay.ne.jp/request/zero'
  ),
  'P0002', 'SETTLEMENT_NOT_FOUND', 'amount-zero settlements cannot receive payment links'
)
from public.events event
join public.settlements settlement on settlement.event_id = event.id and settlement.amount = 0
where event.title = '支払い導線テスト';

select throws_ok(
  format(
    'select public.set_settlement_payment_link(%L,%L,%L::uuid,%L)',
    event.share_token,
    repeat('x', 43),
    settlement.id,
    'https://paypay.ne.jp/request/cross-event'
  ),
  '42501', 'PARTICIPANT_NOT_FOUND', 'another event actor cannot configure this event settlement'
)
from public.events event
join public.settlements settlement on settlement.event_id = event.id and settlement.amount > 0
where event.title = '支払い導線テスト';

select is(
  public.get_payment_state(event.share_token, repeat('p', 43))->'links'->0->>'paypayRequestUrl',
  'https://qr.paypay.ne.jp/request/payment-test',
  'payer can read the request link for their open settlement'
)
from public.events event where event.title = '支払い導線テスト';

select is(
  public.get_payment_state(event.share_token, repeat('r', 43))->'links'->0->>'paypayRequestUrl',
  'https://qr.paypay.ne.jp/request/payment-test',
  'receiver can read their own request link'
)
from public.events event where event.title = '支払い導線テスト';

select is(
  jsonb_array_length(public.get_payment_state(event.share_token, repeat('u', 43))->'links'),
  0,
  'unrelated participant cannot read settlement request links'
)
from public.events event where event.title = '支払い導線テスト';

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
select is(
  jsonb_array_length(public.get_payment_state(event.share_token, null)->'links'),
  0,
  'organizer cannot read request links when not a settlement party'
)
from public.events event where event.title = '支払い導線テスト';
select set_config('request.jwt.claim.sub', '', true);

select is(
  (
    select count(*)::integer
    from information_schema.table_privileges
    where table_schema = 'public'
      and table_name = 'member_payment_profiles'
      and grantee in ('anon', 'authenticated')
  ),
  0,
  'anon and authenticated have no direct privileges on payment profiles'
);

select is(
  (
    select count(*)::integer
    from information_schema.table_privileges
    where table_schema = 'public'
      and table_name = 'settlement_payment_links'
      and grantee in ('anon', 'authenticated')
  ),
  0,
  'anon and authenticated have no direct privileges on payment links'
);

set local role anon;
select throws_ok(
  'select count(*) from public.member_payment_profiles',
  '42501', 'permission denied for table member_payment_profiles', 'anon cannot read payment profiles directly'
);
select throws_ok(
  'select count(*) from public.settlement_payment_links',
  '42501', 'permission denied for table settlement_payment_links', 'anon cannot read payment links directly'
);
set local role postgres;

select ok(
  (
    select prosecdef
      and coalesce((
        select split_part(setting, '=', 2)
        from unnest(proconfig) setting
        where setting like 'search_path=%'
      ), 'not-set') in ('', '""')
    from pg_proc
    where oid = 'public.get_payment_state(text,text)'::regprocedure
  ),
  'get_payment_state is SECURITY DEFINER with an empty search_path'
);

select ok(
  (
    select bool_and(
      proc.prosecdef
      and coalesce((
        select split_part(setting, '=', 2)
        from unnest(proc.proconfig) setting
        where setting like 'search_path=%'
      ), 'not-set') in ('', '""')
    )
    from pg_proc proc
    where proc.oid in (
      'public.upsert_payment_profile(text,text,text,boolean)'::regprocedure,
      'public.delete_payment_profile(text,text)'::regprocedure,
      'public.set_settlement_payment_link(text,text,uuid,text)'::regprocedure,
      'public.purge_expired_payment_data()'::regprocedure,
      'public.organizer_delete_event(uuid)'::regprocedure
    )
  ),
  'all payment mutation and deletion RPCs are SECURITY DEFINER with an empty search_path'
);

select is(
  (
    select count(*)::integer
    from information_schema.routine_privileges
    where specific_schema = 'public'
      and routine_name in (
        'get_payment_state',
        'upsert_payment_profile',
        'delete_payment_profile',
        'set_settlement_payment_link',
        'purge_expired_payment_data',
        'organizer_delete_event'
      )
      and grantee = 'PUBLIC'
      and privilege_type = 'EXECUTE'
  ),
  0,
  'payment and deletion RPCs do not retain default PUBLIC execute'
);

select ok(
  has_function_privilege('anon', 'public.get_payment_state(text,text)', 'EXECUTE')
    and has_function_privilege('anon', 'public.upsert_payment_profile(text,text,text,boolean)', 'EXECUTE')
    and has_function_privilege('anon', 'public.delete_payment_profile(text,text)', 'EXECUTE')
    and has_function_privilege('anon', 'public.set_settlement_payment_link(text,text,uuid,text)', 'EXECUTE'),
  'anon receives only the actor-verified payment RPC entry points'
);

select ok(
  has_function_privilege('authenticated', 'public.get_payment_state(text,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.upsert_payment_profile(text,text,text,boolean)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.delete_payment_profile(text,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.set_settlement_payment_link(text,text,uuid,text)', 'EXECUTE'),
  'authenticated receives the actor-verified payment RPC entry points'
);

select ok(
  not has_function_privilege('anon', 'public.purge_expired_payment_data()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.purge_expired_payment_data()', 'EXECUTE')
    and has_function_privilege('service_role', 'public.purge_expired_payment_data()', 'EXECUTE'),
  'retention purge is executable by service_role but not client roles'
);

select ok(
  not has_function_privilege('anon', 'public.organizer_delete_event(uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.organizer_delete_event(uuid)', 'EXECUTE'),
  'event deletion is authenticated-only at the function ACL'
);

select is(
  (
    select pronargs::integer
    from pg_proc
    where oid = 'public.delete_payment_profile(text,text)'::regprocedure
  ),
  2,
  'delete_payment_profile has no member-id parameter'
);

select lives_ok(
  format(
    'select public.delete_payment_profile(%L,%L)',
    event.share_token, repeat('u', 43)
  ),
  'participant can explicitly delete only their own profile'
)
from public.events event where event.title = '支払い導線テスト';

select is(
  (
    select count(*)::integer
    from public.member_payment_profiles profile
    join public.members member on member.id = profile.member_id
    where member.name = '無関係な人'
  ),
  0,
  'own-profile deletion removed the actor row'
);

select is(
  (
    select count(*)::integer
    from public.member_payment_profiles profile
    join public.members member on member.id = profile.member_id
    where member.name = '受け取る人'
  ),
  1,
  'own-profile deletion did not remove another member profile'
);

select is(
  (
    select count(*)::integer
    from public.activity_logs log
    join public.members member on member.id = log.member_id
    where log.action = 'delete_payment_profile'
      and (
        log.detail::text like '%unrelated_1%'
        or log.detail::text like '%' || member.id::text || '%'
      )
  ),
  0,
  'payment-profile deletion audit detail contains no PayPay ID or member UUID'
);

select is(
  (select note from public.expenses where title = '受取人の立て替え'),
  '夕食会場で現地精算',
  'expense note is stored'
);

select is(
  (
    select sum(item.payable_amount)::integer
    from public.settlement_items item
    join public.settlements settlement on settlement.id = item.settlement_id
    join public.events event on event.id = settlement.event_id
    where event.title = '支払い導線テスト'
      and settlement.amount > 0
      and item.direction = 'charge'
  ),
  8000,
  'per-expense payable amounts add up to the positive settlement total'
);

select lives_ok(
  format(
    'select public.report_settlement_items(%L,%L,%L::uuid,array[%L::uuid])',
    event.share_token, repeat('p', 43), settlement.id, expense.id
  ),
  'payer can report one selected expense'
)
from public.events event
join public.settlements settlement on settlement.event_id = event.id and settlement.amount > 0
join public.expenses expense on expense.event_id = event.id and expense.title = '受取人の立て替え'
where event.title = '支払い導線テスト';

select is(
  (
    select settlement.status::text
    from public.settlements settlement
    join public.events event on event.id = settlement.event_id
    where event.title = '支払い導線テスト' and settlement.amount > 0
  ),
  'pending',
  'parent settlement remains pending while another expense is unpaid'
);

select is(
  (
    select item.payment_status::text
    from public.settlement_items item
    join public.expenses expense on expense.id = item.expense_id
    where expense.title = '受取人の立て替え' and item.direction = 'charge'
  ),
  'reported',
  'selected expense is marked reported'
);

select lives_ok(
  format(
    'select public.confirm_settlement_items(%L,%L,%L::uuid,array[%L::uuid])',
    event.share_token, repeat('r', 43), settlement.id, expense.id
  ),
  'receiver can confirm the selected expense'
)
from public.events event
join public.settlements settlement on settlement.event_id = event.id and settlement.amount > 0
join public.expenses expense on expense.event_id = event.id and expense.title = '受取人の立て替え'
where event.title = '支払い導線テスト';

select is(
  (
    select item.payment_status::text
    from public.settlement_items item
    join public.expenses expense on expense.id = item.expense_id
    where expense.title = '受取人の立て替え' and item.direction = 'charge'
  ),
  'paid',
  'confirmed expense is marked paid'
);

select is(
  (select count(*)::integer from public.settlement_payment_links),
  1,
  'request link remains while part of the settlement is still open'
);

select lives_ok(
  format(
    'select public.report_settlement_items(%L,%L,%L::uuid,array[%L::uuid])',
    event.share_token, repeat('p', 43), settlement.id, expense.id
  ),
  'payer can report the remaining expense'
)
from public.events event
join public.settlements settlement on settlement.event_id = event.id and settlement.amount > 0
join public.expenses expense on expense.event_id = event.id and expense.title = '受取人の交通立て替え'
where event.title = '支払い導線テスト';

select is(
  (
    select settlement.status::text
    from public.settlements settlement
    join public.events event on event.id = settlement.event_id
    where event.title = '支払い導線テスト' and settlement.amount > 0
  ),
  'reported',
  'parent settlement becomes reported when no expense remains pending'
);

select lives_ok(
  format(
    'select public.confirm_settlement_items(%L,%L,%L::uuid,array[%L::uuid])',
    event.share_token, repeat('r', 43), settlement.id, expense.id
  ),
  'receiver can confirm the remaining expense'
)
from public.events event
join public.settlements settlement on settlement.event_id = event.id and settlement.amount > 0
join public.expenses expense on expense.event_id = event.id and expense.title = '受取人の交通立て替え'
where event.title = '支払い導線テスト';

select is(
  (
    select settlement.status::text
    from public.settlements settlement
    join public.events event on event.id = settlement.event_id
    where event.title = '支払い導線テスト' and settlement.amount > 0
  ),
  'paid',
  'parent settlement becomes paid after every expense is confirmed'
);

select is(
  (select count(*)::integer from public.settlement_payment_links),
  0,
  'request link is deleted immediately when its settlement becomes paid'
);

select is(
  jsonb_array_length(public.get_payment_state(event.share_token, repeat('p', 43))->'profiles'),
  1,
  'payer no longer receives receiver profile after the positive settlement is paid'
)
from public.events event where event.title = '支払い導線テスト';

select is(
  jsonb_array_length(public.get_payment_state(event.share_token, repeat('p', 43))->'links'),
  0,
  'paid settlement links are not returned'
)
from public.events event where event.title = '支払い導線テスト';

select throws_ok(
  format(
    'select public.set_settlement_payment_link(%L,%L,%L::uuid,%L)',
    event.share_token, repeat('r', 43), settlement.id, 'https://paypay.ne.jp/request/paid'
  ),
  'P0002', 'SETTLEMENT_NOT_FOUND', 'paid settlements reject new payment links'
)
from public.events event
join public.settlements settlement on settlement.event_id = event.id and settlement.amount > 0
where event.title = '支払い導線テスト';

select is(
  (public.purge_expired_payment_data()->>'profilesDeleted')::integer,
  0,
  'retention purge keeps profiles before 30 days have elapsed'
);

select is(
  (
    select count(*)::integer
    from public.member_payment_profiles profile
    join public.members member on member.id = profile.member_id
    join public.events event on event.id = member.event_id
    where event.title = '支払い導線テスト'
  ),
  3,
  'paid event profiles remain during the 30-day retention period'
);

select is(
  (
    select count(*)::integer
    from public.member_payment_profiles profile
    join public.members member on member.id = profile.member_id
    join public.events event on event.id = member.event_id
    where event.title = '精算なし保持テスト'
  ),
  1,
  'event with no positive settlements uses finalized time and is retained initially'
);

update public.settlements settlement
set confirmed_at = now() - interval '31 days'
from public.events event
where event.id = settlement.event_id
  and event.title = '支払い導線テスト'
  and settlement.amount > 0;

insert into public.settlement_payment_links(
  settlement_id,
  created_by_member_id,
  paypay_request_url
)
select settlement.id, settlement.to_member_id, 'https://paypay.ne.jp/request/stale'
from public.settlements settlement
join public.events event on event.id = settlement.event_id
where event.title = '支払い導線テスト'
  and settlement.amount > 0;

select is(
  public.purge_expired_payment_data(),
  jsonb_build_object('profilesDeleted', 3, 'linksDeleted', 1),
  'purge removes retained profiles and stale links 30 days after final payment'
);

select is(
  (
    select count(*)::integer
    from public.member_payment_profiles profile
    join public.members member on member.id = profile.member_id
    join public.events event on event.id = member.event_id
    where event.title = '支払い導線テスト'
  ),
  0,
  'expired paid-event profiles are deleted'
);

select is(
  (
    select count(*)::integer
    from public.member_payment_profiles profile
    join public.members member on member.id = profile.member_id
    join public.events event on event.id = member.event_id
    where event.title = '精算なし保持テスト'
  ),
  1,
  'purging an expired paid event does not remove a newer no-settlement event profile'
);

update public.events
set finalized_at = now() - interval '31 days'
where title = '精算なし保持テスト';

select is(
  public.purge_expired_payment_data(),
  jsonb_build_object('profilesDeleted', 1, 'linksDeleted', 0),
  'no-settlement event profile is purged 30 days after event finalization'
);

select is(
  (
    select count(*)::integer
    from public.member_payment_profiles profile
    join public.members member on member.id = profile.member_id
    join public.events event on event.id = member.event_id
    where event.title = '精算なし保持テスト'
  ),
  0,
  'expired no-settlement event profile is deleted'
);

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000002', true);
select throws_ok(
  format('select public.organizer_delete_event(%L::uuid)', event.id),
  '42501', 'ORGANIZER_REQUIRED', 'another authenticated user cannot delete the event'
)
from public.events event where event.title = 'イベント削除テスト';

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
select lives_ok(
  format('select public.organizer_delete_event(%L::uuid)', event.id),
  'event organizer can permanently delete an event and its dependent data'
)
from public.events event where event.title = 'イベント削除テスト';
select set_config('request.jwt.claim.sub', '', true);

select is(
  (select count(*)::integer from public.events where title = 'イベント削除テスト'),
  0,
  'organizer event deletion removes the event row'
);

select is(
  (
    select count(*)::integer
    from public.member_payment_profiles profile
    join public.members member on member.id = profile.member_id
    where member.name = '削除イベント支払人'
  ),
  0,
  'organizer event deletion cascades to payment profiles'
);

select * from finish();
rollback;
