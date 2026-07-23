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
