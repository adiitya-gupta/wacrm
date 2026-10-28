import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { encrypt } from '@/lib/whatsapp/encryption'

let pendingAfter: Promise<unknown> | null = null

vi.mock('next/server', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('next/server')
  return {
    ...actual,
    after: vi.fn((fn: () => unknown) => {
      pendingAfter = Promise.resolve().then(() => fn())
    }),
  }
})

const capturedUpserts: Array<{ table: string; payload: Record<string, unknown>; onConflict?: string; ignoreDuplicates?: boolean }> = []
let mockUpsertReturn: unknown[] = [{ id: 'msg-inserted-1' }]
let mockUpsertError: { message: string } | null = null

vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/flows/engine', () => ({
  dispatchInboundToFlows: vi.fn().mockResolvedValue({ consumed: false }),
}))

vi.mock('@/lib/automations/engine', () => ({
  resumeAwaitingReply: vi.fn().mockResolvedValue(false),
  runAutomationsForTrigger: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/conversations/reopen', () => ({
  reopenClosedConversation: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'whatsapp_config') {
        const builder = {
          select: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          then: vi.fn((resolve: (res: { data: unknown; error: unknown }) => unknown) =>
            Promise.resolve(
              resolve({
                data: [
                  {
                    id: 'cfg-1',
                    account_id: 'tenant-1-account',
                    user_id: 'user-1',
                    phone_number_id: 'pn-123',
                    access_token: encrypt('test-token'),
                  },
                ],
                error: null,
              })
            )
          ),
        }
        return builder
      }

      if (table === 'contacts') {
        const builder = {
          select: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          like: vi.fn(() => builder),
          maybeSingle: vi.fn(async () => ({
            data: { id: 'contact-1', phone: '+15551234567', name: 'John Doe' },
            error: null,
          })),
          single: vi.fn(async () => ({
            data: { id: 'contact-1', phone: '+15551234567', name: 'John Doe' },
            error: null,
          })),
          then: vi.fn((resolve: (res: { data: unknown; error: unknown }) => unknown) =>
            Promise.resolve(
              resolve({
                data: [{ id: 'contact-1', phone: '+15551234567', name: 'John Doe' }],
                error: null,
              })
            )
          ),
        }
        return builder
      }

      if (table === 'conversations') {
        const builder = {
          select: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          order: vi.fn(() => builder),
          limit: vi.fn(() => builder),
          maybeSingle: vi.fn(async () => ({
            data: { id: 'conv-1', account_id: 'tenant-1-account', status: 'open' },
            error: null,
          })),
          single: vi.fn(async () => ({
            data: { id: 'conv-1', account_id: 'tenant-1-account', status: 'open' },
            error: null,
          })),
          update: vi.fn(() => builder),
          then: vi.fn((resolve: (res: { data: unknown; error: unknown }) => unknown) =>
            Promise.resolve(
              resolve({
                data: [{ id: 'conv-1', account_id: 'tenant-1-account', status: 'open' }],
                error: null,
              })
            )
          ),
        }
        return builder
      }

      if (table === 'messages') {
        const builder = {
          select: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          order: vi.fn(() => builder),
          limit: vi.fn(() => builder),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          upsert: vi.fn((payload: Record<string, unknown>, opts?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
            capturedUpserts.push({ table: 'messages', payload, ...opts })
            return {
              select: vi.fn(() => Promise.resolve({ data: mockUpsertReturn, error: mockUpsertError })),
            }
          }),
          then: vi.fn((resolve: (res: { data: unknown; error: unknown }) => unknown) =>
            Promise.resolve(resolve({ data: null, error: null }))
          ),
        }
        return builder
      }

      if (table === 'broadcast_recipients') {
        const builder = {
          select: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          in: vi.fn(() => builder),
          order: vi.fn(() => builder),
          limit: vi.fn(() => builder),
          then: vi.fn((resolve: (res: { data: unknown; error: unknown }) => unknown) =>
            Promise.resolve(resolve({ data: [], error: null }))
          ),
        }
        return builder
      }

      const defaultBuilder = {
        select: vi.fn(() => defaultBuilder),
        eq: vi.fn(() => defaultBuilder),
        limit: vi.fn(() => defaultBuilder),
        then: vi.fn((resolve: (res: { data: unknown; error: unknown }) => unknown) =>
          Promise.resolve(resolve({ data: [], error: null }))
        ),
      }
      return defaultBuilder
    }),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  })),
}))

import { POST, __resetWebhookAdminClientForTests } from './route'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'

