import { useEffect, useState, type FormEvent } from 'react'

import type { EventDraft, Expense, Member, WarikanEvent } from '../domain/types'
import type { IntegrationProvider, NotificationIntegration } from '../backend/types'
import { validateDiscordWebhookUrl, validateLineDestination, validateMemberName } from '../lib/validation'
import { INTEGRATION_TEST_MESSAGE } from '../notifications/adapters'
import { EventHeader } from './EventHeader'
import { memberPillStyle } from './ui'

interface EventSettingsViewProps {
  event: WarikanEvent
  members: Member[]
  expenses: Expense[]
  onSave: (draft: EventDraft) => void | Promise<void>
  onAddMember: (name: string) => void | Promise<void>
  onRemoveMember: (memberId: string) => void | Promise<void>
  onRegenerateShareToken?: () => void | Promise<void>
  onListNotificationIntegrations?: () => Promise<NotificationIntegration[]>
  onSaveNotificationIntegration?: (provider: IntegrationProvider, destination: string) => Promise<NotificationIntegration>
  onDeleteNotificationIntegration?: (provider: IntegrationProvider) => Promise<void>
  onQueueTestNotification?: (integrationId: string, message: string) => Promise<string>
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
  onRegenerateShareToken,
  onListNotificationIntegrations,
  onSaveNotificationIntegration,
  onDeleteNotificationIntegration,
  onQueueTestNotification,
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
  const [confirmingShareTokenRotation, setConfirmingShareTokenRotation] = useState(false)
  const [integrations, setIntegrations] = useState<NotificationIntegration[]>([])
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState('')
  const [lineDestination, setLineDestination] = useState('')
  const [integrationBusy, setIntegrationBusy] = useState<IntegrationProvider | null>(null)
  const [testPrompt, setTestPrompt] = useState<NotificationIntegration | null>(null)
  const [busy, setBusy] = useState(false)

