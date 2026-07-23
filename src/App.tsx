import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'

import { CreateWizard } from './components/CreateWizard'
const AdvanceDashboardView = lazy(() => import('./components/AdvanceDashboardView').then(({ AdvanceDashboardView }) => ({ default: AdvanceDashboardView })))
import { DebugPerspectiveSwitcher } from './components/DebugPerspectiveSwitcher'
import { ExpenseForm, type ExpenseDraftInput } from './components/ExpenseForm'
const EventSettingsView = lazy(() => import('./components/EventSettingsView').then(({ EventSettingsView }) => ({ default: EventSettingsView })))
import { HomeView } from './components/HomeView'
const SettlementView = lazy(() => import('./components/SettlementView').then(({ SettlementView }) => ({ default: SettlementView })))
import { SharedEventEntry } from './components/SharedEventEntry'
import { useWarikanApp } from './state/useWarikanApp'
import {
  enqueuePendingExpense,
  flushPendingExpenses,
  pendingExpensesForEvent,
  removePendingExpense,
  retryPendingExpense,
  type PendingExpense,
} from './state/pendingExpenseQueue'
import { useOnlineStatus } from './state/useOnlineStatus'
import { createWarikanBackend, readSupabaseConfig } from './backend/supabase'
import {
  getOrCreateEventSession,
  parseSharedEventRoute,
  saveEventMember,
} from './backend/sharedEventSession'
import { useSupabaseAuth } from './backend/useSupabaseAuth'
import type { AddExpenseInput, EventState, UnfinalizeEventResult } from './backend/types'
import type { EventDraft } from './domain/types'

