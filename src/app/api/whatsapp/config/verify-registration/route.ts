import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  getSubscribedApps,
  verifyPhoneNumber,
  type MetaPhoneInfo,
} from '@/lib/whatsapp/meta-api'
import { explainMetaError } from '@/lib/whatsapp/meta-error-explain'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/**
 * GET /api/whatsapp/config/verify-registration
 *
 * Diagnostic endpoint — confirms the user's saved phone number is
 * actually reachable and registered on Meta's side. Solves the failure mode that
 * surfaced the multi-number bug: "UI says Connected but Meta isn't delivering events."
 *
 * Three checks run:
 *
 *   1. phone_metadata_ok — GET /{phone_number_id} succeeds and returns valid metadata
 *   2. waba_subscribed_to_app — our app appears in GET /{waba_id}/subscribed_apps
 *   3. locally_marked_registered — verified registration state:
 *        a. Meta returns status === 'CONNECTED', OR
 *        b. Modern PIN-less /register succeeds and updates local DB, OR
 *        c. If Meta status is not CONNECTED and PIN is required, returns clear guidance.
 *
 * Never trusts a local DB flag alone if Meta reports the number is not connected.
 * Returns 200 in every case so the UI can render diagnostic detail
 * rather than a generic error toast. The combined `live` flag is what the UI badges on.
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: t('common.unauthorized') }, { status: 401 })
  }

  const limit = await checkRateLimit(`whatsapp-admin:${user.id}`, RATE_LIMITS.whatsappAdmin)
  if (!limit.success) return rateLimitResponse(limit)

  // whatsapp_config is one-row-per-account post-017. Resolve the
  // caller's account_id so a teammate who joined an existing account
  // sees the same registration state as the admin who set it up.
  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const accountId = profile?.account_id as string | undefined
  if (!accountId) {
    return NextResponse.json({
      live: false,
      checks: { config_exists: false },
      message: t('common.profileNotLinked'),
    })
  }

  const { data: config } = await supabase
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()

  if (!config) {
    return NextResponse.json({
      live: false,
      checks: { config_exists: false },
      message: t('whatsappConfig.noConfigShort'),
    })
  }

  let accessToken: string
  try {
    accessToken = decrypt(config.access_token)
  } catch {
    return NextResponse.json({
      live: false,
      checks: {
        config_exists: true,
        token_decryptable: false,
      },
      message:
        t('whatsappConfig.tokenUndecryptable'),
    })
  }

  const checks: {
    config_exists: boolean
    token_decryptable: boolean
    phone_metadata_ok: boolean
    waba_subscribed_to_app: boolean | null
    locally_marked_registered: boolean
  } = {
    config_exists: true,
    token_decryptable: true,
    phone_metadata_ok: false,
    waba_subscribed_to_app: null,
    locally_marked_registered: false,
  }
  const errors: string[] = []

  // 1. Phone metadata & live registration status from Meta
  let phoneInfo: MetaPhoneInfo | null = null
  try {
    phoneInfo = await verifyPhoneNumber({
      phoneNumberId: config.phone_number_id,
      accessToken,
    })
    checks.phone_metadata_ok = true
  } catch (err) {
    errors.push(
      t('whatsappConfig.phoneCheckFailed', { message: err instanceof Error ? err.message : String(err) }),
    )
  }

  // 2. Authoritative registration verification
  // Never trust the local DB flag alone if Meta reports the number is not CONNECTED.
  let isRegistered = false
  const metaCtx = {
    phoneNumberId: config.phone_number_id,
    wabaId: config.waba_id,
  }

  if (phoneInfo?.status === 'CONNECTED') {
    isRegistered = true
    if (!config.registered_at) {
      const now = new Date().toISOString()
      await supabase
        .from('whatsapp_config')
        .update({
          registered_at: now,
          status: 'connected',
          last_registration_error: null,
        })
        .eq('account_id', accountId)
      config.registered_at = now
      config.last_registration_error = null
    }
  } else {
    // Phone number is not confirmed CONNECTED on Meta Cloud API.
    // We must NOT call registerPhoneNumber automatically without a PIN here:
    // 1. Meta rejects PIN-less registration with (#100) The parameter pin is required.
    // 2. Calling /register on an active WhatsApp Business mobile app number
    //    deregisters the mobile app and erases chat sessions.
    isRegistered = false
    errors.push(
      `Phone number is not registered on Cloud API (status: ${phoneInfo?.status || 'UNKNOWN'}). If this number is active on the WhatsApp Business mobile app, Cloud API registration requires a 6-digit PIN and will disconnect the mobile app.`,
    )
    if (config.registered_at) {
      await supabase
        .from('whatsapp_config')
        .update({
          registered_at: null,
          last_registration_error: 'Not registered with Cloud API on Meta',
        })
        .eq('account_id', accountId)
      config.registered_at = null
    }
  }

  checks.locally_marked_registered = isRegistered

  // 3. WABA subscription — only meaningful if we have a waba_id
  if (config.waba_id) {
    try {
      const subs = await getSubscribedApps({
        wabaId: config.waba_id,
        accessToken,
      })
      // Meta returns the apps subscribed to this WABA. If the list
      // is non-empty, OUR app is in there (the access_token we used
      // belongs to our app — Meta wouldn't return data for an app
      // the token can't see). Treat any entry as success.
      checks.waba_subscribed_to_app = subs.length > 0
      if (!checks.waba_subscribed_to_app) {
        errors.push(
          t('whatsappConfig.wabaNoApps'),
        )
      }
    } catch (err) {
      errors.push(
        t('whatsappConfig.wabaCheckFailed', { message: err instanceof Error ? err.message : String(err) }),
      )
    }
  } else {
    errors.push(
      t('whatsappConfig.noWabaId'),
    )
  }

  const live =
    checks.phone_metadata_ok &&
    (checks.waba_subscribed_to_app ?? false) &&
    checks.locally_marked_registered

  return NextResponse.json({
    live,
    checks,
    errors,
    phone_info: phoneInfo,
    last_registration_error: config.last_registration_error ?? null,
    registered_at: config.registered_at ?? null,
    subscribed_apps_at: config.subscribed_apps_at ?? null,
  })
}
