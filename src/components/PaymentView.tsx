import { useEffect, useMemo, useState } from 'react'

import type {
  Member,
  PaymentProfile,
  Settlement,
  SettlementPaymentLink,
  WarikanEvent,
} from '../domain/types'
import type {
  ExternalAccountLink,
  ExternalAccountLinkCode,
  IntegrationProvider,
  PaymentState,
} from '../backend/types'
import { validatePayPayId, validatePayPayRequestUrl } from '../lib/validation'
import { EventHeader } from './EventHeader'
import { formatYen, memberDisplayName, SETTLEMENT_STATUS_META } from './ui'

interface PaymentViewProps {
  event: WarikanEvent
  members: Member[]
  currentMemberId: string | null
  settlements: Settlement[]
  paymentState: PaymentState
  loading?: boolean
  loadError?: string
  initialSettlementId?: string | null
  onBack: () => void
  onOpenDashboard: () => void
  onOpenSettlements: () => void
  onOpenSettings: () => void
  onSaveProfile: (profile: Omit<PaymentProfile, 'memberId'>) => void | Promise<void>
  onSaveLink: (settlementId: string, paypayRequestUrl?: string) => void | Promise<void>
  onReportSettlement: (settlementId: string) => void | Promise<void>
  onReportSettlementItems: (settlementId: string, expenseIds: string[]) => void | Promise<void>
  onConfirmSettlement: (settlementId: string) => void | Promise<void>
  onConfirmSettlementItems: (settlementId: string, expenseIds: string[]) => void | Promise<void>
  onRevertSettlement: (settlementId: string) => void | Promise<void>
  onScheduleReminders: () => number | Promise<number>
  externalAccountLinks: ExternalAccountLink[]
  externalAccountLinkingAvailable: boolean
  onCreateExternalAccountLinkCode: (provider: IntegrationProvider) => ExternalAccountLinkCode | Promise<ExternalAccountLinkCode>
  onUnlinkExternalAccount: (provider: IntegrationProvider) => boolean | Promise<boolean>
}

const EXTERNAL_PROVIDER_META: Record<IntegrationProvider, { label: string; command: string }> = {
  line: { label: 'LINE', command: '連携' },
  discord: { label: 'Discord', command: '/link code:' },
}