export function App() {
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null)
  const sharedRoute = useMemo(
    () => typeof window === 'undefined' ? null : parseSharedEventRoute(window.location.pathname, window.location.search),
    [],
  )
  const [sharedEntry, setSharedEntry] = useState<{
    phase: 'loading' | 'join' | 'ready' | 'error'
    remote?: EventState
    error?: string
  }>(() => ({ phase: sharedRoute ? 'loading' : 'ready' }))
  const [sharedLoadAttempt, setSharedLoadAttempt] = useState(0)
  const [cloudEvent, setCloudEvent] = useState(Boolean(sharedRoute))
  const [queuedExpenses, setQueuedExpenses] = useState<PendingExpense[]>([])
  const [flushRevision, setFlushRevision] = useState(0)
  const loadedAttempt = useRef<number | null>(null)
  const flushingPending = useRef(false)
  const auth = useSupabaseAuth()
  const isOnline = useOnlineStatus()
  const backend = useMemo(() => {
    const config = readSupabaseConfig()
    return config ? createWarikanBackend(config) : null
  }, [])
  const {
    event,
    members,
    currentMemberId,
    expenses,
    displaySettlements,
    totalSpent,
    draftExpenseCount,
    view,
    setView,
    setCurrentMember,
    createEvent: createLocalEvent,
    loadRemoteEvent,
    updateEvent,
    addMember,
    removeMember,
    loadDemo: loadLocalDemo,
    loadFourPersonDemo: loadLocalFourPersonDemo,
    addExpense: addLocalExpense,
    updateExpense: updateLocalExpense,
    saveDraftExpense: saveLocalDraftExpense,
    finalizeExpense: finalizeLocalExpense,
    deleteExpense: deleteLocalExpense,
    finalizeEvent: finalizeLocalEvent,
    unfinalizeEvent: unfinalizeLocalEvent,
    reportSettlement: reportLocalSettlement,
    confirmSettlement: confirmLocalSettlement,
    revertSettlement: revertLocalSettlement,
    resetApp,
  } = useWarikanApp()
  const organizer = Boolean(members.find((member) => member.id === currentMemberId)?.isOrganizer)
  const lazyViewFallback = <main className="app-loading" aria-live="polite">画面を読み込んでいます…</main>

  useEffect(() => {
    if (!sharedRoute || auth.loading || loadedAttempt.current === sharedLoadAttempt) return
    loadedAttempt.current = sharedLoadAttempt

    if (!backend) {
      setSharedEntry({ phase: 'error', error: 'クラウド接続が設定されていません。' })
      return
    }

    setCloudEvent(true)
    setSharedEntry({ phase: 'loading' })
    const session = getOrCreateEventSession(window.localStorage, sharedRoute.shareToken)

    const load = async () => {
      try {
        if (sharedRoute.claimToken) {
          const claimed = await backend.claimMember(
            sharedRoute.shareToken,
            sharedRoute.claimToken,
            session.deviceToken,
          )
          saveEventMember(window.localStorage, sharedRoute.shareToken, claimed.memberId)
          loadRemoteEvent(claimed.state, claimed.memberId)
          window.history.replaceState(null, '', `/e/${sharedRoute.shareToken}`)
          setSharedEntry({ phase: 'ready' })
          return
        }

        const remote = await backend.getEventState(sharedRoute.shareToken, session.deviceToken)
        const currentMemberId = remote.currentMemberId ?? null
        if (currentMemberId) {
          saveEventMember(window.localStorage, sharedRoute.shareToken, currentMemberId)
          loadRemoteEvent(remote, currentMemberId)
          setSharedEntry({ phase: 'ready' })
        } else {
          loadRemoteEvent(remote, null)
          setSharedEntry({ phase: 'join', remote })
        }
      } catch (cause) {
        setSharedEntry({
          phase: 'error',
          error: cause instanceof Error ? cause.message : '共有イベントを読み込めませんでした。',
        })
      }
    }

    void load()
  }, [auth.loading, backend, loadRemoteEvent, sharedLoadAttempt, sharedRoute])

  const joinSharedEvent = async (name: string) => {
    if (!backend || !sharedRoute) return
    const session = getOrCreateEventSession(window.localStorage, sharedRoute.shareToken)
    const joined = await backend.joinEvent(sharedRoute.shareToken, session.deviceToken, name)
    saveEventMember(window.localStorage, sharedRoute.shareToken, joined.memberId)
    loadRemoteEvent(joined.state, joined.memberId)
    setSharedEntry({ phase: 'ready' })
    void backend.broadcastEventChange(sharedRoute.shareToken)
  }
  const createEvent = async (draft: EventDraft) => {
    if (!backend) {
      setCloudEvent(false)
      createLocalEvent(draft)
      return
    }
    if (!auth.user) throw new Error('先にGoogleでログインしてください')

    const remote = await backend.createEvent(draft)
    const organizerId = remote.members.find((member) => member.isOrganizer)?.id ?? null
    setCloudEvent(true)
    loadRemoteEvent(remote, organizerId)
    window.history.replaceState(null, '', `/e/${remote.event.shareToken}`)
  }
  const resetToStart = () => {
    setEditingExpenseId(null)
    setCloudEvent(false)
    resetApp()
  }

  useEffect(() => {
    if (!cloudEvent || !backend || !event || sharedEntry.phase !== 'ready') return

    const deviceToken = organizer
      ? undefined
      : getOrCreateEventSession(window.localStorage, event.shareToken).deviceToken
    let disposed = false
    let refreshing = false
    let refreshQueued = false

    const refresh = async () => {
      if (refreshing) {
        refreshQueued = true
        return
      }
      refreshing = true
      try {
        const remote = await backend.getEventState(event.shareToken, deviceToken)
        if (!disposed) {
          loadRemoteEvent(remote, remote.currentMemberId ?? currentMemberId)
          setView(view)
        }
      } catch (cause) {
        if (!disposed) console.warn('Realtime更新の再取得に失敗しました。', cause)
      } finally {
        refreshing = false
        if (refreshQueued && !disposed) {
          refreshQueued = false
          void refresh()
        }
      }
    }

    return backend.subscribeToEventChanges(event.shareToken, () => {
      void refresh()
    })
  }, [backend, cloudEvent, currentMemberId, event, loadRemoteEvent, organizer, setView, sharedEntry.phase, view])

  useEffect(() => {
    if (!event || !cloudEvent) {
      setQueuedExpenses([])
      return
    }
    setQueuedExpenses(pendingExpensesForEvent(window.localStorage, event.shareToken))
  }, [cloudEvent, event])

  useEffect(() => {
    if (!isOnline || !cloudEvent || !backend || !event || sharedEntry.phase !== 'ready' || flushingPending.current) return
    const deviceToken = organizer ? '' : getOrCreateEventSession(window.localStorage, event.shareToken).deviceToken
    let mounted = true
    const flush = async () => {
      flushingPending.current = true
      const sent = await flushPendingExpenses({
        storage: window.localStorage,
        shareToken: event.shareToken,
        send: async (pending) => {
          await backend.addExpense({ ...pending.input, shareToken: event.shareToken, deviceToken })
        },
        onChange: (items) => {
          if (mounted) setQueuedExpenses(items)
        },
      })
      if (sent > 0) {
        await backend.broadcastEventChange(event.shareToken)
        const remote = await backend.getEventState(event.shareToken, deviceToken || undefined)
        if (mounted) loadRemoteEvent(remote, remote.currentMemberId ?? currentMemberId)
      }
      flushingPending.current = false
    }
    void flush().catch((cause) => {
      flushingPending.current = false
      console.warn('オフライン支出の再送処理に失敗しました。', cause)
    })
    return () => { mounted = false }
  }, [backend, cloudEvent, currentMemberId, event, flushRevision, isOnline, loadRemoteEvent, organizer, sharedEntry.phase])

  if (sharedRoute && sharedEntry.phase !== 'ready') {
    return (
      <SharedEventEntry
        loading={sharedEntry.phase === 'loading'}
        state={sharedEntry.remote}
        error={sharedEntry.error}
        onJoin={sharedEntry.phase === 'join' ? joinSharedEvent : undefined}
        onRetry={sharedEntry.phase === 'error' ? () => {
          loadedAttempt.current = null
          setSharedLoadAttempt((attempt) => attempt + 1)
        } : undefined}
      />
    )
  }

  if (!event || view === 'create') {
    return (
      <CreateWizard
        onCreate={createEvent}
        onLoadDemo={() => {
          setCloudEvent(false)
          loadLocalDemo()
        }}
        onLoadFourPersonDemo={() => {
          setCloudEvent(false)
          loadLocalFourPersonDemo()
        }}
        cloudConfigured={auth.configured}
        authLoading={auth.loading}
        userEmail={auth.user?.email ?? null}
        onGoogleSignIn={auth.signInWithGoogle}
        onSignOut={auth.signOut}
      />
    )
  }

  const eventDeviceToken = !cloudEvent || organizer
    ? undefined
    : getOrCreateEventSession(window.localStorage, event.shareToken).deviceToken
  const refreshRemoteEvent = async (nextView = view) => {
    if (!backend) return
    const remote = await backend.getEventState(event.shareToken, eventDeviceToken)
    loadRemoteEvent(remote, remote.currentMemberId ?? currentMemberId)
    setView(nextView)
  }
  const finalizeEvent = async () => {
    if (cloudEvent && backend) {
      const remote = await backend.finalizeEvent(event.id)
      loadRemoteEvent(remote, remote.currentMemberId ?? currentMemberId)
      setView(view)
      await backend.broadcastEventChange(event.shareToken)
    } else {
      finalizeLocalEvent()
    }
  }
  const unfinalizeEvent = async (force = false): Promise<void | UnfinalizeEventResult> => {
    if (cloudEvent && backend) {
      const result = await backend.unfinalizeEvent(event.id, force)
      if (result.state) {
        loadRemoteEvent(result.state, result.state.currentMemberId ?? currentMemberId)
        setView(view)
        await backend.broadcastEventChange(event.shareToken)
      }
      return result
    }
    unfinalizeLocalEvent()
    return { requiresConfirmation: false }
  }
  const reportSettlement = async (settlementId: string) => {
    if (cloudEvent && backend) {
      await backend.reportSettlement(event.shareToken, eventDeviceToken, settlementId)
      await backend.broadcastEventChange(event.shareToken)
      await refreshRemoteEvent()
    } else reportLocalSettlement(settlementId)
  }
  const confirmSettlement = async (settlementId: string) => {
    if (cloudEvent && backend) {
      await backend.confirmSettlement(event.shareToken, eventDeviceToken, settlementId)
      await backend.broadcastEventChange(event.shareToken)
      await refreshRemoteEvent()
    } else confirmLocalSettlement(settlementId)
  }
  const revertSettlement = async (settlementId: string) => {
    if (cloudEvent && backend) {
      await backend.revertSettlement(event.shareToken, eventDeviceToken, settlementId)
      await backend.broadcastEventChange(event.shareToken)
      await refreshRemoteEvent()
    } else revertLocalSettlement(settlementId)
  }
  const saveEventSettings = async (draft: EventDraft) => {
    if (cloudEvent && backend) {
      const remote = await backend.organizerUpdateEvent(event.id, draft)
      loadRemoteEvent(remote, remote.currentMemberId ?? currentMemberId)
      setView('settings')
      await backend.broadcastEventChange(event.shareToken)
    } else updateEvent(draft)
  }
  const addEventMember = async (name: string) => {
    if (cloudEvent && backend) {
      await backend.organizerAddMember(event.id, name)
      await backend.broadcastEventChange(event.shareToken)
      await refreshRemoteEvent('settings')
    } else addMember(name)
  }
  const removeEventMember = async (memberId: string) => {
    if (cloudEvent && backend) {
      await backend.organizerRemoveMember(event.id, memberId)
      await backend.broadcastEventChange(event.shareToken)
      await refreshRemoteEvent('settings')
    } else removeMember(memberId)
  }
  const regenerateShareToken = cloudEvent && backend ? async () => {
    const previousShareToken = event.shareToken
    const remote = await backend.organizerRegenerateShareToken(event.id)
    const nextShareToken = remote.event.shareToken
    loadRemoteEvent(remote, remote.currentMemberId ?? currentMemberId)
    if (window.location.pathname === `/e/${previousShareToken}`) {
      window.history.replaceState(null, '', `/e/${nextShareToken}`)
    }
    await backend.broadcastEventChange(previousShareToken)
  } : undefined

  const home = (
    <HomeView
      event={event}
      members={members}
      currentMemberId={currentMemberId}
      expenses={expenses}
      totalSpent={totalSpent}
      onAddExpense={() => {
        setEditingExpenseId(null)
        setView('expense')
      }}
      onOpenSettlement={() => setView('settlement')}
      onOpenPayment={() => setView('payment')}
      onOpenDashboard={() => setView('dashboard')}
      onOpenSettings={() => setView('settings')}
      onEditExpense={(expenseId) => {
        setEditingExpenseId(expenseId)
        setView('expense')
      }}
      pendingExpenses={queuedExpenses}
      onRetryPendingExpense={(pendingId) => {
        retryPendingExpense(window.localStorage, pendingId)
        setQueuedExpenses(pendingExpensesForEvent(window.localStorage, event.shareToken))
        setFlushRevision((revision) => revision + 1)
      }}
      onRemovePendingExpense={(pendingId) => {
        removePendingExpense(window.localStorage, pendingId)
        setQueuedExpenses(pendingExpensesForEvent(window.localStorage, event.shareToken))
      }}
    />
  )
  const perspectiveSwitcher = (
    <DebugPerspectiveSwitcher members={members} currentMemberId={currentMemberId} onChange={setCurrentMember} onReset={resetToStart} />
  )

  if (view === 'expense') {
    const editingExpense = expenses.find((expense) => expense.id === editingExpenseId)
    const deviceToken = eventDeviceToken ?? ''
    const remoteExpenseInput = (input: ExpenseDraftInput): AddExpenseInput => ({
      shareToken: event.shareToken,
      deviceToken,
      category: input.category,
      title: input.title,
      amount: input.amount,
      payerMemberId: input.payerMemberId,
      splitMethod: input.splitMethod,
      dayIndex: input.dayIndex,
      targets: input.targetMemberIds.map((memberId) => ({
        memberId,
        fixedAmount: input.fixedAmounts?.[memberId],
      })),
    })
    const inputMatchesExpense = (input: ExpenseDraftInput) => Boolean(
      editingExpense &&
      editingExpense.category === input.category &&
      editingExpense.title === input.title &&
      editingExpense.amount === input.amount &&
      editingExpense.payerMemberId === input.payerMemberId &&
      editingExpense.splitMethod === input.splitMethod &&
      editingExpense.dayIndex === input.dayIndex &&
      editingExpense.targetMemberIds.length === input.targetMemberIds.length &&
      editingExpense.targetMemberIds.every((id) => input.targetMemberIds.includes(id)) &&
      editingExpense.targetMemberIds.every((id) => editingExpense.fixedAmounts?.[id] === input.fixedAmounts?.[id])
    )
    const submitExpense = async (input: ExpenseDraftInput) => {
      if (cloudEvent && backend) {
        if (!isOnline) {
          if (editingExpenseId) throw new Error('オフライン中は既存支出を編集できません。オンライン復帰後にお試しください。')
          const { shareToken: _shareToken, deviceToken: _deviceToken, ...queuedInput } = remoteExpenseInput(input)
          enqueuePendingExpense(window.localStorage, event.shareToken, queuedInput)
          setQueuedExpenses(pendingExpensesForEvent(window.localStorage, event.shareToken))
          setEditingExpenseId(null)
          setView('home')
          return
        }
        if (editingExpenseId) {
          if (editingExpense?.status === 'draft' && inputMatchesExpense(input)) {
            await backend.finalizeExpense(event.shareToken, deviceToken || undefined, editingExpenseId)
          } else {
            await backend.updateExpense({ ...remoteExpenseInput(input), expenseId: editingExpenseId })
          }
        } else {
          await backend.addExpense(remoteExpenseInput(input))
        }
        await backend.broadcastEventChange(event.shareToken)
        await refreshRemoteEvent()
      } else if (editingExpenseId) {
        if (editingExpense?.status === 'draft') finalizeLocalExpense(editingExpenseId, input)
        else updateLocalExpense(editingExpenseId, input)
      } else {
        addLocalExpense(input)
      }
      setEditingExpenseId(null)
      setView('home')
    }
    const saveDraft = editingExpenseId ? async (input: ExpenseDraftInput) => {
      if (cloudEvent && backend && editingExpense) {
        if (!organizer && editingExpense.payerMemberId !== currentMemberId) {
          await backend.saveOwnFixedAmount(
            event.shareToken,
            deviceToken,
            editingExpenseId,
            currentMemberId ? input.fixedAmounts?.[currentMemberId] : undefined,
          )
        } else {
          await backend.updateExpense({ ...remoteExpenseInput(input), expenseId: editingExpenseId })
        }
        await backend.broadcastEventChange(event.shareToken)
        await refreshRemoteEvent()
      } else {
        saveLocalDraftExpense(editingExpenseId, input)
      }
      setEditingExpenseId(null)
      setView('home')
    } : undefined
    const deleteExpense = editingExpenseId ? async () => {
      if (cloudEvent && backend) {
        await backend.deleteExpense(event.shareToken, deviceToken || undefined, editingExpenseId)
        await backend.broadcastEventChange(event.shareToken)
        await refreshRemoteEvent()
      } else {
        deleteLocalExpense(editingExpenseId)
      }
      setEditingExpenseId(null)
      setView('home')
    } : undefined
    return (
      <>
        <div className="modal-background" inert aria-hidden="true">{home}</div>
        <ExpenseForm
          event={event}
          members={members}
          currentMemberId={currentMemberId}
          initialExpense={editingExpense}
          offline={cloudEvent && !isOnline}
          onClose={() => {
            setEditingExpenseId(null)
            setView('home')
          }}
          onSubmit={submitExpense}
          onSaveDraft={editingExpense?.status === 'draft' ? saveDraft : undefined}
          onDelete={editingExpense && (organizer || editingExpense.payerMemberId === currentMemberId) ? deleteExpense : undefined}
        />
        {perspectiveSwitcher}
      </>
    )
  }

  if (view === 'settlement' || view === 'payment') {
    return (
      <>
      <Suspense fallback={lazyViewFallback}><SettlementView
        event={event}
        members={members}
        currentMemberId={currentMemberId}
        expenses={expenses}
        settlements={displaySettlements}
        draftExpenseCount={draftExpenseCount}
        activeTab={view === 'payment' ? 'payment' : 'settlements'}
        onBack={() => setView('home')}
        onOpenDashboard={() => setView('dashboard')}
        onOpenSettlements={() => setView('settlement')}
        onOpenPayment={() => setView('payment')}
        onOpenSettings={() => setView('settings')}
        onFinalize={finalizeEvent}
        onUnfinalize={unfinalizeEvent}
        onReportSettlement={reportSettlement}
        onConfirmSettlement={confirmSettlement}
        onRevertSettlement={revertSettlement}
      /></Suspense>
      {perspectiveSwitcher}
      </>
    )
  }

  if (view === 'dashboard') {
    return (
      <>
        <Suspense fallback={lazyViewFallback}><AdvanceDashboardView
          event={event}
          members={members}
          currentMemberId={currentMemberId}
          expenses={expenses}
          settlements={displaySettlements}
          onOpenExpenses={() => setView('home')}
          onOpenSettlements={() => setView('settlement')}
          onOpenPayment={() => setView('payment')}
          onOpenSettings={() => setView('settings')}
        /></Suspense>
        {perspectiveSwitcher}
      </>
    )
  }

  if (view === 'settings' && organizer) {
    return (
      <>
        <Suspense fallback={<main className="app-loading" aria-live="polite">設定画面を読み込んでいます…</main>}>
          <EventSettingsView
            event={event}
            members={members}
            expenses={expenses}
            onSave={saveEventSettings}
            onAddMember={addEventMember}
            onRemoveMember={removeEventMember}
            onRegenerateShareToken={regenerateShareToken}
            onListNotificationIntegrations={cloudEvent && backend ? () => backend.listNotificationIntegrations(event.id) : undefined}
            onSaveNotificationIntegration={cloudEvent && backend ? (provider, destination) => backend.saveNotificationIntegration(event.id, provider, destination) : undefined}
            onDeleteNotificationIntegration={cloudEvent && backend ? (provider) => backend.deleteNotificationIntegration(event.id, provider) : undefined}
            onQueueTestNotification={cloudEvent && backend ? (integrationId, message) => backend.queueTestNotification(event.id, integrationId, message) : undefined}
            onOpenExpenses={() => setView('home')}
            onOpenDashboard={() => setView('dashboard')}
            onOpenSettlements={() => setView('settlement')}
            onOpenPayment={() => setView('payment')}
            onReset={resetToStart}
          />
        </Suspense>
        {perspectiveSwitcher}
      </>
    )
  }

  return (
    <>
      {home}
      {perspectiveSwitcher}
    </>
  )
}
