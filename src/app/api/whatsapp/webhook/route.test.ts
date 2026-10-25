import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { GET, POST, __resetWebhookAdminClientForTests } from './route'
import { encrypt } from '@/lib/whatsapp/encryption'

interface MockConfigRow {
  id: string
  account_id: string
  user_id: string
  phone_number_id: string
  access_token: string
  verify_token?: string | null
  status?: string
}

let mockConfigs: MockConfigRow[] = []
const messageUpdates: Array<{ id: string; accountId: string; patch: Record<string, unknown> }> = []

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

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'whatsapp_config') {
        let filterPhone: string | null = null
        const builder = {
          select: vi.fn(() => builder),
          eq: vi.fn((col: string, val: string) => {
            if (col === 'phone_number_id') filterPhone = val
            return builder
          }),
          then: vi.fn((resolve: (res: { data: unknown; error: unknown }) => unknown) => {
            const filtered = filterPhone
              ? mockConfigs.filter((c) => c.phone_number_id === filterPhone)
              : mockConfigs
            return Promise.resolve(resolve({ data: filtered, error: null }))
          }),
        }
        return builder
      }

      if (table === 'messages') {
        let filterMsgId: string | null = null
        let filterAccountId: string | null = null
        let currentPatch: Record<string, unknown> = {}

        const builder = {
          select: vi.fn(() => builder),
          update: vi.fn((patch: Record<string, unknown>) => {
            currentPatch = patch
            return builder
          }),
          eq: vi.fn((col: string, val: string) => {
            if (col === 'message_id') filterMsgId = val
            if (col === 'account_id') filterAccountId = val
            return builder
          }),
          limit: vi.fn(() => builder),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          then: vi.fn((resolve: (res: { data: unknown; error: unknown }) => unknown) => {
            if (filterMsgId && filterAccountId) {
              messageUpdates.push({
                id: filterMsgId,
                accountId: filterAccountId,
                patch: currentPatch,
              })
            }
            return Promise.resolve(resolve({ data: null, error: null }))
          }),
        }
        return builder
      }

      if (table === 'broadcast_recipients') {
        const builder = {
          select: vi.fn(() => builder),
          update: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          limit: vi.fn(() => builder),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          then: vi.fn((resolve: (res: { data: unknown; error: unknown }) => unknown) =>
            Promise.resolve(resolve({ data: null, error: null }))
          ),
        }
        return builder
      }

      return {
        select: vi.fn().mockResolvedValue({ data: null, error: null }),
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ then: vi.fn() }) }),
      }
    }),
  })),
}))

