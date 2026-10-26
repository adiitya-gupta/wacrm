import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import {
  ForbiddenError,
  UnauthorizedError,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import {
  debugToken,
  discoverWabaAccounts,
  getSubscribedApps,
  listWabaPhoneNumbers,
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api'
import {
  explainMetaError,
  metaErrorPayload,
  type MetaConnectStep,
  type MetaErrorContext,
} from '@/lib/whatsapp/meta-error-explain'
import {
  appSubscriptionState,
  describeWabaPhoneMismatch,
  isNumericMetaId,
  phoneNumberBelongsToWaba,
} from '@/lib/whatsapp/waba-pairing'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { resolveVerifyTokenForSave } from '@/lib/whatsapp/verify-token'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/**
 * Resolve the caller's account_id from their profile. Inlined here
 * (rather than going through `@/lib/auth/account.getCurrentAccount`)
 * because the GET handler wants to return shaped 200s for every
 * non-auth failure mode, not throw — keeping the helper minimal lets
 * the existing response branches stay as-is.
 *
 * Returns null if the user has no profile or no account; callers
 * should treat that the same as "not connected".
 */
async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data?.account_id) return null
  return data.account_id as string
}

// Lazy-initialised service-role client. We need it to detect a
// phone_number_id already claimed by a *different* user — under RLS,
// the user's own session can't see other users' rows, so the conflict
// would be invisible without the service role.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

/**
 * Shape every failed Meta call into `{ error, meta }` — the actionable
 * text plus the code / subcode / fbtrace_id / step a user can quote to
 * Meta support. Status is 400 when the fix is on the user's side (token,
 * ids, PIN) and 502 when Meta has to change something (issue #505).
 */
function metaFailure(err: unknown, step: MetaConnectStep, ctx: MetaErrorContext) {
  const explained = explainMetaError(err, step, ctx)
  console.error(`[whatsapp/config] Meta ${step} failed:`, explained.metaMessage, {
    code: explained.code,
    subcode: explained.subcode,
    fbtrace_id: explained.fbtraceId,
  })
  return NextResponse.json(
    { error: explained.summary, meta: metaErrorPayload(explained) },
    { status: explained.httpStatus },
  )
}

/**
 * GET /api/whatsapp/config
 *
 * Used by the "Test API Connection" button and by the page to check
 * whether the saved config is healthy. Returns 200 in all non-auth cases
 * so the UI can render an appropriate message rather than show a 500.
 *
 * Response shape:
 *   { connected: true,  phone_info: {...},
 *     waba_subscription: { checked, subscribed, app_id_match, error? } }
 *   { connected: false, reason: 'no_config',        message: '...' }
 *   { connected: false, reason: 'token_corrupted',  message: '...', needs_reset: true }
 *   { connected: false, reason: 'meta_api_error',   message: '...',
 *     meta: { code, subcode, fbtrace_id, step, field, message } }
 */
