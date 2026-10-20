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
    delete process.env.SUPABASE_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test_service_role_key_secret'
    delete process.env.SUPABASE_SERVICE_KEY

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

  it('fails with 500 and diagnostic headers when URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.SUPABASE_URL

    const req = new Request('http://localhost/api/flows/cron', {
      method: 'GET',
      headers: { 'x-cron-secret': SECRET },
    })

    const res = await GET(req)
    expect(res.status).toBe(500)
    expect(res.headers.get('x-cron-error-step')).toBe('env_validation')
    expect(res.headers.get('x-cron-error-code')).toBe('MISSING_ENV')
    const body = (await res.json()) as { error: string; code: string; step: string; message: string }
    expect(body.step).toBe('env_validation')
    expect(body.message).toContain('NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL')
  })

  it('succeeds using fallback SUPABASE_URL when NEXT_PUBLIC_SUPABASE_URL is absent', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    process.env.SUPABASE_URL = 'https://fallback.supabase.co'

    const req = new Request('http://localhost/api/flows/cron', {
      method: 'GET',
      headers: { 'x-cron-secret': SECRET },
    })

    const res = await GET(req)
    expect(res.status).toBe(200)
  })

  it('fails with 500 and diagnostic headers when service key is missing', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    delete process.env.SUPABASE_SERVICE_KEY

    const req = new Request('http://localhost/api/flows/cron', {
      method: 'GET',
      headers: { 'x-cron-secret': SECRET },
    })

    const res = await GET(req)
    expect(res.status).toBe(500)
    expect(res.headers.get('x-cron-error-step')).toBe('env_validation')
    expect(res.headers.get('x-cron-error-code')).toBe('MISSING_ENV')
    const body = (await res.json()) as { error: string; code: string; step: string; message: string }
    expect(body.step).toBe('env_validation')
    expect(body.message).toContain('SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SERVICE_KEY')
  })

  it('succeeds using fallback SUPABASE_SERVICE_KEY when SUPABASE_SERVICE_ROLE_KEY is absent', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    process.env.SUPABASE_SERVICE_KEY = 'test_fallback_service_key'

    const req = new Request('http://localhost/api/flows/cron', {
      method: 'GET',
      headers: { 'x-cron-secret': SECRET },
    })

    const res = await GET(req)
    expect(res.status).toBe(200)
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
    expect(res.headers.get('x-cron-error-step')).toBe('active_run_scan')
    expect(res.headers.get('x-cron-error-code')).toBe('PGRST205')
    expect(res.headers.get('x-cron-error-message')).toContain("Could not find table 'flow_runs'")

    const body = (await res.json()) as { error: string; code: string; step: string }
    expect(body.code).toBe('PGRST205')
    expect(body.step).toBe('active_run_scan')
    expect(consoleSpy).toHaveBeenCalled()

    consoleSpy.mockRestore()
  })

  it('catches unexpected execution exceptions and returns 500 with diagnostic headers', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    mocks.supabaseAdmin.mockImplementation(() => {
      throw new Error('Flows admin client crash')
    })

    const req = new Request('http://localhost/api/flows/cron', {
      method: 'GET',
      headers: { 'x-cron-secret': SECRET },
    })

    const res = await GET(req)
    expect(res.status).toBe(500)
    expect(res.headers.get('x-cron-error-step')).toBe('handler_execution')
    expect(res.headers.get('x-cron-error-message')).toBe('Flows admin client crash')

    const body = (await res.json()) as { error: string; step: string; message: string }
    expect(body.step).toBe('handler_execution')
    expect(body.message).toBe('Flows admin client crash')

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
