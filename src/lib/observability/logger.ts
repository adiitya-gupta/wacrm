/**
 * Production Observability & Error Monitoring.
 *
 * Provides structured error tracking across webhooks, AI auto-replies, cron jobs,
 * and background queues without exposing API tokens, secrets, or PII.
 */

export interface LogContext {
  accountId?: string | null
  userId?: string | null
  conversationId?: string | null
  contactId?: string | null
  action?: string | null
  [key: string]: unknown
}

const SENSITIVE_KEY_REGEX =
  /(?:access_?token|verify_?token|authorization|secret|password|api_?key|encryption_?key|token|bearer)/i

/**
 * Recursively sanitize an object to strip secrets before logging or dispatching.
 */
export function sanitizeLogPayload(data: unknown): unknown {
  if (data === null || data === undefined) return data
  if (typeof data === 'string') {
    // Mask potential token patterns
    if (data.length > 20 && /(?:sk-|wacrm_|EAAG)/i.test(data)) {
      return `${data.slice(0, 4)}...[REDACTED]...${data.slice(-4)}`
    }
    return data
  }
  if (typeof data !== 'object') return data

  if (Array.isArray(data)) {
    return data.map(sanitizeLogPayload)
  }

  const sanitized: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
    if (SENSITIVE_KEY_REGEX.test(key)) {
      sanitized[key] = '[REDACTED]'
    } else {
      sanitized[key] = sanitizeLogPayload(val)
    }
  }
  return sanitized
}

/**
 * Log structured error with contextual details and dispatch to external monitoring if configured.
 */
export function logError(
  subsystem: string,
  error: unknown,
  context?: LogContext,
): void {
  const errorMessage =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error'
  const errorStack = error instanceof Error ? error.stack : undefined

  const payload = {
    level: 'error',
    subsystem,
    message: errorMessage,
    context: context ? sanitizeLogPayload(context) : undefined,
    timestamp: new Date().toISOString(),
    stack: errorStack,
  }

  console.error(`[${subsystem}] ERROR:`, JSON.stringify(payload))

  // Dispatch to external alerting webhook if configured (e.g. Slack / Discord / OpsGenie)
  const alertWebhook = process.env.ERROR_ALERT_WEBHOOK_URL
  if (alertWebhook && typeof fetch === 'function') {
    void fetch(alertWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `🚨 [WACRM Error] ${subsystem}: ${errorMessage}`,
        details: payload,
      }),
      signal: AbortSignal.timeout(3000),
    }).catch(() => {
      // Swallowed: failure in error alerting must never crash the main application
    })
  }
}

/**
 * Log structured warning.
 */
export function logWarn(
  subsystem: string,
  message: string,
  context?: LogContext,
): void {
  const payload = {
    level: 'warn',
    subsystem,
    message,
    context: context ? sanitizeLogPayload(context) : undefined,
    timestamp: new Date().toISOString(),
  }
  console.warn(`[${subsystem}] WARN:`, JSON.stringify(payload))
}

/**
 * Log structured info.
 */
export function logInfo(
  subsystem: string,
  message: string,
  context?: LogContext,
): void {
  const payload = {
    level: 'info',
    subsystem,
    message,
    context: context ? sanitizeLogPayload(context) : undefined,
    timestamp: new Date().toISOString(),
  }
  console.info(`[${subsystem}] INFO:`, JSON.stringify(payload))
}
