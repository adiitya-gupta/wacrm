import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  supabaseAdmin: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
}))

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}))

import { GET } from './route'

describe('GET /api/flows/cron', () => {
  const SECRET = 'test_flows_cron_secret_1234567890abcdef'

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.AUTOMATION_CRON_SECRET = SECRET

    const queryChain: Record<string, unknown> = {}
    queryChain.select = mocks.select.mockReturnValue(queryChain)
    queryChain.eq = mocks.eq.mockResolvedValue({ data: [], error: null })
    queryChain.update = mocks.update.mockReturnValue(queryChain)
    queryChain.insert = mocks.insert.mockResolvedValue({ data: null, error: null })

    mocks.supabaseAdmin.mockReturnValue({
      from: vi.fn().mockReturnValue(queryChain),
    })
  })

  it('rejects with 503 when AUTOMATION_CRON_SECRET is unconfigured in environment', async () => {
    delete process.env.AUTOMATION_CRON_SECRET

    const req = new Request('http://localhost/api/flows/cron', {
      method: 'GET',
      headers: { 'x-cron-secret': SECRET },
    })

    const res = await GET(req)
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('cron not configured')
  })

  it('rejects with 401 when x-cron-secret header is missing', async () => {
    const req = new Request('http://localhost/api/flows/cron', {
      method: 'GET',
    })

    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('rejects with 401 when x-cron-secret header is incorrect', async () => {
    const req = new Request('http://localhost/api/flows/cron', {
      method: 'GET',
      headers: { 'x-cron-secret': 'wrong_secret' },
    })

    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('authorizes successfully and sweeps stale runs when x-cron-secret is valid', async () => {
    const req = new Request('http://localhost/api/flows/cron', {
      method: 'GET',
      headers: { 'x-cron-secret': SECRET },
    })

    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { swept: number }
    expect(body).toEqual({ swept: 0 })
  })

  it('authorizes successfully when valid secret is in Authorization: Bearer header', async () => {
    const req = new Request('http://localhost/api/flows/cron', {
      method: 'GET',
      headers: { authorization: `Bearer ${SECRET}` },
    })

    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { swept: number }
    expect(body).toEqual({ swept: 0 })
  })
})
