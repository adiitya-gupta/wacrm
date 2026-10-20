import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  expireAwaitingReplies: vi.fn(),
  resumePendingExecution: vi.fn(),
  supabaseAdmin: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  lte: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  update: vi.fn(),
  maybeSingle: vi.fn(),
}))

vi.mock('@/lib/automations/engine', () => ({
  expireAwaitingReplies: mocks.expireAwaitingReplies,
  resumePendingExecution: mocks.resumePendingExecution,
}))

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}))

import { GET } from './route'

describe('GET /api/automations/cron', () => {
  const SECRET = 'test_automation_cron_secret_abcdef123456'

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.AUTOMATION_CRON_SECRET = SECRET
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test_service_role_key_secret'

    mocks.expireAwaitingReplies.mockResolvedValue(0)

    const queryChain: Record<string, unknown> = {}
    queryChain.select = mocks.select.mockReturnValue(queryChain)
    queryChain.eq = mocks.eq.mockReturnValue(queryChain)
    queryChain.lte = mocks.lte.mockReturnValue(queryChain)
    queryChain.order = mocks.order.mockReturnValue(queryChain)
    queryChain.limit = mocks.limit.mockResolvedValue({ data: [], error: null })
    queryChain.update = mocks.update.mockReturnValue(queryChain)
    queryChain.maybeSingle = mocks.maybeSingle.mockResolvedValue({ data: null, error: null })

    mocks.supabaseAdmin.mockReturnValue({
      from: vi.fn().mockReturnValue(queryChain),
    })
  })

  it('rejects with 503 when AUTOMATION_CRON_SECRET is unconfigured in environment', async () => {
    delete process.env.AUTOMATION_CRON_SECRET

    const req = new Request('http://localhost/api/automations/cron', {
      method: 'GET',
      headers: { 'x-cron-secret': SECRET },
    })

    const res = await GET(req)
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('cron not configured')
  })

  it('rejects with 401 when x-cron-secret header is missing', async () => {
    const req = new Request('http://localhost/api/automations/cron', {
      method: 'GET',
    })

    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('rejects with 401 when x-cron-secret header is incorrect', async () => {
    const req = new Request('http://localhost/api/automations/cron', {
      method: 'GET',
      headers: { 'x-cron-secret': 'wrong_secret' },
    })

    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('fails with 500 when NEXT_PUBLIC_SUPABASE_URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL

    const req = new Request('http://localhost/api/automations/cron', {
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

    const req = new Request('http://localhost/api/automations/cron', {
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
    queryChain.eq = vi.fn().mockReturnValue(queryChain)
    queryChain.lte = vi.fn().mockReturnValue(queryChain)
    queryChain.order = vi.fn().mockReturnValue(queryChain)
    queryChain.limit = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST205', message: "Could not find table 'automation_pending_executions'" },
    })

    mocks.supabaseAdmin.mockReturnValue({
      from: vi.fn().mockReturnValue(queryChain),
    })

    const req = new Request('http://localhost/api/automations/cron', {
      method: 'GET',
      headers: { 'x-cron-secret': SECRET },
    })

    const res = await GET(req)
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string; code?: string }
    expect(body.code).toBe('PGRST205')
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[automations-cron] Database query error'),
      expect.objectContaining({ code: 'PGRST205' }),
    )

    consoleSpy.mockRestore()
  })

  it('authorizes successfully and drains executions when x-cron-secret is valid', async () => {
    const req = new Request('http://localhost/api/automations/cron', {
      method: 'GET',
      headers: { 'x-cron-secret': SECRET },
    })

    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { processed: number; expired: number }
    expect(body).toEqual({ processed: 0, expired: 0 })
    expect(mocks.expireAwaitingReplies).toHaveBeenCalledTimes(1)
  })

  it('processes and claims due pending execution rows', async () => {
    const fakeRow = {
      id: 'row-1',
      automation_id: 'auto-1',
      account_id: 'acc-1',
      user_id: 'usr-1',
      contact_id: 'cont-1',
      log_id: 'log-1',
      parent_step_id: null,
      branch: null,
      next_step_position: 2,
      context: {},
    }

    const selectChain: Record<string, unknown> = {}
    selectChain.eq = vi.fn().mockReturnValue(selectChain)
    selectChain.lte = vi.fn().mockReturnValue(selectChain)
    selectChain.order = vi.fn().mockReturnValue(selectChain)
    selectChain.limit = vi.fn().mockResolvedValue({ data: [fakeRow], error: null })

    const updateChain: Record<string, unknown> = {}
    updateChain.eq = vi.fn().mockReturnValue(updateChain)
    updateChain.select = vi.fn().mockReturnValue(updateChain)
    updateChain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: 'row-1' }, error: null })

    mocks.supabaseAdmin.mockReturnValue({
      from: vi.fn((table: string) => ({
        select: vi.fn().mockReturnValue(selectChain),
        update: vi.fn().mockReturnValue(updateChain),
      })),
    })

    const req = new Request('http://localhost/api/automations/cron', {
      method: 'GET',
      headers: { 'x-cron-secret': SECRET },
    })

    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { processed: number; expired: number }
    expect(body.processed).toBe(1)
    expect(mocks.resumePendingExecution).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'row-1', automation_id: 'auto-1' }),
    )
  })

  it('handles expireAwaitingReplies failure gracefully and continues processing', async () => {
    mocks.expireAwaitingReplies.mockRejectedValue(new Error('Reply window lookup failed'))

    const req = new Request('http://localhost/api/automations/cron', {
      method: 'GET',
      headers: { 'x-cron-secret': SECRET },
    })

    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { processed: number; expired: number }
    expect(body).toEqual({ processed: 0, expired: 0 })
  })
})
