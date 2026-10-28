import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { expireAwaitingReplies, resumePendingExecution } from '@/lib/automations/engine'
import type { AutomationContext } from '@/lib/automations/engine'
import { authenticateCronRequest } from '@/lib/cron/auth'
import { normalizeSupabaseUrl } from '@/lib/supabase/normalize-url'

interface ErrorWithPostgrestFields {
  code?: string
  message: string
  details?: string | null
  hint?: string | null
}

/**
 * Safely format and return an error response for the automations cron endpoint.
 *
 * Guarantees:
 * 1. Single-line human-readable string to console.error (stderr).
 * 2. An Error instance with stack trace logged to console.error so Vercel Function
 *    monitoring flags it as a true serverless exception.
 * 3. Diagnostic response headers (`x-cron-error-step`, `x-cron-error-code`, `x-cron-error-message`)
 *    that appear directly in Vercel's Request Inspector panel.
 * 4. Detects upstream HTML payloads (e.g. from Supabase Studio dashboard URLs) and normalizes them
 *    to safe, descriptive error codes without logging or leaking raw HTML or secrets.
 * 5. Never logs or leaks secrets, authorization tokens, or customer data.
 */
function cronErrorResponse(
  status: number,
  step: string,
  error: ErrorWithPostgrestFields | Error | string,
) {
  let code =
    typeof error === 'object' && 'code' in error && error.code
      ? String(error.code)
      : error instanceof Error
        ? error.name || 'ERROR'
        : 'ERROR'

  let message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : error.message || 'Unknown error'

  const details = typeof error === 'object' && 'details' in error ? error.details : undefined
  const hint = typeof error === 'object' && 'hint' in error ? error.hint : undefined

  // Detect HTML responses from Supabase Studio / Dashboard or proxy
  const isHtml =
    message.trim().startsWith('<!DOCTYPE') ||
    message.trim().startsWith('<!doctype') ||
    message.trim().startsWith('<html') ||
    /<(?:title|head|body|div)[\s>]/i.test(message)

  if (isHtml) {
    code = 'HTML_NOT_JSON'
    message =
      'Received HTML document instead of JSON API response. Verify NEXT_PUBLIC_SUPABASE_URL is an API endpoint (https://<project-ref>.supabase.co), not a Supabase Studio / Dashboard URL.'
  }

  const logMessage = `[automations-cron] [${step}] [${code}]: ${message}`
  console.error(logMessage, { details, hint })
  console.error(new Error(logMessage))

  const sanitizedHeaderMessage = message
    .slice(0, 200)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7E]/g, ' ')
    .trim()

  return NextResponse.json(
    {
      error: `Automation cron failed at ${step}`,
      step,
      code,
      message,
      ...(details ? { details } : {}),
      ...(hint ? { hint } : {}),
    },
    {
      status,
      headers: {
        'x-cron-error-step': step,
        'x-cron-error-code': code,
        'x-cron-error-message': sanitizedHeaderMessage,
      },
    },
  )
}

/**
 * Drain due `automation_pending_executions` rows. Meant to be hit
 * on a schedule (external scheduler / pinger) — requires a shared
 * secret via `x-cron-secret` or `Authorization: Bearer <secret>` to match
 * `AUTOMATION_CRON_SECRET`.
 *
 * The claim step (status = 'running') serves as a simple lock so
 * overlapping invocations don't double-process rows. Best-effort
 * only; expensive SELECT ... FOR UPDATE is avoided in favor of a
 * two-step UPDATE-by-id.
 */
export async function GET(request: Request) {
  const auth = authenticateCronRequest(request)
  if (!auth.authorized) {
    return auth.response!
  }

  // Pre-flight check: ensure required Supabase credentials exist in the environment
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY

  let url = ''
  try {
    url = normalizeSupabaseUrl(rawUrl)
  } catch (urlErr) {
    return cronErrorResponse(500, 'env_validation', {
      code: 'INVALID_SUPABASE_URL',
      message: urlErr instanceof Error ? urlErr.message : String(urlErr),
    })
  }

  const key = rawKey?.trim().replace(/^["']|["']$/g, '').trim()
  const hasUrl = Boolean(url)
  const hasServiceKey = Boolean(key)

  if (!hasUrl || !hasServiceKey) {
    const missing = [
      !hasUrl ? 'NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL' : null,
      !hasServiceKey ? 'SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SERVICE_KEY' : null,
    ]
      .filter(Boolean)
      .join(', ')

    return cronErrorResponse(500, 'env_validation', {
      code: 'MISSING_ENV',
      message: `Server misconfiguration: missing ${missing}`,
    })
  }

  try {
    // Close out wait_for_reply runs whose 24h reply window lapsed. The
    // webhook already refuses to resume them; this just settles their
    // status and explains the outcome on the log.
    let expired = 0
    try {
      expired = await expireAwaitingReplies()
    } catch (expireErr) {
      console.error(
        '[automations-cron] [expire_awaiting_replies]: non-fatal error expiring old runs:',
        expireErr instanceof Error ? expireErr.message : String(expireErr),
      )
      // Non-fatal: do not block draining pending executions if expiring replies fails
    }

    const admin = supabaseAdmin()
    const { data: due, error } = await admin
      .from('automation_pending_executions')
      .select('*')
      .eq('status', 'pending')
      .lte('run_at', new Date().toISOString())
      .order('run_at', { ascending: true })
      .limit(50)

    if (error) {
      return cronErrorResponse(500, 'query_due_executions', error)
    }

    if (!due || due.length === 0) {
      return NextResponse.json({ processed: 0, expired })
    }

    let processed = 0
    for (const row of due) {
      try {
        const { data: claim, error: claimErr } = await admin
          .from('automation_pending_executions')
          .update({ status: 'running' })
          .eq('id', row.id)
          .eq('status', 'pending')
          .select('id')
          .maybeSingle()

        if (claimErr) {
          console.error(
            `[automations-cron] [claim_row] [${claimErr.code}]: Failed to claim row ${row.id}: ${claimErr.message}`,
          )
          continue
        }
        if (!claim) continue

        await resumePendingExecution({
          id: row.id as string,
          automation_id: row.automation_id as string,
          account_id: row.account_id as string,
          user_id: row.user_id as string,
          contact_id: (row.contact_id as string | null) ?? null,
          log_id: (row.log_id as string | null) ?? null,
          parent_step_id: (row.parent_step_id as string | null) ?? null,
          branch: (row.branch as 'yes' | 'no' | null) ?? null,
          next_step_position: row.next_step_position as number,
          context: (row.context as AutomationContext) ?? {},
          created_at: row.created_at as string | undefined,
        })
        processed++
      } catch (rowErr) {
        console.error(
          `[automations-cron] [resume_row]: Error processing pending execution row ${row.id}:`,
          rowErr instanceof Error ? rowErr.message : String(rowErr),
        )
      }
    }

    return NextResponse.json({ processed, expired })
  } catch (err) {
    return cronErrorResponse(500, 'handler_execution', err instanceof Error ? err : String(err))
  }
}
