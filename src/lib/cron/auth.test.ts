import { beforeEach, describe, expect, it } from 'vitest'
import { authenticateCronRequest, extractCronSecret } from './auth'

describe('Cron Authentication Utility', () => {
  const SECRET = 'test_cron_secret_1234567890abcdef'

  beforeEach(() => {
    process.env.AUTOMATION_CRON_SECRET = SECRET
  })

  it('rejects with 503 when AUTOMATION_CRON_SECRET is unconfigured', async () => {
    delete process.env.AUTOMATION_CRON_SECRET

    const req = new Request('http://localhost/api/automations/cron', {
      headers: { 'x-cron-secret': SECRET },
    })

    const res = authenticateCronRequest(req)
    expect(res.authorized).toBe(false)
    expect(res.response?.status).toBe(503)
    const body = (await res.response?.json()) as { error: string }
    expect(body.error).toBe('cron not configured')
  })

  it('rejects with 401 when secret header is completely missing', async () => {
    const req = new Request('http://localhost/api/automations/cron')

    const res = authenticateCronRequest(req)
    expect(res.authorized).toBe(false)
    expect(res.response?.status).toBe(401)
  })

  it('rejects with 401 when incorrect secret is provided', async () => {
    const req = new Request('http://localhost/api/automations/cron', {
      headers: { 'x-cron-secret': 'wrong_secret' },
    })

    const res = authenticateCronRequest(req)
    expect(res.authorized).toBe(false)
    expect(res.response?.status).toBe(401)
  })

  it('authorizes successfully when valid secret is in x-cron-secret', () => {
    const req = new Request('http://localhost/api/automations/cron', {
      headers: { 'x-cron-secret': SECRET },
    })

    const res = authenticateCronRequest(req)
    expect(res.authorized).toBe(true)
    expect(res.response).toBeUndefined()
  })

  it('authorizes successfully when valid secret is in Authorization: Bearer <token>', () => {
    const req = new Request('http://localhost/api/automations/cron', {
      headers: { authorization: `Bearer ${SECRET}` },
    })

    const res = authenticateCronRequest(req)
    expect(res.authorized).toBe(true)
    expect(res.response).toBeUndefined()
  })

  it('extractCronSecret extracts token correctly from both headers', () => {
    const req1 = new Request('http://localhost/api/cron', {
      headers: { 'x-cron-secret': 'my-secret' },
    })
    expect(extractCronSecret(req1)).toBe('my-secret')

    const req2 = new Request('http://localhost/api/cron', {
      headers: { authorization: 'Bearer bearer-secret' },
    })
    expect(extractCronSecret(req2)).toBe('bearer-secret')

    const req3 = new Request('http://localhost/api/cron')
    expect(extractCronSecret(req3)).toBe('')
  })
})