function ExternalAccountLinking({
  links,
  available,
  onCreateCode,
  onUnlink,
}: {
  links: ExternalAccountLink[]
  available: boolean
  onCreateCode: PaymentViewProps['onCreateExternalAccountLinkCode']
  onUnlink: PaymentViewProps['onUnlinkExternalAccount']
}) {
  const [codes, setCodes] = useState<Partial<Record<IntegrationProvider, ExternalAccountLinkCode>>>({})
  const [busy, setBusy] = useState<IntegrationProvider | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const createCode = async (provider: IntegrationProvider) => {
    setBusy(provider)
    setMessage('')
    setError('')
    try {
      const code = await onCreateCode(provider)
      setCodes((current) => ({ ...current, [provider]: code }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '連携コードを発行できませんでした。')
    } finally {
      setBusy(null)
    }
  }

  const unlink = async (provider: IntegrationProvider) => {
    setBusy(provider)
    setMessage('')
    setError('')
    try {
      await onUnlink(provider)
      setCodes((current) => ({ ...current, [provider]: undefined }))
      setMessage(`${EXTERNAL_PROVIDER_META[provider].label}との連携を解除しました。`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '連携を解除できませんでした。')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="payment-profile-card external-account-card" aria-labelledby="external-account-heading">
      <div>
        <p className="eyebrow">BOTから確認・報告</p>
        <h2 id="external-account-heading">LINE／Discord連携</h2>
        <p>5分間・1回限りのコードで、この参加者と外部アカウントを紐付けます。コード自体や外部ユーザーIDの平文は保存しません。</p>
      </div>
      <div className="external-account-grid">
        {(['line', 'discord'] as const).map((provider) => {
          const meta = EXTERNAL_PROVIDER_META[provider]
          const connected = links.some((link) => link.provider === provider)
          const code = codes[provider]
          return (
            <article key={provider} className="external-account-provider">
              <div className="external-account-provider__heading">
                <strong>{meta.label}</strong>
                <span className={`status-pill ${connected ? 'status-pill--success' : 'status-pill--muted'}`}>
                  {connected ? '連携済み' : '未連携'}
                </span>
              </div>
              {connected ? (
                <button type="button" className="text-button text-button--danger" disabled={busy === provider} onClick={() => void unlink(provider)}>
                  {busy === provider ? '解除中…' : '連携を解除'}
                </button>
              ) : (
                <>
                  <button type="button" className="button button--secondary" disabled={!available || busy === provider} onClick={() => void createCode(provider)}>
                    {busy === provider ? '発行中…' : '連携コードを発行'}
                  </button>
                  {code && (
                    <div className="external-link-code" role="status">
                      <span>5分以内に{meta.label}で入力</span>
                      <strong>{meta.command} {code.code}</strong>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          if (typeof navigator !== 'undefined') void navigator.clipboard?.writeText(code.code)
                        }}
                      >
                        コードをコピー
                      </button>
                    </div>
                  )}
                </>
              )}
            </article>
          )
        })}
        {!available && <p className="external-account-note">BOT連携はクラウドの共有イベントで利用できます。</p>}
        {message && <p className="form-success" role="status">{message}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </section>
  )
}

function PaymentProfileEditor({
  profile,
  disabled,
  onSave,
}: {
  profile?: PaymentProfile
  disabled?: boolean
  onSave: PaymentViewProps['onSaveProfile']
}) {
  const [paypayId, setPaypayId] = useState(profile?.paypayId ?? '')
  const [acceptsCash, setAcceptsCash] = useState(profile?.acceptsCash ?? true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    setPaypayId(profile?.paypayId ?? '')
    setAcceptsCash(profile?.acceptsCash ?? true)
  }, [profile])

  const save = async () => {
    const validation = validatePayPayId(paypayId)
    if (!validation.valid) {
      setError(validation.error ?? 'PayPay IDを確認してください。')
      return
    }
    if (!paypayId.trim() && !acceptsCash) {
      setError('PayPayまたは現金のどちらか1つは受取可能にしてください。')
      return
    }
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await onSave({ paypayId: paypayId.trim() || null, acceptsCash })
      setMessage('受取方法を保存しました。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '受取方法を保存できませんでした。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="payment-profile-card" aria-labelledby="payment-profile-heading">
      <div>
        <p className="eyebrow">受け取るときの設定</p>
        <h2 id="payment-profile-heading">あなたの受取方法</h2>
        <p>支払う相手にだけ必要な情報を表示します。銀行口座やカード情報は入力しないでください。</p>
      </div>
      <div className="payment-profile-card__form">
        <label>
          <span>PayPay ID（任意）</span>
          <input
            value={paypayId}
            onChange={(event) => setPaypayId(event.target.value)}
            placeholder="例: paypay_user"
            autoCapitalize="none"
            autoCorrect="off"
            disabled={disabled || busy}
            aria-invalid={Boolean(error && !validatePayPayId(paypayId).valid)}
          />
        </label>
        <label className="payment-method-checkbox">
          <input
            type="checkbox"
            checked={acceptsCash}
            onChange={(event) => setAcceptsCash(event.target.checked)}
            disabled={disabled || busy}
          />
          <span><strong>現金での受け取りも可能</strong><small>PayPayを使わない相手も精算できます</small></span>
        </label>
        <button type="button" className="button button--secondary" onClick={() => void save()} disabled={disabled || busy}>
          {busy ? '保存中…' : '受取方法を保存'}
        </button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="form-success" role="status">{message}</p>}
    </section>
  )
}

function RequestLinkEditor({
  settlementId,
  existingLink,
  disabled,
  onSave,
}: {
  settlementId: string
  existingLink?: string
  disabled?: boolean
  onSave: PaymentViewProps['onSaveLink']
}) {
  const [value, setValue] = useState(existingLink ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => setValue(existingLink ?? ''), [existingLink])

  const save = async () => {
    const validation = validatePayPayRequestUrl(value)
    if (!validation.valid) {
      setError(validation.error ?? '請求リンクを確認してください。')
      return
    }
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await onSave(settlementId, value.trim() || undefined)
      setMessage(value.trim() ? '請求リンクを保存しました。' : '請求リンクを削除しました。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '請求リンクを保存できませんでした。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="payment-request-link">
      <label>
        <span>この相手用のPayPay請求リンク（任意）</span>
        <input
          type="url"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="https://…paypay.ne.jp/…"
          disabled={disabled || busy}
          aria-invalid={Boolean(error)}
        />
      </label>
      <button type="button" className="button button--outline button--small" onClick={() => void save()} disabled={disabled || busy}>
        {busy ? '保存中…' : value.trim() ? 'リンクを保存' : existingLink ? 'リンクを削除' : '未設定'}
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="form-success" role="status">{message}</p>}
    </div>
  )
}

