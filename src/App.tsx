import { useMemo, useState } from 'react'

import { CreateWizard } from './components/CreateWizard'
import { AdvanceDashboardView } from './components/AdvanceDashboardView'
import { DebugPerspectiveSwitcher } from './components/DebugPerspectiveSwitcher'
import { ExpenseForm, type ExpenseDraftInput } from './components/ExpenseForm'
import { EventSettingsView } from './components/EventSettingsView'
import { HomeView } from './components/HomeView'
import { SettlementView } from './components/SettlementView'
import { TestResetButton } from './components/TestResetButton'
import { useWarikanApp } from './state/useWarikanApp'
import { createWarikanBackend, readSupabaseConfig } from './backend/supabase'
import { useSupabaseAuth } from './backend/useSupabaseAuth'
import type { EventDraft } from './domain/types'

export function App() {
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null)
  const auth = useSupabaseAuth()
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
    currentMemberShare,
    draftExpenseCount,
    view,
    setView,
    setCurrentMember,
    createEvent: createLocalEvent,
    loadRemoteEvent,
    updateEvent,
    addMember,
    removeMember,
    loadDemo,
    loadFourPersonDemo,
    addExpense,
    saveDraftExpense,
    finalizeExpense,
    finalizeEvent,
    unfinalizeEvent,
    resetApp,
  } = useWarikanApp()
  const createEvent = async (draft: EventDraft) => {
    if (!backend) {
      createLocalEvent(draft)
      return
    }
    if (!auth.user) throw new Error('先にGoogleでログインしてください')

    const remote = await backend.createEvent(draft)
    const organizerId = remote.members.find((member) => member.isOrganizer)?.id ?? null
    loadRemoteEvent(remote, organizerId)
    window.history.replaceState(null, '', `/e/${remote.event.shareToken}`)
  }
  const resetToStart = () => {
    setEditingExpenseId(null)
    resetApp()
  }
  const organizer = Boolean(members.find((member) => member.id === currentMemberId)?.isOrganizer)

  if (!event || view === 'create') {
    return (
      <CreateWizard
        onCreate={createEvent}
        onLoadDemo={loadDemo}
        onLoadFourPersonDemo={loadFourPersonDemo}
        cloudConfigured={auth.configured}
        authLoading={auth.loading}
        userEmail={auth.user?.email ?? null}
        onGoogleSignIn={auth.signInWithGoogle}
        onSignOut={auth.signOut}
      />
    )
  }

  const home = (
    <HomeView
      event={event}
      members={members}
      currentMemberId={currentMemberId}
      expenses={expenses}
      totalSpent={totalSpent}
      currentMemberShare={currentMemberShare}
      onAddExpense={() => {
        setEditingExpenseId(null)
        setView('expense')
      }}
      onOpenSettlement={() => setView('settlement')}
      onOpenDashboard={() => setView('dashboard')}
      onOpenSettings={() => setView('settings')}
      onFinalize={finalizeEvent}
      onUnfinalize={unfinalizeEvent}
      onFinalizeDraft={(expenseId) => {
        setEditingExpenseId(expenseId)
        setView('expense')
      }}
      onReset={resetToStart}
    />
  )
  const testResetButton = <TestResetButton onReset={resetToStart} />
  const perspectiveSwitcher = (
    <DebugPerspectiveSwitcher members={members} currentMemberId={currentMemberId} onChange={setCurrentMember} />
  )

  if (view === 'expense') {
    const submitExpense = (input: ExpenseDraftInput) => {
      if (editingExpenseId) {
        finalizeExpense(editingExpenseId, input)
      } else {
        addExpense(input)
      }
      setEditingExpenseId(null)
      setView('home')
    }
    return (
      <>
        <div className="modal-background" inert aria-hidden="true">{home}</div>
        <ExpenseForm
          event={event}
          members={members}
          currentMemberId={currentMemberId}
          initialExpense={expenses.find((expense) => expense.id === editingExpenseId)}
          onClose={() => {
            setEditingExpenseId(null)
            setView('home')
          }}
          onSubmit={submitExpense}
          onSaveDraft={editingExpenseId ? (input) => {
            saveDraftExpense(editingExpenseId, input)
            setEditingExpenseId(null)
            setView('home')
          } : undefined}
        />
        {perspectiveSwitcher}
        {testResetButton}
      </>
    )
  }

  if (view === 'settlement') {
    return (
      <>
      <SettlementView
        event={event}
        members={members}
        currentMemberId={currentMemberId}
        expenses={expenses}
        settlements={displaySettlements}
        totalSpent={totalSpent}
        draftExpenseCount={draftExpenseCount}
        onBack={() => setView('home')}
        onOpenDashboard={() => setView('dashboard')}
        onOpenSettings={() => setView('settings')}
        onFinalize={finalizeEvent}
        onUnfinalize={unfinalizeEvent}
        onReset={resetToStart}
      />
      {testResetButton}
      {perspectiveSwitcher}
      </>
    )
  }

  if (view === 'dashboard') {
    return (
      <>
        <AdvanceDashboardView
          event={event}
          members={members}
          currentMemberId={currentMemberId}
          expenses={expenses}
          onOpenExpenses={() => setView('home')}
          onOpenSettlements={() => setView('settlement')}
          onOpenSettings={() => setView('settings')}
          onReset={resetToStart}
        />
        {perspectiveSwitcher}
        {testResetButton}
      </>
    )
  }

  if (view === 'settings' && organizer) {
    return (
      <>
        <EventSettingsView
          event={event}
          members={members}
          expenses={expenses}
          onSave={updateEvent}
          onAddMember={addMember}
          onRemoveMember={removeMember}
          onOpenExpenses={() => setView('home')}
          onOpenDashboard={() => setView('dashboard')}
          onOpenSettlements={() => setView('settlement')}
          onReset={resetToStart}
        />
        {perspectiveSwitcher}
        {testResetButton}
      </>
    )
  }

  return (
    <>
      {home}
      {perspectiveSwitcher}
      {testResetButton}
    </>
  )
}
