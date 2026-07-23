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
    create function extensions.digest(bytea, text) returns bytea language sql immutable
      as $$ select decode(md5(encode($1, 'hex')) || md5('warikan:' || encode($1, 'hex')), 'hex') $$;
    create function extensions.gen_random_bytes(integer) returns bytea language sql volatile
      as $$ select decode(string_agg(lpad(to_hex(floor(random() * 256)::integer), 2, '0'), ''), 'hex')
            from generate_series(1, $1) $$;
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
  await database.query("select public.create_event('Backend smoke test', 'overnight', '2026-07-18', '2026-07-20', 6)")

  const eventResult = await database.query("select id, share_token from public.events where title = 'Backend smoke test'")
  assert.equal(eventResult.rows.length, 1)
  const { id: eventId, share_token: shareToken } = eventResult.rows[0]

  await database.query('select public.organizer_add_member($1::uuid, $2)', [eventId, 'Proxy'])
  const deviceToken = 'device-token-that-is-at-least-thirty-two-characters'
  const otherDeviceToken = 'other-device-token-that-is-at-least-thirty-two-characters'
  const duplicateDeviceToken = 'duplicate-device-token-that-is-at-least-thirty-two-characters'
  await database.query('select public.join_event($1, $2, $3)', [shareToken, deviceToken, 'Participant'])
  await database.query('select public.join_event($1, $2, $3)', [shareToken, otherDeviceToken, 'Other participant'])
  await database.query('select public.organizer_add_member($1::uuid, $2)', [eventId, 'Proxy'])
  await database.query('select public.join_event($1, $2, $3)', [shareToken, duplicateDeviceToken, 'Participant'])

  const members = await database.query('select id, name from public.members where event_id = $1::uuid order by created_at', [eventId])
  const payer = members.rows.find((member) => member.name === 'Participant')
  const proxy = members.rows.find((member) => member.name === 'Proxy')
  const otherParticipant = members.rows.find((member) => member.name === 'Other participant')
  assert.ok(payer && proxy && otherParticipant)
  assert.ok(members.rows.some((member) => member.name === 'Proxy(1)'))
  assert.ok(members.rows.some((member) => member.name === 'Participant(1)'))
  await database.query("select set_config('request.jwt.claim.sub', '', false)")

  await database.query(
    `select public.add_expense($1, $2, 'food', 'Draft dinner', 5000, $3::uuid, 'fixed', null, $4::jsonb)`,
    [shareToken, deviceToken, payer.id, JSON.stringify([
      { memberId: payer.id, fixedAmount: 2000 },
      { memberId: proxy.id },
    ])],
  )
  await database.query(
    `select public.add_expense($1, $2, 'transport', 'Final transport', 5000, $3::uuid, 'fixed', 1, $4::jsonb, $5)`,
    [shareToken, deviceToken, payer.id, JSON.stringify([
      { memberId: payer.id, fixedAmount: 2000 },
      { memberId: proxy.id, fixedAmount: 3000 },
    ]), 'Airport pickup at 08:30'],
  )

  const statuses = await database.query('select title, status::text from public.expenses order by created_at')
  assert.deepEqual(statuses.rows.map(({ status }) => status), ['draft', 'finalized'])

  const draftExpense = await database.query("select id from public.expenses where title = 'Draft dinner'")
  const draftExpenseId = draftExpense.rows[0].id
  const draftTargets = JSON.stringify([
    { memberId: payer.id, fixedAmount: 2000 },
    { memberId: proxy.id, fixedAmount: 3000 },
  ])
  await assert.rejects(
    database.query(
      `select public.update_expense($1, $2, $3::uuid, 'food', 'Unauthorized edit', 5000, $4::uuid, 'fixed', null, $5::jsonb)`,
      [shareToken, otherDeviceToken, draftExpenseId, payer.id, draftTargets],
    ),
    /PAYER_OR_ORGANIZER_REQUIRED/,
  )
  await assert.rejects(
    database.query('select public.delete_expense($1, $2, $3::uuid)', [shareToken, otherDeviceToken, draftExpenseId]),
    /PAYER_OR_ORGANIZER_REQUIRED/,
  )
  await assert.rejects(
    database.query('select public.finalize_expense($1, $2, $3::uuid)', [shareToken, otherDeviceToken, draftExpenseId]),
    /PAYER_OR_ORGANIZER_REQUIRED/,
  )
  await assert.rejects(
    database.query('select public.save_own_fixed_amount($1, $2, $3::uuid, 1000)', [shareToken, otherDeviceToken, draftExpenseId]),
    /MEMBER_NOT_TARGET/,
  )
  await database.query('select public.save_own_fixed_amount($1, $2, $3::uuid, 2500)', [shareToken, deviceToken, draftExpense.rows[0].id])
  const savedAmount = await database.query('select fixed_amount from public.expense_targets where expense_id = $1::uuid and member_id = $2::uuid', [draftExpense.rows[0].id, payer.id])
  assert.equal(savedAmount.rows[0].fixed_amount, 2500)

  await database.query("select set_config('request.jwt.claim.sub', $1, false)", [organizerId])
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

  const otherOrganizerId = '10000000-0000-0000-0000-000000000002'
  await database.query('insert into auth.users(id) values ($1)', [otherOrganizerId])
  await database.query("select set_config('request.jwt.claim.sub', $1, false)", [otherOrganizerId])
  await assert.rejects(database.query('select public.finalize_event($1::uuid)', [eventId]), /ORGANIZER_REQUIRED/)
  await assert.rejects(
    database.query(
      "select public.organizer_update_event($1::uuid, 'Unauthorized', 'overnight', '2026-07-18', '2026-07-20', 4)",
      [eventId],
    ),
    /ORGANIZER_REQUIRED/,
  )
  await assert.rejects(
    database.query('select public.organizer_remove_member($1::uuid, $2::uuid)', [eventId, proxy.id]),
    /ORGANIZER_REQUIRED/,
  )
  await assert.rejects(database.query('select public.unfinalize_event($1::uuid, false)', [eventId]), /ORGANIZER_REQUIRED/)
  await database.query("select set_config('request.jwt.claim.sub', $1, false)", [organizerId])

  await database.query("select public.organizer_upsert_integration($1::uuid, 'discord', 'channel-123', 'Trip channel')", [eventId])
  await database.query('select public.finalize_event($1::uuid)', [eventId])
  const settlementResult = await database.query('select id, from_member_id, to_member_id, amount, gross_amount, offset_amount, status::text from public.settlements where event_id = $1::uuid', [eventId])
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
  assert.equal(settlementResult.rows[0].from_member_id, proxy.id)
  assert.equal(settlementResult.rows[0].to_member_id, payer.id)
  const finalizedState = await database.query('select public.get_event_state($1) as state', [shareToken])
  assert.equal(
    finalizedState.rows[0].state.expenses.find((expense) => expense.title === 'Final transport').note,
    'Airport pickup at 08:30',
  )
  const paymentItems = await database.query(
    `select expense_id, payable_amount, payment_status::text
     from public.settlement_items
     where settlement_id = $1::uuid and direction = 'charge'
     order by expense_id`,
    [settlementId],
  )
  assert.equal(paymentItems.rows.length, 2)
  assert.equal(paymentItems.rows.reduce((sum, item) => sum + item.payable_amount, 0), 4000)
  assert.ok(paymentItems.rows.every((item) => item.payment_status === 'pending'))
  await database.query(
    'select public.report_settlement_items($1, null, $2::uuid, $3::uuid[])',
    [shareToken, settlementId, [paymentItems.rows[0].expense_id]],
  )
  const partialItems = await database.query(
    `select payment_status::text from public.settlement_items
     where settlement_id = $1::uuid and direction = 'charge'
     order by expense_id`,
    [settlementId],
  )
  assert.deepEqual(partialItems.rows.map((item) => item.payment_status), ['reported', 'pending'])
  const partialSettlement = await database.query('select status::text from public.settlements where id = $1::uuid', [settlementId])
  assert.equal(partialSettlement.rows[0].status, 'pending')
  await database.query('select public.revert_settlement($1, null, $2::uuid)', [shareToken, settlementId])
  const resetItems = await database.query(
    `select payment_status::text from public.settlement_items
     where settlement_id = $1::uuid and direction = 'charge'`,
    [settlementId],
  )
  assert.ok(resetItems.rows.every((item) => item.payment_status === 'pending'))
  const finalizedJob = await database.query(
    "select notification_type, payload from public.notification_jobs where notification_type = 'settlement_finalized'",
  )
  assert.equal(finalizedJob.rows.length, 1)
  assert.match(finalizedJob.rows[0].payload.url, new RegExp(`/e/${shareToken}\\?view=payment$`))
  const firstReminder = await database.query(
    'select public.schedule_settlement_reminders($1::uuid) as count',
    [eventId],
  )
  const duplicateReminder = await database.query(
    'select public.schedule_settlement_reminders($1::uuid) as count',
    [eventId],
  )
  assert.equal(firstReminder.rows[0].count, 1)
  assert.equal(duplicateReminder.rows[0].count, 0)
  const pendingBotStatus = await database.query(
    'select public.get_settlement_status_for_bot($1) as state',
    [shareToken],
  )
  assert.deepEqual(
    {
      total: pendingBotStatus.rows[0].state.totalCount,
      pending: pendingBotStatus.rows[0].state.pendingCount,
      reported: pendingBotStatus.rows[0].state.reportedCount,
      completed: pendingBotStatus.rows[0].state.completedCount,
      remaining: pendingBotStatus.rows[0].state.remainingAmount,
      allPaid: pendingBotStatus.rows[0].state.allPaid,
    },
    { total: 1, pending: 1, reported: 0, completed: 0, remaining: 4000, allPaid: false },
  )
  await database.query("select set_config('request.jwt.claim.sub', '', false)")
  await database.query(
    'select public.upsert_payment_profile($1, $2, $3, true)',
    [shareToken, deviceToken, 'participant_1'],
  )
  await assert.rejects(
    database.query(
      'select public.upsert_payment_profile($1, $2, $3, true)',
      [shareToken, deviceToken, 'Invalid-ID'],
    ),
    /INVALID_PAYPAY_ID/,
  )
  await database.query(
    'select public.set_settlement_payment_link($1, $2, $3::uuid, $4)',
    [shareToken, deviceToken, settlementId, 'https://paypay.ne.jp/request/backend-smoke'],
  )
  await assert.rejects(
    database.query(
      'select public.set_settlement_payment_link($1, $2, $3::uuid, $4)',
      [shareToken, otherDeviceToken, settlementId, 'https://paypay.ne.jp/request/unauthorized'],
    ),
    /RECEIVER_REQUIRED/,
  )
  await assert.rejects(
    database.query(
      'select public.set_settlement_payment_link($1, $2, $3::uuid, $4)',
      [shareToken, deviceToken, settlementId, 'https://paypay.ne.jp.evil.example/request'],
    ),
    /INVALID_PAYPAY_REQUEST_URL/,
  )
  const paymentState = await database.query(
    'select public.get_payment_state($1, $2) as state',
    [shareToken, deviceToken],
  )
  assert.equal(paymentState.rows[0].state.currentMemberId, payer.id)
  assert.deepEqual(paymentState.rows[0].state.profiles, [{
    memberId: payer.id,
    paypayId: 'participant_1',
    acceptsCash: true,
  }])
  assert.deepEqual(paymentState.rows[0].state.links, [{
    settlementId,
    paypayRequestUrl: 'https://paypay.ne.jp/request/backend-smoke',
  }])

  const linkCodeResult = await database.query(
    "select public.create_member_link_code($1, $2, 'line') as result",
    [shareToken, deviceToken],
  )
  const linkCode = linkCodeResult.rows[0].result.code
  assert.match(linkCode, /^[0-9A-F]{8}$/)
  const payerExternalHash = 'a'.repeat(64)
  const proxyExternalHash = 'b'.repeat(64)
  const consumedLink = await database.query(
    "select public.consume_member_link_code($1, 'line', $2) as result",
    [linkCode, payerExternalHash],
  )
  assert.equal(consumedLink.rows[0].result.linked, true)
  const reusedLink = await database.query(
    "select public.consume_member_link_code($1, 'line', $2) as result",
    [linkCode, payerExternalHash],
  )
  assert.equal(reusedLink.rows[0].result.error, 'LINK_CODE_ALREADY_USED')
  const externalLinks = await database.query(
    'select public.get_external_account_links($1, $2) as result',
    [shareToken, deviceToken],
  )
  assert.deepEqual(externalLinks.rows[0].result.map((link) => link.provider), ['line'])

  await database.query(
    `insert into public.member_external_accounts(member_id, provider, external_user_hash, verified_at)
     values ($1::uuid, 'discord', $2, now())`,
    [proxy.id, proxyExternalHash],
  )
  const linkedStatus = await database.query(
    "select public.get_member_settlement_status_for_bot('discord', $1) as state",
    [proxyExternalHash],
  )
  assert.equal(linkedStatus.rows[0].state.pendingCount, 1)
  assert.equal(linkedStatus.rows[0].state.settlements[0].direction, 'outgoing')
  await database.query(
    "select public.report_settlement_for_external_account('discord', $1, $2::uuid)",
    [proxyExternalHash, settlementId],
  )
  await database.query(
    "select public.confirm_settlement_for_external_account('line', $1, $2::uuid)",
    [payerExternalHash, settlementId],
  )
  await assert.rejects(
    database.query(
      "select public.report_settlement_for_external_account('line', $1, $2::uuid)",
      [payerExternalHash, settlementId],
    ),
    /PENDING_SETTLEMENT_REQUIRED/,
  )
  const nowMs = Date.now()
  const firstWebhook = await database.query(
    "select public.claim_webhook_event('line', '01K123456789ABCDEFGHJKMNPQ', $1::bigint, $2, 300) as claimed",
    [nowMs, 'c'.repeat(64)],
  )
  const replayedWebhook = await database.query(
    "select public.claim_webhook_event('line', '01K123456789ABCDEFGHJKMNPQ', $1::bigint, $2, 300) as claimed",
    [nowMs, 'c'.repeat(64)],
  )
  const expiredWebhook = await database.query(
    "select public.claim_webhook_event('discord', '123456789012345678', $1::bigint, $2, 300) as claimed",
    [nowMs - 301_000, 'd'.repeat(64)],
  )
  assert.equal(firstWebhook.rows[0].claimed, true)
  assert.equal(replayedWebhook.rows[0].claimed, false)
  assert.equal(expiredWebhook.rows[0].claimed, false)
  const firstRate = await database.query(
    "select public.consume_assistant_rate_limit('line', $1, 2, 300) as allowed",
    [payerExternalHash],
  )
  const secondRate = await database.query(
    "select public.consume_assistant_rate_limit('line', $1, 2, 300) as allowed",
    [payerExternalHash],
  )
  const limitedRate = await database.query(
    "select public.consume_assistant_rate_limit('line', $1, 2, 300) as allowed",
    [payerExternalHash],
  )
  const providerSeparatedRate = await database.query(
    "select public.consume_assistant_rate_limit('discord', $1, 2, 300) as allowed",
    [payerExternalHash],
  )
  assert.equal(firstRate.rows[0].allowed, true)
  assert.equal(secondRate.rows[0].allowed, true)
  assert.equal(limitedRate.rows[0].allowed, false)
  assert.equal(providerSeparatedRate.rows[0].allowed, true)
  const unlinked = await database.query(
    "select public.unlink_external_account($1, $2, 'line') as removed",
    [shareToken, deviceToken],
  )
  assert.equal(unlinked.rows[0].removed, true)

  await database.query("select set_config('request.jwt.claim.sub', $1, false)", [organizerId])
  const completedBotStatus = await database.query(
    'select public.get_settlement_status_for_bot($1) as state',
    [shareToken],
  )
  assert.equal(completedBotStatus.rows[0].state.completedCount, 1)
  assert.equal(completedBotStatus.rows[0].state.remainingAmount, 0)
  assert.equal(completedBotStatus.rows[0].state.allPaid, true)
  const lifecycleTypes = await database.query(
    `select notification_type from public.notification_jobs
     where notification_type in ('settlement_finalized', 'payment_reminder', 'payment_reported', 'payment_confirmed', 'settlement_completed')
     order by notification_type`,
  )
  assert.deepEqual(
    lifecycleTypes.rows.map((row) => row.notification_type),
    ['payment_confirmed', 'payment_reminder', 'payment_reported', 'settlement_completed', 'settlement_finalized'],
  )
  await database.query('select public.revert_settlement($1, null, $2::uuid)', [shareToken, settlementId])
  const reverted = await database.query('select status::text from public.settlements where id = $1::uuid', [settlementId])
  assert.equal(reverted.rows[0].status, 'reported')

  const guardedUnfinalize = await database.query('select public.unfinalize_event($1::uuid, false) as result', [eventId])
  assert.equal(guardedUnfinalize.rows[0].result.requiresConfirmation, true)
  await database.query('select public.unfinalize_event($1::uuid, true)', [eventId])
  const activeEvent = await database.query('select status::text from public.events where id = $1::uuid', [eventId])
  assert.equal(activeEvent.rows[0].status, 'active')

  await database.query(
    "select public.organizer_queue_notification($1::uuid, 'invite', '{\"message\":\"join\"}'::jsonb, null, null, now(), 'invite:initial')",
    [eventId],
  )
  const jobs = await database.query("select status::text from public.notification_jobs where dedupe_key = 'invite:initial'")
  assert.equal(jobs.rows[0]?.status, 'pending')

  const stateResult = await database.query('select public.get_event_state($1) as state', [shareToken])
  assert.equal(stateResult.rows[0].state.members.length, 6)
  assert.equal(stateResult.rows[0].state.expenses.length, 3)

  const organizerMember = await database.query(
    'select id from public.members where event_id = $1::uuid and is_organizer',
    [eventId],
  )
  const organizerState = await database.query(
    'select public.get_event_state($1, null) as state',
    [shareToken],
  )
  assert.equal(organizerState.rows[0].state.currentMemberId, organizerMember.rows[0].id)

  await database.query("select set_config('request.jwt.claim.sub', '', false)")
  const participantState = await database.query(
    'select public.get_event_state($1, $2) as state',
    [shareToken, deviceToken],
  )
  assert.equal(participantState.rows[0].state.currentMemberId, payer.id)
  const visitorState = await database.query(
    'select public.get_event_state($1, $2) as state',
    [shareToken, 'unknown-device-token-that-is-at-least-thirty-two-characters'],
  )
  assert.equal(visitorState.rows[0].state.currentMemberId, null)

  await database.query("select set_config('request.jwt.claim.sub', $1, false)", [organizerId])
  const rotatedState = await database.query(
    'select public.organizer_regenerate_share_token($1::uuid) as state',
    [eventId],
  )
  const rotatedShareToken = rotatedState.rows[0].state.event.shareToken
  assert.notEqual(rotatedShareToken, shareToken)
  assert.equal(rotatedShareToken.length, 43)
  await assert.rejects(
    database.query('select public.get_event_state($1)', [shareToken]),
    /EVENT_NOT_FOUND/,
  )
  const currentState = await database.query('select public.get_event_state($1) as state', [rotatedShareToken])
  assert.equal(currentState.rows[0].state.event.id, eventId)

  console.log(`Validated ${migrations.length} migrations and the core backend flow.`)
} finally {
  await database.close()
}
