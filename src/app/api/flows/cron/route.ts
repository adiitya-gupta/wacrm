import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { resolveFallbackPolicy } from '@/lib/flows/fallback'
import { authenticateCronRequest } from '@/lib/cron/auth'
import { normalizeSupabaseUrl } from '@/lib/supabase/normalize-url'

interface ErrorWithPostgrestFields {
  code?: string
  message: string
  details?: string | null
  hint?: string | null
}

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

  const logMessage = `[flows-cron] [${step}] [${code}]: ${message}`
  console.error(logMessage, { details, hint })
  console.error(new Error(logMessage))

  const sanitizedHeaderMessage = message
    .slice(0, 200)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7E]/g, ' ')
    .trim()

  return NextResponse.json(
    {
      error: `Flows cron failed at ${step}`,
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
 * Sweep abandoned active flow runs.
 *
 * Reads each active run's parent-flow `fallback_policy.on_timeout_hours`
 * to compute the staleness cutoff (default 24h), then marks any run
 * past its cutoff as `timed_out`. Writes a matching `flow_run_events`
 * row for the audit trail.
 */
export async function GET(request: Request) {
  const auth = authenticateCronRequest(request)
  if (!auth.authorized) {
    return auth.response!
  }

  // Pre-flight check: ensure required Supabase credentials exist
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
    const admin = supabaseAdmin()
    const now = new Date()

    // Pull all currently-active runs along with their parent flow's
    // fallback_policy. Joined in one query — the small set of active
    // runs per tenant keeps this cheap.
    const { data: runs, error } = await admin
      .from('flow_runs')
      .select(
        'id, flow_id, user_id, contact_id, last_advanced_at, flows ( fallback_policy )',
      )
      .eq('status', 'active')

    if (error) {
      return cronErrorResponse(500, 'active_run_scan', error)
    }
    if (!runs?.length) return NextResponse.json({ swept: 0 })

    type Row = {
      id: string
      flow_id: string
      user_id: string
      contact_id: string | null
      last_advanced_at: string
      flows: { fallback_policy: unknown } | { fallback_policy: unknown }[] | null
    }

    let swept = 0
    for (const r of runs as Row[]) {
      try {
        const flowsField = Array.isArray(r.flows) ? r.flows[0] : r.flows
        const policy = resolveFallbackPolicy(flowsField?.fallback_policy ?? null)
        const lastAdvanced = new Date(r.last_advanced_at)
        const ageHours = (now.getTime() - lastAdvanced.getTime()) / (1000 * 60 * 60)
        if (ageHours < policy.on_timeout_hours) continue

        // Mark timed_out — guarded by the precondition `status='active'`
        // so concurrent advance from a late inbound doesn't overwrite a
        // legitimate update.
        const { data: updated, error: updateErr } = await admin
          .from('flow_runs')
          .update({
            status: 'timed_out',
            ended_at: now.toISOString(),
            end_reason: 'stale_sweep',
          })
          .eq('id', r.id)
          .eq('status', 'active')
          .select('id')

        if (updateErr) {
          console.error(
            `[flows-cron] [time_out_run] [${updateErr.code}]: Failed to time out flow run ${r.id}: ${updateErr.message}`,
          )
          continue
        }

        if (Array.isArray(updated) && updated.length > 0) {
          await admin.from('flow_run_events').insert({
            flow_run_id: r.id,
            event_type: 'timeout',
            payload: {
              age_hours: Math.round(ageHours * 10) / 10,
              policy_hours: policy.on_timeout_hours,
            },
          })
          swept += 1
        }
      } catch (runErr) {
        console.error(
          `[flows-cron] [process_run]: Error processing flow run ${r.id}:`,
          runErr instanceof Error ? runErr.message : String(runErr),
        )
      }
    }

    return NextResponse.json({ swept })
  } catch (err) {
    return cronErrorResponse(500, 'handler_execution', err instanceof Error ? err : String(err))
  }
}
