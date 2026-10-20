import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { normalizeSupabaseUrl } from '@/lib/supabase/normalize-url'

// Lazy, shared service-role client for the AI auto-reply path.
// Mirrors src/lib/flows/admin-client.ts and src/lib/automations/admin-client.ts
// — the inbound webhook has no `auth.uid()`, so the bot reads config +
// conversation state and sends through the service role.
let _adminClient: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
    const rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
    const url = normalizeSupabaseUrl(rawUrl)
    const key = rawKey?.trim().replace(/^["']|["']$/g, '').trim()

    if (!url || !key) {
      throw new Error('Supabase AI admin client misconfigured')
    }

    _adminClient = createClient(
      url,
      key,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    )
  }
  return _adminClient
}

/** Exposed for tests to reset cached singleton. */
export function resetSupabaseAdminClient(): void {
  _adminClient = null
}
