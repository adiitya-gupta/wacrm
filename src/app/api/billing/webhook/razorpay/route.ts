import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  verifyRazorpayWebhookSignature,
  handlePaymentSuccess,
} from '@/lib/billing/razorpay';
import type { PlanTier } from '@/types/billing';

export async function POST(request: Request) {
  try {
    const signature = request.headers.get('x-razorpay-signature');
    if (!signature) {
      return NextResponse.json({ error: 'Missing webhook signature' }, { status: 401 });
    }

    const rawBody = await request.text();
    const isValid = verifyRazorpayWebhookSignature(rawBody, signature);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
    }

    const event = JSON.parse(rawBody);
    const db = supabaseAdmin();

    // Event: payment.captured or order.paid
    if (event.event === 'payment.captured' || event.event === 'order.paid') {
      const payment = event.payload?.payment?.entity;
      const notes = payment?.notes || {};
      const accountId = notes.accountId;
      const planId = (notes.planId as PlanTier) || 'pro';
      const billingCycle = (notes.billingCycle as 'monthly' | 'yearly') || 'monthly';

      if (accountId) {
        await handlePaymentSuccess(db, {
          accountId,
          planId,
          billingCycle,
          paymentId: payment.id,
          orderId: payment.order_id,
          amount: (payment.amount || 0) / 100,
          currency: payment.currency || 'INR',
        });
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[/api/billing/webhook/razorpay] Error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