export async function GET() {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: t('common.unauthorized') }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_account',
          message: t('common.profileNotLinked'),
        },
        { status: 200 },
      )
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, waba_id, access_token, status, registered_at')
      .eq('account_id', accountId)
      .maybeSingle()

    if (configError) {
      console.error('Error fetching whatsapp_config:', configError)
      return NextResponse.json(
        { connected: false, reason: 'db_error', message: t('whatsappConfig.fetchFailed') },
        { status: 200 }
      )
    }

    if (!config) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_config',
          message: t('whatsappConfig.noConfig'),
        },
        { status: 200 }
      )
    }

    // Try to decrypt the stored token with the current ENCRYPTION_KEY.
    // If this fails, the key changed (or was never consistent across envs).
    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch (err) {
      console.error('[whatsapp/config GET] Token decryption failed:', err)
      return NextResponse.json(
        {
          connected: false,
          reason: 'token_corrupted',
          needs_reset: true,
          message:
            t('whatsappConfig.tokenCorrupted'),
        },
        { status: 200 }
      )
    }

    // Validate credentials against Meta
    let phoneInfo
    try {
      phoneInfo = await verifyPhoneNumber({
        phoneNumberId: config.phone_number_id,
        accessToken,
      })
    } catch (err) {
      const explained = explainMetaError(err, 'verify_number', {
        phoneNumberId: config.phone_number_id,
        wabaId: config.waba_id,
      })
      console.error('[whatsapp/config GET] Meta API verification failed:', explained.metaMessage)
      return NextResponse.json(
        {
          connected: false,
          reason: 'meta_api_error',
          message: explained.summary,
          meta: metaErrorPayload(explained),
        },
        { status: 200 }
      )
    }

    // If Meta authoritatively confirms the phone number is CONNECTED and registered
    // on the Cloud API, synchronize registered_at in DB if it was previously null.
    if (phoneInfo?.status === 'CONNECTED' && !config.registered_at) {
      const now = new Date().toISOString()
      const { error: syncError } = await supabase
        .from('whatsapp_config')
        .update({ registered_at: now, status: 'connected', last_registration_error: null })
        .eq('account_id', accountId)
      if (!syncError) {
        config.registered_at = now
      }
    }

    // Credentials work. Also report whether the WABA is subscribed to
    // this app — valid credentials with an unsubscribed WABA is exactly
    // the "connected but no messages arrive" state (issue #505). Never
    // fatal: the token may lack whatsapp_business_management and still
    // be fine for sending.
    let wabaSubscription: {
      checked: boolean
      subscribed: boolean | null
      app_id_match: boolean | null
      error?: string
    } = { checked: false, subscribed: null, app_id_match: null }
    if (config.waba_id) {
      try {
        const subs = await getSubscribedApps({ wabaId: config.waba_id, accessToken })
        const state = appSubscriptionState(subs, process.env.META_APP_ID)
        wabaSubscription = {
          checked: true,
          subscribed: state.subscribed,
          app_id_match: state.appIdMatch,
        }
      } catch (err) {
        const explained = explainMetaError(err, 'subscribed_apps', { wabaId: config.waba_id })
        wabaSubscription = {
          checked: true,
          subscribed: null,
          app_id_match: null,
          error: explained.summary,
        }
      }
    }

    return NextResponse.json({
      connected: true,
      phone_info: phoneInfo,
      waba_subscription: wabaSubscription,
    })
  } catch (error) {
    console.error('Error in WhatsApp config GET:', error)
    return NextResponse.json(
      { connected: false, reason: 'unknown', message: t('common.internalServerError') },
      { status: 500 }
    )
  }
}

