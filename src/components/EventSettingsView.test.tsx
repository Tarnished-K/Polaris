import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { EventSettingsView } from './EventSettingsView'

describe('EventSettingsView notification settings', () => {
  it('shows Discord and LINE controls only when a secure integration backend is available', () => {
    const baseProps = {
      event: {
        id: 'event-a',
        shareToken: 'share-token',
        title: 'Test event',
        eventType: 'single_day' as const,
        startDate: '2026-07-23',
        endDate: '2026-07-23',
        capacity: 4,
        status: 'active' as const,
      },
      members: [{ id: 'organizer', name: 'Organizer', isOrganizer: true }],
      expenses: [],
      onSave: vi.fn(),
      onAddMember: vi.fn(),
      onRemoveMember: vi.fn(),
      onOpenExpenses: vi.fn(),
      onOpenDashboard: vi.fn(),
      onOpenSettlements: vi.fn(),
      onOpenPayment: vi.fn(),
      onReset: vi.fn(),
    }

    const localMarkup = renderToStaticMarkup(<EventSettingsView {...baseProps} />)
    expect(localMarkup).not.toContain('通知設定')

    const cloudMarkup = renderToStaticMarkup(
      <EventSettingsView
        {...baseProps}
        onSaveNotificationIntegration={vi.fn()}
        onListNotificationIntegrations={vi.fn().mockResolvedValue([])}
        onDeleteNotificationIntegration={vi.fn()}
        onQueueTestNotification={vi.fn()}
      />,
    )
    expect(cloudMarkup).toContain('通知設定')
    expect(cloudMarkup).toContain('Discord Webhook URL')
    expect(cloudMarkup).toContain('LINEの送信先ID')
    expect(cloudMarkup).toContain('暗号化して保存')
  })
})

describe('EventSettingsView claim invitations', () => {
  it('offers one-time URLs only for proxy members who have not claimed their identity', () => {
    const markup = renderToStaticMarkup(
      <EventSettingsView
        event={{
          id: 'event-a',
          shareToken: 'share-token',
          title: 'Test event',
          eventType: 'single_day',
          startDate: '2026-07-23',
          endDate: '2026-07-23',
          capacity: 4,
          status: 'active',
        }}
        members={[
          { id: 'organizer', name: 'Organizer', isOrganizer: true, isClaimed: true },
          { id: 'proxy', name: 'Proxy', isClaimed: false },
          { id: 'claimed', name: 'Claimed', isClaimed: true },
        ]}
        expenses={[]}
        onSave={vi.fn()}
        onAddMember={vi.fn()}
        onRemoveMember={vi.fn()}
        onIssueClaimToken={vi.fn()}
        onOpenExpenses={vi.fn()}
        onOpenDashboard={vi.fn()}
        onOpenSettlements={vi.fn()}
        onOpenPayment={vi.fn()}
        onReset={vi.fn()}
      />,
    )

    expect(markup).toContain('7日間・1回限り')
    expect(markup).toContain('代理登録・本人確認待ち')
    expect(markup).toContain('本人確認済み')
    expect(markup).toContain('Proxyさんの本人確認URLを発行してコピー')
    expect(markup).not.toContain('Claimedさんの本人確認URLを発行してコピー')
    expect(markup.match(/発行してコピー/g)).toHaveLength(2)
  })

  it('does not expose cloud-only invitation controls in a local event', () => {
    const markup = renderToStaticMarkup(
      <EventSettingsView
        event={{
          id: 'event-a',
          shareToken: 'share-token',
          title: 'Test event',
          eventType: 'single_day',
          startDate: '2026-07-23',
          endDate: '2026-07-23',
          capacity: 2,
          status: 'active',
        }}
        members={[
          { id: 'organizer', name: 'Organizer', isOrganizer: true },
          { id: 'proxy', name: 'Proxy' },
        ]}
        expenses={[]}
        onSave={vi.fn()}
        onAddMember={vi.fn()}
        onRemoveMember={vi.fn()}
        onOpenExpenses={vi.fn()}
        onOpenDashboard={vi.fn()}
        onOpenSettlements={vi.fn()}
        onOpenPayment={vi.fn()}
        onReset={vi.fn()}
      />,
    )

    expect(markup).not.toContain('本人確認用の招待URL')
    expect(markup).not.toContain('準備中')
  })
})

describe('EventSettingsView event deletion', () => {
  const props = {
    event: {
      id: 'event-a',
      shareToken: 'share-token',
      title: 'Test event',
      eventType: 'single_day' as const,
      startDate: '2026-07-23',
      endDate: '2026-07-23',
      capacity: 2,
      status: 'active' as const,
    },
    members: [{ id: 'organizer', name: 'Organizer', isOrganizer: true }],
    expenses: [],
    onSave: vi.fn(),
    onAddMember: vi.fn(),
    onRemoveMember: vi.fn(),
    onOpenExpenses: vi.fn(),
    onOpenDashboard: vi.fn(),
    onOpenSettlements: vi.fn(),
    onOpenPayment: vi.fn(),
    onReset: vi.fn(),
  }

  it('makes the irreversible cloud deletion scope explicit', () => {
    const markup = renderToStaticMarkup(<EventSettingsView {...props} cloudEvent />)

    expect(markup).toContain('クラウド上の全イベントデータを削除')
    expect(markup).toContain('参加者、支出、精算、PayPay ID、通知設定を含む全データ')
    expect(markup).toContain('クラウドから完全に削除')
    expect(markup).toContain('disabled=""')
  })

  it('describes local reset as device-only', () => {
    const markup = renderToStaticMarkup(<EventSettingsView {...props} />)

    expect(markup).toContain('この端末のイベントデータだけを削除')
    expect(markup).toContain('クラウド上のイベントには影響しません')
    expect(markup).toContain('この端末から削除')
  })
})
