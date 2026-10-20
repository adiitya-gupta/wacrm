import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { GET } from './route'
import { encrypt } from '@/lib/whatsapp/encryption'

let mockConfigs: { id: string; verify_token: string | null }[] = []

vi.mock('next/server', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('next/server')
  return {
    ...actual,
    after: vi.fn((_fn: () => unknown) => {
      // safe no-op in unit tests
    }),
  }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'whatsapp_config') {
        return {
          select: vi.fn().mockResolvedValue({ data: mockConfigs, error: null }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              then: vi.fn((cb: (res: { error: unknown }) => unknown) => cb({ error: null })),
            }),
          }),
        }
      }
      return {
        select: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
    }),
  })),
}))

describe('WhatsApp Webhook GET Verification', () => {
  const originalEnv = process.env.WHATSAPP_VERIFY_TOKEN
  const TEST_TOKEN = 'opsiys_webhook_verify_2026_A7x9K2'

  beforeEach(() => {
    mockConfigs = []
    process.env.WHATSAPP_VERIFY_TOKEN = ''
    process.env.META_VERIFY_TOKEN = ''
  })

  afterAll(() => {
    process.env.WHATSAPP_VERIFY_TOKEN = originalEnv
  })

  it('verifies successfully with token from database whatsapp_config', async () => {
    mockConfigs = [{ id: 'cfg-1', verify_token: encrypt(TEST_TOKEN) }]

    const req = new Request(
      `https://example.com/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=112233&hub.verify_token=${TEST_TOKEN}`
    )
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    const body = await res.text()
    expect(body).toBe('112233')
  })

  it('verifies successfully with token from WHATSAPP_VERIFY_TOKEN environment variable', async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = TEST_TOKEN
    mockConfigs = []

    const req = new Request(
      `https://example.com/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=challenge_456&hub.verify_token=${TEST_TOKEN}`
    )
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('challenge_456')
  })

  it('supports underscore query parameters (hub_mode, hub_challenge, hub_verify_token)', async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = TEST_TOKEN

    const req = new Request(
      `https://example.com/api/whatsapp/webhook?hub_mode=subscribe&hub_challenge=underscore_789&hub_verify_token=${TEST_TOKEN}`
    )
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('underscore_789')
  })

  it('rejects an incorrect verification token with 403', async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = TEST_TOKEN
    mockConfigs = [{ id: 'cfg-1', verify_token: encrypt(TEST_TOKEN) }]

    const req = new Request(
      `https://example.com/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=112233&hub.verify_token=wrong_token`
    )
    const res = await GET(req)

    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.error).toBe('Verification token mismatch')
  })

  it('rejects missing verification parameters with 400', async () => {
    const req = new Request('https://example.com/api/whatsapp/webhook')
    const res = await GET(req)

    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('Missing verification parameters')
  })

  it('rejects invalid verification mode with 400', async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = TEST_TOKEN

    const req = new Request(
      `https://example.com/api/whatsapp/webhook?hub.mode=unsubscribe&hub.challenge=112233&hub.verify_token=${TEST_TOKEN}`
    )
    const res = await GET(req)

    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('Invalid verification mode')
  })
})

describe('WhatsApp Webhook POST Handler', () => {
  const TEST_SECRET = 'test-meta-app-secret-123456789'

  beforeEach(() => {
    process.env.META_APP_SECRET = TEST_SECRET
  })

  function signBody(body: string, secret: string = TEST_SECRET): string {
    const hex = createHmac('sha256', secret).update(body).digest('hex')
    return `sha256=${hex}`
  }

  it('accepts valid signed Meta POST webhook request with 200 received', async () => {
    const { POST } = await import('./route')
    const payload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [],
    })
    const signature = signBody(payload)

    const req = new Request('https://example.com/api/whatsapp/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': signature,
      },
      body: payload,
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.status).toBe('received')
  })

  it('rejects POST with invalid signature with 401 Unauthorized', async () => {
    const { POST } = await import('./route')
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
    const { POST } = await import('./route')
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
})
