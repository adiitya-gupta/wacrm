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

  it('authorizes successfully when valid secret is in Authorization: Bearer header', async () => {
    const req = new Request('http://localhost/api/automations/cron', {
      method: 'GET',
      headers: { authorization: `Bearer ${SECRET}` },
    })

    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { processed: number; expired: number }
    expect(body).toEqual({ processed: 0, expired: 0 })
  })
})
