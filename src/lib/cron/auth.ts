import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

export interface CronAuthResult {
  authorized: boolean
  response?: NextResponse
}

/**
 * Extract cron secret from incoming request.
 * Supports both `x-cron-secret` custom header and standard
 * `Authorization: Bearer <secret>` header.
 */
export function extractCronSecret(request: Request): string {
  const directHeader = request.headers.get('x-cron-secret')
  if (directHeader && directHeader.trim()) {
    return directHeader.trim()
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader && authHeader.trim()) {
    const trimmed = authHeader.trim()
    if (trimmed.toLowerCase().startsWith('bearer ')) {
      return trimmed.slice(7).trim()
    }
    return trimmed
  }

  return ''
}

/**
 * Authenticate a scheduled cron request against `AUTOMATION_CRON_SECRET`.
 *
 * Security:
 * - 503 Service Unavailable if `AUTOMATION_CRON_SECRET` is not set in environment.
 * - 401 Unauthorized if secret is absent or mismatched.
 * - Constant-time comparison using `crypto.timingSafeEqual` to prevent timing attacks.
 */
export function authenticateCronRequest(request: Request): CronAuthResult {
  const expected = process.env.AUTOMATION_CRON_SECRET?.trim()
  if (!expected) {
    return {
      authorized: false,
      response: NextResponse.json({ error: 'cron not configured' }, { status: 503 }),
    }
  }

  const supplied = extractCronSecret(request)
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)

  if (
    suppliedBuf.length === 0 ||
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return {
      authorized: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  return { authorized: true }
}
