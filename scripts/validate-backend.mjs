import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { PGlite } from '@electric-sql/pglite'

const database = new PGlite()

try {
  // Supabase normally provides auth, roles, and pgcrypto. The embedded validator
  // supplies minimal equivalents so migrations can be checked without Docker.
  await database.exec(`
    create schema auth;
    create schema extensions;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function extensions.digest(bytea, text) returns bytea language sql immutable as $$ select $1 $$;
    create function extensions.gen_random_bytes(integer) returns bytea language sql volatile
      as $$ select decode(repeat('ab', $1), 'hex') $$;
    create role anon;
    create role authenticated;
    create role service_role;
  `)

  const migrationDirectory = path.resolve('supabase/migrations')
  const migrations = (await readdir(migrationDirectory)).filter((file) => file.endsWith('.sql')).sort()
  for (const migration of migrations) {
    const source = await readFile(path.join(migrationDirectory, migration), 'utf8')
    const compatibleSource = source.replace(/create extension if not exists pgcrypto with schema extensions;\s*/i, '')
    await database.exec(compatibleSource)
  }

  const organizerId = '10000000-0000-0000-0000-000000000001'
  await database.query('insert into auth.users(id) values ($1)', [organizerId])
  await database.query("select set_config('request.jwt.claim.sub', $1, false)", [organizerId])
  await database.query("select public.create_event('Backend smoke test', 'overnight', '2026-07-18', '2026-07-20', 4)")

  const eventResult = await database.query("select id, share_token from public.events where title = 'Backend smoke test'")
  assert.equal(eventResult.rows.length, 1)
  const { id: eventId, share_token: shareToken } = eventResult.rows[0]

  await database.query('select public.organizer_add_member($1::uuid, $2)', [eventId, 'Proxy'])
  const deviceToken = 'device-token-that-is-at-least-thirty-two-characters'
  await database.query('select public.join_event($1, $2, $3)', [shareToken, deviceToken, 'Participant'])

  const members = await database.query('select id, name from public.members where event_id = $1::uuid order by created_at', [eventId])
  const payer = members.rows.find((member) => member.name === 'Participant')
  const proxy = members.rows.find((member) => member.name === 'Proxy')
  assert.ok(payer && proxy)

  await database.query(
    `select public.add_expense($1, $2, 'food', 'Draft dinner', 5000, $3::uuid, 'fixed', null, $4::jsonb)`,
    [shareToken, deviceToken, payer.id, JSON.stringify([
      { memberId: payer.id, fixedAmount: 2000 },
      { memberId: proxy.id },
    ])],
  )
  await database.query(
    `select public.add_expense($1, $2, 'transport', 'Final transport', 5000, $3::uuid, 'fixed', 1, $4::jsonb)`,
    [shareToken, deviceToken, payer.id, JSON.stringify([
      { memberId: payer.id, fixedAmount: 2000 },
      { memberId: proxy.id, fixedAmount: 3000 },
    ])],
  )

  const statuses = await database.query('select title, status::text from public.expenses order by created_at')
  assert.deepEqual(statuses.rows.map(({ status }) => status), ['draft', 'finalized'])

  const draftExpense = await database.query("select id from public.expenses where title = 'Draft dinner'")
  await database.query('select public.save_own_fixed_amount($1, $2, $3::uuid, 2500)', [shareToken, deviceToken, draftExpense.rows[0].id])
  const savedAmount = await database.query('select fixed_amount from public.expense_targets where expense_id = $1::uuid and member_id = $2::uuid', [draftExpense.rows[0].id, payer.id])
  assert.equal(savedAmount.rows[0].fixed_amount, 2500)

  await database.query(
    `select public.update_expense($1, null, $2::uuid, 'food', 'Updated dinner', 5000, $3::uuid, 'fixed', null, $4::jsonb)`,
    [shareToken, draftExpense.rows[0].id, payer.id, JSON.stringify([
      { memberId: payer.id, fixedAmount: 2000 },
      { memberId: proxy.id, fixedAmount: 3000 },
    ])],
  )
  await database.query(
    `select public.add_expense($1, null, 'activity', 'Reverse advance', 2000, $2::uuid, 'fixed', 2, $3::jsonb)`,
    [shareToken, proxy.id, JSON.stringify([{ memberId: payer.id, fixedAmount: 2000 }])],
  )

  await database.query('select public.finalize_event($1::uuid)', [eventId])
  const settlementResult = await database.query('select id, amount, gross_amount, offset_amount, status::text from public.settlements where event_id = $1::uuid', [eventId])
  assert.equal(settlementResult.rows.length, 1)
  assert.deepEqual(
    {
      amount: settlementResult.rows[0].amount,
      gross: settlementResult.rows[0].gross_amount,
      offset: settlementResult.rows[0].offset_amount,
      status: settlementResult.rows[0].status,
    },
    { amount: 4000, gross: 6000, offset: 2000, status: 'pending' },
  )
  const settlementId = settlementResult.rows[0].id
  await database.query('select public.report_settlement($1, null, $2::uuid)', [shareToken, settlementId])
  await database.query('select public.confirm_settlement($1, null, $2::uuid)', [shareToken, settlementId])
  await database.query('select public.revert_settlement($1, null, $2::uuid)', [shareToken, settlementId])
  const reverted = await database.query('select status::text from public.settlements where id = $1::uuid', [settlementId])
  assert.equal(reverted.rows[0].status, 'reported')

  const guardedUnfinalize = await database.query('select public.unfinalize_event($1::uuid, false) as result', [eventId])
  assert.equal(guardedUnfinalize.rows[0].result.requiresConfirmation, true)
  await database.query('select public.unfinalize_event($1::uuid, true)', [eventId])
  const activeEvent = await database.query('select status::text from public.events where id = $1::uuid', [eventId])
  assert.equal(activeEvent.rows[0].status, 'active')

  await database.query("select public.organizer_upsert_integration($1::uuid, 'discord', 'channel-123', 'Trip channel')", [eventId])
  await database.query(
    "select public.organizer_queue_notification($1::uuid, 'invite', '{\"message\":\"join\"}'::jsonb, null, null, now(), 'invite:initial')",
    [eventId],
  )
  const jobs = await database.query("select status::text from public.notification_jobs where dedupe_key = 'invite:initial'")
  assert.equal(jobs.rows[0]?.status, 'pending')

  const stateResult = await database.query('select public.get_event_state($1) as state', [shareToken])
  assert.equal(stateResult.rows[0].state.members.length, 3)
  assert.equal(stateResult.rows[0].state.expenses.length, 3)

  console.log(`Validated ${migrations.length} migrations and the core backend flow.`)
} finally {
  await database.close()
}
