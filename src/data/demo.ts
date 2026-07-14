import type { Expense, Member, WarikanEvent } from '../domain/types'
import { createRandomId, createShareToken } from '../lib/random'

export interface DemoData {
  event: WarikanEvent
  members: Member[]
  currentMemberId: string
  expenses: Expense[]
}

/**
 * UI reference data for the Hakone trip.
 *
 * IDs intentionally get regenerated so loading the demo behaves like creating
 * a fresh event rather than restoring a shared fixture.
 */
export function createDemoData(): DemoData {
  const memberIds = {
    you: createRandomId(),
    mina: createRandomId(),
    kenta: createRandomId(),
    saki: createRandomId(),
    riku: createRandomId(),
    aoi: createRandomId(),
  }

  const members: Member[] = [
    { id: memberIds.you, name: 'あなた', isOrganizer: true },
    { id: memberIds.mina, name: 'ミナ' },
    { id: memberIds.kenta, name: 'ケンタ' },
    { id: memberIds.saki, name: 'サキ' },
    { id: memberIds.riku, name: 'リク' },
    { id: memberIds.aoi, name: 'アオイ' },
  ]

  const allMemberIds = members.map(({ id }) => id)
  const createdByMemberId = memberIds.you

  const expenses: Expense[] = [
    {
      id: createRandomId(),
      category: 'transport',
      title: 'ロマンスカー往復',
      amount: 13_920,
      payerMemberId: memberIds.mina,
      targetMemberIds: allMemberIds,
      splitMethod: 'equal',
      status: 'finalized',
      dayIndex: 1,
      createdByMemberId,
      createdAt: '2026-03-14T00:30:00.000Z',
    },
    {
      id: createRandomId(),
      category: 'food',
      title: '昼食・そば処',
      amount: 8_400,
      payerMemberId: memberIds.you,
      targetMemberIds: allMemberIds,
      splitMethod: 'equal',
      status: 'finalized',
      dayIndex: 1,
      createdByMemberId,
      createdAt: '2026-03-14T03:15:00.000Z',
    },
    {
      id: createRandomId(),
      category: 'shopping',
      title: 'コンビニ買い出し',
      amount: 2_180,
      payerMemberId: memberIds.saki,
      targetMemberIds: [
        memberIds.you,
        memberIds.mina,
        memberIds.riku,
        memberIds.aoi,
      ],
      splitMethod: 'equal',
      status: 'finalized',
      dayIndex: 1,
      createdByMemberId,
      createdAt: '2026-03-14T09:20:00.000Z',
    },
    {
      id: createRandomId(),
      category: 'lodging',
      title: '温泉旅館(1泊)',
      amount: 66_000,
      payerMemberId: memberIds.kenta,
      targetMemberIds: allMemberIds,
      splitMethod: 'equal',
      status: 'finalized',
      dayIndex: 2,
      createdByMemberId,
      createdAt: '2026-03-15T00:00:00.000Z',
    },
    {
      id: createRandomId(),
      category: 'activity',
      title: '彫刻の森美術館',
      amount: 8_000,
      payerMemberId: memberIds.aoi,
      targetMemberIds: [
        memberIds.you,
        memberIds.mina,
        memberIds.saki,
        memberIds.riku,
        memberIds.aoi,
      ],
      splitMethod: 'equal',
      status: 'finalized',
      dayIndex: 2,
      createdByMemberId,
      createdAt: '2026-03-15T04:00:00.000Z',
    },
  ]

  return {
    event: {
      id: createRandomId(),
      shareToken: createShareToken(),
      title: '箱根旅行',
      eventType: 'overnight',
      startDate: '2026-03-14',
      endDate: '2026-03-15',
      capacity: 6,
      status: 'active',
    },
    members,
    currentMemberId: memberIds.you,
    expenses,
  }
}

