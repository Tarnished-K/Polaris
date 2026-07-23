import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_HELP_MESSAGE,
  linkedStatusMessage,
  linkResultMessage,
  normalizeLinkedStatus,
  parseDiscordAction,
  parsePostbackAction,
  parseTextAction,
} from '../../supabase/functions/_shared/assistant-actions'

const settlementId = '10000000-0000-4000-8000-000000000001'

describe('assistant actions', () => {
  it('parses short-lived link codes in Japanese and English', () => {
    expect(parseTextAction('連携 abcd1234')).toEqual({ kind: 'link', code: 'ABCD1234' })
    expect(parseTextAction('link ABCD1234')).toEqual({ kind: 'link', code: 'ABCD1234' })
    expect(parseTextAction('link 123')).toEqual({ kind: 'help' })
  })

  it('parses read-only status commands without fuzzy personal names', () => {
    expect(parseTextAction('状況')).toEqual({ kind: 'status' })
    expect(parseTextAction('精算状況')).toEqual({ kind: 'status' })
    expect(parseTextAction('status')).toEqual({ kind: 'status' })
    expect(parseTextAction('山田の状況')).toEqual({ kind: 'help' })
  })

  it('accepts only opaque settlement IDs in postbacks', () => {
    expect(parsePostbackAction(`action=report&settlement=${settlementId}`)).toEqual({ kind: 'report', settlementId })
    expect(parsePostbackAction(`action=confirm&settlement=${settlementId}`)).toEqual({ kind: 'confirm', settlementId })
    expect(parsePostbackAction('action=report&settlement=person-name')).toEqual({ kind: 'help' })
  })

  it('parses Discord slash-command options', () => {
    expect(parseDiscordAction({ data: { name: 'link', options: [{ name: 'code', value: 'ABCD1234' }] } })).toEqual({ kind: 'link', code: 'ABCD1234' })
    expect(parseDiscordAction({ data: { name: 'status' } })).toEqual({ kind: 'status' })
    expect(parseDiscordAction({ data: { name: 'report', options: [{ name: 'settlement', value: settlementId }] } })).toEqual({ kind: 'report', settlementId })
    expect(parseDiscordAction({ data: { name: 'confirm', options: [{ name: 'settlement', value: settlementId }] } })).toEqual({ kind: 'confirm', settlementId })
  })

  it('rejects unknown or malformed Discord commands', () => {
    expect(parseDiscordAction(null)).toEqual({ kind: 'help' })
    expect(parseDiscordAction({ data: { name: 'admin' } })).toEqual({ kind: 'help' })
    expect(parseDiscordAction({ data: { name: 'report', options: [] } })).toEqual({ kind: 'help' })
  })

  it('normalizes linked status and drops malformed settlements', () => {
    const status = normalizeLinkedStatus({
      eventStatus: 'finalized',
      pendingCount: 1,
      reportedCount: 0,
      completedCount: 2,
      remainingAmount: 2400,
      settlements: [
        {
          settlementId,
          direction: 'outgoing',
          counterpartyName: '受取人',
          amount: 2400,
          status: 'pending',
          url: `https://polaris-warikan.netlify.app/e/token?view=payment&settlement=${settlementId}`,
        },
        { settlementId: 'bad', direction: 'outgoing' },
      ],
    })
    expect(status.settlements).toHaveLength(1)
    expect(status.remainingAmount).toBe(2400)
  })

  it('formats only the linked participant own open settlements', () => {
    const message = linkedStatusMessage(normalizeLinkedStatus({
      eventStatus: 'finalized',
      pendingCount: 1,
      reportedCount: 0,
      completedCount: 0,
      remainingAmount: 2400,
      settlements: [{
        settlementId,
        direction: 'outgoing',
        counterpartyName: '受取人',
        amount: 2400,
        status: 'pending',
        url: `https://polaris-warikan.netlify.app/e/token?view=payment&settlement=${settlementId}`,
      }],
    }))
    expect(message).toContain('あなたの精算')
    expect(message).toContain('受取人さんへ支払う')
    expect(message).toContain('2,400円')
  })

  it('maps link outcomes without revealing account identifiers', () => {
    expect(linkResultMessage({ linked: true })).toContain('連携しました')
    expect(linkResultMessage({ linked: false, error: 'LINK_CODE_EXPIRED' })).toContain('有効期限')
    expect(linkResultMessage({ linked: false, error: 'EXTERNAL_ACCOUNT_ALREADY_LINKED' })).not.toContain('user')
  })

  it('keeps help text limited to supported commands', () => {
    expect(ASSISTANT_HELP_MESSAGE).toContain('連携 ABCD1234')
    expect(ASSISTANT_HELP_MESSAGE).toContain('状況')
    expect(ASSISTANT_HELP_MESSAGE).not.toContain('幹事')
  })
})
