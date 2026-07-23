begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(33);

select has_table('public', 'member_link_codes', 'one-time link code table exists');
select has_table('public', 'webhook_receipts', 'webhook replay ledger exists');
select has_function(
  'public',
  'create_member_link_code',
  array['text', 'text', 'integration_provider'],
  'participant link code RPC exists'
);
select has_function(
  'public',
  'consume_member_link_code',
  array['text', 'integration_provider', 'text'],
  'service-only link consumption RPC exists'
);

insert into auth.users(id, email, created_at, updated_at)
values ('50000000-0000-0000-0000-000000000001', 'link-owner@example.com', now(), now());

select set_config('request.jwt.claim.sub', '50000000-0000-0000-0000-000000000001', true);
select public.create_event('外部アカウント連携テスト', 'single_day', '2026-08-21', '2026-08-21', 3);
select set_config('request.jwt.claim.sub', '', true);
select public.join_event(
  (select share_token from public.events where title = '外部アカウント連携テスト'),
  repeat('p', 43),
  '支払う人'
);
select public.join_event(
  (select share_token from public.events where title = '外部アカウント連携テスト'),
  repeat('r', 43),
  '受け取る人'
);
select public.add_expense(
  event.share_token,
  repeat('r', 43),
  'food',
  '連携テストの立て替え',
  5000,
  receiver.id,
  'fixed',
  null,
  jsonb_build_array(jsonb_build_object('memberId', payer.id, 'fixedAmount', 5000))
)
from public.events event
join public.members payer on payer.event_id = event.id and payer.name = '支払う人'
join public.members receiver on receiver.event_id = event.id and receiver.name = '受け取る人'
where event.title = '外部アカウント連携テスト';

select set_config('request.jwt.claim.sub', '50000000-0000-0000-0000-000000000001', true);
select public.finalize_event((select id from public.events where title = '外部アカウント連携テスト'));
select set_config('request.jwt.claim.sub', '', true);
select set_config(
  'test.payer_code',
  public.create_member_link_code(
    (select share_token from public.events where title = '外部アカウント連携テスト'),
    repeat('p', 43),
    'line'
  )->>'code',
  true
);

select matches(current_setting('test.payer_code'), '^[0-9A-F]{8}$', 'link code is eight uppercase hexadecimal characters');
select isnt(
  (
    select code.code_hash
    from public.member_link_codes code
    join public.members member on member.id = code.member_id
    join public.events event on event.id = member.event_id
    where event.title = '外部アカウント連携テスト'
      and member.name = '支払う人'
      and code.consumed_at is null
  ),
  current_setting('test.payer_code'),
  'only a hash of the link code is stored'
);
select ok(
  (
    select code.expires_at <= code.created_at + interval '5 minutes 1 second'
    from public.member_link_codes code
    join public.members member on member.id = code.member_id
    join public.events event on event.id = member.event_id
    where event.title = '外部アカウント連携テスト'
      and member.name = '支払う人'
      and code.consumed_at is null
  ),
  'link code expires after five minutes'
);
select is(
  public.consume_member_link_code(current_setting('test.payer_code'), 'discord', repeat('a', 64))->>'error',
  'INVALID_LINK_CODE',
  'a code cannot be consumed by another provider'
);
select ok(
  (public.consume_member_link_code(current_setting('test.payer_code'), 'line', repeat('a', 64))->>'linked')::boolean,
  'matching LINE account consumes the code once'
);
select is(
  public.consume_member_link_code(current_setting('test.payer_code'), 'line', repeat('a', 64))->>'error',
  'LINK_CODE_ALREADY_USED',
  'consumed code cannot be replayed'
);
select is(
  public.get_external_account_links(
    (select share_token from public.events where title = '外部アカウント連携テスト'),
    repeat('p', 43)
  )->0->>'provider',
  'line',
  'participant can see their linked provider without an external user ID'
);
select is(
  (
    select account.external_user_hash
    from public.member_external_accounts account
    join public.members member on member.id = account.member_id
    join public.events event on event.id = member.event_id
    where event.title = '外部アカウント連携テスト'
      and member.name = '支払う人'
      and account.provider = 'line'
  ),
  repeat('a', 64),
  'only the Edge Function HMAC lookup hash is stored'
);
select is(
  (
    select account.display_name
    from public.member_external_accounts account
    join public.members member on member.id = account.member_id
    join public.events event on event.id = member.event_id
    where event.title = '外部アカウント連携テスト'
      and member.name = '支払う人'
      and account.provider = 'line'
  ),
  null,
  'external display names are not stored'
);

select set_config(
  'test.receiver_code',
  public.create_member_link_code(
    (select share_token from public.events where title = '外部アカウント連携テスト'),
    repeat('r', 43),
    'line'
  )->>'code',
  true
);
select is(
  public.consume_member_link_code(current_setting('test.receiver_code'), 'line', repeat('a', 64))->>'error',
  'EXTERNAL_ACCOUNT_ALREADY_LINKED',
  'one external account cannot impersonate another participant'
);

