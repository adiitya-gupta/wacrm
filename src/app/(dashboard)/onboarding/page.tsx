'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  MessageSquare,
  Bot,
  Globe,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Loader2,
  Copy,
  Check,
  Target,
  BookOpen,
  Shield,
  HelpCircle,
  Save,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';

const GOAL_OPTIONS = [
  { id: 'customer_support', label: 'Shared Team Customer Support', desc: 'Centralize customer conversations with team routing' },
  { id: 'lead_qualification', label: 'Automated Lead Qualification', desc: 'Qualify inbound prospects 24/7 with intelligent AI' },
  { id: 'broadcasts', label: 'Marketing & Broadcast Campaigns', desc: 'Send official Meta-approved template messages' },
  { id: 'appointments', label: 'Meeting & Appointment Booking', desc: 'Coordinate Google Meet bookings from WhatsApp chat' },
  { id: 'website_capture', label: 'Website Inbound Lead Capture', desc: 'Connect website forms directly to WhatsApp follow-ups' },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6 | 7>(1);
  const [loading, setLoading] = useState(false);
  const [savingProgress, setSavingProgress] = useState(false);
  const [copied, setCopied] = useState(false);

  // Form State
  const [businessName, setBusinessName] = useState('');
  const [industry, setIndustry] = useState('Technology & SaaS');
  const [website, setWebsite] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [businessDescription, setBusinessDescription] = useState('');
  const [selectedGoals, setSelectedGoals] = useState<string[]>(['customer_support', 'lead_qualification']);

  // WhatsApp & AI State
  const [siteKey, setSiteKey] = useState('');
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const [agentName, setAgentName] = useState('Sophia');
  const [agentTone, setAgentTone] = useState('Professional & Helpful');
  const [systemPrompt, setSystemPrompt] = useState(
    'You are a knowledgeable, friendly representative for our business. Answer inquiries accurately, qualify potential clients, and help them take the next step.'
  );

  // Knowledge Base State
  const [initialKnowledge, setInitialKnowledge] = useState('');

  // Prefetch existing state
  useEffect(() => {
    (async () => {
      try {
        const [onboardingRes, websiteRes] = await Promise.all([
          fetch('/api/account/onboarding'),
          fetch('/api/website-integrations'),
        ]);

        if (onboardingRes.ok) {
          const data = await onboardingRes.json();
          if (data.business_name) setBusinessName(data.business_name);
          if (data.industry) setIndustry(data.industry);
          if (data.website) setWebsite(data.website);
          if (data.timezone) setTimezone(data.timezone);
          if (data.business_description) setBusinessDescription(data.business_description);
          if (data.primary_goals) setSelectedGoals(data.primary_goals);
          if (data.agent_name) setAgentName(data.agent_name);
          if (data.system_prompt) setSystemPrompt(data.system_prompt);
          if (data.steps?.whatsapp_connected) setWhatsappConnected(true);
        }

        if (websiteRes.ok) {
          const data = await websiteRes.json();
          if (data.site_key) setSiteKey(data.site_key);
        }
      } catch (e) {
        console.error('Failed to prefetch onboarding context:', e);
      }
    })();
  }, []);

  const toggleGoal = (goalId: string) => {
    setSelectedGoals((prev) =>
      prev.includes(goalId) ? prev.filter((g) => g !== goalId) : [...prev, goalId]
    );
  };

  const saveCurrentProgress = async (silent = false) => {
    setSavingProgress(true);
    try {
      const res = await fetch('/api/account/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_name: businessName,
          industry,
          website,
          timezone,
          business_description: businessDescription,
          primary_goals: selectedGoals,
          agent_name: agentName,
          system_prompt: systemPrompt,
          initial_knowledge: initialKnowledge || undefined,
          completed: false,
        }),
      });

      if (!res.ok) throw new Error('Failed to save progress');
      if (!silent) toast.success('Progress saved');
    } catch (err: any) {
      if (!silent) toast.error(err.message);
    } finally {
      setSavingProgress(false);
    }
  };

  const handleNextStep = async () => {
    if (step === 1) {
      if (!businessName.trim()) {
        toast.error('Please enter your business or workspace name');
        return;
      }
      await saveCurrentProgress(true);
    }
    if (step < 7) {
      setStep((prev) => (prev + 1) as any);
    }
  };

  const handleCompleteOnboarding = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/account/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_name: businessName,
          industry,
          website,
          timezone,
          business_description: businessDescription,
          primary_goals: selectedGoals,
          agent_name: agentName,
          system_prompt: systemPrompt,
          initial_knowledge: initialKnowledge || undefined,
          completed: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to complete onboarding');
      }

      toast.success('Workspace configured successfully! Welcome to Wattomation by OPSIYS.');
      router.push('/dashboard');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const copySnippet = () => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://wacrm.com';
    const snippet = `<script src="${origin}/sdk/wacrm.js" data-site-key="${siteKey || 'wk_live_...'}" defer></script>`;
    navigator.clipboard.writeText(snippet);
    setCopied(true);
    toast.success('Website installation snippet copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const STEPS_NAV = [
    { num: 1, label: 'Profile', icon: Building2 },
    { num: 2, label: 'Goals', icon: Target },
    { num: 3, label: 'WhatsApp', icon: MessageSquare },
    { num: 4, label: 'AI Agent', icon: Bot },
    { num: 5, label: 'Knowledge', icon: BookOpen },
    { num: 6, label: 'Integrations', icon: Globe },
    { num: 7, label: 'Review', icon: CheckCircle2 },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center items-center py-10 px-4 sm:px-6 lg:px-8">
      {/* Step Indicator Header */}
      <div className="w-full max-w-2xl mb-6 text-center">
        <Badge variant="outline" className="mb-2 border-primary/30 bg-primary/10 text-primary">
          <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Workspace Setup Wizard
        </Badge>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
          Configure Your <span className="text-primary">Wattomation</span> Workspace
        </h1>
        <p className="mt-0.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          by OPSIYS
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Personalize your business settings, conversational AI agent, and WhatsApp connections.
        </p>

        {/* Progress Stepper */}
        <div className="mt-6 flex items-center justify-between">
          {STEPS_NAV.map((s) => {
            const Icon = s.icon;
            const isDone = step > s.num;
            const isCurrent = step === s.num;
            return (
              <div key={s.num} className="flex flex-col items-center">
                <button
                  type="button"
                  onClick={() => {
                    if (s.num < step) setStep(s.num as any);
                  }}
                  disabled={s.num > step}
                  className={`flex h-9 w-9 items-center justify-center rounded-full border transition-all ${
                    isDone
                      ? 'border-primary bg-primary text-primary-foreground cursor-pointer'
                      : isCurrent
                      ? 'border-primary bg-primary/20 text-primary ring-2 ring-primary/30 font-bold'
                      : 'border-border bg-card text-muted-foreground opacity-60'
                  }`}
                >
                  {isDone ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </button>
                <span className={`mt-1 text-[11px] font-medium hidden sm:inline-block ${isCurrent ? 'text-primary font-bold' : 'text-muted-foreground'}`}>
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Wizard Card */}
      <Card className="w-full max-w-2xl border-border bg-card shadow-xl shadow-black/5">
        {/* STEP 1: Profile */}
        {step === 1 && (
          <>
            <CardHeader>
              <CardTitle className="text-lg">Step 1: Organization & Business Profile</CardTitle>
              <CardDescription className="text-xs">
                Set your business details to personalize client interactions and CRM records.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-xs">Business or Workspace Name *</Label>
                <Input
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="e.g. Acme Global Logistics"
                  className="mt-1 text-sm"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Industry Sector</Label>
                  <Select value={industry} onValueChange={(v) => { if (v) setIndustry(v); }}>
                    <SelectTrigger className="mt-1 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Technology & SaaS">Technology & SaaS</SelectItem>
                      <SelectItem value="Retail & E-Commerce">Retail & E-Commerce</SelectItem>
                      <SelectItem value="Real Estate & Property">Real Estate & Property</SelectItem>
                      <SelectItem value="Healthcare & Clinics">Healthcare & Clinics</SelectItem>
                      <SelectItem value="Financial & Legal Services">Financial & Legal Services</SelectItem>
                      <SelectItem value="Education & Coaching">Education & Coaching</SelectItem>
                      <SelectItem value="Travel & Hospitality">Travel & Hospitality</SelectItem>
                      <SelectItem value="Other">Other Services</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs">Primary Timezone</Label>
                  <Select value={timezone} onValueChange={(v) => { if (v) setTimezone(v); }}>
                    <SelectTrigger className="mt-1 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UTC">UTC (Universal Time)</SelectItem>
                      <SelectItem value="Asia/Kolkata">Asia/Kolkata (IST +5:30)</SelectItem>
                      <SelectItem value="America/New_York">America/New York (EST)</SelectItem>
                      <SelectItem value="America/Los_Angeles">America/Los Angeles (PST)</SelectItem>
                      <SelectItem value="Europe/London">Europe/London (GMT)</SelectItem>
                      <SelectItem value="Asia/Dubai">Asia/Dubai (GST)</SelectItem>
                      <SelectItem value="Asia/Singapore">Asia/Singapore (SGT)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label className="text-xs">Business Website (Optional)</Label>
                <Input
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://example.com"
                  className="mt-1 text-sm"
                />
              </div>

              <div>
                <Label className="text-xs">Short Description of Services</Label>
                <Textarea
                  value={businessDescription}
                  onChange={(e) => setBusinessDescription(e.target.value)}
                  rows={2}
                  placeholder="Describe your primary offerings and who your ideal customers are..."
                  className="mt-1 text-xs"
                />
              </div>
            </CardContent>
          </>
        )}

        {/* STEP 2: Goals */}
        {step === 2 && (
          <>
            <CardHeader>
              <CardTitle className="text-lg">Step 2: Business Goals & Use Cases</CardTitle>
              <CardDescription className="text-xs">
                Select your primary objectives so Wattomation can tailor your default automations.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {GOAL_OPTIONS.map((g) => {
                const active = selectedGoals.includes(g.id);
                return (
                  <div
                    key={g.id}
                    onClick={() => toggleGoal(g.id)}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                      active
                        ? 'border-primary/50 bg-primary/5'
                        : 'border-border bg-card hover:bg-muted/30'
                    }`}
                  >
                    <div
                      className={`h-4 w-4 rounded mt-0.5 flex items-center justify-center border text-[10px] ${
                        active ? 'bg-primary text-primary-foreground border-primary' : 'border-border'
                      }`}
                    >
                      {active ? <Check className="h-3 w-3" /> : null}
                    </div>
                    <div>
                      <div className="font-semibold text-xs text-foreground">{g.label}</div>
                      <div className="text-[11px] text-muted-foreground">{g.desc}</div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </>
        )}

        {/* STEP 3: WhatsApp Setup */}
        {step === 3 && (
          <>
            <CardHeader>
              <CardTitle className="text-lg">Step 3: WhatsApp Cloud API Integration</CardTitle>
              <CardDescription className="text-xs">
                Wattomation interfaces directly with Meta&apos;s official WhatsApp Business Cloud API.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs space-y-2">
                <div className="flex items-center gap-2 font-semibold text-foreground">
                  <Shield className="h-4 w-4 text-primary" /> Hardware-Grade AES-256-GCM Encryption
                </div>
                <p className="text-muted-foreground leading-relaxed">
                  Your WhatsApp Access Tokens and secrets are encrypted at rest with hardware AES-256 keys. Decrypted tokens are never returned to client browsers.
                </p>
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-foreground">Integration Status:</span>
                  {whatsappConnected ? (
                    <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
                      Connected
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      Ready to Configure
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  You can connect your Meta App Phone Number ID and WABA details right now, or safely complete this under <strong>Settings → WhatsApp</strong> after entering your workspace.
                </p>
              </div>
            </CardContent>
          </>
        )}

        {/* STEP 4: AI Agent */}
        {step === 4 && (
          <>
            <CardHeader>
              <CardTitle className="text-lg">Step 4: AI Agent Persona Configuration</CardTitle>
              <CardDescription className="text-xs">
                Configure your autonomous 24/7 representative for customer inquiry handling.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Agent Persona Name</Label>
                  <Input
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    placeholder="e.g. Sophia, Marcus, Maya"
                    className="mt-1 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">Conversation Style & Tone</Label>
                  <Select value={agentTone} onValueChange={(v) => { if (v) setAgentTone(v); }}>
                    <SelectTrigger className="mt-1 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Professional & Helpful">Professional & Helpful</SelectItem>
                      <SelectItem value="Friendly & Warm">Friendly & Warm</SelectItem>
                      <SelectItem value="Direct & Efficient">Direct & Efficient</SelectItem>
                      <SelectItem value="Consultative & Thorough">Consultative & Thorough</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label className="text-xs">Base AI Instructions (System Prompt)</Label>
                <Textarea
                  rows={4}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="Define your AI agent's instructions, scope, and boundaries..."
                  className="mt-1 text-xs font-mono"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  You can adjust your Bring-Your-Own-Key OpenAI or Anthropic provider anytime in Settings.
                </p>
              </div>
            </CardContent>
          </>
        )}

        {/* STEP 5: Knowledge Base */}
        {step === 5 && (
          <>
            <CardHeader>
              <CardTitle className="text-lg">Step 5: Business Knowledge Base</CardTitle>
              <CardDescription className="text-xs">
                Teach your AI agent key facts about your business, FAQs, and service policies.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs">Core Business Information & FAQs (Optional)</Label>
                <Textarea
                  rows={5}
                  value={initialKnowledge}
                  onChange={(e) => setInitialKnowledge(e.target.value)}
                  placeholder="Paste your business FAQs, opening hours, pricing overview, or return policies here..."
                  className="mt-1 text-xs"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Wattomation uses semantic full-text search to retrieve relevant excerpts when customers ask questions.
                </p>
              </div>
            </CardContent>
          </>
        )}

        {/* STEP 6: Integrations */}
        {step === 6 && (
          <>
            <CardHeader>
              <CardTitle className="text-lg">Step 6: Website Lead Capture & Webhooks</CardTitle>
              <CardDescription className="text-xs">
                Connect your website to dispatch automated WhatsApp messages on form submissions.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
                <Label className="text-xs font-semibold">Your Website Widget Embed Code</Label>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={`<script src="${typeof window !== 'undefined' ? window.location.origin : 'https://wacrm.com'}/sdk/wacrm.js" data-site-key="${siteKey || 'wk_live_...'}" defer></script>`}
                    className="font-mono text-xs bg-card"
                  />
                  <Button size="sm" variant="outline" onClick={copySnippet} className="text-xs">
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Paste this snippet before the closing <code>&lt;/body&gt;</code> tag on your site.
                </p>
              </div>
            </CardContent>
          </>
        )}

        {/* STEP 7: Review */}
        {step === 7 && (
          <>
            <CardHeader>
              <CardTitle className="text-lg">Step 7: Review & Launch Workspace</CardTitle>
              <CardDescription className="text-xs">
                Your workspace configuration is ready to activate.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-2">
                <div className="flex justify-between py-1 border-b border-border/50">
                  <span className="text-muted-foreground">Workspace Name:</span>
                  <span className="font-semibold text-foreground">{businessName || 'My Workspace'}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border/50">
                  <span className="text-muted-foreground">Industry:</span>
                  <span className="font-semibold text-foreground">{industry}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border/50">
                  <span className="text-muted-foreground">AI Persona:</span>
                  <span className="font-semibold text-foreground">{agentName} ({agentTone})</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border/50">
                  <span className="text-muted-foreground">Selected Goals:</span>
                  <span className="font-semibold text-foreground">{selectedGoals.length} Configured</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Tenant Isolation:</span>
                  <span className="font-semibold text-emerald-500 flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Enforced (RLS Scoped)
                  </span>
                </div>
              </div>
            </CardContent>
          </>
        )}

        {/* Navigation Footer */}
        <CardFooter className="flex items-center justify-between border-t border-border pt-4">
          <div>
            {step > 1 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep((prev) => (prev - 1) as any)}
                className="text-xs"
              >
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => saveCurrentProgress(false)}
              disabled={savingProgress}
              className="text-xs text-muted-foreground"
            >
              <Save className="mr-1.5 h-3.5 w-3.5" /> Save Progress
            </Button>

            {step < 7 ? (
              <Button
                size="sm"
                onClick={handleNextStep}
                className="bg-primary text-primary-foreground text-xs"
              >
                Next <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleCompleteOnboarding}
                disabled={loading}
                className="bg-primary text-primary-foreground text-xs font-semibold"
              >
                {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Launch Workspace
              </Button>
            )}
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