describe('WhatsApp Webhook GET Verification (Platform-Level)', () => {
  const originalEnv = { ...process.env }
  const PLATFORM_TOKEN = 'opsiys_webhook_verify_2026_A7x9K2'

  beforeEach(() => {
    mockConfigs = []
    messageUpdates.length = 0
    __resetWebhookAdminClientForTests()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test_service_role_key'
    process.env.WHATSAPP_VERIFY_TOKEN = PLATFORM_TOKEN
    process.env.META_VERIFY_TOKEN = ''
  })

  afterAll(() => {
    process.env = originalEnv
    __resetWebhookAdminClientForTests()
  })

  it('verifies successfully with platform WHATSAPP_VERIFY_TOKEN returning plain-text challenge', async () => {
    const req = new Request(
      `https://example.com/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=test_challenge_123&hub.verify_token=${PLATFORM_TOKEN}`
    )
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    expect(await res.text()).toBe('test_challenge_123')
  })

  it('verifies successfully with compatibility fallback META_VERIFY_TOKEN', async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = ''
    process.env.META_VERIFY_TOKEN = 'fallback_meta_secret_token'

    const req = new Request(
      'https://example.com/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=meta_challenge_456&hub.verify_token=fallback_meta_secret_token'
    )
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('meta_challenge_456')
  })

  it('succeeds even when whatsapp_config database table has zero rows', async () => {
    mockConfigs = [] // zero rows in database

    const req = new Request(
      `https://example.com/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=empty_db_challenge&hub.verify_token=${PLATFORM_TOKEN}`
    )
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('empty_db_challenge')
  })

  it('supports comma-separated token rotation (old token and new token both verify)', async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = 'old_secret_token, new_rotated_token'

    const reqOld = new Request(
      'https://example.com/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=old_chal&hub.verify_token=old_secret_token'
    )
    const resOld = await GET(reqOld)
    expect(resOld.status).toBe(200)
    expect(await resOld.text()).toBe('old_chal')

    const reqNew = new Request(
      'https://example.com/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=new_chal&hub.verify_token=new_rotated_token'
    )
    const resNew = await GET(reqNew)
    expect(resNew.status).toBe(200)
    expect(await resNew.text()).toBe('new_chal')
  })

  it('tenant-supplied verify_token in database cannot override or satisfy the platform verification', async () => {
    // Tenant has a verify token in DB, but platform token is different
    mockConfigs = [
      {
        id: 'cfg-tenant-1',
        account_id: 'acct-1',
        user_id: 'user-1',
        phone_number_id: '12345',
        access_token: 'enc',
        verify_token: encrypt('tenant_private_token'),
      },
    ]

    const req = new Request(
      'https://example.com/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=chal&hub.verify_token=tenant_private_token'
    )
    const res = await GET(req)

    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.error).toBe('Verification token mismatch')
  })

  it('fails closed with HTTP 500 when no platform secret is configured', async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = ''
    process.env.META_VERIFY_TOKEN = ''

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const req = new Request(
      `https://example.com/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=112233&hub.verify_token=${PLATFORM_TOKEN}`
    )
    const res = await GET(req)

    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toBe('Platform webhook verify token is not configured')
    expect(JSON.stringify(data)).not.toContain(PLATFORM_TOKEN)
    consoleSpy.mockRestore()
  })

  it('rejects an incorrect verification token with HTTP 403', async () => {
    const req = new Request(
      'https://example.com/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=112233&hub.verify_token=wrong_token'
    )
    const res = await GET(req)

    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.error).toBe('Verification token mismatch')
  })

  it('rejects missing verification parameters with HTTP 400', async () => {
    const req = new Request('https://example.com/api/whatsapp/webhook')
    const res = await GET(req)

    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('Missing verification parameters')
  })

  it('rejects invalid verification mode with HTTP 400', async () => {
    const req = new Request(
      `https://example.com/api/whatsapp/webhook?hub.mode=unsubscribe&hub.challenge=112233&hub.verify_token=${PLATFORM_TOKEN}`
    )
    const res = await GET(req)

    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('Invalid verification mode')
  })

  it('verifies successfully when platform env var has surrounding double quotes', async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = `"${PLATFORM_TOKEN}"`

    const req = new Request(
      `https://example.com/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=quoted_chal_1&hub.verify_token=${PLATFORM_TOKEN}`
    )
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('quoted_chal_1')
  })

  it('verifies successfully when platform env var has surrounding single quotes', async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = `'${PLATFORM_TOKEN}'`

    const req = new Request(
      `https://example.com/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=quoted_chal_2&hub.verify_token=${PLATFORM_TOKEN}`
    )
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('quoted_chal_2')
  })

  it('verifies successfully when incoming query token has surrounding quotes or whitespace', async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = PLATFORM_TOKEN

    const req = new Request(
      `https://example.com/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=whitespace_chal&hub.verify_token=%20%22${PLATFORM_TOKEN}%22%20`
    )
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('whitespace_chal')
  })

  it('verifies successfully with alias fallbacks META_WEBHOOK_VERIFY_TOKEN and WHATSAPP_WEBHOOK_VERIFY_TOKEN', async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = ''
    process.env.META_VERIFY_TOKEN = ''
    process.env.META_WEBHOOK_VERIFY_TOKEN = 'meta_webhook_alias_tok'

    const req1 = new Request(
      'https://example.com/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=alias_chal_1&hub.verify_token=meta_webhook_alias_tok'
    )
    const res1 = await GET(req1)
    expect(res1.status).toBe(200)
    expect(await res1.text()).toBe('alias_chal_1')

    process.env.META_WEBHOOK_VERIFY_TOKEN = ''
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'wa_webhook_alias_tok'

    const req2 = new Request(
      'https://example.com/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=alias_chal_2&hub.verify_token=wa_webhook_alias_tok'
    )
    const res2 = await GET(req2)
    expect(res2.status).toBe(200)
    expect(await res2.text()).toBe('alias_chal_2')
  })

  it('rejects missing individual verification parameters with HTTP 400', async () => {
    // Missing hub.mode
    const resNoMode = await GET(
      new Request(`https://example.com/api/whatsapp/webhook?hub.challenge=c1&hub.verify_token=${PLATFORM_TOKEN}`)
    )
    expect(resNoMode.status).toBe(400)
    expect((await resNoMode.json()).error).toBe('Missing verification parameters')

    // Missing hub.challenge
    const resNoChal = await GET(
      new Request(`https://example.com/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${PLATFORM_TOKEN}`)
    )
    expect(resNoChal.status).toBe(400)
    expect((await resNoChal.json()).error).toBe('Missing verification parameters')

    // Missing hub.verify_token
    const resNoTok = await GET(
      new Request('https://example.com/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=c1')
    )
    expect(resNoTok.status).toBe(400)
    expect((await resNoTok.json()).error).toBe('Missing verification parameters')
  })

  it('supports underscore query parameters (hub_mode, hub_challenge, hub_verify_token)', async () => {
    const req = new Request(
      `https://example.com/api/whatsapp/webhook?hub_mode=subscribe&hub_challenge=underscore_chal&hub_verify_token=${PLATFORM_TOKEN}`
    )
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('underscore_chal')
  })


  it('never leaks platform secrets or incoming tokens in responses', async () => {
    const req = new Request(
      'https://example.com/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=chal&hub.verify_token=super_secret_incoming_val'
    )
    const res = await GET(req)
    const text = await res.text()

    expect(text).not.toContain(PLATFORM_TOKEN)
    expect(text).not.toContain('super_secret_incoming_val')
  })
})

