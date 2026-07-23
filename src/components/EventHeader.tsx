import { useMemo, useState } from 'react'
import type { Member, WarikanEvent } from '../domain/types'
import { formatEventDateRange, getDurationLabel, memberPillStyle } from './ui'

export type EventSectionTab = 'expenses' | 'dashboard' | 'settlements' | 'payment'

interface EventHeaderProps {
  event: WarikanEvent
  members: Member[]
  activeTab: EventSectionTab | 'settings'
  onTabChange: (tab: EventSectionTab) => void
  onOpenSettings?: () => void
}

export function EventHeader({ event, members, activeTab, onTabChange, onOpenSettings }: EventHeaderProps) {
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'error'>('idle')
  const shareUrl = useMemo(() => {
    if (typeof window === 'undefined') return `/e/${event.shareToken}`
    return new URL(`/e/${event.shareToken}`, window.location.origin).toString()
  }, [event.shareToken])

  const copyShareUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopyState('done')
      window.setTimeout(() => setCopyState('idle'), 2200)
    } catch {
      setCopyState('error')
      window.setTimeout(() => setCopyState('idle'), 2200)
    }
  }

  return (
    <header className="event-header">
      <div className="event-header__identity">
        <div className="event-brand" aria-hidden="true">割</div>
        <div className="event-heading">
          <div className="event-heading__title-row">
            <h1>{event.title}</h1>
            <span className={`status-pill ${event.status === 'finalized' ? 'status-pill--success' : 'status-pill--warning'}`}>
              {event.status === 'finalized' ? '精算確定' : '集計中'}
            </span>
          </div>
          <p>{formatEventDateRange(event)}<span aria-hidden="true">・</span>{getDurationLabel(event)}</p>
        </div>
      </div>

      <nav className="event-section-tabs" aria-label="イベント内の画面">
        <button type="button" aria-label="支出イベント" data-mobile-label="支出" className={activeTab === 'expenses' ? 'is-active' : ''} onClick={() => onTabChange('expenses')}>支出イベント</button>
        <button type="button" aria-label="立替ダッシュボード" data-mobile-label="立替" className={activeTab === 'dashboard' ? 'is-active' : ''} onClick={() => onTabChange('dashboard')}>立替ダッシュボード</button>
        <button type="button" aria-label="みんなの精算状況" data-mobile-label="精算" className={activeTab === 'settlements' ? 'is-active' : ''} onClick={() => onTabChange('settlements')}>みんなの精算状況</button>
        <button type="button" aria-label="支払い・受け取り" data-mobile-label="支払" className={activeTab === 'payment' ? 'is-active' : ''} onClick={() => onTabChange('payment')}>支払い・受け取り</button>
      </nav>

      <div className="event-header__actions">
        <div className="member-chips" aria-label={`${members.length}人の参加者`}>
          {members.map((member, index) => (
            <span className="member-chip" style={memberPillStyle(index)} key={member.id}>{member.name}{member.isOrganizer && <span className="sr-only">（幹事）</span>}</span>
          ))}
        </div>
        {onOpenSettings && <button type="button" aria-label="イベント設定" className={`header-settings-button ${activeTab === 'settings' ? 'is-active' : ''}`} onClick={onOpenSettings}><span aria-hidden="true">⚙</span><b>イベント設定</b></button>}
        <button type="button" className="share-button" onClick={copyShareUrl}>
          <span aria-hidden="true">⧉</span>
          <b>{copyState === 'done' ? 'コピーしました' : copyState === 'error' ? 'コピーできませんでした' : '共有リンクをコピー'}</b>
        </button>
      </div>
    </header>
  )
}
