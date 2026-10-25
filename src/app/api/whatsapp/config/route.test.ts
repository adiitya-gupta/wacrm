import { beforeEach, describe, expect, it, vi } from 'vitest'

let callerRole = 'admin'
let signedIn = true

const configInserts: Record<string, unknown>[] = []
const configUpdates: Record<string, unknown>[] = []
let configDeletes = 0

const STORED_CONFIG = {
  id: 'cfg-1',
  phone_number_id: '111222333',
  waba_id: '444555666',
  access_token: 'enc-token',
  status: 'connected',
  registered_at: '2026-01-01T00:00:00.000Z',
  verify_token: null,
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
    b.insert = vi.fn((row: Record<string, unknown>) => {
      if (table === 'whatsapp_config') configInserts.push(row)
      return b
    })
    b.update = vi.fn((patch: Record<string, unknown>) => {
      if (table === 'whatsapp_config') configUpdates.push(patch)
      return b
    })
    b.delete = vi.fn(() => {
      if (table === 'whatsapp_config') configDeletes += 1
      return b
    })
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

const serviceRole = vi.hoisted(() => ({
  lookups: 0,
  conflictRow: null as { account_id: string } | null,
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => {
      serviceRole.lookups += 1
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'neq']) b[m] = vi.fn(() => b)
      b.maybeSingle = vi.fn(async () => ({ data: serviceRole.conflictRow, error: null }))
      return b
    }),
  })),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'plaintext-token'),
  encrypt: vi.fn(() => 'enc-token'),
}))

const meta = vi.hoisted(() => ({
  verifyPhoneNumber: vi.fn(async () => ({ id: '111222333', verified_name: 'Acme Support' })),
  listWabaPhoneNumbers: vi.fn(async () => [{ id: '111222333' }]),
  registerPhoneNumber: vi.fn(async () => ({ success: true })),
  subscribeWabaToApp: vi.fn(async () => ({ success: true })),
  getSubscribedApps: vi.fn(async () => []),
}))
vi.mock('@/lib/whatsapp/meta-api', () => meta)

import { DELETE, GET, POST } from './route'
import { __resetRateLimitForTests } from '@/lib/rate-limit'

function saveConfig(bodyOverrides: Record<string, unknown> = {}) {
  return POST(
    new Request('http://localhost/api/whatsapp/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone_number_id: '111222333',
        waba_id: '444555666',
        access_token: 'caller-supplied-token',
        pin: '123456',
        ...bodyOverrides,
      }),
    }),
  )
}

function metaCallCount() {
  return (
    meta.verifyPhoneNumber.mock.calls.length +
    meta.listWabaPhoneNumbers.mock.calls.length +
    meta.registerPhoneNumber.mock.calls.length +
    meta.subscribeWabaToApp.mock.calls.length +
    meta.getSubscribedApps.mock.calls.length
  )
}

beforeEach(() => {
  __resetRateLimitForTests()
  callerRole = 'admin'
  signedIn = true
  storedConfig = null
  configInserts.length = 0
  configUpdates.length = 0
  configDeletes = 0
  serviceRole.lookups = 0
  serviceRole.conflictRow = null
  supabaseMock = makeSupabaseMock()
  for (const fn of Object.values(meta)) fn.mockClear()
})

