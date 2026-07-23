import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createFourPersonDemoData } from '../data/demo'
import type { Settlement } from './types'
import { generatePairwiseSettlements } from './settlement'

const database = new PGlite()

async function applyMigrations() {
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
  const migrations = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith('.sql'))
    .sort()

  for (const migration of migrations) {
    const source = await readFile(path.join(migrationDirectory, migration), 'utf8')
    const compatibleSource = source.replace(
      /create extension if not exists pgcrypto with schema extensions;\s*/i,
      '',
    )
    await database.exec(compatibleSource)
  }
}

function normalizeSettlement(settlement: Omit<Settlement, 'id' | 'status'>) {
  const normalizeItems = (items: Settlement['charges']) =>
    items
      .map((item) => ({ ...item }))
      .sort((left, right) => left.expenseId.localeCompare(right.expenseId))

  return {
    fromMemberId: settlement.fromMemberId,
    toMemberId: settlement.toMemberId,
    amount: settlement.amount,
    grossAmount: settlement.grossAmount,
    offsetAmount: settlement.offsetAmount,
    charges: normalizeItems(settlement.charges),
    offsets: normalizeItems(settlement.offsets),
  }
}

function normalizeSettlements(
  settlements: Array<Settlement | ReturnType<typeof generatePairwiseSettlements>[number]>,
) {
  return settlements
    .map(normalizeSettlement)
    .sort((left, right) =>
      `${left.fromMemberId}:${left.toMemberId}`.localeCompare(
        `${right.fromMemberId}:${right.toMemberId}`,
      ),
    )
}

beforeAll(async () => {
  await applyMigrations()
}, 30_000)

afterAll(async () => {
  await database.close()
})

describe('TypeScript and Postgres settlement contract', () => {
  it('produces identical pairwise totals and breakdowns for the four-person demo', async () => {
    const demo = createFourPersonDemoData()
    const finalizedExpenses = demo.expenses.filter((expense) => expense.status === 'finalized')
    const organizerUserId = '20000000-0000-0000-0000-000000000001'

    await database.query('insert into auth.users(id) values ($1::uuid)', [organizerUserId])
    await database.query(
      `insert into public.events(
        id, share_token, organizer_user_id, title, event_type, start_date, end_date, capacity
      ) values ($1::uuid, $2, $3::uuid, $4, $5::public.event_type, $6::date, $7::date, $8)`,
      [
        demo.event.id,
        demo.event.shareToken,
        organizerUserId,
        demo.event.title,
        demo.event.eventType,
        demo.event.startDate,
        demo.event.endDate,
        demo.event.capacity,
      ],
    )

    for (const [index, member] of demo.members.entries()) {
      await database.query(
        `insert into public.members(id, event_id, name, is_organizer, created_at)
         values ($1::uuid, $2::uuid, $3, $4, $5::timestamptz)`,
        [
          member.id,
          demo.event.id,
          member.name,
          member.isOrganizer ?? false,
          `2026-07-18T00:00:0${index}.000Z`,
        ],
      )
    }

    for (const expense of finalizedExpenses) {
      await database.query(
        `insert into public.expenses(
          id, event_id, category, title, amount, payer_member_id, split_method,
          status, day_index, created_by_member_id, created_at
        ) values (
          $1::uuid, $2::uuid, $3::public.expense_category, $4, $5, $6::uuid,
          $7::public.split_method, $8::public.expense_status, $9, $10::uuid, $11::timestamptz
        )`,
        [
          expense.id,
          demo.event.id,
          expense.category,
          expense.title,
          expense.amount,
          expense.payerMemberId,
          expense.splitMethod,
          expense.status,
          expense.dayIndex ?? null,
          expense.createdByMemberId,
          expense.createdAt,
        ],
      )

      for (const memberId of expense.targetMemberIds) {
        await database.query(
          `insert into public.expense_targets(expense_id, member_id, fixed_amount)
           values ($1::uuid, $2::uuid, $3)`,
          [expense.id, memberId, expense.fixedAmounts?.[memberId] ?? null],
        )
      }
    }

    await database.query("select set_config('request.jwt.claim.sub', $1, false)", [organizerUserId])
    const result = await database.query<{ state: { settlements: Settlement[] } }>(
      'select public.finalize_event($1::uuid) as state',
      [demo.event.id],
    )

    const expected = generatePairwiseSettlements(demo.members, finalizedExpenses)
    expect(normalizeSettlements(result.rows[0].state.settlements)).toEqual(
      normalizeSettlements(expected),
    )
  })
})
