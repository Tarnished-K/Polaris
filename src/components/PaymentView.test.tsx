import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { Member, Settlement, WarikanEvent } from '../domain/types'
import { PaymentView } from './PaymentView'

const event: WarikanEvent = {
  id: 'event-a',
  shareToken: 'share-token',
  title: 'Test event',
  eventType: 'single_day',
  startDate: '2026-07-23',
  endDate: '2026-07-23',
  capacity: 3,
  status: 'finalized',
}

const members: Member[] = [
  { id: 'organizer', name: 'Organizer', isOrganizer: true },
  { id: 'payer', name: 'Payer' },
  { id: 'other', name: 'Other' },
]

const settlements: Settlement[] = [{
  id: '10000000-0000-4000-8000-000000000001',
  fromMemberId: 'payer',
  toMemberId: 'organizer',
  amount: 2400,
  grossAmount: 3000,
  offsetAmount: 600,
  charges: [{
    expenseId: 'expense-hotel',
    expenseTitle: 'ホテル2泊分',
    category: 'lodging',
    amount: 3000,
    payableAmount: 2400,
    paymentStatus: 'pending',
    fromMemberId: 'payer',
    toMemberId: 'organizer',
  }],
  offsets: [],
  status: 'pending',
}]

const callbacks = {
  onBack: vi.fn(),
  onOpenDashboard: vi.fn(),
  onOpenSettlements: vi.fn(),
  onOpenSettings: vi.fn(),
  onSaveProfile: vi.fn(),
  onSaveLink: vi.fn(),
  onReportSettlement: vi.fn(),
  onReportSettlementItems: vi.fn(),
  onConfirmSettlement: vi.fn(),
  onConfirmSettlementItems: vi.fn(),
  onRevertSettlement: vi.fn(),
  onScheduleReminders: vi.fn().mockResolvedValue(1),
  externalAccountLinks: [],
  externalAccountLinkingAvailable: true,
  onCreateExternalAccountLinkCode: vi.fn(),
  onUnlinkExternalAccount: vi.fn(),
}

describe('PaymentView', () => {
  it('shows the payer only their outgoing payment actions and registered methods', () => {
    const markup = renderToStaticMarkup(
      <PaymentView
        {...callbacks}
        event={event}
        members={members}
        currentMemberId="payer"
        settlements={settlements}
        paymentState={{
          currentMemberId: 'payer',
          profiles: [{ memberId: 'organizer', paypayId: 'organizer_1', acceptsCash: true }],
          links: [{
            settlementId: settlements[0].id,
            paypayRequestUrl: 'https://paypay.ne.jp/request/example',
          }],
        }}
      />,
    )

    expect(markup).toContain('支払い・受け取り')
    expect(markup).toContain('LINE／Discord連携')
    expect(markup).toContain('連携コードを発行')
    expect(markup).toContain('幹事へ支払う')
    expect(markup).toContain('organizer_1')
    expect(markup).toContain('PayPay請求リンクを開く')
    expect(markup).toContain('相手への全額')
    expect(markup).toContain('イベントを選ぶ')
    expect(markup).toContain('ホテル2泊分')
    expect(markup).toContain('全額の支払いを報告')
    expect(markup).not.toContain('全員の支払い進捗')
  })

  it('shows a receiver request-link editor and organizer-wide progress', () => {
    const markup = renderToStaticMarkup(
      <PaymentView
        {...callbacks}
        externalAccountLinks={[{ provider: 'line', verifiedAt: '2026-07-23T00:00:00Z' }]}
        event={event}
        members={members}
        currentMemberId="organizer"
        settlements={settlements}
        paymentState={{
          currentMemberId: 'organizer',
          profiles: [{ memberId: 'organizer', paypayId: null, acceptsCash: true }],
          links: [],
        }}
      />,
    )

    expect(markup).toContain('Payerから受け取る')
    expect(markup).toContain('この相手用のPayPay請求リンク')
    expect(markup).toContain('全員の支払い進捗')
    expect(markup).toContain('未払い1件を催促')
    expect(markup).toContain('連携済み')
    expect(markup).toContain('連携を解除')
    expect(markup).toContain('Organizer')
  })
})