describe('WhatsApp Webhook POST Multi-Tenant Routing', () => {
  const TEST_SECRET = 'test-meta-app-secret-123456789'

  beforeEach(() => {
    process.env.META_APP_SECRET = TEST_SECRET
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test_service_role_key'
    mockConfigs = []
    messageUpdates.length = 0
    pendingAfter = null
    __resetWebhookAdminClientForTests()
  })

  function signBody(body: string, secret: string = TEST_SECRET): string {
    const hex = createHmac('sha256', secret).update(body).digest('hex')
    return `sha256=${hex}`
  }

  it('rejects POST with invalid signature with 401 Unauthorized', async () => {
    const payload = JSON.stringify({ object: 'whatsapp_business_account' })
    const wrongSignature = signBody(payload, 'wrong-secret')

    const req = new Request('https://example.com/api/whatsapp/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': wrongSignature,
      },
      body: payload,
    })

    const res = await POST(req)
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toBe('Invalid signature')
  })

  it('rejects POST with missing signature with 401 Unauthorized', async () => {
    const payload = JSON.stringify({ object: 'whatsapp_business_account' })

    const req = new Request('https://example.com/api/whatsapp/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: payload,
    })

    const res = await POST(req)
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toBe('Invalid signature')
  })

  it('routes Phone Number A only to Tenant A', async () => {
    mockConfigs = [
      {
        id: 'cfg-a',
        account_id: 'tenant-a-account',
        user_id: 'user-a',
        phone_number_id: 'phone-num-A',
        access_token: 'enc-token-a',
      },
      {
        id: 'cfg-b',
        account_id: 'tenant-b-account',
        user_id: 'user-b',
        phone_number_id: 'phone-num-B',
        access_token: 'enc-token-b',
      },
    ]

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
                  display_phone_number: '+15550001',
                  phone_number_id: 'phone-num-A',
                },
                statuses: [
                  {
                    id: 'wamid-msg-001',
                    status: 'delivered',
                    timestamp: '1700000000',
                    recipient_id: '15559999',
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

    // Verify status update was routed strictly to Tenant A's account_id
    expect(messageUpdates).toHaveLength(1)
    expect(messageUpdates[0]).toEqual({
      id: 'wamid-msg-001',
      accountId: 'tenant-a-account',
      patch: { status: 'delivered' },
    })
  })

  it('routes Phone Number B only to Tenant B', async () => {
    mockConfigs = [
      {
        id: 'cfg-a',
        account_id: 'tenant-a-account',
        user_id: 'user-a',
        phone_number_id: 'phone-num-A',
        access_token: 'enc-token-a',
      },
      {
        id: 'cfg-b',
        account_id: 'tenant-b-account',
        user_id: 'user-b',
        phone_number_id: 'phone-num-B',
        access_token: 'enc-token-b',
      },
    ]

    const payload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-2',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+15550002',
                  phone_number_id: 'phone-num-B',
                },
                statuses: [
                  {
                    id: 'wamid-msg-002',
                    status: 'read',
                    timestamp: '1700000010',
                    recipient_id: '15558888',
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

    // Verify status update was routed strictly to Tenant B's account_id
    expect(messageUpdates).toHaveLength(1)
    expect(messageUpdates[0]).toEqual({
      id: 'wamid-msg-002',
      accountId: 'tenant-b-account',
      patch: { status: 'read' },
    })
  })

  it('safely drops events for unknown Phone Number ID without delivering to any tenant', async () => {
    mockConfigs = [
      {
        id: 'cfg-a',
        account_id: 'tenant-a-account',
        user_id: 'user-a',
        phone_number_id: 'phone-num-A',
        access_token: 'enc-token-a',
      },
    ]

    const payload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-unknown',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+15559999',
                  phone_number_id: 'unknown-phone-num',
                },
                statuses: [
                  {
                    id: 'wamid-msg-orphan',
                    status: 'delivered',
                    timestamp: '1700000020',
                    recipient_id: '15557777',
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
    // No message update should have been performed
    expect(messageUpdates).toHaveLength(0)
  })

  it('fails closed and drops event if multiple configurations match the same Phone Number ID', async () => {
    // Corrupted state: two accounts claim the same number
    mockConfigs = [
      {
        id: 'cfg-1',
        account_id: 'tenant-conflict-1',
        user_id: 'user-1',
        phone_number_id: 'duplicate-phone-id',
        access_token: 'enc-1',
      },
      {
        id: 'cfg-2',
        account_id: 'tenant-conflict-2',
        user_id: 'user-2',
        phone_number_id: 'duplicate-phone-id',
        access_token: 'enc-2',
      },
    ]

    const payload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-dup',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+15553333',
                  phone_number_id: 'duplicate-phone-id',
                },
                statuses: [
                  {
                    id: 'wamid-msg-dup',
                    status: 'delivered',
                    timestamp: '1700000030',
                    recipient_id: '15556666',
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
    // Fail-closed guarantee: neither conflicting tenant receives the update
    expect(messageUpdates).toHaveLength(0)
  })
})