/** Four-person, two-night fixture for multi-participant debugging. */
export function createFourPersonDemoData(): DemoData {
  const ids = {
    you: createRandomId(),
    mina: createRandomId(),
    kenta: createRandomId(),
    saki: createRandomId(),
  }
  const members: Member[] = [
    { id: ids.you, name: 'あなた', isOrganizer: true },
    { id: ids.mina, name: 'ミナ' },
    { id: ids.kenta, name: 'ケンタ' },
    { id: ids.saki, name: 'サキ' },
  ]
  const all = members.map((member) => member.id)
  const finalized = 'finalized' as const

  const expenses: Expense[] = [
    {
      id: createRandomId(),
      category: 'transport',
      title: '新幹線・往路',
      amount: 16_000,
      payerMemberId: ids.you,
      targetMemberIds: all,
      splitMethod: 'fixed',
      fixedAmounts: { [ids.you]: 3_000, [ids.mina]: 4_000, [ids.kenta]: 5_000, [ids.saki]: 4_000 },
      status: finalized,
      dayIndex: 1,
      createdByMemberId: ids.you,
      createdAt: '2026-07-18T00:30:00.000Z',
    },
    {
      id: createRandomId(),
      category: 'food',
      title: '初日のランチ',
      amount: 8_800,
      payerMemberId: ids.mina,
      targetMemberIds: all,
      splitMethod: 'fixed',
      fixedAmounts: { [ids.you]: 2_000, [ids.mina]: 1_800, [ids.kenta]: 3_000, [ids.saki]: 2_000 },
      status: finalized,
      dayIndex: 1,
      createdByMemberId: ids.mina,
      createdAt: '2026-07-18T03:00:00.000Z',
    },
    {
      id: createRandomId(),
      category: 'lodging',
      title: 'ホテル2泊分',
      amount: 64_000,
      payerMemberId: ids.kenta,
      targetMemberIds: all,
      splitMethod: 'fixed',
      fixedAmounts: { [ids.you]: 15_000, [ids.mina]: 16_000, [ids.kenta]: 18_000, [ids.saki]: 15_000 },
      status: finalized,
      dayIndex: 1,
      createdByMemberId: ids.kenta,
      createdAt: '2026-07-18T06:00:00.000Z',
    },
    {
      id: createRandomId(),
      category: 'shopping',
      title: '部屋の飲み物とお菓子',
      amount: 7_200,
      payerMemberId: ids.saki,
      targetMemberIds: all,
      splitMethod: 'fixed',
      fixedAmounts: { [ids.you]: 1_800, [ids.mina]: 1_600, [ids.kenta]: 2_200, [ids.saki]: 1_600 },
      status: finalized,
      dayIndex: 1,
      createdByMemberId: ids.saki,
      createdAt: '2026-07-18T09:00:00.000Z',
    },
    {
      id: createRandomId(),
      category: 'activity',
      title: '美術館チケット',
      amount: 9_000,
      payerMemberId: ids.you,
      targetMemberIds: [ids.you, ids.mina, ids.kenta],
      splitMethod: 'fixed',
      fixedAmounts: { [ids.you]: 2_500, [ids.mina]: 3_000, [ids.kenta]: 3_500 },
      status: finalized,
      dayIndex: 2,
      createdByMemberId: ids.you,
      createdAt: '2026-07-19T02:00:00.000Z',
    },
    {
      id: createRandomId(),
      category: 'food',
      title: '2日目の夕食（内訳確認中）',
      amount: 18_400,
      payerMemberId: ids.mina,
      targetMemberIds: all,
      splitMethod: 'fixed',
      fixedAmounts: { [ids.you]: 4_600, [ids.mina]: 4_600 },
      status: 'draft',
      dayIndex: 2,
      createdByMemberId: ids.mina,
      createdAt: '2026-07-19T10:00:00.000Z',
    },
    {
      id: createRandomId(),
      category: 'transport',
      title: 'レンタカー給油',
      amount: 5_600,
      payerMemberId: ids.kenta,
      targetMemberIds: all,
      splitMethod: 'fixed',
      fixedAmounts: { [ids.you]: 1_200, [ids.mina]: 1_400, [ids.kenta]: 1_800, [ids.saki]: 1_200 },
      status: finalized,
      dayIndex: 3,
      createdByMemberId: ids.kenta,
      createdAt: '2026-07-20T01:30:00.000Z',
    },
    {
      id: createRandomId(),
      category: 'food',
      title: '帰りのカフェ',
      amount: 4_800,
      payerMemberId: ids.saki,
      targetMemberIds: [ids.mina, ids.saki],
      splitMethod: 'fixed',
      fixedAmounts: { [ids.mina]: 2_700, [ids.saki]: 2_100 },
      status: finalized,
      dayIndex: 3,
      createdByMemberId: ids.saki,
      createdAt: '2026-07-20T05:00:00.000Z',
    },
  ]

  return {
    event: {
      id: createRandomId(),
      shareToken: createShareToken(),
      title: '4人・2泊3日デバッグ旅行',
      eventType: 'overnight',
      startDate: '2026-07-18',
      endDate: '2026-07-20',
      capacity: 4,
      status: 'active',
    },
    members,
    currentMemberId: ids.you,
    expenses,
  }
}