select is(
  public.get_member_settlement_status_for_bot('line', repeat('a', 64))->'settlements'->0->>'direction',
  'outgoing',
  'linked payer sees only their own payment direction'
);
select is(
  (public.get_member_settlement_status_for_bot('line', repeat('a', 64))->'settlements'->0->>'amount')::integer,
  5000,
  'linked payer sees their own amount'
);

select lives_ok(
  format(
    'select public.report_settlement_for_external_account(%L,%L,%L::uuid)',
    'line',
    repeat('a', 64),
    (
      select settlement.id
      from public.settlements settlement
      join public.events event on event.id = settlement.event_id
      where event.title = '外部アカウント連携テスト'
        and settlement.amount = 5000
    )
  ),
  'linked payer can report their own settlement'
);
select throws_ok(
  format(
    'select public.confirm_settlement_for_external_account(%L,%L,%L::uuid)',
    'line',
    repeat('a', 64),
    (
      select settlement.id
      from public.settlements settlement
      join public.events event on event.id = settlement.event_id
      where event.title = '外部アカウント連携テスト'
        and settlement.amount = 5000
    )
  ),
  '42501',
  'RECEIVER_REQUIRED',
  'linked payer cannot impersonate the receiver'
);

select set_config(
  'test.receiver_code',
  public.create_member_link_code(
    (select share_token from public.events where title = '外部アカウント連携テスト'),
    repeat('r', 43),
    'line'
  )->>'code',
  true
);
select public.consume_member_link_code(current_setting('test.receiver_code'), 'line', repeat('b', 64));
select lives_ok(
  format(
    'select public.confirm_settlement_for_external_account(%L,%L,%L::uuid)',
    'line',
    repeat('b', 64),
    (
      select settlement.id
      from public.settlements settlement
      join public.events event on event.id = settlement.event_id
      where event.title = '外部アカウント連携テスト'
        and settlement.amount = 5000
    )
  ),
  'linked receiver can confirm their own receipt'
);
select is(
  (public.get_member_settlement_status_for_bot('line', repeat('a', 64))->>'completedCount')::integer,
  1,
  'linked payer status reflects the confirmed settlement'
);
select ok(
  public.unlink_external_account(
    (select share_token from public.events where title = '外部アカウント連携テスト'),
    repeat('p', 43),
    'line'
  ),
  'participant can unlink their own external account'
);
select throws_ok(
  format('select public.get_member_settlement_status_for_bot(%L,%L)', 'line', repeat('a', 64)),
  '42501',
  'EXTERNAL_ACCOUNT_NOT_LINKED',
  'unlinked account can no longer read member status'
);

select ok(
  public.claim_webhook_event('line', '01K123456789ABCDEFGHJKMNPQ', (extract(epoch from now()) * 1000)::bigint, repeat('c', 64), 300),
  'first signed webhook event is claimed'
);
select is(
  public.claim_webhook_event('line', '01K123456789ABCDEFGHJKMNPQ', (extract(epoch from now()) * 1000)::bigint, repeat('c', 64), 300),
  false,
  'same provider event ID is rejected as a replay'
);
select is(
  public.claim_webhook_event('discord', '123456789012345678', (extract(epoch from now() - interval '6 minutes') * 1000)::bigint, repeat('d', 64), 300),
  false,
  'expired Discord interaction timestamp is rejected'
);
select is(
  public.claim_webhook_event('discord', '123456789012345679', (extract(epoch from now() + interval '6 minutes') * 1000)::bigint, repeat('e', 64), 300),
  false,
  'far-future interaction timestamp is rejected'
);
select ok(
  public.consume_assistant_rate_limit('line', repeat('f', 64), 2, 300),
  'first assistant action is inside the rate limit'
);
select ok(
  public.consume_assistant_rate_limit('line', repeat('f', 64), 2, 300),
  'second assistant action is inside the configured limit'
);
select is(
  public.consume_assistant_rate_limit('line', repeat('f', 64), 2, 300),
  false,
  'additional assistant action is limited'
);
select ok(
  public.consume_assistant_rate_limit('discord', repeat('f', 64), 2, 300),
  'rate limits are separated by provider'
);

set local role authenticated;
select throws_ok(
  'select external_user_hash from public.member_external_accounts',
  '42501',
  'permission denied for table member_external_accounts',
  'authenticated organizers cannot read external account hashes directly'
);
set local role postgres;

set local role anon;
select throws_ok(
  'select count(*) from public.member_link_codes',
  '42501',
  'permission denied for table member_link_codes',
  'anonymous callers cannot read link-code hashes'
);
select throws_ok(
  format(
    'select public.consume_member_link_code(%L,%L,%L)',
    'ABCD1234',
    'line',
    repeat('f', 64)
  ),
  '42501',
  'permission denied for function consume_member_link_code',
  'anonymous callers cannot consume link codes directly'
);
set local role postgres;

select * from finish();
rollback;
