import { describe, expect, it, vi } from 'vitest'
import { logError, logInfo, logWarn, sanitizeLogPayload } from './logger'

describe('Observability Logger', () => {
  it('sanitizes sensitive keys and token strings in log context', () => {
    const raw = {
      accountId: 'acc-123',
      access_token: 'EAAG1234567890abcdefghijklmnopqrstuvwxyz',
      apiKey: 'sk-abcdef1234567890abcdef1234567890',
      nested: {
        password: 'supersecretpassword',
        safeKey: 'hello',
      },
      array: ['sk-12345678901234567890', 'normal string'],
    }

    const sanitized = sanitizeLogPayload(raw) as Record<string, unknown>

    expect(sanitized.accountId).toBe('acc-123')
    expect(sanitized.access_token).toBe('[REDACTED]')
    expect(sanitized.apiKey).toBe('[REDACTED]')
    const nested = sanitized.nested as Record<string, unknown>
    expect(nested.password).toBe('[REDACTED]')
    expect(nested.safeKey).toBe('hello')
  })

  it('logs structured errors without crashing', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    logError('webhook', new Error('Meta API 500 internal error'), {
      accountId: 'acc-1',
      access_token: 'EAAG_SECRET',
    })

    expect(consoleErrorSpy).toHaveBeenCalled()
    const loggedOutput = consoleErrorSpy.mock.calls[0][1] as string
    expect(loggedOutput).toContain('Meta API 500 internal error')
    expect(loggedOutput).toContain('acc-1')
    expect(loggedOutput).not.toContain('EAAG_SECRET')

    consoleErrorSpy.mockRestore()
  })
})
