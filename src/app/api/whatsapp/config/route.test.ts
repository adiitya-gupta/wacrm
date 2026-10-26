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
  registered_at: '2026-01-01T00:00:00.000Z' as string | null,
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
  verifyPhoneNumber: vi.fn(
    async (): Promise<{
      id: string
      display_phone_number?: string
      verified_name?: string
      quality_rating?: string
      status?: string
      code_verification_status?: string
      name_status?: string
    }> => ({ id: '111222333', verified_name: 'Acme Support' }),
  ),
  listWabaPhoneNumbers: vi.fn(async () => [{ id: '111222333' }]),
  registerPhoneNumber: vi.fn(
    async (): Promise<{ success: boolean; alreadyRegistered?: boolean }> => ({ success: true }),
  ),
  subscribeWabaToApp: vi.fn(async () => ({ success: true })),
  getSubscribedApps: vi.fn(async () => []),
  debugToken: vi.fn(async () => ({
    isValid: true,
    scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
    granularScopes: [],
  })),
  discoverWabaAccounts: vi.fn(async () => [{ id: '444555666', name: 'Acme WABA' }]),
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

  it('registers successfully without PIN when Meta verifyPhoneNumber reports status CONNECTED', async () => {
    meta.verifyPhoneNumber.mockResolvedValueOnce({
      id: '111222333',
      verified_name: 'Acme Support',
      status: 'CONNECTED',
    })

    const res = await saveConfig({ pin: undefined })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ success: true, saved: true, registered: true })
    expect(configInserts).toHaveLength(1)
    expect(configInserts[0].registered_at).toBeDefined()
    expect(configInserts[0].registered_at).not.toBeNull()
    expect(configInserts[0].last_registration_error).toBeNull()
  })

  it('safely skips registration and does NOT call registerPhoneNumber when number is not CONNECTED and no PIN is provided', async () => {
    meta.verifyPhoneNumber.mockResolvedValueOnce({
      id: '111222333',
      verified_name: 'Acme Support',
      status: 'PENDING',
    })

    const res = await saveConfig({ pin: undefined })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ success: true, saved: true, registered: false, registration_skipped: true })
    expect(meta.registerPhoneNumber).not.toHaveBeenCalled()
    expect(configInserts[0].registered_at).toBeNull()
    expect(body.notice).toContain('not yet registered for Cloud API')
  })

  it('calls registerPhoneNumber with PIN when number is not CONNECTED and 6-digit PIN is provided', async () => {
    meta.verifyPhoneNumber.mockResolvedValueOnce({
      id: '111222333',
      verified_name: 'Acme Support',
      status: 'PENDING',
    })
    meta.registerPhoneNumber.mockResolvedValueOnce({ success: true, alreadyRegistered: false })

    const res = await saveConfig({ pin: '123456' })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ success: true, saved: true, registered: true })
    expect(meta.registerPhoneNumber).toHaveBeenCalledWith({
      phoneNumberId: '111222333',
      accessToken: 'caller-supplied-token',
      pin: '123456',
    })
    expect(configInserts[0].registered_at).toBeDefined()
    expect(configInserts[0].registered_at).not.toBeNull()
  })

  it('fails registration and does not set registered_at when user supplies wrong PIN', async () => {
    meta.registerPhoneNumber.mockRejectedValueOnce({
      name: 'MetaApiError',
      message: 'The two-step verification PIN is wrong.',
      code: 136025,
    })

    const res = await saveConfig({ pin: '000000' })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ success: false, saved: true, registered: false })
    expect(configInserts[0].registered_at).toBeNull()
    expect(configInserts[0].last_registration_error).toContain('PIN is wrong')
  })

  it('clears registered_at without blind register when number is re-saved but Meta reports DISCONNECTED and no PIN is given', async () => {
    storedConfig = STORED_CONFIG
    meta.verifyPhoneNumber.mockResolvedValueOnce({
      id: '111222333',
      verified_name: 'Acme Support',
      status: 'DISCONNECTED',
    })

    const res = await saveConfig({ pin: undefined })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.registered).toBe(false)
    expect(meta.registerPhoneNumber).not.toHaveBeenCalled()
    expect(configUpdates[0].registered_at).toBeNull()
  })

  it('supports validate_only dry-run without writing to database', async () => {
    const res = await saveConfig({ validate_only: true })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.valid).toBe(true)
    expect(body.phone_info).toBeDefined()
    expect(configInserts).toHaveLength(0)
    expect(configUpdates).toHaveLength(0)
  })

  it('safely reuses existing decrypted token when updating config without re-entering token', async () => {
    storedConfig = STORED_CONFIG

    // Client passes masked token or omits access_token during a setting update
    const res = await saveConfig({ access_token: '••••••••••••••••', pin: '654321' })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(configUpdates).toHaveLength(1)
    expect(meta.verifyPhoneNumber).toHaveBeenCalledWith({
      phoneNumberId: '111222333',
      accessToken: 'plaintext-token',
    })
  })

  it('auto-discovers WABA ID when waba_id is omitted from manual connection payload', async () => {
    meta.discoverWabaAccounts.mockResolvedValueOnce([{ id: '444555666', name: 'Discovered WABA' }])
    meta.listWabaPhoneNumbers.mockResolvedValueOnce([{ id: '111222333' }])

    const res = await saveConfig({ waba_id: undefined })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(configInserts[0].waba_id).toBe('444555666')
    expect(meta.subscribeWabaToApp).toHaveBeenCalledWith({
      wabaId: '444555666',
      accessToken: 'caller-supplied-token',
    })
  })

  it('auto-selects Phone Number ID when phone_number_id is omitted and WABA has single phone number', async () => {
    meta.listWabaPhoneNumbers.mockResolvedValueOnce([{ id: '999888777' }])

    const res = await saveConfig({ phone_number_id: undefined, waba_id: '444555666' })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(configInserts[0].phone_number_id).toBe('999888777')
    expect(meta.verifyPhoneNumber).toHaveBeenCalledWith({
      phoneNumberId: '999888777',
      accessToken: 'caller-supplied-token',
    })
  })

  it('rejects with 400 when debugToken reports token is invalid or expired', async () => {
    process.env.META_APP_ID = 'app-123'
    process.env.META_APP_SECRET = 'secret-123'

    meta.debugToken.mockResolvedValueOnce({
      isValid: false,
      scopes: [],
      granularScopes: [],
    })

    const res = await saveConfig()
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/invalid or expired/i)
    expect(configInserts).toHaveLength(0)

    delete process.env.META_APP_ID
    delete process.env.META_APP_SECRET
  })

  it('rejects with 400 and names missing permissions when debugToken scopes lack required permissions', async () => {
    process.env.META_APP_ID = 'app-123'
    process.env.META_APP_SECRET = 'secret-123'

    meta.debugToken.mockResolvedValueOnce({
      isValid: true,
      scopes: ['whatsapp_business_messaging'], // missing whatsapp_business_management
      granularScopes: [],
    })

    const res = await saveConfig()
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('whatsapp_business_management')
    expect(configInserts).toHaveLength(0)

    delete process.env.META_APP_ID
    delete process.env.META_APP_SECRET
  })

  it('rejects with 400 when Phone Number ID does not belong to specified WABA', async () => {
    meta.listWabaPhoneNumbers.mockResolvedValueOnce([{ id: 'other-phone-id' }])

    const res = await saveConfig({ phone_number_id: '111222333', waba_id: '444555666' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/does not belong to/i)
    expect(configInserts).toHaveLength(0)
  })

  it('fails safely and does not persist row when subscribeWabaToApp fails', async () => {
    meta.subscribeWabaToApp.mockRejectedValueOnce({
      name: 'MetaApiError',
      message: 'Failed to subscribe webhook',
      status: 400,
      code: 100,
    })

    const res = await saveConfig()
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeDefined()
    expect(configInserts).toHaveLength(0)
    expect(configUpdates).toHaveLength(0)
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

  it('auto-synchronizes registered_at when Meta reports status CONNECTED and local registered_at is null', async () => {
    callerRole = 'admin'
    storedConfig = { ...STORED_CONFIG, registered_at: null }
    meta.verifyPhoneNumber.mockResolvedValueOnce({
      id: '111222333',
      verified_name: 'Acme Support',
      status: 'CONNECTED',
    })

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.connected).toBe(true)
    expect(configUpdates).toHaveLength(1)
    expect(configUpdates[0].registered_at).toBeDefined()
    expect(configUpdates[0].registered_at).not.toBeNull()
  })
})
