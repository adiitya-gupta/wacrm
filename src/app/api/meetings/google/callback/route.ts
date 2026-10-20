import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { exchangeGoogleCodeForTokens } from '@/lib/scheduling/google-calendar';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const stateRaw = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  const redirectBase = `${url.origin}/meetings`;

  if (error) {
    console.error('[google-callback] OAuth returned error:', error);
    return NextResponse.redirect(`${redirectBase}?error=${encodeURIComponent(error)}`);
  }

  if (!code || !stateRaw) {
    return NextResponse.redirect(`${redirectBase}?error=missing_code_or_state`);
  }

  try {
    const stateStr = Buffer.from(stateRaw, 'base64url').toString('utf8');
    const state = JSON.parse(stateStr) as { accountId: string; userId: string; timestamp: number };

    // Validate state timestamp (15 minutes expiry)
    if (Date.now() - state.timestamp > 15 * 60 * 1000) {
      return NextResponse.redirect(`${redirectBase}?error=state_expired`);
    }

    const redirectUri = `${url.origin}/api/meetings/google/callback`;
    const result = await exchangeGoogleCodeForTokens(code, redirectUri);

    if (!result) {
      return NextResponse.redirect(`${redirectBase}?error=token_exchange_failed`);
    }

    const admin = supabaseAdmin();

    // Check if scheduling_settings already exists for this account
    const { data: existing } = await admin
      .from('scheduling_settings')
      .select('id')
      .eq('account_id', state.accountId)
      .maybeSingle();

    if (existing) {
      const { error: updateErr } = await admin
        .from('scheduling_settings')
        .update({
          google_calendar_enabled: true,
          google_calendar_email: result.email || null,
          google_calendar_tokens: result.tokens,
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', state.accountId);

      if (updateErr) {
        console.error('[google-callback] Failed to update scheduling_settings:', updateErr);
        return NextResponse.redirect(`${redirectBase}?error=db_update_failed`);
      }
    } else {
      const { error: insertErr } = await admin.from('scheduling_settings').insert({
        account_id: state.accountId,
        google_calendar_enabled: true,
        google_calendar_email: result.email || null,
        google_calendar_tokens: result.tokens,
      });

      if (insertErr) {
        console.error('[google-callback] Failed to insert scheduling_settings:', insertErr);
        return NextResponse.redirect(`${redirectBase}?error=db_insert_failed`);
      }
    }

    return NextResponse.redirect(`${redirectBase}?connected=google`);
  } catch (err) {
    console.error('[google-callback] Exception handling callback:', err);
    return NextResponse.redirect(`${redirectBase}?error=internal_callback_error`);
  }
}
