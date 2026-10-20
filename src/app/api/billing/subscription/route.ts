import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { getPlanDetails, DEFAULT_PLANS } from '@/lib/billing/plans';
import { getAccountUsageSummary } from '@/lib/billing/quota';
import {
  createRazorpayOrder,
  isRazorpayConfigured,
  handlePaymentSuccess,
  verifyRazorpayPaymentSignature,
} from '@/lib/billing/razorpay';
import type { PlanTier } from '@/types/billing';

export async function GET() {
  try {
    const ctx = await requireRole('agent');

    const { data: sub } = await ctx.supabase
      .from('subscriptions')
      .select('*')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    const planId = (sub?.plan_id as PlanTier) || 'starter';
    const plan = getPlanDetails(planId);
    const usage = await getAccountUsageSummary(ctx.supabase, ctx.accountId);

    return NextResponse.json({
      subscription: sub || {
        account_id: ctx.accountId,
        plan_id: 'starter',
        status: 'trialing',
        billing_cycle: 'monthly',
        acquisition_model: 'self_serve',
      },
      plan,
      usage,
      available_plans: Object.values(DEFAULT_PLANS).filter((p) => p.is_public),
      payment_gateway: {
        razorpay_configured: isRazorpayConfigured(),
        razorpay_key_id: process.env.RAZORPAY_KEY_ID || null,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = await request.json().catch(() => ({}));

    // Mode 1: Create checkout order
    if (body.action === 'create_order') {
      const planId = (body.plan_id as PlanTier) || 'pro';
      const billingCycle = (body.billing_cycle as 'monthly' | 'yearly') || 'monthly';
      const plan = getPlanDetails(planId);

      const price = billingCycle === 'yearly' ? plan.price_yearly : plan.price_monthly;

      if (!isRazorpayConfigured()) {
        return NextResponse.json(
          {
            error:
              'Payment gateway is in setup mode. Please configure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET or contact sales for custom onboarding.',
            setup_required: true,
          },
          { status: 400 }
        );
      }

      const receipt = `rcpt_${ctx.accountId.slice(0, 8)}_${Date.now()}`;
      const order = await createRazorpayOrder({
        amount: price * 100, // paise
        currency: plan.currency,
        receipt,
        notes: {
          accountId: ctx.accountId,
          planId,
          billingCycle,
        },
      });

      return NextResponse.json({
        order_id: order.id,
        amount: order.amount,
        currency: order.currency,
        key_id: process.env.RAZORPAY_KEY_ID,
        plan_id: planId,
        billing_cycle: billingCycle,
      });
    }

    // Mode 2: Verify payment & activate subscription
    if (body.action === 'verify_payment') {
      const { order_id, payment_id, signature, plan_id, billing_cycle } = body;

      if (!order_id || !payment_id || !signature) {
        return NextResponse.json(
          { error: 'Missing required payment verification parameters' },
          { status: 400 }
        );
      }

      const valid = verifyRazorpayPaymentSignature({
        orderId: order_id,
        paymentId: payment_id,
        signature,
      });

      if (!valid) {
        return NextResponse.json({ error: 'Invalid payment signature' }, { status: 400 });
      }

      const plan = getPlanDetails(plan_id || 'pro');
      const price = billing_cycle === 'yearly' ? plan.price_yearly : plan.price_monthly;

      await handlePaymentSuccess(ctx.supabase, {
        accountId: ctx.accountId,
        planId: plan_id || 'pro',
        billingCycle: billing_cycle || 'monthly',
        paymentId: payment_id,
        orderId: order_id,
        amount: price,
        currency: plan.currency,
      });

      return NextResponse.json({ success: true, message: 'Subscription successfully activated' });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
