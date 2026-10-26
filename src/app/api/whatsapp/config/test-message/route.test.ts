import { beforeEach, describe, expect, it, vi } from 'vitest'

let callerRole = 'admin'
let signedIn = true

const STORED_CONFIG = {
  id: 'cfg-1',
  phone_number_id: '111222333',
  waba_id: '444555666',
  access_token: 'enc-token',
  status: 'connected',
}

let storedConfig: typeof STORED_CONFIG | null = null

function makeSupabaseMock() {
  function builder(table: string) {
    const result = () => {
      switch (table) {
        case 'profiles':
          return {
            data: { account_id: 'acct-1', account_role: callerRole },
            error: null,
          }
        case 'accounts':
          return { data: { id: 'acct-1', name: 'Acme', approval_status: 'approved' }, error: null }
        case 'whatsapp_config':
          return { data: storedConfig, error: null }
        default:
          return { data: null, error: null }
      }
    }

    const b: Record<string, unknown> = {}
    const chain = () => b
    for (const m of ['select', 'eq', 'neq']) b[m] = vi.fn(chain)
    b.single = vi.fn(async () => result())
    b.maybeSingle = vi.fn(async () => result())
    b.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null })
    return b
  }

  return {
    auth: {
      getUser: vi.fn(async () =>
        signedIn
          ? { data: { user: { id: 'user-1' } }, error: null }
          : { data: { user: null }, error: { message: 'no session' } },
      ),
    },
    from: vi.fn((table: string) => builder(table)),
  }
}

let supabaseMock = makeSupabaseMock()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => supabaseMock),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn((token: string) => {
    if (token === 'corrupted') throw new Error('decryption failed')
    return 'plaintext-token'
  }),
}))

const meta = vi.hoisted(() => ({
  sendTextMessage: vi.fn(async () => ({ messageId: 'wamid.test_12345' })),
}))
vi.mock('@/lib/whatsapp/meta-api', () => meta)

import { POST } from './route'
import { __resetRateLimitForTests } from '@/lib/rate-limit'

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/whatsapp/config/test-message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  __resetRateLimitForTests()
  callerRole = 'admin'
  signedIn = true
  storedConfig = { ...STORED_CONFIG }
  supabaseMock = makeSupabaseMock()
  meta.sendTextMessage.mockClear()
})

describe('POST /api/whatsapp/config/test-message', () => {
  it('rejects unauthenticated caller with 401', async () => {
    signedIn = false
    const res = await POST(makeRequest({ to: '+15551234567' }))
    expect(res.status).toBe(401)
  })

  it('rejects non-admin role with 403', async () => {
    callerRole = 'viewer'
    const res = await POST(makeRequest({ to: '+15551234567' }))
    expect(res.status).toBe(403)
  })

  it('rejects with 400 when destination phone number is missing', async () => {
    const res = await POST(makeRequest({ to: '' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/recipient phone number/i)
  })

  it('rejects with 400 when phone number format is invalid', async () => {
    const res = await POST(makeRequest({ to: 'invalid-phone' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Invalid phone number format/i)
  })

  it('rejects with 400 when WhatsApp is not configured in the account', async () => {
    storedConfig = null
    const res = await POST(makeRequest({ to: '+15551234567' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/WhatsApp is not configured/i)
  })

  it('rejects with 400 when token cannot be decrypted', async () => {
    storedConfig = { ...STORED_CONFIG, access_token: 'corrupted' }
    const res = await POST(makeRequest({ to: '+15551234567' }))
    expect(res.status).toBe(400)
  })

  it('sends test message with default text and strips leading plus for Meta recipient parameter', async () => {
    const res = await POST(makeRequest({ to: '+1 (555) 123-4567' }))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body).toEqual({
      success: true,
      message_id: 'wamid.test_12345',
      to: '+15551234567',
    })

    expect(meta.sendTextMessage).toHaveBeenCalledWith({
      phoneNumberId: '111222333',
      accessToken: 'plaintext-token',
      to: '15551234567',
      text: expect.stringContaining('Hello from Wattomation'),
    })
  })

  it('sends custom message text when provided', async () => {
    const res = await POST(
      makeRequest({
        to: '+919876543210',
        message: 'Custom greeting test',
      }),
    )
    expect(res.status).toBe(200)

    expect(meta.sendTextMessage).toHaveBeenCalledWith({
      phoneNumberId: '111222333',
      accessToken: 'plaintext-token',
      to: '919876543210',
      text: 'Custom greeting test',
    })
  })

  it('handles and explains Meta send failure without leaking secrets', async () => {
    meta.sendTextMessage.mockRejectedValueOnce({
      name: 'MetaApiError',
      message: 'Message undeliverable',
      code: 131047,
      fbtraceId: 'trace-test-msg-123',
    })

    const res = await POST(makeRequest({ to: '+15551234567' }))
    expect(res.status).toBe(502)
    const body = await res.json()

    expect(body.error).toBeDefined()
    expect(body.meta).toMatchObject({
      code: 131047,
      fbtrace_id: 'trace-test-msg-123',
      step: 'send_message',
    })
    expect(JSON.stringify(body)).not.toContain('plaintext-token')
  })
})
