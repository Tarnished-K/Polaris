import {
  ASSISTANT_HELP_MESSAGE,
  linkedStatusMessage,
  linkResultMessage,
  normalizeLinkedStatus,
  type AssistantAction,
} from './assistant-actions.ts'
import type { AssistantProvider } from './webhook-security.ts'

type RpcResult = {
  data: unknown
  error: { message?: string } | null
}

export type AssistantRpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>
}

function linkedError(message = ''): string {
  if (message.includes('EXTERNAL_ACCOUNT_NOT_LINKED')) {
    return '先にアプリで連携コードを発行して、このアカウントを参加者と連携してください。'
  }
  return '操作を完了できませんでした。アプリで現在の状態を確認してください。'
}

export async function performAssistantAction(
  client: AssistantRpcClient,
  provider: AssistantProvider,
  externalUserHash: string,
  action: AssistantAction,
): Promise<string> {
  if (action.kind === 'help') return ASSISTANT_HELP_MESSAGE

  if (action.kind === 'link') {
    const { data, error } = await client.rpc('consume_member_link_code', {
      p_code: action.code,
      p_provider: provider,
      p_external_user_hash: externalUserHash,
    })
    return error ? '連携できませんでした。アプリでコードを再発行してください。' : linkResultMessage(data)
  }

  if (action.kind === 'status') {
    const { data, error } = await client.rpc('get_member_settlement_status_for_bot', {
      p_provider: provider,
      p_external_user_hash: externalUserHash,
    })
    if (error) return linkedError(error.message)
    try {
      return linkedStatusMessage(normalizeLinkedStatus(data))
    } catch {
      return '精算状況を読み込めませんでした。'
    }
  }

  const rpcName = action.kind === 'report'
    ? 'report_settlement_for_external_account'
    : 'confirm_settlement_for_external_account'
  const { error } = await client.rpc(rpcName, {
    p_provider: provider,
    p_external_user_hash: externalUserHash,
    p_settlement_id: action.settlementId,
  })
  if (error) return linkedError(error.message)
  return action.kind === 'report'
    ? '支払い完了を報告しました。受取人の確認を待っています。'
    : '受け取りを確認しました。'
}
