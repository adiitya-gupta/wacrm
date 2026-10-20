'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  CreditCard,
  Zap,
  Check,
  ShieldCheck,
  Sparkles,
  ArrowRight,
  Loader2,
  FileText,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import type { Subscription, SubscriptionPlan, AccountUsageSummary, BillingInvoice } from '@/types/billing';

export default function BillingPage() {
  const [loading, setLoading] = useState(true);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [plan, setPlan] = useState<SubscriptionPlan | null>(null);
  const [usage, setUsage] = useState<AccountUsageSummary | null>(null);
  const [availablePlans, setAvailablePlans] = useState<SubscriptionPlan[]>([]);
  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);
  const [upgradingPlan, setUpgradingPlan] = useState<string | null>(null);

  const fetchBillingData = useCallback(async () => {
    setLoading(true);
    try {
      const [subRes, invRes] = await Promise.all([
        fetch('/api/billing/subscription'),
        fetch('/api/billing/invoices'),
      ]);

      if (subRes.ok) {
        const data = await subRes.json();
        setSub(data.subscription);
        setPlan(data.plan);
        setUsage(data.usage);
        setAvailablePlans(data.available_plans || []);
      }

      if (invRes.ok) {
        const data = await invRes.json();
        setInvoices(data.invoices || []);
      }
    } catch (e) {
      console.error('Failed to load billing context:', e);
      toast.error('Failed to load subscription details');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBillingData();
  }, [fetchBillingData]);

  const handleUpgrade = async (planId: string) => {
    setUpgradingPlan(planId);
    try {
      const res = await fetch('/api/billing/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_order',
          plan_id: planId,
          billing_cycle: 'monthly',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.setup_required) {
          toast.info(data.error);
        } else {
          toast.error(data.error || 'Failed to initialize checkout');
        }
        return;
      }

      // If Razorpay checkout is configured in client, open Razorpay modal
      if (typeof window !== 'undefined' && (window as any).Razorpay) {
        const rzp = new (window as any).Razorpay({
          key: data.key_id,
          amount: data.amount,
          currency: data.currency,
          name: 'Wattomation by OPSIYS',
          description: `Subscription: ${planId}`,
          order_id: data.order_id,
          handler: async function (response: any) {
            toast.loading('Verifying payment...');
            const verifyRes = await fetch('/api/billing/subscription', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'verify_payment',
                order_id: response.razorpay_order_id,
                payment_id: response.razorpay_payment_id,
                signature: response.razorpay_signature,
                plan_id: planId,
              }),
            });
            if (verifyRes.ok) {
              toast.success('Subscription activated!');
              fetchBillingData();
            } else {
              toast.error('Payment verification failed');
            }
          },
        });
        rzp.open();
      } else {
        toast.info(`Checkout order created: ${data.order_id}. Razorpay client script loading.`);
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUpgradingPlan(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const status = sub?.status || 'trialing';
  const isManaged = sub?.acquisition_model === 'managed';

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <div className="flex items-center gap-2">
          <CreditCard className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Billing & Subscriptions
          </h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your subscription tier, track resource quotas, and view past invoices.
        </p>
      </div>

      {/* Active Subscription Overview Card */}
      <Card className="border-border bg-card">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-xl font-bold">{plan?.name || 'Starter'} Plan</CardTitle>
              <Badge
                variant={status === 'active' ? 'default' : 'secondary'}
                className={
                  status === 'active'
                    ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                }
              >
                {status.toUpperCase()}
              </Badge>
              {isManaged && (
                <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
                  OPSIYS Managed
                </Badge>
              )}
            </div>
            <CardDescription className="mt-1">
              Current billing period ends:{' '}
              <strong>
                {sub?.current_period_end
                  ? new Date(sub.current_period_end).toLocaleDateString()
                  : 'N/A'}
              </strong>
            </CardDescription>
          </div>

          <div className="mt-4 sm:mt-0 text-left sm:text-right">
            <div className="text-2xl font-extrabold text-foreground">
              ₹{(sub?.custom_pricing_amount || plan?.price_monthly || 0).toLocaleString()}
              <span className="text-xs font-normal text-muted-foreground"> / month</span>
            </div>
          </div>
        </CardHeader>

        {/* Quota Usage Bars */}
        <CardContent className="border-t border-border/40 pt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
            Current Month Quota Consumption
          </h4>

          <div className="grid gap-6 md:grid-cols-2">
            {/* WhatsApp Messages */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-medium">
                <span>WhatsApp Messages</span>
                <span className="text-muted-foreground">
                  {usage?.messages_sent.toLocaleString()} / {usage?.messages_quota.toLocaleString()}
                </span>
              </div>
              <Progress
                value={
                  usage?.messages_quota
                    ? Math.min(100, (usage.messages_sent / usage.messages_quota) * 100)
                    : 0
                }
                className="h-2"
              />
            </div>

            {/* Active Contacts */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-medium">
                <span>Contacts Saved</span>
                <span className="text-muted-foreground">
                  {usage?.contacts_count.toLocaleString()} / {usage?.contacts_quota.toLocaleString()}
                </span>
              </div>
              <Progress
                value={
                  usage?.contacts_quota
                    ? Math.min(100, (usage.contacts_count / usage.contacts_quota) * 100)
                    : 0
                }
                className="h-2"
              />
            </div>

            {/* Team Members */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-medium">
                <span>Team Member Seats</span>
                <span className="text-muted-foreground">
                  {usage?.team_members_count} / {usage?.team_members_quota}
                </span>
              </div>
              <Progress
                value={
                  usage?.team_members_quota
                    ? Math.min(100, (usage.team_members_count / usage.team_members_quota) * 100)
                    : 0
                }
                className="h-2"
              />
            </div>

            {/* AI Tokens */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-medium">
                <span>AI LLM Tokens</span>
                <span className="text-muted-foreground">
                  {usage?.ai_tokens_used.toLocaleString()} / {usage?.ai_tokens_quota.toLocaleString()}
                </span>
              </div>
              <Progress
                value={
                  usage?.ai_tokens_quota
                    ? Math.min(100, (usage.ai_tokens_used / usage.ai_tokens_quota) * 100)
                    : 0
                }
                className="h-2"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Available Plans Comparison */}
      <div>
        <h3 className="text-lg font-bold text-foreground mb-4">Available Plans</h3>
        <div className="grid gap-6 md:grid-cols-3">
          {availablePlans.map((p) => {
            const isCurrent = sub?.plan_id === p.id;
            return (
              <Card
                key={p.id}
                className={`flex flex-col justify-between border ${
                  isCurrent ? 'border-primary shadow-md' : 'border-border'
                }`}
              >
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg font-bold">{p.name}</CardTitle>
                    {isCurrent && (
                      <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
                        Current
                      </Badge>
                    )}
                  </div>
                  <CardDescription className="text-xs">{p.description}</CardDescription>
                  <div className="mt-4 text-2xl font-bold">
                    ₹{p.price_monthly.toLocaleString()}
                    <span className="text-xs font-normal text-muted-foreground"> / mo</span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-primary" />
                    <span>{p.monthly_messages_quota.toLocaleString()} WhatsApp messages</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-primary" />
                    <span>{p.contacts_quota.toLocaleString()} Contacts</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-primary" />
                    <span>{p.team_members_quota} Team seats</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-primary" />
                    <span>{p.ai_tokens_quota.toLocaleString()} AI Tokens</span>
                  </div>
                </CardContent>
                <CardFooter className="pt-2">
                  <Button
                    onClick={() => handleUpgrade(p.id)}
                    disabled={isCurrent || upgradingPlan === p.id}
                    variant={isCurrent ? 'outline' : 'default'}
                    className="w-full text-xs font-semibold"
                  >
                    {upgradingPlan === p.id ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : isCurrent ? (
                      'Current Plan'
                    ) : (
                      'Upgrade to ' + p.name
                    )}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Invoices History Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" /> Invoices & Receipts
          </CardTitle>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <div className="text-center py-6 text-xs text-muted-foreground">
              No billing invoices recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground">
                  <tr>
                    <th className="p-3">Date</th>
                    <th className="p-3">Description</th>
                    <th className="p-3">Amount</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-xs">
                  {invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td className="p-3 text-muted-foreground">
                        {new Date(inv.created_at).toLocaleDateString()}
                      </td>
                      <td className="p-3 font-medium text-foreground">{inv.description || 'Subscription charge'}</td>
                      <td className="p-3 font-mono font-semibold">
                        ₹{inv.amount.toLocaleString()} {inv.currency}
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className="text-emerald-500 border-emerald-500/20 bg-emerald-500/10">
                          {inv.status.toUpperCase()}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