function PaymentActionCard({
  settlement,
  mode,
  members,
  currentMemberId,
  receiverProfile,
  requestLink,
  highlighted,
  onSaveLink,
  onReport,
  onReportItems,
  onConfirm,
  onConfirmItems,
  onRevert,
}: {
  settlement: Settlement
  mode: 'outgoing' | 'incoming' | 'overview'
  members: Member[]
  currentMemberId: string | null
  receiverProfile?: PaymentProfile
  requestLink?: SettlementPaymentLink
  highlighted?: boolean
  onSaveLink: PaymentViewProps['onSaveLink']
  onReport: () => void | Promise<void>
  onReportItems: (expenseIds: string[]) => void | Promise<void>
  onConfirm: () => void | Promise<void>
  onConfirmItems: (expenseIds: string[]) => void | Promise<void>
  onRevert: () => void | Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copyState, setCopyState] = useState<'idle' | 'amount' | 'paypay' | 'error'>('idle')
  const [paymentMode, setPaymentMode] = useState<'all' | 'events'>('all')
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<string[]>([])
  const payerName = memberDisplayName(members, settlement.fromMemberId, currentMemberId)
  const receiverName = memberDisplayName(members, settlement.toMemberId, currentMemberId)
  const status = SETTLEMENT_STATUS_META[settlement.status]
  const payableItems = settlement.charges.filter((item) => (item.payableAmount ?? item.amount) > 0)
  const pendingItems = payableItems.filter((item) => (item.paymentStatus ?? settlement.status) === 'pending')
  const reportedItems = payableItems.filter((item) => (item.paymentStatus ?? settlement.status) === 'reported')
  const hasItemProgress = payableItems.some((item) => (item.paymentStatus ?? settlement.status) !== 'pending')
  const activeExpenseIds = paymentMode === 'all'
    ? pendingItems.map((item) => item.expenseId)
    : selectedExpenseIds.filter((expenseId) => pendingItems.some((item) => item.expenseId === expenseId))
  const activeAmount = pendingItems
    .filter((item) => activeExpenseIds.includes(item.expenseId))
    .reduce((sum, item) => sum + (item.payableAmount ?? item.amount), 0)

  useEffect(() => {
    setSelectedExpenseIds((current) =>
      current.filter((expenseId) => pendingItems.some((item) => item.expenseId === expenseId)))
  }, [settlement.charges, settlement.status])

  useEffect(() => {
    if (!highlighted) return
    document.getElementById(`payment-settlement-${settlement.id}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })
  }, [highlighted, settlement.id])

  const run = async (action: () => void | Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '精算状態を更新できませんでした。')
    } finally {
      setBusy(false)
    }
  }

  const copy = async (kind: 'amount' | 'paypay', value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopyState(kind)
    } catch {
      setCopyState('error')
    }
    window.setTimeout(() => setCopyState('idle'), 2000)
  }

  return (
    <article
      className={`payment-action-card${highlighted ? ' is-highlighted' : ''}`}
      id={`payment-settlement-${settlement.id}`}
      data-settlement-id={settlement.id}
    >
      <header>
        <div>
          <p>{mode === 'outgoing' ? `${receiverName}へ支払う` : mode === 'incoming' ? `${payerName}から受け取る` : `${payerName} → ${receiverName}`}</p>
          <strong>{formatYen(settlement.amount)}</strong>
        </div>
        <span className={`settlement-status settlement-status--${status.tone}`}>{status.label}</span>
      </header>

      {mode === 'outgoing' && (
        <div className="payment-methods">
          <h4>受取方法</h4>
          {!receiverProfile && !requestLink && <p className="payment-methods__empty">受取方法が未登録です。相手に確認してください。</p>}
          {receiverProfile?.paypayId && (
            <div className="payment-method-row">
              <span><small>PayPay ID</small><strong>{receiverProfile.paypayId}</strong></span>
              <button type="button" className="text-button" onClick={() => void copy('paypay', receiverProfile.paypayId ?? '')}>
                {copyState === 'paypay' ? 'コピー済み' : 'IDをコピー'}
              </button>
            </div>
          )}
          {receiverProfile?.acceptsCash && <p className="payment-method-chip">現金での支払い可</p>}
          {requestLink && validatePayPayRequestUrl(requestLink.paypayRequestUrl).valid && (
            <a className="button button--secondary button--small" href={requestLink.paypayRequestUrl} target="_blank" rel="noopener noreferrer">
              PayPay請求リンクを開く
            </a>
          )}
        </div>
      )}

      <section className="payment-event-breakdown" aria-label="支出イベントごとの支払い">
        <div className="payment-event-breakdown__heading">
          <h4>支出イベントごとの内訳</h4>
          {mode === 'outgoing' && pendingItems.length > 0 && (
            <div className="payment-scope-toggle" role="group" aria-label="支払い範囲">
              <button type="button" className={paymentMode === 'all' ? 'is-active' : ''} aria-pressed={paymentMode === 'all'} onClick={() => setPaymentMode('all')}>相手への全額</button>
              <button type="button" className={paymentMode === 'events' ? 'is-active' : ''} aria-pressed={paymentMode === 'events'} onClick={() => setPaymentMode('events')}>イベントを選ぶ</button>
            </div>
          )}
        </div>
        {mode === 'outgoing' && paymentMode === 'all' && pendingItems.length > 0 && (
          <p className="payment-scope-summary">未払いの{pendingItems.length}件をまとめて {formatYen(activeAmount)}</p>
        )}
        <div className="payment-event-list">
          {payableItems.map((item) => {
            const itemStatus = item.paymentStatus ?? settlement.status
            const statusMeta = SETTLEMENT_STATUS_META[itemStatus]
            const selectable = mode === 'outgoing' && paymentMode === 'events' && itemStatus === 'pending'
            const checked = activeExpenseIds.includes(item.expenseId)
            return (
              <label className={`payment-event-item${selectable ? ' is-selectable' : ''}`} key={item.expenseId}>
                {selectable && (
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => setSelectedExpenseIds((current) =>
                      current.includes(item.expenseId)
                        ? current.filter((expenseId) => expenseId !== item.expenseId)
                        : [...current, item.expenseId])}
                  />
                )}
                <span><strong>{item.expenseTitle}</strong><small>相殺後の支払額</small></span>
                <b>{formatYen(item.payableAmount ?? item.amount)}</b>
                <em className={`settlement-status settlement-status--${statusMeta.tone}`}>{statusMeta.label}</em>
              </label>
            )
          })}
        </div>
        {mode === 'outgoing' && paymentMode === 'events' && pendingItems.length > 0 && (
          <p className="payment-scope-summary">選択 {activeExpenseIds.length}件・{formatYen(activeAmount)}</p>
        )}
      </section>

      <div className="payment-action-card__actions">
        {mode !== 'overview' && (
          <button type="button" className="button button--outline button--small" onClick={() => void copy('amount', String(mode === 'outgoing' && pendingItems.length > 0 ? activeAmount : settlement.amount))} disabled={mode === 'outgoing' && pendingItems.length > 0 && activeExpenseIds.length === 0}>
            {copyState === 'amount' ? '金額をコピー済み' : copyState === 'error' ? 'コピーできませんでした' : '金額をコピー'}
          </button>
        )}
        {mode === 'outgoing' && pendingItems.length > 0 && (
          <button type="button" className="button button--success button--small" disabled={busy || activeExpenseIds.length === 0} onClick={() => void run(() => onReportItems(activeExpenseIds))}>
            {busy ? '更新中…' : paymentMode === 'all' ? '全額の支払いを報告' : `${activeExpenseIds.length}件の支払いを報告`}
          </button>
        )}
        {mode === 'outgoing' && payableItems.length === 0 && settlement.status === 'pending' && (
          <button type="button" className="button button--success button--small" disabled={busy} onClick={() => void run(onReport)}>
            {busy ? '更新中…' : '全額の支払いを報告'}
          </button>
        )}
        {mode === 'incoming' && reportedItems.length > 0 && (
          <button type="button" className="button button--success button--small" disabled={busy} onClick={() => void run(() => onConfirmItems(reportedItems.map((item) => item.expenseId)))}>
            {busy ? '更新中…' : `${reportedItems.length}件の受け取りを確認`}
          </button>
        )}
        {mode === 'incoming' && payableItems.length === 0 && settlement.status === 'reported' && (
          <button type="button" className="button button--success button--small" disabled={busy} onClick={() => void run(onConfirm)}>
            {busy ? '更新中…' : '受け取りを確認'}
          </button>
        )}
        {mode === 'overview' && hasItemProgress && (
          <button type="button" className="text-button" disabled={busy} onClick={() => void run(onRevert)}>
            1段階戻す
          </button>
        )}
      </div>

      {mode === 'incoming' && settlement.status !== 'paid' && (
        <RequestLinkEditor
          settlementId={settlement.id}
          existingLink={requestLink?.paypayRequestUrl}
          disabled={busy}
          onSave={onSaveLink}
        />
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </article>
  )
}

export function PaymentView({
  event,
  members,
  currentMemberId,
  settlements,
  paymentState,
  loading = false,
  loadError,
  initialSettlementId,
  onBack,
  onOpenDashboard,
  onOpenSettlements,
  onOpenSettings,
  onSaveProfile,
  onSaveLink,
  onReportSettlement,
  onReportSettlementItems,
  onConfirmSettlement,
  onConfirmSettlementItems,
  onRevertSettlement,
  onScheduleReminders,
  externalAccountLinks,
  externalAccountLinkingAvailable,
  onCreateExternalAccountLinkCode,
  onUnlinkExternalAccount,
}: PaymentViewProps) {
  const [reminderBusy, setReminderBusy] = useState(false)
  const [reminderMessage, setReminderMessage] = useState('')
  const [reminderError, setReminderError] = useState('')
  const currentMember = members.find((member) => member.id === currentMemberId)
  const organizer = Boolean(currentMember?.isOrganizer)
  const outgoing = settlements.filter((settlement) => settlement.fromMemberId === currentMemberId && settlement.amount > 0)
  const incoming = settlements.filter((settlement) => settlement.toMemberId === currentMemberId && settlement.amount > 0)
  const completedCount = settlements.filter((settlement) => settlement.status === 'paid').length
  const profileMap = useMemo(
    () => new Map(paymentState.profiles.map((profile) => [profile.memberId, profile])),
    [paymentState.profiles],
  )
  const linkMap = useMemo(
    () => new Map(paymentState.links.map((link) => [link.settlementId, link])),
    [paymentState.links],
  )
  const pendingCount = settlements.filter((settlement) => settlement.amount > 0 && settlement.status === 'pending').length

  const scheduleReminders = async () => {
    setReminderBusy(true)
    setReminderMessage('')
    setReminderError('')
    try {
      const count = await onScheduleReminders()
      setReminderMessage(count > 0
        ? `未払いの精算について${count}件の通知を予約しました。`
        : '新しい催促はありません。本日送信済み、または通知先が未設定です。')
    } catch (cause) {
      setReminderError(cause instanceof Error ? cause.message : '催促を予約できませんでした。')
    } finally {
      setReminderBusy(false)
    }
  }

  const renderCards = (items: Settlement[], mode: 'outgoing' | 'incoming' | 'overview') => (
    <div className="payment-action-list">
      {items.map((settlement) => (
        <PaymentActionCard
          key={`${mode}-${settlement.id}`}
          settlement={settlement}
          mode={mode}
          members={members}
          currentMemberId={currentMemberId}
          receiverProfile={profileMap.get(settlement.toMemberId)}
          requestLink={linkMap.get(settlement.id)}
          highlighted={settlement.id === initialSettlementId}
          onSaveLink={onSaveLink}
          onReport={() => onReportSettlement(settlement.id)}
          onReportItems={(expenseIds) => onReportSettlementItems(settlement.id, expenseIds)}
          onConfirm={() => onConfirmSettlement(settlement.id)}
          onConfirmItems={(expenseIds) => onConfirmSettlementItems(settlement.id, expenseIds)}
          onRevert={() => onRevertSettlement(settlement.id)}
        />
      ))}
    </div>
  )

  return (
    <div className="app-shell payment-page">
      <EventHeader
        event={event}
        members={members}
        activeTab="payment"
        onTabChange={(tab) => tab === 'expenses' ? onBack() : tab === 'dashboard' ? onOpenDashboard() : tab === 'settlements' ? onOpenSettlements() : undefined}
        onOpenSettings={organizer ? onOpenSettings : undefined}
      />

      <main className="payment-layout">
        <section className="payment-hero">
          <div>
            <p className="eyebrow">外部で支払い、ここで確認</p>
            <h1>支払い・受け取り</h1>
            <p>アプリ内で送金は行いません。金額と相手を確認して支払い、双方の確認で完了にします。</p>
          </div>
          <div className="payment-progress" aria-label={`完了${completedCount}件、全${settlements.length}件`}>
            <strong>{completedCount}<small> / {settlements.length}</small></strong>
            <span>受取確認済み</span>
          </div>
        </section>

        {loadError && <p className="form-error payment-load-error" role="alert">{loadError}</p>}
        {loading && <p className="payment-loading" role="status">受取方法を読み込んでいます…</p>}

        <PaymentProfileEditor
          profile={profileMap.get(currentMemberId ?? '')}
          disabled={loading || !currentMemberId}
          onSave={onSaveProfile}
        />

        <ExternalAccountLinking
          links={externalAccountLinks}
          available={externalAccountLinkingAvailable}
          onCreateCode={onCreateExternalAccountLinkCode}
          onUnlink={onUnlinkExternalAccount}
        />

        {event.status !== 'finalized' ? (
          <section className="payment-empty-state">
            <strong>精算を確定すると、支払い先と金額が表示されます。</strong>
            <p>受取方法は先に登録しておけます。</p>
            <button type="button" className="button button--secondary" onClick={onOpenSettlements}>精算状況を確認</button>
          </section>
        ) : (
          <>
            <section className="payment-role-section" aria-labelledby="outgoing-payments-heading">
              <div className="section-heading-row">
                <div><p className="eyebrow">あなたの支払い</p><h2 id="outgoing-payments-heading">支払う予定</h2></div>
                <span className="count-label">{outgoing.length}件</span>
              </div>
              {outgoing.length ? renderCards(outgoing, 'outgoing') : <p className="payment-section-empty">あなたから支払う精算はありません。</p>}
            </section>

            <section className="payment-role-section" aria-labelledby="incoming-payments-heading">
              <div className="section-heading-row">
                <div><p className="eyebrow">あなたの受け取り</p><h2 id="incoming-payments-heading">受け取る予定</h2></div>
                <span className="count-label">{incoming.length}件</span>
              </div>
              {incoming.length ? renderCards(incoming, 'incoming') : <p className="payment-section-empty">あなたが受け取る精算はありません。</p>}
            </section>

            {organizer && (
              <section className="payment-role-section payment-organizer-overview" aria-labelledby="all-payment-progress-heading">
                <div className="section-heading-row">
                  <div><p className="eyebrow">幹事用</p><h2 id="all-payment-progress-heading">全員の支払い進捗</h2></div>
                  <span className="count-label">完了 {completedCount} / {settlements.length}</span>
                </div>
                <div className="payment-reminder-actions">
                  <div>
                    <strong>未払いの人だけに催促</strong>
                    <p>同じ精算への通知は1日1回までです。報告済み・受取済みの人には送りません。</p>
                  </div>
                  <button
                    type="button"
                    className="button button--secondary"
                    disabled={reminderBusy || pendingCount === 0}
                    onClick={() => void scheduleReminders()}
                  >
                    {reminderBusy ? '予約中…' : `未払い${pendingCount}件を催促`}
                  </button>
                </div>
                {reminderMessage && <p className="form-success" role="status">{reminderMessage}</p>}
                {reminderError && <p className="form-error" role="alert">{reminderError}</p>}
                {settlements.length ? renderCards(settlements.filter((settlement) => settlement.amount > 0), 'overview') : <p className="payment-section-empty">支払いが必要な精算はありません。</p>}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}
