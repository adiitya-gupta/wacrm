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
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test_service_role_key_secret'

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

  it('fails with 500 when NEXT_PUBLIC_SUPABASE_URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL

    const req = new Request('http://localhost/api/flows/cron', {
      method: 'GET',
      headers: { 'x-cron-secret': SECRET },
    })

    const res = await GET(req)
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('NEXT_PUBLIC_SUPABASE_URL')
  })

  it('fails with 500 when SUPABASE_SERVICE_ROLE_KEY is missing', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY

    const req = new Request('http://localhost/api/flows/cron', {
      method: 'GET',
      headers: { 'x-cron-secret': SECRET },
    })

    const res = await GET(req)
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('SUPABASE_SERVICE_ROLE_KEY')
  })

  it('fails with 500 and exposes structured error when Supabase query returns an error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const queryChain: Record<string, unknown> = {}
    queryChain.select = vi.fn().mockReturnValue(queryChain)
    queryChain.eq = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST205', message: "Could not find table 'flow_runs'" },
    })

    mocks.supabaseAdmin.mockReturnValue({
      from: vi.fn().mockReturnValue(queryChain),
    })

    const req = new Request('http://localhost/api/flows/cron', {
      method: 'GET',
      headers: { 'x-cron-secret': SECRET },
    })

    const res = await GET(req)
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string; code?: string }
    expect(body.code).toBe('PGRST205')
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[flows-cron] active-run scan failed'),
      expect.objectContaining({ code: 'PGRST205' }),
    )

    consoleSpy.mockRestore()
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
})
