import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  exchangeOAuthCode,
  exchangeForLongLivedToken,
  debugToken,
  extractTargetIdsFromDebugToken,
  discoverWabaAccounts,
  listWabaPhoneNumbers,
  subscribeWabaToApp,
  verifyPhoneNumber,
  registerPhoneNumber,
} from '@/lib/whatsapp/meta-api';
import { isNumericMetaId, phoneNumberBelongsToWaba } from '@/lib/whatsapp/waba-pairing';
import { encrypt, validateEncryptionKey } from '@/lib/whatsapp/encryption';
import { resolveVerifyTokenForSave } from '@/lib/whatsapp/verify-token';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { getT } from '@/lib/i18n/translate';
import { explainMetaError } from '@/lib/whatsapp/meta-error-explain';

const t = getT('Api');

const REQUIRED_SCOPES = [
  'whatsapp_business_management',
  'whatsapp_business_messaging',
];

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');

    // Rate-limit by workspace and user
    const limit = await checkRateLimit(
      `whatsapp-embedded-signup:${accountId}:${userId}`,
      RATE_LIMITS.whatsappAdmin
    );
    if (!limit.success) return rateLimitResponse(limit);

    // Fail safely if token encryption key is unconfigured or invalid
    try {
      validateEncryptionKey();
    } catch (encErr) {
      console.error('[embedded-signup] Encryption key check failed:', encErr instanceof Error ? encErr.message : encErr);
      return NextResponse.json(
        { error: 'Server encryption configuration error. Cannot store WhatsApp credentials securely.' },
        { status: 500 }
      );
    }

    // Load server-side Meta configuration
    const appId = (
      process.env.META_APP_ID ||
      process.env.NEXT_PUBLIC_META_APP_ID ||
      ''
    ).trim();

    const appSecret = (
      process.env.META_APP_SECRET ||
      process.env.WHATSAPP_APP_SECRET ||
      ''
    ).trim();

    if (!appId || !appSecret) {
      console.error('[embedded-signup] Missing META_APP_ID or META_APP_SECRET environment variables');
      return NextResponse.json(
        { error: 'Meta App credentials are not configured on the server.' },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => null);
    const code = body?.code;
    let wabaId = body?.waba_id?.toString().trim();
    let phoneNumberId = body?.phone_number_id?.toString().trim();
    const businessId = body?.business_id?.toString().trim();

    if (!code || typeof code !== 'string' || !code.trim()) {
      return NextResponse.json(
        { error: 'Missing or invalid authorization code from Meta Embedded Signup.' },
        { status: 400 }
      );
    }

    // 1. Exchange the Embedded Signup OAuth authorization code for an access token
    let accessToken: string;
    try {
      const tokenRes = await exchangeOAuthCode({
        code: code.trim(),
        appId,
        appSecret,
      });
      accessToken = tokenRes.accessToken;
    } catch (err) {
      console.error('[embedded-signup] exchangeOAuthCode failed:', err);
      return NextResponse.json(
        { error: 'Failed to exchange authorization code with Meta. The code may be expired or already used.' },
        { status: 400 }
      );
    }

    // 2. Inspect and validate token permissions via debug_token
    let tokenData;
    try {
      tokenData = await debugToken({
        inputToken: accessToken,
        appId,
        appSecret,
      });
    } catch (err) {
      console.error('[embedded-signup] debugToken failed:', err);
      return NextResponse.json(
        { error: 'Failed to verify token permissions with Meta.' },
        { status: 400 }
      );
    }

    if (!tokenData.isValid) {
      return NextResponse.json(
        { error: 'The access token granted by Meta is invalid or expired.' },
        { status: 400 }
      );
    }

    // 3. If the token is short-lived (expiresAt > 0), exchange for a long-lived access token (60-day validity).
    // System user tokens from Embedded Signup have expiresAt: 0 (permanent) and do not need exchange.
    if (tokenData.expiresAt && tokenData.expiresAt > 0) {
      try {
        const longLivedRes = await exchangeForLongLivedToken({
          shortLivedToken: accessToken,
          appId,
          appSecret,
        });
        if (longLivedRes.accessToken) {
          accessToken = longLivedRes.accessToken;
        }
      } catch (err) {
        console.warn('[embedded-signup] exchangeForLongLivedToken notice:', err instanceof Error ? err.message : err);
      }
    }

    const grantedScopes = new Set(tokenData.scopes);
    const missingScopes = REQUIRED_SCOPES.filter((scope) => !grantedScopes.has(scope));
    if (missingScopes.length > 0) {
      return NextResponse.json(
        {
          error: `Missing required WhatsApp permissions: ${missingScopes.join(', ')}. Please complete signup with full management permissions.`,
          missing_scopes: missingScopes,
        },
        { status: 400 }
      );
    }

    // 4. Resolve WABA ID if not provided in the frontend payload
    if (!wabaId || !isNumericMetaId(wabaId)) {
      // 4a. Inspect granular_scopes from debug_token across all relevant scopes
      const targetIds = extractTargetIdsFromDebugToken(tokenData);
      if (targetIds.length > 0) {
        wabaId = targetIds[0];
      }
    }

    // 4b. Discover WABA via Graph API using authenticated access token if still unassigned
    let discoveredWabas: Array<{ id: string; name?: string }> = [];
    if (!wabaId || !isNumericMetaId(wabaId)) {
      try {
        discoveredWabas = await discoverWabaAccounts({
          accessToken,
          businessId: businessId && isNumericMetaId(businessId) ? businessId : undefined,
          userId: tokenData.userId && isNumericMetaId(tokenData.userId) ? tokenData.userId : undefined,
        });

        if (discoveredWabas.length > 0) {
          // If client provided a phoneNumberId, find the WABA that owns it
          if (phoneNumberId && isNumericMetaId(phoneNumberId)) {
            for (const acct of discoveredWabas) {
              try {
                const numbers = await listWabaPhoneNumbers({
                  wabaId: acct.id,
                  accessToken,
                });
                if (phoneNumberBelongsToWaba(numbers, phoneNumberId)) {
                  wabaId = acct.id;
                  break;
                }
              } catch {
                // Continue checking other accounts
              }
            }
          }

          // If no specific match or no phoneNumberId, pick the first discovered WABA that has phone numbers
          if (!wabaId) {
            for (const acct of discoveredWabas) {
              try {
                const numbers = await listWabaPhoneNumbers({
                  wabaId: acct.id,
                  accessToken,
                });
                if (numbers.length > 0) {
                  wabaId = acct.id;
                  if (!phoneNumberId) {
                    phoneNumberId = numbers[0].id;
                  }
                  break;
                }
              } catch {
                // Continue
              }
            }
          }

          // Fallback to first discovered account
          if (!wabaId && discoveredWabas[0]?.id) {
            wabaId = discoveredWabas[0].id;
          }
        }
      } catch (discErr) {
        console.warn('[embedded-signup] discoverWabaAccounts notice:', discErr instanceof Error ? discErr.message : discErr);
      }
    }

    if (!wabaId || !isNumericMetaId(wabaId)) {
      return NextResponse.json(
        {
          error:
            'Could not determine WhatsApp Business Account ID from Meta Embedded Signup. ' +
            'This usually occurs if the Meta popup was closed before completing setup or if an unsupported account type was selected. ' +
            'Please click "Connect with Meta" again, ensure you select a valid Meta Business Portfolio, and create or choose a WhatsApp Business Account.',
        },
        { status: 400 }
      );
    }

    // 5. Resolve and verify Phone Number ID
    let wabaNumbers;
    try {
      wabaNumbers = await listWabaPhoneNumbers({
        wabaId,
        accessToken,
      });
    } catch (err) {
      console.error('[embedded-signup] listWabaPhoneNumbers failed:', err);
      return NextResponse.json(
        { error: `Could not list phone numbers for WhatsApp Business Account ${wabaId}. Please verify your Meta permissions.` },
        { status: 400 }
      );
    }

    // If wabaNumbers is empty, check other discovered WABAs if any exist
    if ((!wabaNumbers || wabaNumbers.length === 0) && discoveredWabas.length > 1) {
      for (const altAcct of discoveredWabas) {
        if (altAcct.id !== wabaId) {
          try {
            const altNumbers = await listWabaPhoneNumbers({
              wabaId: altAcct.id,
              accessToken,
            });
            if (altNumbers.length > 0) {
              wabaId = altAcct.id;
              wabaNumbers = altNumbers;
              break;
            }
          } catch {
            // Continue
          }
        }
      }
    }

    if (!wabaNumbers || wabaNumbers.length === 0) {
      return NextResponse.json(
        {
          error:
            'No phone numbers found under the selected WhatsApp Business Account. ' +
            'If Meta displayed an "Unsupported WhatsApp business account type" notice, please ensure your number is registered as a Cloud API number, ' +
            'or add and verify a valid phone number during the Meta Embedded Signup flow.',
        },
        { status: 400 }
      );
    }

    if (phoneNumberId) {
      if (!isNumericMetaId(phoneNumberId) || !phoneNumberBelongsToWaba(wabaNumbers, phoneNumberId)) {
        return NextResponse.json(
          { error: `The selected Phone Number ID (${phoneNumberId}) does not belong to WhatsApp Business Account ${wabaId}.` },
          { status: 400 }
        );
      }
    } else {
      // If single phone number exists under the WABA, pick it automatically
      phoneNumberId = wabaNumbers[0].id;
    }

    // 6. Enforce Cross-Tenant Isolation: Ensure phone_number_id is not claimed by another account
    const { data: claimed, error: claimedErr } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('account_id')
      .eq('phone_number_id', phoneNumberId)
      .neq('account_id', accountId)
      .maybeSingle();

    if (claimedErr) {
      console.error('[embedded-signup] Error checking phone_number_id ownership:', claimedErr);
      return NextResponse.json(
        { error: t('whatsappConfig.validateFailed') },
        { status: 500 }
      );
    }

    if (claimed) {
      return NextResponse.json(
        { error: t('whatsappConfig.numberLinkedElsewhere') },
        { status: 409 }
      );
    }

    // Query existing config for this workspace to check previous registration and verify token
    const { data: existing } = await supabase
      .from('whatsapp_config')
      .select('id, verify_token, phone_number_id, registered_at')
      .eq('account_id', accountId)
      .maybeSingle();

    const isSameNumber = existing?.phone_number_id === phoneNumberId;
    const existingRegisteredAt = isSameNumber && existing?.registered_at ? existing.registered_at : null;

    // 7. Verify Phone Number details with Meta
    let phoneInfo;
    try {
      phoneInfo = await verifyPhoneNumber({
        phoneNumberId,
        accessToken,
      });
    } catch (err) {
      console.error('[embedded-signup] verifyPhoneNumber failed:', err);
      return NextResponse.json(
        { error: 'Could not verify the selected phone number with Meta Cloud API.' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    let registeredAt: string | null = null;
    let registrationError: string | null = null;
    let isRegistrationConfirmed = false;

    // Determine registration state with Meta Cloud API
    if (phoneInfo?.status === 'CONNECTED') {
      // Meta authoritatively confirms the phone number is active and connected on the Cloud API
      registeredAt = existingRegisteredAt ?? now;
      registrationError = null;
      isRegistrationConfirmed = true;
    } else {
      // If phone status is not yet CONNECTED, attempt PIN-less register
      try {
        await registerPhoneNumber({
          phoneNumberId,
          accessToken,
        });
        registeredAt = now;
        registrationError = null;
        isRegistrationConfirmed = true;
      } catch (regErr) {
        const metaCtx = { phoneNumberId, wabaId };
        const explained = explainMetaError(regErr, 'register', metaCtx);
        registrationError =
          explained.summary ||
          'Phone number registration with Meta Cloud API is incomplete. Two-step verification PIN or manual verification may be required.';
        // If this same number had a valid registration timestamp previously, preserve it on retry rather than overwriting with null,
        // but do not set a new timestamp and do not report registration as confirmed.
        registeredAt = existingRegisteredAt ?? null;
        isRegistrationConfirmed = false;
        console.warn('[embedded-signup] registerPhoneNumber failed:', explained.metaMessage);
      }
    }

    // 8. Subscribe WABA to this Meta App for webhook delivery
    try {
      await subscribeWabaToApp({
        wabaId,
        accessToken,
      });
    } catch (subErr) {
      console.error('[embedded-signup] subscribeWabaToApp failed:', subErr);
      return NextResponse.json(
        { error: 'Could not subscribe WhatsApp Business Account to the platform app for webhook delivery.' },
        { status: 502 }
      );
    }

    // 9. Encrypt token and upsert into whatsapp_config
    const encryptedAccessToken = encrypt(accessToken);
    const encryptedVerifyToken = resolveVerifyTokenForSave(
      null,
      existing?.verify_token ?? null
    );

    const configRow = {
      account_id: accountId,
      user_id: userId,
      phone_number_id: phoneNumberId,
      waba_id: wabaId,
      access_token: encryptedAccessToken,
      verify_token: encryptedVerifyToken,
      status: 'connected',
      connected_at: now,
      registered_at: registeredAt,
      subscribed_apps_at: now,
      last_registration_error: registrationError,
      updated_at: now,
    };

    if (existing) {
      const { error: updateErr } = await supabase
        .from('whatsapp_config')
        .update(configRow)
        .eq('account_id', accountId);

      if (updateErr) {
        console.error('[embedded-signup] Error updating whatsapp_config:', updateErr);
        return NextResponse.json(
          { error: t('whatsappConfig.saveFailed') },
          { status: 500 }
        );
      }
    } else {
      const { error: insertErr } = await supabase
        .from('whatsapp_config')
        .insert(configRow);

      if (insertErr) {
        console.error('[embedded-signup] Error inserting whatsapp_config:', insertErr);
        return NextResponse.json(
          { error: t('whatsappConfig.saveFailed') },
          { status: 500 }
        );
      }
    }

    // Return success without exposing the raw or encrypted token
    return NextResponse.json({
      success: true,
      phone_info: phoneInfo,
      phone_number_id: phoneNumberId,
      waba_id: wabaId,
      registered: isRegistrationConfirmed,
      registration_error: registrationError,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