/**
 * POST /api/whatsapp/config
 *
 * Saves or updates the WhatsApp config for the authenticated user.
 * Verifies credentials with Meta first, then encrypts and stores.
 *
 * Every Meta failure answers `{ error, meta: { code, subcode,
 * fbtrace_id, step, field, message } }` — `error` is the actionable
 * text, `meta` is what to quote to Meta support. 400 = fix it on the
 * form (token / ids / PIN), 502 = Meta has to change something.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = await checkRateLimit(`whatsapp-admin:${accountId}:${userId}`, RATE_LIMITS.whatsappAdmin)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json()
    const { phone_number_id, waba_id, access_token, verify_token, pin, validate_only } = body

    // 1. Look up any pre-existing row for this account early to support:
    //    a) safe credential updates without re-entering the token if unchanged
    //    b) reusing verified phone_number_id or waba_id if omitted during update
    const { data: existing } = await supabase
      .from('whatsapp_config')
      .select('id, registered_at, phone_number_id, waba_id, access_token, verify_token')
      .eq('account_id', accountId)
      .maybeSingle()

    let resolvedToken = typeof access_token === 'string' ? access_token.trim() : ''
    const MASKED_TOKEN = '••••••••••••••••'
    if ((!resolvedToken || resolvedToken === MASKED_TOKEN) && existing?.access_token) {
      try {
        resolvedToken = decrypt(existing.access_token)
      } catch (decErr) {
        console.error('[whatsapp/config POST] Failed to decrypt existing token for update:', decErr)
        return NextResponse.json(
          { error: t('whatsappConfig.tokenCorrupted') },
          { status: 400 }
        )
      }
    }

    let resolvedPhoneNumberId = typeof phone_number_id === 'string' ? phone_number_id.trim() : ''
    let resolvedWabaId = typeof waba_id === 'string' ? waba_id.trim() : ''

    if (!resolvedPhoneNumberId && existing?.phone_number_id) {
      resolvedPhoneNumberId = existing.phone_number_id
    }
    if (!resolvedWabaId && existing?.waba_id) {
      resolvedWabaId = existing.waba_id
    }

    if (!resolvedToken) {
      return NextResponse.json(
        { error: t('whatsappConfig.credentialsRequired') },
        { status: 400 }
      )
    }

    let fetchedWabaNumbers: Array<{ id: string; display_phone_number?: string; verified_name?: string }> | null = null
    // Auto-discovery: If waba_id is known but phone_number_id is omitted,
    // list phone numbers under the WABA. If exactly one exists, auto-select it.
    if (!resolvedPhoneNumberId && resolvedWabaId && isNumericMetaId(resolvedWabaId)) {
      try {
        const wabaNumbers = await listWabaPhoneNumbers({
          wabaId: resolvedWabaId,
          accessToken: resolvedToken,
        })
        fetchedWabaNumbers = wabaNumbers
        if (wabaNumbers.length === 1 && wabaNumbers[0].id) {
          resolvedPhoneNumberId = wabaNumbers[0].id
        } else if (wabaNumbers.length > 1) {
          return NextResponse.json(
            {
              error: 'Multiple phone numbers were found under this WhatsApp Business Account. Please specify the Phone Number ID to connect.',
              field: 'phone_number_id',
            },
            { status: 400 }
          )
        }
      } catch {
        // Will be validated below
      }
    }

    // Auto-discovery: If phone_number_id is known but waba_id is omitted,
    // attempt to discover accessible WABA accounts that own this number.
    if (!resolvedWabaId && resolvedPhoneNumberId && isNumericMetaId(resolvedPhoneNumberId)) {
      try {
        const discovered = await discoverWabaAccounts({ accessToken: resolvedToken })
        for (const acct of discovered) {
          try {
            const numbers = await listWabaPhoneNumbers({
              wabaId: acct.id,
              accessToken: resolvedToken,
            })
            if (phoneNumberBelongsToWaba(numbers, resolvedPhoneNumberId)) {
              resolvedWabaId = acct.id
              fetchedWabaNumbers = numbers
              break
            }
          } catch {
            // Check next
          }
        }
      } catch {
        // Discovery optional; handled below if still missing
      }
    }

    if (!resolvedPhoneNumberId) {
      return NextResponse.json(
        { error: t('whatsappConfig.credentialsRequired') },
        { status: 400 }
      )
    }

    // Meta ids are decimal digit strings. Catch the classic paste
    // mistakes (the +phone number, a display name, a URL) here with a
    // named field, instead of letting Meta answer "(#100) Unsupported
    // get request" for a value we could have rejected up front.
    if (!isNumericMetaId(resolvedPhoneNumberId)) {
      return NextResponse.json(
        {
          error: t('whatsappConfig.phoneIdDigits'),
          field: 'phone_number_id',
        },
        { status: 400 }
      )
    }
    if (resolvedWabaId !== undefined && resolvedWabaId !== null && resolvedWabaId !== '' && !isNumericMetaId(resolvedWabaId)) {
      return NextResponse.json(
        {
          error: t('whatsappConfig.wabaIdDigits'),
          field: 'waba_id',
        },
        { status: 400 }
      )
    }
    const metaCtx: MetaErrorContext = { phoneNumberId: resolvedPhoneNumberId, wabaId: resolvedWabaId || null }

    if (pin !== undefined && pin !== null && pin !== '') {
      if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
        return NextResponse.json(
          { error: t('whatsappConfig.pinDigits') },
          { status: 400 }
        )
      }
    }

    // Inspect token permissions via debugToken when Meta App credentials exist
    const appId = (process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID || '').trim()
    const appSecret = (process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET || '').trim()
    if (appId && appSecret) {
      try {
        const tokenData = await debugToken({
          inputToken: resolvedToken,
          appId,
          appSecret,
        })
        if (tokenData?.isValid === false) {
          return NextResponse.json(
            { error: 'The access token is invalid or expired according to Meta.' },
            { status: 400 }
          )
        }
        const scopeNames = (tokenData.scopes || []).map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean)
        const granularScopeNames = (tokenData.granularScopes || []).map((gs) => (typeof gs?.scope === 'string' ? gs.scope.trim() : '')).filter(Boolean)
        const allScopes = new Set([...scopeNames, ...granularScopeNames])
        if (allScopes.size > 0) {
          const required = ['whatsapp_business_management', 'whatsapp_business_messaging']
          const missing = required.filter((s) => !allScopes.has(s))
          if (missing.length > 0) {
            return NextResponse.json(
              {
                error: `The provided access token is missing required WhatsApp permissions: ${missing.join(', ')}. Please generate a token with both permissions in Meta Business Suite.`,
                field: 'access_token',
              },
              { status: 400 }
            )
          }
        }
      } catch (debugErr) {
        console.warn('[whatsapp/config] debugToken notice:', debugErr instanceof Error ? debugErr.message : debugErr)
      }
    }

    // Reject if another account has already claimed this phone_number_id.
    // wacrm is single-tenant-per-WhatsApp-number — letting two accounts
    // bind the same number causes the webhook's `.single()` lookup to
    // throw PGRST116 ("multiple rows"), silently dropping every
    // inbound message. See issue #136. Post-multi-user we key on
    // account_id (not user_id) since teammates inside the same account
    // all share one config; the conflict is between accounts.
    const { data: claimed, error: claimedError } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('account_id')
      .eq('phone_number_id', resolvedPhoneNumberId)
      .neq('account_id', accountId)
      .maybeSingle()

    if (claimedError) {
      console.error('Error checking phone_number_id ownership:', claimedError)
      return NextResponse.json(
        { error: t('whatsappConfig.validateFailed') },
        { status: 500 }
      )
    }

    if (claimed) {
      return NextResponse.json(
        {
          error: t('whatsappConfig.numberLinkedElsewhere'),
        },
        { status: 409 }
      )
    }

    // Verify credentials with Meta BEFORE saving
    let phoneInfo
    try {
      phoneInfo = await verifyPhoneNumber({
        phoneNumberId: resolvedPhoneNumberId,
        accessToken: resolvedToken,
      })
    } catch (err) {
      return metaFailure(err, 'verify_number', metaCtx)
    }

    // The number resolves — now make sure it lives under the WABA the
    // user typed. A foreign-but-valid WABA ID used to save fine and
    // subscribe the *wrong* account, surfacing days later as a webhook
    // that never fires. Failing here names the mismatch instead.
    if (resolvedWabaId) {
      let wabaNumbers = fetchedWabaNumbers
      if (!wabaNumbers) {
        try {
          wabaNumbers = await listWabaPhoneNumbers({
            wabaId: resolvedWabaId,
            accessToken: resolvedToken,
          })
        } catch (err) {
          return metaFailure(err, 'waba_phone_numbers', metaCtx)
        }
      }
      if (!phoneNumberBelongsToWaba(wabaNumbers, resolvedPhoneNumberId)) {
        return NextResponse.json(
          {
            error: describeWabaPhoneMismatch(wabaNumbers, resolvedPhoneNumberId, resolvedWabaId),
            field: 'waba_id',
            meta: {
              code: null,
              subcode: null,
              fbtrace_id: null,
              step: 'waba_phone_numbers',
              field: 'waba_id',
              message: 'phone_number_id is not listed under waba_id',
            },
          },
          { status: 400 }
        )
      }
    }

    if (validate_only === true) {
      return NextResponse.json({
        success: true,
        valid: true,
        phone_info: phoneInfo,
        waba_id: resolvedWabaId || null,
        phone_number_id: resolvedPhoneNumberId,
      })
    }

    // Encrypt sensitive tokens before storing
    let encryptedAccessToken: string
    let encryptedVerifyToken: string | null
    try {
      encryptedAccessToken = encrypt(resolvedToken)
      encryptedVerifyToken = resolveVerifyTokenForSave(
        verify_token,
        existing?.verify_token ?? null
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown encryption error'
      console.error('Encryption failed:', message)
      return NextResponse.json(
        {
          error:
            t('whatsappConfig.encryptFailed'),
        },
        { status: 500 }
      )
    }

    const sameNumber =
      existing?.phone_number_id === resolvedPhoneNumberId &&
      existing?.registered_at != null

    // Step 1: register the phone number for inbound webhooks.
    //
    // Attempted on first save AND whenever the user supplies a fresh
    // PIN (e.g. they rotated the 2FA PIN in Meta Manager). Skipped
    // when the same number is already registered and no PIN was
    // supplied — re-registering an already-active number with a
    // stale PIN would actually fail and undo the active subscription.
    let registeredAt: string | null = existing?.registered_at ?? null
    let registrationError: string | null = null
    let registrationMeta: ReturnType<typeof metaErrorPayload> | null = null
    let registrationSkipped = false
    let registrationNotice: string | null = null

    const hasPin = typeof pin === 'string' && pin.trim().length > 0
    const isMetaConnected = phoneInfo?.status === 'CONNECTED'
    const needsRegistration = !sameNumber || hasPin || !existing?.registered_at

    if (needsRegistration) {
      if (hasPin) {
        // Customer provided 2FA PIN: explicitly registering number on Cloud API
        try {
          await registerPhoneNumber({
            phoneNumberId: resolvedPhoneNumberId,
            accessToken: resolvedToken,
            pin: pin.trim(),
          })
          registeredAt = new Date().toISOString()
        } catch (err) {
          const explained = explainMetaError(err, 'register', metaCtx)
          registrationError = explained.summary
          registrationMeta = metaErrorPayload(explained)
          registeredAt = null
          console.error('Phone number /register with PIN failed:', explained.metaMessage, registrationMeta)
        }
      } else if (isMetaConnected) {
        // Case 1: Already registered Cloud API number.
        // Meta authoritatively confirms the phone number is active and connected on the Cloud API.
        registeredAt = existing?.registered_at ?? new Date().toISOString()
      } else {
        // Case 2: Number not yet registered with Cloud API and no PIN provided.
        // DO NOT automatically call POST /{phone-number-id}/register without PIN!
        // Never call /{phone-number-id}/register without a valid PIN or on an active WhatsApp Business mobile app number.
        registeredAt = null
        registrationSkipped = true
        registrationNotice =
          'Phone number verified with Meta, but not yet registered for Cloud API messaging. If this number is active on the WhatsApp Business mobile app, registering it with Cloud API requires a 6-digit PIN and will permanently disconnect the mobile app (manual setup does not support Coexistence). If this is a dedicated Cloud API number, enter your 6-digit two-step verification PIN to complete registration.'
      }
    } else if (phoneInfo?.status && phoneInfo.status !== 'CONNECTED') {
      // Local DB had registered_at, but Meta reports the number is no longer connected.
      // Do NOT blindly attempt PIN-less re-registration.
      registeredAt = null
      registrationSkipped = true
      registrationNotice =
        'Meta reports this phone number is no longer connected to Cloud API. To re-register it, provide your 6-digit two-step verification PIN.'
    }

    // Step 2: subscribe the WABA to this app. Idempotent on Meta's
    // side, so we call on every save and persist the timestamp.
    // Skipped only when there's no waba_id (legacy rows from before
    // we required it).
    //
    // A failure here used to be swallowed with a console.warn, which
    // left the user with a green "connected" banner and a webhook that
    // never fired. Without this subscription Meta delivers nothing, so
    // treat it as a failed connect and say why (issue #505). Nothing
    // has been written yet, so the user just fixes the cause and saves
    // again.
    let subscribedAppsAt: string | null = null
    if (resolvedWabaId) {
      try {
        await subscribeWabaToApp({
          wabaId: resolvedWabaId,
          accessToken: resolvedToken,
        })
        subscribedAppsAt = new Date().toISOString()
      } catch (err) {
        return metaFailure(err, 'subscribe_waba', metaCtx)
      }
    }

    // Persist everything in one shot. If /register failed we still
    // store the credentials and the error so the UI can guide the
    // user through a retry.
    const baseRow = {
      phone_number_id: resolvedPhoneNumberId,
      waba_id: resolvedWabaId || null,
      access_token: encryptedAccessToken,
      verify_token: encryptedVerifyToken,
      status: registrationError ? 'disconnected' : 'connected',
      connected_at: registrationError ? null : new Date().toISOString(),
      registered_at: registrationError ? null : registeredAt,
      subscribed_apps_at: subscribedAppsAt ?? null,
      last_registration_error: registrationError,
      updated_at: new Date().toISOString(),
    }

    if (existing) {
      const { error: updateError } = await supabase
        .from('whatsapp_config')
        .update(baseRow)
        .eq('account_id', accountId)

      if (updateError) {
        console.error('Error updating whatsapp_config:', updateError)
        return NextResponse.json(
          { error: t('whatsappConfig.updateFailed') },
          { status: 500 }
        )
      }
    } else {
      // Insert with both columns: `account_id` is the tenancy key
      // (NOT NULL post-017, UNIQUE so duplicates trip the constraint
      // up-front), `user_id` is the audit column identifying which
      // member of the account saved the config.
      const { error: insertError } = await supabase
        .from('whatsapp_config')
        .insert({
          account_id: accountId,
          user_id: userId,
          ...baseRow,
        })

      if (insertError) {
        console.error('Error inserting whatsapp_config:', insertError)
        return NextResponse.json(
          { error: t('whatsappConfig.saveFailed') },
          { status: 500 }
        )
      }
    }

    if (registrationError) {
      // Save succeeded but the number isn't actually live. Return
      // 200 with a structured error so the UI can show the specific
      // remediation step instead of a generic toast.
      return NextResponse.json({
        success: false,
        saved: true,
        registered: false,
        registration_error: registrationError,
        error: registrationError,
        meta: registrationMeta,
        phone_info: phoneInfo,
      })
    }

    return NextResponse.json({
      success: true,
      saved: true,
      registered: registeredAt != null,
      registration_skipped: registrationSkipped,
      notice: registrationNotice,
      phone_info: phoneInfo,
    })
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return toErrorResponse(error)
    }
    console.error('Error in WhatsApp config POST:', error)
    return NextResponse.json({ error: t('common.internalServerError') }, { status: 500 })
  }
}

/**
 * DELETE /api/whatsapp/config
 *
 * Removes the authenticated user's WhatsApp configuration row.
 * Used by the "Reset Configuration" button to recover from a corrupted
 * encrypted token (mismatched ENCRYPTION_KEY across environments).
 */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const { error: deleteError } = await supabase
      .from('whatsapp_config')
      .delete()
      .eq('account_id', accountId)

    if (deleteError) {
      console.error('Error deleting whatsapp_config:', deleteError)
      return NextResponse.json(
        { error: t('whatsappConfig.deleteFailed') },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return toErrorResponse(error)
    }
    console.error('Error in WhatsApp config DELETE:', error)
    return NextResponse.json({ error: t('common.internalServerError') }, { status: 500 })
  }
}
