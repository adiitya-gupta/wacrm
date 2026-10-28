import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const mocks = vi.hoisted(() => ({
  addContactTagIfAbsent: vi.fn(),
  dispatchWebhookEvent: vi.fn(),
}))

vi.mock('@/lib/contacts/tag-write', () => ({
  addContactTagIfAbsent: mocks.addContactTagIfAbsent,
}))

vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: mocks.dispatchWebhookEvent,
}))

import { dispatchAiOutcomeEvent } from './events'

describe('dispatchAiOutcomeEvent', () => {
  let mockDb: Record<string, unknown>
  let tables: Record<string, unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.addContactTagIfAbsent.mockResolvedValue({ added: true })
    mocks.dispatchWebhookEvent.mockResolvedValue(undefined)

    tables = {
      contacts: {
        id: 'contact-1',
        user_id: 'user-1',
        name: 'Alice',
      },
      conversations: {
        id: 'conv-1',
        user_id: 'user-1',
        customer_phone: '+1234567890',
      },
      tags: {
        id: 'tag-1',
      },
      deals: null,
      accounts: {
        default_currency: 'USD',
      },
      pipelines: [{ id: 'pipe-1' }],
      pipeline_stages: [{ id: 'stage-1', pipeline_id: 'pipe-1' }],
    }

    mockDb = {
      from: vi.fn((tableName: string) => {
        if (tableName === 'contacts') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: tables.contacts, error: null }),
                }),
              }),
            }),
          }
        }
        if (tableName === 'conversations') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: tables.conversations, error: null }),
                }),
                maybeSingle: () => Promise.resolve({ data: tables.conversations, error: null }),
              }),
            }),
            update: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          }
        }
        if (tableName === 'accounts') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: tables.accounts, error: null }),
              }),
            }),
          }
        }
        if (tableName === 'pipelines') {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => Promise.resolve({ data: tables.pipelines, error: null }),
                }),
              }),
            }),
          }
        }
        if (tableName === 'pipeline_stages') {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => Promise.resolve({ data: tables.pipeline_stages, error: null }),
                }),
              }),
            }),
          }
        }
        if (tableName === 'tags') {
          return {
            select: () => ({
              eq: () => ({
                ilike: () => ({
                  maybeSingle: () => Promise.resolve({ data: tables.tags, error: null }),
                }),
              }),
            }),
            insert: () => ({
              select: () => ({
                maybeSingle: () => Promise.resolve({ data: { id: 'tag-new' }, error: null }),
              }),
            }),
          }
        }
        if (tableName === 'deals') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: tables.deals, error: null }),
                  in: () => ({
                    maybeSingle: () => Promise.resolve({ data: tables.deals, error: null }),
                  }),
                }),
              }),
            }),
            insert: () => ({
              select: () => ({
                maybeSingle: () => Promise.resolve({ data: { id: 'deal-new' }, error: null }),
              }),
            }),
          }
        }
        if (tableName === 'automation_pending_executions') {
          const chain: Record<string, unknown> = {
            eq: () => chain,
            in: () => chain,
            then: (resolve: (v: unknown) => void) => resolve({ error: null }),
          }
          return { update: () => chain }
        }
        return {
          select: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
        }
      }),
    }
  })

  it('handles meeting_booked: tags contact, creates deal, and dispatches webhook', async () => {
    const result = await dispatchAiOutcomeEvent(mockDb as unknown as SupabaseClient, {
      type: 'meeting_booked',
      accountId: 'acct-1',
      contactId: 'contact-1',
      conversationId: 'conv-1',
      data: {
        meetingId: 'mtg-1',
        serviceName: 'WhatsApp AI Bot',
        leadSummary: 'Needs WhatsApp bot for customer support',
        budget: '$1,500',
        contactName: 'Alice',
      },
    })

    expect(result.success).toBe(true)
    expect(result.dealCreated).toBe(true)
    expect(result.dealId).toBe('deal-new')
    expect(mocks.addContactTagIfAbsent).toHaveBeenCalledWith(
      expect.anything(),
      {
        accountId: 'acct-1',
        contactId: 'contact-1',
        tagId: 'tag-1',
      },
    )
    expect(mocks.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      'ai.meeting_booked',
      expect.objectContaining({
        meeting_id: 'mtg-1',
        service_name: 'WhatsApp AI Bot',
      }),
    )
  })

  it('handles lead_qualified: tags contact and dispatches webhook', async () => {
    const result = await dispatchAiOutcomeEvent(mockDb as unknown as SupabaseClient, {
      type: 'lead_qualified',
      accountId: 'acct-1',
      contactId: 'contact-1',
      conversationId: 'conv-1',
      data: {
        serviceName: 'Cleaning Service',
        leadSummary: '3-bedroom apartment move-in clean',
      },
    })

    expect(result.success).toBe(true)
    expect(result.tagApplied).toBe('Qualified Lead')
    expect(mocks.addContactTagIfAbsent).toHaveBeenCalled()
    expect(mocks.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      'ai.lead_qualified',
      expect.objectContaining({
        service_name: 'Cleaning Service',
      }),
    )
  })

  it('handles customer_opted_out: cancels pending automations and disables auto-reply', async () => {
    const result = await dispatchAiOutcomeEvent(mockDb as unknown as SupabaseClient, {
      type: 'customer_opted_out',
      accountId: 'acct-1',
      contactId: 'contact-1',
      conversationId: 'conv-1',
      data: {
        notes: 'User requested STOP',
      },
    })

    expect(result.success).toBe(true)
    expect(result.tagApplied).toBe('Opted Out')
    expect(mocks.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      'ai.customer_opted_out',
      expect.objectContaining({
        conversation_id: 'conv-1',
      }),
    )
  })

  it('handles conversation_handed_off: cancels pending automations and marks handoff', async () => {
    const result = await dispatchAiOutcomeEvent(mockDb as unknown as SupabaseClient, {
      type: 'conversation_handed_off',
      accountId: 'acct-1',
      contactId: 'contact-1',
      conversationId: 'conv-1',
      data: {
        handoffReason: 'Complex enterprise pricing questions',
      },
    })

    expect(result.success).toBe(true)
    expect(result.tagApplied).toBe('Human Handoff')
    expect(mocks.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      'ai.conversation_handed_off',
      expect.objectContaining({
        reason: 'Complex enterprise pricing questions',
      }),
    )
  })
})
