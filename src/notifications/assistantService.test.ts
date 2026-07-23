import { describe, expect, it, vi } from 'vitest'

import { performAssistantAction, type AssistantRpcClient } from '../../supabase/functions/_shared/assistant-service'

const hash = 'a'.repeat(64)
const settlementId = '10000000-0000-4000-8000-000000000001'

function client(result: { data: unknown; error: { message?: string } | null }): AssistantRpcClient {
  return { rpc: vi.fn().mockResolvedValue(result) }
}

describe('assistant service', () => {
  it('consumes a one-time link code without sending the raw external ID to Postgres', async () => {
    const rpcClient = client({ data: { linked: true }, error: null })
    await expect(performAssistantAction(rpcClient, 'line', hash, { kind: 'link', code: 'ABCD1234' })).resolves.toContain('連携しました')
    expect(rpcClient.rpc).toHaveBeenCalledWith('consume_member_link_code', {
      p_code: 'ABCD1234',
      p_provider: 'line',
      p_external_user_hash: hash,
    })
  })

  it('returns only linked-member status', async () => {
    const rpcClient = client({
      data: {
        eventStatus: 'finalized',
        pendingCount: 0,
        reportedCount: 0,
        completedCount: 0,
        remainingAmount: 0,
        settlements: [],
      },
      error: null,
    })
    await expect(performAssistantAction(rpcClient, 'discord', hash, { kind: 'status' })).resolves.toContain('あなたの精算')
    expect(rpcClient.rpc).toHaveBeenCalledWith('get_member_settlement_status_for_bot', expect.objectContaining({
      p_external_user_hash: hash,
    }))
  })

  it('does not leak backend errors for unlinked accounts', async () => {
    const rpcClient = client({ data: null, error: { message: 'EXTERNAL_ACCOUNT_NOT_LINKED details' } })
    const message = await performAssistantAction(rpcClient, 'line', hash, { kind: 'status' })
    expect(message).toContain('連携してください')
    expect(message).not.toContain('EXTERNAL_ACCOUNT_NOT_LINKED')
  })

  it('uses actor-scoped external report and confirmation RPCs', async () => {
    const reportClient = client({ data: null, error: null })
    await expect(performAssistantAction(reportClient, 'line', hash, { kind: 'report', settlementId })).resolves.toContain('報告しました')
    expect(reportClient.rpc).toHaveBeenCalledWith('report_settlement_for_external_account', expect.objectContaining({
      p_settlement_id: settlementId,
    }))

    const confirmClient = client({ data: null, error: null })
    await expect(performAssistantAction(confirmClient, 'discord', hash, { kind: 'confirm', settlementId })).resolves.toContain('受け取りを確認')
    expect(confirmClient.rpc).toHaveBeenCalledWith('confirm_settlement_for_external_account', expect.objectContaining({
      p_settlement_id: settlementId,
    }))
  })

  it('returns help without touching the database', async () => {
    const rpcClient = client({ data: null, error: null })
    await expect(performAssistantAction(rpcClient, 'line', hash, { kind: 'help' })).resolves.toContain('連携 ABCD1234')
    expect(rpcClient.rpc).not.toHaveBeenCalled()
  })
})
