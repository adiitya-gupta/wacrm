import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlanTier } from '@/types/billing';

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

/**
 * Validates Stripe webhook signature (v1 scheme).
 * stripe-signature header format: t=timestamp,v1=signature
 */
export function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  webhookSecretOverride?: string
): boolean {
  const secret = webhookSecretOverride || process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret || !signatureHeader) return false;

  const parts = signatureHeader.split(',');
  const timestampPart = parts.find((p) => p.startsWith('t='));
  const signaturePart = parts.find((p) => p.startsWith('v1='));

  if (!timestampPart || !signaturePart) return false;

  const timestamp = timestampPart.slice(2);
  const signature = signaturePart.slice(3);

  // Replay tolerance: 5 minutes
  const now = Math.floor(Date.now() / 1000);
  const eventTime = parseInt(timestamp, 10);
  if (Math.abs(now - eventTime) > 300) {
    return false;
  }

  const payloadToSign = `${timestamp}.${rawBody}`;
  const computed = crypto
    .createHmac('sha256', secret)
    .update(payloadToSign)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(computed, 'hex'),
      Buffer.from(signature, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Process a verified Stripe payment success event.
 */
export async function handleStripePaymentSuccess(
  db: SupabaseClient,
  details: {
    accountId: string;
    planId: PlanTier;
    billingCycle: 'monthly' | 'yearly';
    paymentId: string;
    customerId?: string;
    subscriptionId?: string;
    amount: number;
    currency: string;
  }
): Promise<void> {
  const {
    accountId,
    planId,
    billingCycle,
    paymentId,
    customerId,
    subscriptionId,
    amount,
    currency,
  } = details;

  const periodDays = billingCycle === 'yearly' ? 365 : 30;
  const periodEnd = new Date(Date.now() + periodDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: sub } = await db
    .from('subscriptions')
    .upsert(
      {
        account_id: accountId,
        plan_id: planId,
        status: 'active',
        billing_cycle: billingCycle,
        current_period_start: new Date().toISOString(),
        current_period_end: periodEnd,
        payment_provider: 'stripe',
        provider_customer_id: customerId || null,
        provider_subscription_id: subscriptionId || paymentId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id' }
    )
    .select('id')
    .single();

  await db.from('billing_invoices').insert({
    account_id: accountId,
    subscription_id: sub?.id || null,
    amount,
    currency: currency.toUpperCase(),
    status: 'paid',
    provider_payment_id: paymentId,
    provider_invoice_id: subscriptionId || null,
    description: `Stripe subscription: ${planId} (${billingCycle})`,
    paid_at: new Date().toISOString(),
  });
}
