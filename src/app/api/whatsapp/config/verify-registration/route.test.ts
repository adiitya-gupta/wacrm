import { beforeEach, describe, expect, it, vi } from 'vitest'

let signedIn = true
const configUpdates: Record<string, unknown>[] = []

const STORED_CONFIG = {
  id: 'cfg-1',
  phone_number_id: '111222333',
  waba_id: '444555666',
  access_token: 'enc-token',
  status: 'connected',
  registered_at: null as string | null,
  last_registration_error: null as string | null,
  subscribed_apps_at: '2026-01-01T00:00:00.000Z',
  verify_token: null,
}

let storedConfig: typeof STORED_CONFIG | null = null

function makeSupabaseMock() {
  function builder(table: string) {
    const result = () => {
      switch (table) {
        case 'profiles':
          return {
            data: { account_id: 'acct-1', account_role: 'admin' },
            error: null,
          }
        case 'whatsapp_config':
          return { data: storedConfig, error: null }
        default:
          return { data: null, error: null }
      }
    }

    const b: Record<string, unknown> = {}
    const chain = () => b
    for (const m of ['select', 'eq', 'neq']) b[m] = vi.fn(chain)
    b.update = vi.fn((patch: Record<string, unknown>) => {
      if (table === 'whatsapp_config') configUpdates.push(patch)
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

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'plaintext-token'),
  encrypt: vi.fn(() => 'enc-token'),
}))

const meta = vi.hoisted(() => ({
  verifyPhoneNumber: vi.fn(async () => ({
    id: '111222333',
    display_phone_number: '+1 555-0100',
    verified_name: 'Acme Support',
    status: 'CONNECTED',
  })),
  registerPhoneNumber: vi.fn(async () => ({ success: true, alreadyRegistered: false })),
  getSubscribedApps: vi.fn(async () => [
    {
      whatsapp_business_api_data: {
        id: 'APP1',
        name: 'Wattomation',
      },
    },
  ]),
}))
vi.mock('@/lib/whatsapp/meta-api', () => meta)

import { GET } from './route'
import { __resetRateLimitForTests } from '@/lib/rate-limit'

beforeEach(() => {
  __resetRateLimitForTests()
  signedIn = true
  storedConfig = { ...STORED_CONFIG }
  configUpdates.length = 0
  supabaseMock = makeSupabaseMock()
  for (const fn of Object.values(meta)) fn.mockClear()
})

describe('GET /api/whatsapp/config/verify-registration', () => {
  it('returns 401 when user is not signed in', async () => {
    signedIn = false

    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('heals and synchronizes local DB when Meta authoritatively reports status CONNECTED', async () => {
    storedConfig = { ...STORED_CONFIG, registered_at: null }
    meta.verifyPhoneNumber.mockResolvedValueOnce({
      id: '111222333',
      display_phone_number: '+1 555-0100',
      verified_name: 'Acme Support',
      status: 'CONNECTED',
    })

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.live).toBe(true)
    expect(body.checks.locally_marked_registered).toBe(true)
    expect(body.checks.phone_metadata_ok).toBe(true)
    expect(body.checks.waba_subscribed_to_app).toBe(true)
    expect(configUpdates).toHaveLength(1)
    expect(configUpdates[0].registered_at).toBeDefined()
    expect(configUpdates[0].registered_at).not.toBeNull()
    expect(configUpdates[0].status).toBe('connected')
  })

  it('does NOT automatically call registerPhoneNumber and reports not live when Meta status is not CONNECTED', async () => {
    storedConfig = { ...STORED_CONFIG, registered_at: null }
    meta.verifyPhoneNumber.mockResolvedValueOnce({
      id: '111222333',
      display_phone_number: '+1 555-0100',
      verified_name: 'Acme Support',
      status: 'PENDING',
    })

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.live).toBe(false)
    expect(meta.registerPhoneNumber).not.toHaveBeenCalled()
    expect(body.checks.locally_marked_registered).toBe(false)
    expect(body.errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/not registered on Cloud API/i)]),
    )
  })

  it('does NOT trust local DB flag alone when Meta reports status DISCONNECTED', async () => {
    // Local DB previously had registered_at set
    storedConfig = { ...STORED_CONFIG, registered_at: '2026-01-01T00:00:00.000Z' }
    meta.verifyPhoneNumber.mockResolvedValueOnce({
      id: '111222333',
      display_phone_number: '+1 555-0100',
      verified_name: 'Acme Support',
      status: 'DISCONNECTED',
    })

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.live).toBe(false)
    expect(meta.registerPhoneNumber).not.toHaveBeenCalled()
    expect(body.checks.locally_marked_registered).toBe(false)
    expect(body.errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/not registered on Cloud API/i)]),
    )
    expect(configUpdates).toHaveLength(1)
    expect(configUpdates[0].registered_at).toBeNull()
  })

  it('fails with live=false and surfaces WABA subscription error when no apps are subscribed', async () => {
    meta.getSubscribedApps.mockResolvedValueOnce([])

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.live).toBe(false)
    expect(body.checks.waba_subscribed_to_app).toBe(false)
  })
})