describe('WhatsApp Webhook — Inbound Message Persistence & AI Trigger Execution', () => {
  const SECRET = 'test-meta-app-secret-123456789012'

  function signBody(body: string): string {
    return `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`
  }

  beforeEach(() => {
    capturedUpserts.length = 0
    mockUpsertReturn = [{ id: 'msg-inserted-1' }]
    mockUpsertError = null
    pendingAfter = null
    vi.clearAllMocks()
    __resetWebhookAdminClientForTests()
    process.env.META_APP_SECRET = SECRET
    process.env.ENCRYPTION_KEY = 'a'.repeat(64)
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-role-key'
  })

  it('persists inbound message WITHOUT account_id and dispatches to AI auto-reply', async () => {
    const payload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+15551234567',
                  phone_number_id: 'pn-123',
                },
                contacts: [
                  {
                    profile: { name: 'John Doe' },
                    wa_id: '15551234567',
                  },
                ],
                messages: [
                  {
                    from: '15551234567',
                    id: 'wamid.inbound-test-001',
                    timestamp: '1700000000',
                    type: 'text',
                    text: { body: 'Hello, need information about services' },
                  },
                ],
              },
            },
          ],
        },
      ],
    })

    const req = new Request('https://example.com/api/whatsapp/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': signBody(payload),
      },
      body: payload,
    })

    const res = await POST(req)
    if (pendingAfter) await pendingAfter
    expect(res.status).toBe(200)

    // 1. Verify messages upsert payload
    expect(capturedUpserts).toHaveLength(1)
    const upsert = capturedUpserts[0]
    expect(upsert.table).toBe('messages')
    expect(upsert.onConflict).toBe('conversation_id,message_id')
    expect(upsert.ignoreDuplicates).toBe(true)

    // CRITICAL: Must NOT contain account_id (preventing schema cache error)
    expect(upsert.payload).not.toHaveProperty('account_id')
    expect(upsert.payload.conversation_id).toBe('conv-1')
    expect(upsert.payload.sender_type).toBe('customer')
    expect(upsert.payload.content_text).toBe('Hello, need information about services')
    expect(upsert.payload.message_id).toBe('wamid.inbound-test-001')

    // 2. Verify AI reply dispatch was called
    expect(dispatchInboundToAiReply).toHaveBeenCalledTimes(1)
    expect(dispatchInboundToAiReply).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'tenant-1-account',
        conversationId: 'conv-1',
        contactId: 'contact-1',
        configOwnerUserId: 'user-1',
        inboundMessageId: 'wamid.inbound-test-001',
      }),
    )
  })

  it('idempotently ignores duplicate webhook replays without double-dispatching to AI', async () => {
    // When upsert returns empty array (ON CONFLICT DO NOTHING hit for duplicate)
    mockUpsertReturn = []

    const payload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+15551234567',
                  phone_number_id: 'pn-123',
                },
                contacts: [{ profile: { name: 'John Doe' }, wa_id: '15551234567' }],
                messages: [
                  {
                    from: '15551234567',
                    id: 'wamid.inbound-duplicate-002',
                    timestamp: '1700000000',
                    type: 'text',
                    text: { body: 'Repeated webhook delivery' },
                  },
                ],
              },
            },
          ],
        },
      ],
    })

    const req = new Request('https://example.com/api/whatsapp/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': signBody(payload),
      },
      body: payload,
    })

    const res = await POST(req)
    if (pendingAfter) await pendingAfter
    expect(res.status).toBe(200)

    // Upsert was attempted with ignoreDuplicates
    expect(capturedUpserts).toHaveLength(1)

    // Downstream AI dispatch MUST NOT be triggered on replay
    expect(dispatchInboundToAiReply).not.toHaveBeenCalled()
  })

  it('safely handles DB insertion failure without crashing or dispatching AI', async () => {
    // When DB error occurs
    mockUpsertError = { message: 'Database query timeout' }

    const payload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+15551234567',
                  phone_number_id: 'pn-123',
                },
                contacts: [{ profile: { name: 'John Doe' }, wa_id: '15551234567' }],
                messages: [
                  {
                    from: '15551234567',
                    id: 'wamid.inbound-fail-003',
                    timestamp: '1700000000',
                    type: 'text',
                    text: { body: 'Message during DB outage' },
                  },
                ],
              },
            },
          ],
        },
      ],
    })

    const req = new Request('https://example.com/api/whatsapp/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': signBody(payload),
      },
      body: payload,
    })

    const res = await POST(req)
    if (pendingAfter) await pendingAfter
    expect(res.status).toBe(200)

    // Upsert failed, so AI dispatch was correctly bypassed
    expect(dispatchInboundToAiReply).not.toHaveBeenCalled()
  })
})
