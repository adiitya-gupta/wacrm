import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  verifyStripeWebhookSignature,
  handleStripePaymentSuccess,
} from '@/lib/billing/stripe';
import type { PlanTier } from '@/types/billing';

export async function POST(request: Request) {
  try {
    const signature = request.headers.get('stripe-signature');
    if (!signature) {
      return NextResponse.json({ error: 'Missing stripe signature' }, { status: 401 });
    }

    const rawBody = await request.text();
    const isValid = verifyStripeWebhookSignature(rawBody, signature);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid stripe signature' }, { status: 401 });
    }

    const event = JSON.parse(rawBody);
    const db = supabaseAdmin();

    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'invoice.payment_succeeded'
    ) {
      const obj = event.data?.object;
      const metadata = obj?.metadata || {};
      const accountId = metadata.accountId;
      const planId = (metadata.planId as PlanTier) || 'pro';
      const billingCycle = (metadata.billingCycle as 'monthly' | 'yearly') || 'monthly';

      if (accountId) {
        await handleStripePaymentSuccess(db, {
          accountId,
          planId,
          billingCycle,
          paymentId: obj.id,
          customerId: obj.customer,
          subscriptionId: obj.subscription,
          amount: (obj.amount_total || obj.amount_paid || 0) / 100,
          currency: obj.currency || 'usd',
        });
      }
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error('[/api/billing/webhook/stripe] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
