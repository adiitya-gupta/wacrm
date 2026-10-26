import { NextResponse } from 'next/server'
import {
  ForbiddenError,
  UnauthorizedError,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendTextMessage } from '@/lib/whatsapp/meta-api'
import {
  explainMetaError,
  metaErrorPayload,
  type MetaErrorContext,
} from '@/lib/whatsapp/meta-error-explain'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/**
 * Validates international phone number format:
 * Optional leading '+', followed by 8 to 15 digits (E.164 recommendation).
 */
const PHONE_NUMBER_RE = /^\+?[1-9]\d{7,14}$/

/**
 * POST /api/whatsapp/config/test-message
 *
 * Sends a test WhatsApp message using the account's configured Cloud API credentials.
 * Used by the settings page to verify end-to-end messaging capability safely.
 *
 * Requirements:
 * - Admin role required
 * - Rate limited
 * - Decrypts stored token
 * - Sanitizes destination phone number
 * - Returns structured error with Meta diagnostics on failure without leaking credentials
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = await checkRateLimit(
      `whatsapp-test-msg:${accountId}:${userId}`,
      RATE_LIMITS.whatsappAdmin,
    )
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json()
    const { to, message } = body

    if (typeof to !== 'string' || !to.trim()) {
      return NextResponse.json(
        { error: 'Please enter a recipient phone number with country code.' },
        { status: 400 },
      )
    }

    const cleanTo = to.trim().replace(/[\s\-()]/g, '')
    if (!PHONE_NUMBER_RE.test(cleanTo)) {
      return NextResponse.json(
        {
          error:
            'Invalid phone number format. Please enter an international phone number with country code (e.g. +15551234567 or +919876543210).',
        },
        { status: 400 },
      )
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, waba_id, access_token, status')
      .eq('account_id', accountId)
      .maybeSingle()

    if (configError) {
      console.error('Error fetching whatsapp_config for test-message:', configError)
      return NextResponse.json(
        { error: t('whatsappConfig.fetchFailed') },
        { status: 500 },
      )
    }

    if (!config || !config.phone_number_id || !config.access_token) {
      return NextResponse.json(
        {
          error:
            'WhatsApp is not configured. Please configure your WhatsApp Cloud API credentials first.',
        },
        { status: 400 },
      )
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch (err) {
      console.error('[test-message] Token decryption failed:', err)
      return NextResponse.json(
        {
          error: t('whatsappConfig.tokenCorrupted'),
        },
        { status: 400 },
      )
    }

    const metaCtx: MetaErrorContext = {
      phoneNumberId: config.phone_number_id,
      wabaId: config.waba_id,
    }

    const text =
      typeof message === 'string' && message.trim()
        ? message.trim()
        : 'Hello from Wattomation! This is a test message confirming your WhatsApp Cloud API connection is active and configured correctly.'

    // Strip leading '+' for WhatsApp Cloud API recipient parameter
    const recipient = cleanTo.replace(/^\+/, '')

    try {
      const result = await sendTextMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: recipient,
        text,
      })

      return NextResponse.json({
        success: true,
        message_id: result.messageId,
        to: cleanTo,
      })
    } catch (err) {
      const explained = explainMetaError(err, 'send_message', metaCtx)
      console.error('[test-message] Meta send failed:', explained.metaMessage, {
        code: explained.code,
        subcode: explained.subcode,
        fbtrace_id: explained.fbtraceId,
      })

      return NextResponse.json(
        {
          error: explained.summary,
          meta: metaErrorPayload(explained),
        },
        { status: explained.httpStatus },
      )
    }
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return toErrorResponse(error)
    }
    console.error('Error in WhatsApp test-message POST:', error)
    return NextResponse.json(
      { error: t('common.internalServerError') },
      { status: 500 },
    )
  }
}
