import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import {
  exchangeGoogleCodeForTokens,
  encryptGoogleTokens,
  decryptGoogleTokens,
  validateGoogleOAuthState,
} from '@/lib/scheduling/google-calendar';

function parseCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const stateRaw = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  const appUrl = (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    url.origin
  ).replace(/\/+$/, '');
  const redirectBase = `${appUrl}/meetings`;

  if (error) {
    console.error('[google-callback] OAuth returned error from Google:', error);
    return NextResponse.redirect(`${redirectBase}?error=${encodeURIComponent(error)}`);
  }

  if (!code || !stateRaw) {
    return NextResponse.redirect(`${redirectBase}?error=missing_code_or_state`);
  }

  try {
    // 1. Cryptographically validate state payload (AES-256-GCM auth tag + timestamp expiry)
    const stateValidation = validateGoogleOAuthState(stateRaw);
    if (!stateValidation.valid) {
      console.error('[google-callback] State validation failed:', stateValidation.error);
      return NextResponse.redirect(`${redirectBase}?error=${stateValidation.error.toLowerCase()}`);
    }

    const statePayload = stateValidation.payload;

    // 2. Validate anti-CSRF / account-linking nonce cookie
    let cookieNonce: string | null = null;
    try {
      const { cookies } = await import('next/headers');
      const store = await cookies();
      cookieNonce = store.get('google_oauth_nonce')?.value || null;
    } catch {
      // fallback to header parsing if next/headers is unavailable in test context
    }
    if (!cookieNonce) {
      cookieNonce = parseCookie(request.headers.get('cookie'), 'google_oauth_nonce');
    }

    if (!cookieNonce || cookieNonce !== statePayload.nonce) {
      console.error('[google-callback] Nonce mismatch or missing cookie — rejecting possible CSRF / account linking attack');
      return NextResponse.redirect(`${redirectBase}?error=csrf_nonce_mismatch`);
    }

    // 3. Session validation if an active session cookie is present
    try {
      const { getCurrentAccount } = await import('@/lib/auth/account');
      const sessionCtx = await getCurrentAccount();
      if (sessionCtx?.accountId && sessionCtx.accountId !== statePayload.accountId) {
        console.error(
          `[google-callback] Cross-tenant conflict: session account ${sessionCtx.accountId} does not match state account ${statePayload.accountId}`,
        );
        return NextResponse.redirect(`${redirectBase}?error=cross_tenant_conflict`);
      }
      if (sessionCtx?.userId && sessionCtx.userId !== statePayload.userId) {
        console.error('[google-callback] Initiating user mismatch for active session');
        return NextResponse.redirect(`${redirectBase}?error=user_session_mismatch`);
      }
    } catch {
      // Session helper may be unavailable in external browser redirects or stripped cookies;
      // server-side membership check below verifies statePayload.userId <-> accountId.
    }

    const admin = supabaseAdmin();

    // 4. Verify initiating user still belongs to the state account with admin/owner role
    const { data: profileRow, error: profileErr } = await admin
      .from('profiles')
      .select('account_id, account_role')
      .eq('user_id', statePayload.userId)
      .maybeSingle();

    if (profileErr) {
      console.error('[google-callback] Failed to verify tenant profile:', profileErr);
      return NextResponse.redirect(`${redirectBase}?error=profile_verification_failed`);
    }

    if (
      profileRow &&
      (profileRow.account_id !== statePayload.accountId ||
        (profileRow.account_role !== 'owner' && profileRow.account_role !== 'admin'))
    ) {
      console.error('[google-callback] Initiating user lacks admin authorization for target tenant');
      return NextResponse.redirect(`${redirectBase}?error=unauthorized_tenant_role`);
    }

    // 5. Exchange authorization code for tokens and Google account info
    const redirectUri = `${appUrl}/api/meetings/google/callback`;
    const result = await exchangeGoogleCodeForTokens(code, redirectUri);

    if (!result) {
      return NextResponse.redirect(`${redirectBase}?error=token_exchange_failed`);
    }

    // 6. Load existing settings to preserve refresh_token or custom calendar choice on reconnect
    const { data: existing } = await admin
      .from('scheduling_settings')
      .select('id, google_calendar_tokens, google_calendar_calendar_id')
      .eq('account_id', statePayload.accountId)
      .maybeSingle();

    const tokensToStore = { ...result.tokens };
    if (!tokensToStore.refresh_token && existing?.google_calendar_tokens) {
      const prevTokens = decryptGoogleTokens(existing.google_calendar_tokens);
      if (prevTokens?.refresh_token) {
        tokensToStore.refresh_token = prevTokens.refresh_token;
      }
    }

    const encryptedTokens = encryptGoogleTokens(tokensToStore);
    const preservedCalendarId = existing?.google_calendar_calendar_id || 'primary';

    // 7. Securely persist scoped exclusively to the authenticated tenant
    if (existing) {
      const { error: updateErr } = await admin
        .from('scheduling_settings')
        .update({
          google_calendar_enabled: true,
          google_calendar_status: 'connected',
          google_calendar_email: result.email || null,
          google_calendar_account_id: result.googleAccountId || null,
          google_calendar_tokens: encryptedTokens,
          google_calendar_calendar_id: preservedCalendarId,
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', statePayload.accountId);

      if (updateErr) {
        console.error('[google-callback] Failed to update scheduling_settings:', updateErr);
        return NextResponse.redirect(`${redirectBase}?error=db_update_failed`);
      }
    } else {
      const { error: insertErr } = await admin.from('scheduling_settings').insert({
        account_id: statePayload.accountId,
        google_calendar_enabled: true,
        google_calendar_status: 'connected',
        google_calendar_email: result.email || null,
        google_calendar_account_id: result.googleAccountId || null,
        google_calendar_tokens: encryptedTokens,
        google_calendar_calendar_id: 'primary',
      });

      if (insertErr) {
        console.error('[google-callback] Failed to insert scheduling_settings:', insertErr);
        return NextResponse.redirect(`${redirectBase}?error=db_insert_failed`);
      }
    }

    // 8. Build response, clear nonce cookie, and redirect to meetings dashboard
    const response = NextResponse.redirect(`${redirectBase}?connected=google`);
    response.cookies.delete('google_oauth_nonce');
    return response;
  } catch (err) {
    console.error('[google-callback] Exception handling callback:', err);
    return NextResponse.redirect(`${redirectBase}?error=internal_callback_error`);
  }
}
