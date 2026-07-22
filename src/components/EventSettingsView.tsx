import { useState, type FormEvent } from 'react'

import type { EventDraft, Expense, Member, WarikanEvent } from '../domain/types'
import { EventHeader } from './EventHeader'
import { memberPillStyle } from './ui'

interface EventSettingsViewProps {
  event: WarikanEvent
  members: Member[]
  expenses: Expense[]
  onSave: (draft: EventDraft) => void
  onAddMember: (name: string) => void
  onRemoveMember: (memberId: string) => void
  onOpenExpenses: () => void
  onOpenDashboard: () => void
  onOpenSettlements: () => void
  onOpenPayment: () => void
  onReset: () => void
}

export function EventSettingsView({
  event,
  members,
  expenses,
  onSave,
  onAddMember,
  onRemoveMember,
  onOpenExpenses,
  onOpenDashboard,
  onOpenSettlements,
  onOpenPayment,
  onReset,
}: EventSettingsViewProps) {
  const [title, setTitle] = useState(event.title)
  const [eventType, setEventType] = useState(event.eventType)
  const [startDate, setStartDate] = useState(event.startDate)
  const [endDate, setEndDate] = useState(event.endDate)
  const [capacity, setCapacity] = useState(event.capacity)
  const [newMemberName, setNewMemberName] = useState('')
  const [message, setMessage] = useState('')
  const [deleteConfirmation, setDeleteConfirmation] = useState('')

  const saveEvent = (submitEvent: FormEvent) => {
    submitEvent.preventDefault()
    if (!title.trim() || !startDate || (eventType === 'overnight' && (!endDate || endDate < startDate))) {
      setMessage('イベント名と正しい日付を入力してください。')
      return
    }
    onSave({ title, eventType, startDate, endDate: eventType === 'single_day' ? startDate : endDate, capacity })
    setMessage('イベント設定を保存しました。')
  }

  const addMember = (submitEvent: FormEvent) => {
    submitEvent.preventDefault()
    const name = newMemberName.trim()
    if (!name) return
    if (members.length >= 50) {
      setMessage('登録できる参加者は最大50人です。')
      return
    }
    if (members.some((member) => member.name === name)) {
      setMessage('同じ名前の参加者がすでにいます。')
      return
    }
    onAddMember(name)
    if (members.length >= capacity) setCapacity(Math.min(50, members.length + 1))
    setNewMemberName('')
    setMessage(`${name}さんを幹事が代理登録しました。`)
  }

  return (
    <div className="app-shell event-settings-page">
      <EventHeader
        event={event}
        members={members}
        activeTab="settings"
        onTabChange={(tab) => tab === 'expenses' ? onOpenExpenses() : tab === 'dashboard' ? onOpenDashboard() : tab === 'payment' ? onOpenPayment() : onOpenSettlements()}
        onOpenSettings={() => undefined}
      />

      <main className="event-settings-layout">
        <div className="event-settings-heading">
          <div><p className="eyebrow">幹事のみ</p><h2>イベント設定</h2></div>
          <p>予定変更や、参加者の代理登録をここで管理できます。</p>
        </div>

        {message && <p className="settings-message" role="status">{message}</p>}

        <div className="event-settings-grid">
          <form className="settings-card event-edit-card" onSubmit={saveEvent}>
            <div className="settings-card__heading"><span aria-hidden="true">日</span><div><h3>イベント内容</h3><p>予定が変わった場合も後から更新できます</p></div></div>

            <label className="field">
              <span className="field__label">イベント名</span>
              <input value={title} onChange={(changeEvent) => setTitle(changeEvent.target.value)} />
            </label>

            <fieldset className="settings-duration">
              <legend>予定タイプ</legend>
              <button type="button" className={eventType === 'single_day' ? 'is-active' : ''} onClick={() => setEventType('single_day')}>終日・日帰り</button>
              <button type="button" className={eventType === 'overnight' ? 'is-active' : ''} onClick={() => setEventType('overnight')}>宿泊</button>
            </fieldset>

            <div className="date-grid">
              <label className="field"><span className="field__label">開始日</span><input type="date" value={startDate} onChange={(changeEvent) => {
                setStartDate(changeEvent.target.value)
                if (endDate < changeEvent.target.value) setEndDate(changeEvent.target.value)
              }} /></label>
              <label className="field"><span className="field__label">終了日</span><input type="date" min={startDate} disabled={eventType === 'single_day'} value={eventType === 'single_day' ? startDate : endDate} onChange={(changeEvent) => setEndDate(changeEvent.target.value)} /></label>
            </div>

            <label className="field settings-capacity"><span className="field__label">定員</span><span><input type="number" min={members.length} max={50} value={capacity} onChange={(changeEvent) => setCapacity(Math.max(members.length, Math.min(50, Number(changeEvent.target.value))))} /><b>人</b></span></label>

            <p className="settings-hint">日程を短くした場合、範囲外になった支出の日付は「未指定」に戻ります。</p>
            <button type="submit" className="button button--primary">変更を保存</button>
          </form>

          <section className="settings-card participant-management" aria-labelledby="participant-management-heading">
            <div className="settings-card__heading"><span aria-hidden="true">人</span><div><h3 id="participant-management-heading">参加者管理</h3><p>{members.length} / {capacity}人が登録済み</p></div></div>

            {event.status === 'finalized' && <p className="settings-lock-note">精算確定中は参加者を変更できません。先に精算確定を解除してください。</p>}

            <div className="settings-member-list">
              {members.map((member, index) => {
                const isReferenced = expenses.some((expense) => expense.payerMemberId === member.id || expense.createdByMemberId === member.id || expense.targetMemberIds.includes(member.id))
                const cannotRemove = Boolean(member.isOrganizer || isReferenced || event.status === 'finalized')
                return (
                  <article key={member.id}>
                    <span className="settings-member-name" style={memberPillStyle(index)}>{member.name}</span>
                    <small>{member.isOrganizer ? '幹事' : isReferenced ? '支出に登録済み' : '幹事が代理登録'}</small>
                    {!member.isOrganizer && <button type="button" disabled={cannotRemove} title={isReferenced ? '支出に関係する参加者は削除できません' : undefined} onClick={() => {
                      onRemoveMember(member.id)
                      setMessage(`${member.name}さんを参加者から削除しました。`)
                    }}>削除</button>}
                  </article>
                )
              })}
            </div>

            <form className="proxy-member-form" onSubmit={addMember}>
              <label className="field"><span className="field__label">幹事が代わりに参加登録</span><input placeholder="参加者の名前" value={newMemberName} disabled={event.status === 'finalized'} onChange={(changeEvent) => setNewMemberName(changeEvent.target.value)} /></label>
              <button type="submit" className="button button--outline" disabled={event.status === 'finalized' || members.length >= 50}>参加者を追加</button>
            </form>

            <div className="claim-link-placeholder">
              <div><strong>本人確認用の招待URL</strong><p>代理登録した人が自分の名前を引き継ぐためのURLです。</p></div>
              <button type="button" disabled>URLを発行（準備中）</button>
            </div>
          </section>
        </div>

        <section className="settings-card event-delete-card" aria-labelledby="event-delete-heading">
          <div className="settings-card__heading">
            <span aria-hidden="true">削</span>
            <div><h3 id="event-delete-heading">イベントを削除</h3><p>この端末からイベントデータを削除して、作成画面へ戻ります</p></div>
          </div>
          <p>削除を確認するため、イベント名「<strong>{event.title}</strong>」を入力してください。</p>
          <label className="field">
            <span className="field__label">イベント名（プロジェクト名）</span>
            <input
              value={deleteConfirmation}
              autoComplete="off"
              placeholder={event.title}
              onChange={(changeEvent) => setDeleteConfirmation(changeEvent.target.value)}
            />
          </label>
          <button
            type="button"
            className="button button--danger"
            disabled={deleteConfirmation !== event.title}
            onClick={onReset}
          >
            イベントを削除
          </button>
        </section>
      </main>
    </div>
  )
}
