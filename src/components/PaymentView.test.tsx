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
  charges: [],
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
  onConfirmSettlement: vi.fn(),
  onRevertSettlement: vi.fn(),
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
    expect(markup).toContain('幹事へ支払う')
    expect(markup).toContain('organizer_1')
    expect(markup).toContain('PayPay請求リンクを開く')
    expect(markup).toContain('支払い完了を報告')
    expect(markup).not.toContain('全員の支払い進捗')
  })

  it('shows a receiver request-link editor and organizer-wide progress', () => {
    const markup = renderToStaticMarkup(
      <PaymentView
        {...callbacks}
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
    expect(markup).toContain('Organizer')
  })
})