  const saveEvent = async (submitEvent: FormEvent) => {
    submitEvent.preventDefault()
    if (!title.trim() || !startDate || (eventType === 'overnight' && (!endDate || endDate < startDate))) {
      setMessage('イベント名と正しい日付を入力してください。')
      return
    }
    setBusy(true)
    try {
      await onSave({ title, eventType, startDate, endDate: eventType === 'single_day' ? startDate : endDate, capacity })
      setMessage('イベント設定を保存しました。')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'イベント設定を保存できませんでした。')
    } finally {
      setBusy(false)
    }
  }

  const addMember = async (submitEvent: FormEvent) => {
    submitEvent.preventDefault()
    const name = newMemberName.trim()
    const validation = validateMemberName(name)
    if (!validation.valid) {
      setMessage(validation.error ?? '参加者名を確認してください。')
      return
    }
    if (members.length >= 50) {
      setMessage('登録できる参加者は最大50人です。')
      return
    }
    if (members.some((member) => member.name === name)) {
      setMessage('同じ名前の参加者がすでにいます。')
      return
    }
    setBusy(true)
    try {
      await onAddMember(name)
      if (members.length >= capacity) setCapacity(Math.min(50, members.length + 1))
      setNewMemberName('')
      setMessage(`${name}さんを幹事が代理登録しました。`)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '参加者を追加できませんでした。')
    } finally {
      setBusy(false)
    }
  }

  const removeMember = async (member: Member) => {
    setBusy(true)
    try {
      await onRemoveMember(member.id)
      setMessage(`${member.name}さんを参加者から削除しました。`)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '参加者を削除できませんでした。')
    } finally {
      setBusy(false)
    }
  }

  const regenerateShareToken = async () => {
    if (!onRegenerateShareToken) return
    setBusy(true)
    try {
      await onRegenerateShareToken()
      setConfirmingShareTokenRotation(false)
      setMessage('共有URLを再発行しました。以前のURLは無効です。新しいURLを参加者へ共有してください。')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '共有URLを再発行できませんでした。')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!onListNotificationIntegrations) return
    let active = true
    void onListNotificationIntegrations()
      .then((items) => { if (active) setIntegrations(items) })
      .catch((cause) => { if (active) setMessage(cause instanceof Error ? cause.message : '通知設定を読み込めませんでした。') })
    return () => { active = false }
  }, [onListNotificationIntegrations])

  const saveIntegration = async (provider: IntegrationProvider) => {
    if (!onSaveNotificationIntegration) return
    const destination = provider === 'discord' ? discordWebhookUrl : lineDestination
    const validation = provider === 'discord'
      ? validateDiscordWebhookUrl(destination)
      : validateLineDestination(destination)
    if (!validation.valid) {
      setMessage(validation.error ?? '通知先を確認してください。')
      return
    }
    setIntegrationBusy(provider)
    try {
      const integration = await onSaveNotificationIntegration(provider, destination)
      setIntegrations((items) => [...items.filter((item) => item.provider !== provider), integration])
      if (provider === 'discord') setDiscordWebhookUrl('')
      else setLineDestination('')
      setTestPrompt(integration)
      setMessage(`${provider === 'discord' ? 'Discord' : 'LINE'}の通知先を安全に保存しました。`)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '通知先を保存できませんでした。')
    } finally {
      setIntegrationBusy(null)
    }
  }

  const deleteIntegration = async (provider: IntegrationProvider) => {
    if (!onDeleteNotificationIntegration) return
    setIntegrationBusy(provider)
    try {
      await onDeleteNotificationIntegration(provider)
      setIntegrations((items) => items.filter((item) => item.provider !== provider))
      setMessage(`${provider === 'discord' ? 'Discord' : 'LINE'}連携を削除しました。`)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '通知連携を削除できませんでした。')
    } finally {
      setIntegrationBusy(null)
    }
  }

  const queueTestNotification = async () => {
    if (!testPrompt || !onQueueTestNotification) return
    setIntegrationBusy(testPrompt.provider)
    try {
      await onQueueTestNotification(testPrompt.id, INTEGRATION_TEST_MESSAGE)
      setMessage('テスト通知を送信キューへ追加しました。')
      setTestPrompt(null)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'テスト通知を追加できませんでした。')
    } finally {
      setIntegrationBusy(null)
    }
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
            <button type="submit" className="button button--primary" disabled={busy}>変更を保存</button>
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
                    {!member.isOrganizer && <button type="button" disabled={cannotRemove || busy} title={isReferenced ? '支出に関係する参加者は削除できません' : undefined} onClick={() => void removeMember(member)}>削除</button>}
                  </article>
                )
              })}
            </div>

            <form className="proxy-member-form" onSubmit={addMember}>
              <label className="field"><span className="field__label">幹事が代わりに参加登録</span><input placeholder="参加者の名前" value={newMemberName} aria-invalid={message.includes('予約されています')} disabled={event.status === 'finalized'} onChange={(changeEvent) => setNewMemberName(changeEvent.target.value)} /></label>
              <button type="submit" className="button button--outline" disabled={busy || event.status === 'finalized' || members.length >= 50}>参加者を追加</button>
            </form>

            <div className="claim-link-placeholder">
              <div><strong>本人確認用の招待URL</strong><p>代理登録した人が自分の名前を引き継ぐためのURLです。</p></div>
              <button type="button" disabled>URLを発行（準備中）</button>
            </div>
          </section>
        </div>

        {onRegenerateShareToken && (
          <section className="settings-card share-link-security-card" aria-labelledby="share-link-security-heading">
            <div className="settings-card__heading">
              <span aria-hidden="true">鍵</span>
              <div><h3 id="share-link-security-heading">共有URLのセキュリティ</h3><p>URLが意図しない相手へ渡った場合に再発行できます</p></div>
            </div>
            <p>再発行すると現在の共有URLは直ちに無効になります。参加者は新しいURLを開き直す必要があります。</p>
            {confirmingShareTokenRotation ? (
              <div className="share-link-security-card__confirmation" role="alert">
                <strong>現在のURLを無効にしますか？</strong>
                <div>
                  <button type="button" className="button button--danger" disabled={busy} onClick={() => void regenerateShareToken()}>{busy ? '再発行中…' : '無効にして再発行'}</button>
                  <button type="button" className="button button--secondary" disabled={busy} onClick={() => setConfirmingShareTokenRotation(false)}>キャンセル</button>
                </div>
              </div>
            ) : (
              <button type="button" className="button button--outline" disabled={busy} onClick={() => setConfirmingShareTokenRotation(true)}>共有URLを再発行</button>
            )}
          </section>
        )}

        {onSaveNotificationIntegration && (
          <section className="settings-card notification-settings-card" aria-labelledby="notification-settings-heading">
            <div className="settings-card__heading">
              <span aria-hidden="true">通</span>
              <div><h3 id="notification-settings-heading">通知設定</h3><p>DiscordまたはLINEへイベント通知を送ります</p></div>
            </div>
            <p className="notification-settings-card__security">DiscordのWebhook URLは暗号化して保存し、保存後は画面へ再表示しません。</p>
            <div className="notification-provider-grid">
              {([
                {
                  provider: 'discord' as const,
                  title: 'Discord',
                  description: 'サーバーのWebhook URLを登録します。',
                  label: 'Discord Webhook URL',
                  placeholder: 'https://discord.com/api/webhooks/…',
                  value: discordWebhookUrl,
                  onChange: setDiscordWebhookUrl,
                },
                {
                  provider: 'line' as const,
                  title: 'LINE',
                  description: 'Messaging APIのUser／Group／Room IDを登録します。',
                  label: 'LINEの送信先ID',
                  placeholder: 'U… / C… / R…',
                  value: lineDestination,
                  onChange: setLineDestination,
                },
              ]).map((item) => {
                const connected = integrations.find((integration) => integration.provider === item.provider)
                return (
                  <article key={item.provider} className="notification-provider-card">
                    <header><div><h4>{item.title}</h4><p>{item.description}</p></div>{connected && <span>接続済み</span>}</header>
                    {connected && <p className="notification-provider-card__destination">{connected.externalSpaceName}</p>}
                    <label className="field">
                      <span className="field__label">{connected ? `${item.label}を変更` : item.label}</span>
                      <input
                        type={item.provider === 'discord' ? 'url' : 'text'}
                        value={item.value}
                        placeholder={item.placeholder}
                        autoComplete="off"
                        onChange={(event) => item.onChange(event.target.value)}
                      />
                    </label>
                    <div className="notification-provider-card__actions">
                      <button type="button" className="button button--outline" disabled={integrationBusy !== null} onClick={() => void saveIntegration(item.provider)}>
                        {integrationBusy === item.provider ? '保存中…' : connected ? '接続先を変更' : '保存'}
                      </button>
                      {connected && (
                        <>
                          <button type="button" className="button button--secondary" disabled={integrationBusy !== null} onClick={() => setTestPrompt(connected)}>テスト通知</button>
                          <button type="button" className="text-button" disabled={integrationBusy !== null} onClick={() => void deleteIntegration(item.provider)}>連携を削除</button>
                        </>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
            {testPrompt && (
              <div className="notification-test-confirmation" role="alert">
                <strong>{testPrompt.provider === 'discord' ? 'Discord' : 'LINE'}へテスト通知を送信しますか？</strong>
                <p>通知ジョブをキューへ追加します。Dispatcherが設定済みの場合は登録先へ届きます。</p>
                <div>
                  <button type="button" className="button button--primary" disabled={integrationBusy !== null} onClick={() => void queueTestNotification()}>送信キューへ追加</button>
                  <button type="button" className="button button--secondary" disabled={integrationBusy !== null} onClick={() => setTestPrompt(null)}>キャンセル</button>
                </div>
              </div>
            )}
          </section>
        )}

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
