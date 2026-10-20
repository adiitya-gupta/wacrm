import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { expireAwaitingReplies, resumePendingExecution } from '@/lib/automations/engine'
import type { AutomationContext } from '@/lib/automations/engine'
import { authenticateCronRequest } from '@/lib/cron/auth'

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
  const hasUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim())
  const hasServiceKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim())
  if (!hasUrl || !hasServiceKey) {
    const missing = [
      !hasUrl ? 'NEXT_PUBLIC_SUPABASE_URL' : null,
      !hasServiceKey ? 'SUPABASE_SERVICE_ROLE_KEY' : null,
    ]
      .filter(Boolean)
      .join(', ')

    console.error('[automations-cron] Missing required environment variables:', {
      hasUrl,
      hasServiceKey,
      missing,
    })

    return NextResponse.json(
      { error: `Server misconfiguration: missing ${missing}` },
      { status: 500 },
    )
  }

  try {
    // Close out wait_for_reply runs whose 24h reply window lapsed. The
    // webhook already refuses to resume them; this just settles their
    // status and explains the outcome on the log.
    let expired = 0
    try {
      expired = await expireAwaitingReplies()
    } catch (expireErr) {
      console.error('[automations-cron] expireAwaitingReplies failed:', {
        error: expireErr instanceof Error ? expireErr.message : String(expireErr),
      })
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
      console.error('[automations-cron] Database query error on automation_pending_executions:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      })
      return NextResponse.json(
        {
          error: 'Failed to query due executions',
          code: error.code,
          message: error.message,
        },
        { status: 500 },
      )
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
          console.error('[automations-cron] Failed to claim execution row:', {
            rowId: row.id,
            code: claimErr.code,
            message: claimErr.message,
          })
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
        })
        processed++
      } catch (rowErr) {
        console.error('[automations-cron] Error processing pending execution row:', {
          rowId: row.id,
          error: rowErr instanceof Error ? rowErr.message : String(rowErr),
        })
      }
    }

    return NextResponse.json({ processed, expired })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[automations-cron] Unexpected error during execution:', {
      message,
      stack,
    })
    return NextResponse.json(
      { error: 'Internal automation cron failure', message },
      { status: 500 },
    )
  }
}