describe('POST /api/whatsapp/config', () => {
  it.each(['viewer', 'agent'])('refuses the %s role before any Meta call', async (role) => {
    callerRole = role

    const res = await saveConfig()

    expect(res.status).toBe(403)
    expect(metaCallCount()).toBe(0)
    expect(serviceRole.lookups).toBe(0)
    expect(configInserts).toHaveLength(0)
    expect(configUpdates).toHaveLength(0)
  })

  it('answers 401 without a session and calls nothing', async () => {
    signedIn = false

    const res = await saveConfig()

    expect(res.status).toBe(401)
    expect(metaCallCount()).toBe(0)
    expect(serviceRole.lookups).toBe(0)
  })

  it.each(['admin', 'owner'])('lets the %s role verify, register, subscribe and save', async (role) => {
    callerRole = role

    const res = await saveConfig()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ success: true, saved: true, registered: true })
    expect(meta.verifyPhoneNumber).toHaveBeenCalledTimes(1)
    expect(meta.listWabaPhoneNumbers).toHaveBeenCalledTimes(1)
    expect(meta.registerPhoneNumber).toHaveBeenCalledTimes(1)
    expect(meta.subscribeWabaToApp).toHaveBeenCalledTimes(1)
    expect(configInserts).toHaveLength(1)
    expect(configInserts[0]).toMatchObject({ account_id: 'acct-1', user_id: 'user-1' })
  })

  it('saves credentials without requiring prior Meta webhook verification handshake', async () => {
    // Platform webhook verification is completely separate from tenant config save
    delete process.env.WHATSAPP_VERIFY_TOKEN
    delete process.env.META_VERIFY_TOKEN

    const res = await saveConfig()
    expect(res.status).toBe(200)
    expect(configInserts).toHaveLength(1)
  })

  it('enforces tenant isolation and rejects saving a number claimed by another account', async () => {
    serviceRole.conflictRow = { account_id: 'other-tenant-account' }

    const res = await saveConfig()
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toContain('already linked to another account')
    expect(configInserts).toHaveLength(0)
  })

  it('updates existing record on repeated submission without creating duplicate rows', async () => {
    storedConfig = STORED_CONFIG

    const res = await saveConfig()
    expect(res.status).toBe(200)
    expect(configInserts).toHaveLength(0)
    expect(configUpdates).toHaveLength(1)
  })

  it('accurately reports Meta credential validation failure and does not leak secrets', async () => {
    meta.verifyPhoneNumber.mockRejectedValueOnce({
      name: 'MetaApiError',
      message: 'Invalid OAuth access token - Cannot parse access token',
      status: 400,
      code: 190,
      subcode: 467,
      fbtraceId: 'fb_trace_12345',
    })

    const res = await saveConfig()
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeDefined()
    expect(body.meta).toMatchObject({
      code: 190,
      step: 'verify_number',
      fbtrace_id: 'fb_trace_12345',
    })
    // Secrets must never be leaked
    expect(JSON.stringify(body)).not.toContain('caller-supplied-token')
    expect(configInserts).toHaveLength(0)
  })

  it('enforces rate limits and returns 429 when limit is legitimately exceeded', async () => {
    // whatsappAdmin limit is 30/minute
    for (let i = 0; i < 30; i++) {
      const okRes = await saveConfig()
      expect(okRes.status).toBe(200)
    }

    // 31st request exceeds the rate limit
    const overRes = await saveConfig()
    expect(overRes.status).toBe(429)
    const body = await overRes.json()
    expect(body.error).toBe('Rate limit exceeded')
    expect(body.retry_after_seconds).toBeGreaterThan(0)
    expect(overRes.headers.get('Retry-After')).toBeDefined()
    expect(overRes.headers.get('X-RateLimit-Limit')).toBe('30')
  })

  it('does not falsely return 429 in production when Redis is unconfigured, enforcing local limits', async () => {
    const originalEnv = process.env.NODE_ENV
    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production'
      delete process.env.UPSTASH_REDIS_REST_URL
      delete process.env.UPSTASH_REDIS_REST_TOKEN

      // First save must succeed (not falsely rejected with 429!)
      const res = await saveConfig()
      expect(res.status).toBe(200)
      expect(configInserts).toHaveLength(1)
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv
    }
  })
})

describe('DELETE /api/whatsapp/config', () => {
  it.each(['viewer', 'agent'])('refuses the %s role and deletes nothing', async (role) => {
    callerRole = role
    storedConfig = STORED_CONFIG

    const res = await DELETE()

    expect(res.status).toBe(403)
    expect(configDeletes).toBe(0)
  })

  it('lets an admin reset the configuration', async () => {
    storedConfig = STORED_CONFIG

    const res = await DELETE()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(configDeletes).toBe(1)
  })
})

describe('GET /api/whatsapp/config', () => {
  it('stays readable for a viewer and never returns the token', async () => {
    callerRole = 'viewer'
    storedConfig = STORED_CONFIG

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.connected).toBe(true)
    expect(JSON.stringify(body)).not.toContain('plaintext-token')
    expect(JSON.stringify(body)).not.toContain('enc-token')
  })
})
