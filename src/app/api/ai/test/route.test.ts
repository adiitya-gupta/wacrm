import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AiError } from '@/lib/ai/types'

const h = vi.hoisted(() => ({
  stored: null as { api_key: string; provider: string; base_url: string | null } | null,
  validateCalls: [] as { provider: string; apiKey: string; baseUrl: string | null }[],
  validateError: null as Error | null,
}))

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    }),
  },
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    accountId: 'acc-1',
    userId: 'user-1',
    role: 'admin',
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: h.stored, error: null }),
          }),
        }),
      }),
    },
  }),
  toErrorResponse: (err: unknown) => ({
    body: { error: err instanceof Error ? err.message : 'error' },
    status: 403,
  }),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (value: string) => `plain:${value}`,
}))

vi.mock('@/lib/ai/validate', () => ({
  validateAiCredentials: async (cfg: { provider: string; apiKey: string; baseUrl: string | null }) => {
    h.validateCalls.push({ provider: cfg.provider, apiKey: cfg.apiKey, baseUrl: cfg.baseUrl })
    if (h.validateError) throw h.validateError
  },
}))

import { POST } from './route'
import { __resetRateLimitForTests } from '@/lib/rate-limit'

function post(body: Record<string, unknown>) {
  return POST(
    new Request('http://t/api/ai/test', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  ) as unknown as Promise<{ status: number; body: Record<string, unknown> }>
}

beforeEach(() => {
  __resetRateLimitForTests()
  h.validateCalls = []
  h.validateError = null
  h.stored = {
    api_key: 'enc-key',
    provider: 'openai_compatible',
    base_url: 'https://8.8.8.8/v1',
  }
})

describe('POST /api/ai/test stored key reuse', () => {
  it('reuses the stored key against the stored endpoint', async () => {
    const res = await post({ provider: 'openai_compatible', model: 'm', base_url: 'https://8.8.8.8/v1/' })
    expect(res.status).toBe(200)
    expect(h.validateCalls).toEqual([
      { provider: 'openai_compatible', apiKey: 'plain:enc-key', baseUrl: 'https://8.8.8.8/v1/' },
    ])
  })

  it('never sends the stored key to a different base URL', async () => {
    const res = await post({ provider: 'openai_compatible', model: 'm', base_url: 'https://1.1.1.1/v1' })
    expect(res.status).toBe(400)
    expect(h.validateCalls).toHaveLength(0)
  })

  it('never sends the stored key to a different provider', async () => {
    const res = await post({ provider: 'openai', model: 'gpt-4o-mini' })
    expect(res.status).toBe(400)
    expect(h.validateCalls).toHaveLength(0)
  })

  it('accepts a freshly entered key for a new base URL', async () => {
    const res = await post({
      provider: 'openai_compatible',
      model: 'm',
      base_url: 'https://1.1.1.1/v1',
      api_key: 'new-key',
    })
    expect(res.status).toBe(200)
    expect(h.validateCalls).toEqual([
      { provider: 'openai_compatible', apiKey: 'new-key', baseUrl: 'https://1.1.1.1/v1' },
    ])
  })

  it('surfaces upstreamStatus and sanitized error message on provider rejection without returning key', async () => {
    h.validateError = new AiError(
      'OpenAI-compatible provider rejected the API key: HTTP 403 — Authentication error (code 10000)',
      { code: 'invalid_key', status: 401, upstreamStatus: 403 },
    )
    const res = await post({
      provider: 'openai_compatible',
      model: '@cf/meta/llama-3.1-8b-instruct',
      base_url: 'https://api.cloudflare.com/client/v4/accounts/acct-123/ai/run/@cf/meta/llama-3.1-8b-instruct',
      api_key: 'cf_secret_key_never_returned',
    })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({
      error: 'OpenAI-compatible provider rejected the API key: HTTP 403 — Authentication error (code 10000)',
      code: 'invalid_key',
      upstreamStatus: 403,
    })
    expect(JSON.stringify(res.body)).not.toContain('cf_secret_key_never_returned')
  })
})
