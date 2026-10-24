import Link from 'next/link';
import { Check, MessageSquare, Zap, Shield, Sparkles, Globe, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DEFAULT_PLANS } from '@/lib/billing/plans';

export default function PricingPage() {
  const plans = [
    {
      ...DEFAULT_PLANS.starter,
      popular: false,
      cta: 'Start 14-Day Free Trial',
      highlights: [
        '1,000 WhatsApp messages / month',
        '500 Active contacts',
        '2 Team member seats',
        '100,000 AI tokens for auto-reply',
        'Website event webhook & JavaScript SDK',
        'Visual workflow automation engine',
        'Standard business hours support',
      ],
    },
    {
      ...DEFAULT_PLANS.pro,
      popular: true,
      cta: 'Get Started with Pro',
      highlights: [
        '5,000 WhatsApp messages / month',
        '2,500 Active contacts',
        '5 Team member seats',
        '500,000 AI tokens (GPT-4o & Claude)',
        'Website lead capture & auto-triggers',
        'Multi-step branching flows & delay timers',
        'Custom branding & priority delivery',
        'Fast email & WhatsApp support',
      ],
    },
    {
      ...DEFAULT_PLANS.enterprise,
      popular: false,
      cta: 'Scale with Enterprise',
      highlights: [
        '25,000 WhatsApp messages / month',
        '15,000 Active contacts',
        '20 Team member seats',
        '2,500,000 AI tokens & Custom Knowledge Bases',
        'High-concurrency webhook ingestion',
        'Dedicated account manager',
        'Custom SLA & uptime guarantee',
        'Managed onboarding assistance',
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top Header */}
      <header className="border-b border-border bg-card/60 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold shadow-md shadow-primary/20">
              <MessageSquare className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-bold tracking-tight text-foreground">
                Wattomation
              </span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold -mt-1">
                by OPSIYS
              </span>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/login">
              <Button variant="ghost" className="text-sm font-medium">
                Sign In
              </Button>
            </Link>
            <Link href="/login">
              <Button className="bg-primary text-primary-foreground shadow-sm hover:bg-primary/90">
                Start Free Trial
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="text-center">
          <Badge variant="outline" className="mb-4 border-primary/30 bg-primary/10 px-3 py-1 text-sm text-primary">
            <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Simple, Transparent SaaS Pricing
          </Badge>
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl text-foreground">
            Grow your business with <span className="text-primary">WhatsApp Automation</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Choose the subscription plan that fits your business scale. All self-serve plans include a 14-day free trial with zero risk.
          </p>
        </div>

        {/* Pricing Cards Grid */}
        <div className="mt-16 grid gap-8 lg:grid-cols-3 lg:gap-8">
          {plans.map((plan) => (
            <Card
              key={plan.id}
              className={`relative flex flex-col justify-between border transition-all duration-200 ${
                plan.popular
                  ? 'border-primary shadow-xl shadow-primary/10 ring-2 ring-primary/20'
                  : 'border-border bg-card hover:border-primary/40'
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                  <span className="inline-flex items-center rounded-full bg-primary px-3 py-0.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground shadow-sm">
                    Most Popular
                  </span>
                </div>
              )}

              <CardHeader className="p-6">
                <CardTitle className="text-2xl font-bold text-foreground">{plan.name}</CardTitle>
                <CardDescription className="mt-1 text-sm text-muted-foreground">
                  {plan.description}
                </CardDescription>

                <div className="mt-6 flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold tracking-tight text-foreground">
                    ₹{plan.price_monthly.toLocaleString()}
                  </span>
                  <span className="text-sm font-medium text-muted-foreground">/ month</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  or ₹{plan.price_yearly.toLocaleString()} billed yearly (Save 17%)
                </div>
              </CardHeader>

              <CardContent className="flex-1 p-6 pt-0">
                <div className="border-t border-border/60 pt-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    What is included:
                  </p>
                  <ul className="mt-4 space-y-3">
                    {plan.highlights.map((feat, idx) => (
                      <li key={idx} className="flex items-start gap-3 text-sm text-foreground/90">
                        <Check className="h-4 w-4 shrink-0 text-primary mt-0.5" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>

              <CardFooter className="p-6 pt-0">
                <Link href={`/login?plan=${plan.id}`} className="w-full">
                  <Button
                    className={`w-full font-semibold shadow-sm ${
                      plan.popular
                        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                        : 'border border-border bg-card text-foreground hover:bg-muted'
                    }`}
                  >
                    {plan.cta} <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </CardFooter>
            </Card>
          ))}
        </div>

        {/* Managed Agency Option Banner */}
        <div className="mt-16 rounded-2xl border border-primary/20 bg-primary/5 p-8 text-center sm:p-10">
          <Badge variant="outline" className="mb-2 border-primary/40 bg-primary/10 text-primary">
            OPSIYS Done-For-You
          </Badge>
          <h2 className="text-2xl font-bold text-foreground sm:text-3xl">
            Want a fully managed custom setup?
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-muted-foreground">
            Our team builds and manages your bespoke WhatsApp AI agents, website integrations, sales funnels, and CRM workflows for you.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
            <Link href="/meetings">
              <Button size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90">
                Book Managed Discovery Call
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="outline">
                Explore Self-Service Platform
              </Button>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
