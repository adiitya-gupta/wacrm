import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlanTier } from '@/types/billing';

export interface CreateOrderParams {
  amount: number; // in lowest denomination (e.g. paise for INR, 100 paise = 1 INR)
  currency?: string;
  receipt: string;
  notes?: Record<string, string>;
}

export interface RazorpayOrderResult {
  id: string;
  entity: string;
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt: string;
  status: string;
  created_at: number;
}

export function isRazorpayConfigured(): boolean {
  return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

/**
 * Creates an order in Razorpay using the REST API.
 */
export async function createRazorpayOrder(
  params: CreateOrderParams
): Promise<RazorpayOrderResult> {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();

  if (!keyId || !keySecret) {
    throw new Error('Razorpay credentials (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET) are not configured.');
  }

  const authHeader = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authHeader}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: Math.round(params.amount),
      currency: params.currency || 'INR',
      receipt: params.receipt,
      notes: params.notes || {},
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.description || data.error?.message || 'Failed to create Razorpay order');
  }

  return data as RazorpayOrderResult;
}

/**
 * Verifies Razorpay checkout payment signature:
 * hmac_sha256(order_id + "|" + razorpay_payment_id, secret) == razorpay_signature
 */
export function verifyRazorpayPaymentSignature(args: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!secret) return false;

  const generated = crypto
    .createHmac('sha256', secret)
    .update(`${args.orderId}|${args.paymentId}`)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(generated, 'hex'),
      Buffer.from(args.signature, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Verifies Razorpay webhook event signature:
 * hmac_sha256(rawBody, webhookSecret) == x-razorpay-signature
 */
export function verifyRazorpayWebhookSignature(
  rawBody: string,
  signature: string,
  secretOverride?: string
): boolean {
  const secret = secretOverride || process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (!secret || !signature) return false;

  const generated = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(generated, 'hex'),
      Buffer.from(signature, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Process a verified Razorpay payment success event.
 */
export async function handlePaymentSuccess(
  db: SupabaseClient,
  details: {
    accountId: string;
    planId: PlanTier;
    billingCycle: 'monthly' | 'yearly';
    paymentId: string;
    orderId?: string;
    amount: number;
    currency: string;
  }
): Promise<void> {
  const { accountId, planId, billingCycle, paymentId, orderId, amount, currency } = details;

  const periodDays = billingCycle === 'yearly' ? 365 : 30;
  const periodEnd = new Date(Date.now() + periodDays * 24 * 60 * 60 * 1000).toISOString();

  // 1. Update or upsert subscription
  const { data: sub, error: subErr } = await db
    .from('subscriptions')
    .upsert(
      {
        account_id: accountId,
        plan_id: planId,
        status: 'active',
        billing_cycle: billingCycle,
        current_period_start: new Date().toISOString(),
        current_period_end: periodEnd,
        payment_provider: 'razorpay',
        provider_customer_id: null,
        provider_subscription_id: orderId || paymentId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id' }
    )
    .select('id')
    .single();

  if (subErr) {
    console.error('[razorpay] Failed to update subscription on payment success:', subErr);
  }

  // 2. Record invoice
  await db.from('billing_invoices').insert({
    account_id: accountId,
    subscription_id: sub?.id || null,
    amount,
    currency,
    status: 'paid',
    provider_payment_id: paymentId,
    provider_invoice_id: orderId || null,
    description: `Subscription upgrade: ${planId} (${billingCycle})`,
    paid_at: new Date().toISOString(),
  });
}
