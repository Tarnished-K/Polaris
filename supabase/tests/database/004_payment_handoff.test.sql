begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(22);

insert into auth.users(id, email, created_at, updated_at)
values ('30000000-0000-0000-0000-000000000001', 'payment-owner@example.com', now(), now());

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
select public.create_event('支払い導線テスト', 'single_day', '2026-08-10', '2026-08-10', 4);

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
select set_config('request.jwt.claim.sub', '', true);

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
    'select public.set_settlement_payment_link(%L,%L,%L::uuid,%L)',
    event.share_token, repeat('r', 43), settlement.id, 'https://paypay.ne.jp/request/payment-test'
  ),
  'receiver can save an official PayPay request link'
)
from public.events event
join public.settlements settlement on settlement.event_id = event.id
where event.title = '支払い導線テスト';

select throws_ok(
  format(
    'select public.set_settlement_payment_link(%L,%L,%L::uuid,%L)',
    event.share_token, repeat('p', 43), settlement.id, 'https://paypay.ne.jp/request/impersonation'
  ),
  '42501', 'RECEIVER_REQUIRED', 'payer cannot configure the receiver request link'
)
from public.events event
join public.settlements settlement on settlement.event_id = event.id
where event.title = '支払い導線テスト';

select throws_ok(
  format(
    'select public.set_settlement_payment_link(%L,%L,%L::uuid,%L)',
    event.share_token, repeat('r', 43), settlement.id, 'https://paypay.ne.jp.evil.example/request'
  ),
  '22023', 'INVALID_PAYPAY_REQUEST_URL', 'lookalike PayPay domains are rejected'
)
from public.events event
join public.settlements settlement on settlement.event_id = event.id
where event.title = '支払い導線テスト';

select is(
  public.get_payment_state(event.share_token, repeat('p', 43))->'profiles'->0->>'paypayId',
  'receiver_1',
  'payer can read the counterpart PayPay ID'
)
from public.events event where event.title = '支払い導線テスト';

select is(
  public.get_payment_state(event.share_token, repeat('p', 43))->'links'->0->>'paypayRequestUrl',
  'https://paypay.ne.jp/request/payment-test',
  'payer can read the request link for their settlement'
)
from public.events event where event.title = '支払い導線テスト';

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

select set_config('request.jwt.claim.sub', '', true);
select public.set_settlement_payment_link(
  event.share_token,
  repeat('r', 43),
  settlement.id,
  null
)
from public.events event
join public.settlements settlement on settlement.event_id = event.id
where event.title = '支払い導線テスト';

select is(
  (select count(*)::integer from public.settlement_payment_links),
  0,
  'receiver can remove a request link'
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
    where event.title = '支払い導線テスト' and item.direction = 'charge'
  ),
  8000,
  'per-expense payable amounts add up to the settlement total'
);

select lives_ok(
  format(
    'select public.report_settlement_items(%L,%L,%L::uuid,array[%L::uuid])',
    event.share_token, repeat('p', 43), settlement.id, expense.id
  ),
  'payer can report one selected expense'
)
from public.events event
join public.settlements settlement on settlement.event_id = event.id
join public.expenses expense on expense.event_id = event.id and expense.title = '受取人の立て替え'
where event.title = '支払い導線テスト';

select is(
  (select status::text from public.settlements settlement join public.events event on event.id = settlement.event_id where event.title = '支払い導線テスト'),
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
join public.settlements settlement on settlement.event_id = event.id
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

select lives_ok(
  format(
    'select public.report_settlement_items(%L,%L,%L::uuid,array[%L::uuid])',
    event.share_token, repeat('p', 43), settlement.id, expense.id
  ),
  'payer can report the remaining expense'
)
from public.events event
join public.settlements settlement on settlement.event_id = event.id
join public.expenses expense on expense.event_id = event.id and expense.title = '受取人の交通立て替え'
where event.title = '支払い導線テスト';

select is(
  (select status::text from public.settlements settlement join public.events event on event.id = settlement.event_id where event.title = '支払い導線テスト'),
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
join public.settlements settlement on settlement.event_id = event.id
join public.expenses expense on expense.event_id = event.id and expense.title = '受取人の交通立て替え'
where event.title = '支払い導線テスト';

select is(
  (select status::text from public.settlements settlement join public.events event on event.id = settlement.event_id where event.title = '支払い導線テスト'),
  'paid',
  'parent settlement becomes paid after every expense is confirmed'
);

select * from finish();
rollback;
