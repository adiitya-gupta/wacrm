'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  Bot,
  RotateCcw,
  Send,
  Loader2,
  UserCircle2,
  ArrowRight,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  DollarSign,
  Calendar,
  MessageSquare,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  /** assistant-only: the agent signalled a human handoff on this turn. */
  handoff?: boolean;
}

const STAGE_LABELS: Record<string, { label: string; color: string }> = {
  STAGE_A_UNDERSTAND: {
    label: 'Stage A: Understand Needs',
    color: 'bg-blue-500/10 text-blue-600 border-blue-200 dark:border-blue-900',
  },
  STAGE_B_ACKNOWLEDGE_OPTIONS: {
    label: 'Stage B: Acknowledged & Options',
    color: 'bg-emerald-500/10 text-emerald-600 border-emerald-200 dark:border-emerald-900',
  },
  STAGE_C_PRICING: {
    label: 'Stage C: Pricing Path',
    color: 'bg-purple-500/10 text-purple-600 border-purple-200 dark:border-purple-900',
  },
  STAGE_D_CONSULTATION: {
    label: 'Stage D: Consultation Booking',
    color: 'bg-amber-500/10 text-amber-600 border-amber-200 dark:border-amber-900',
  },
  STAGE_E_RESOLUTION: {
    label: 'Stage E: Flow Complete',
    color: 'bg-slate-500/10 text-slate-600 border-slate-200 dark:border-slate-800',
  },
  HANDOFF: {
    label: 'Human Handoff',
    color: 'bg-rose-500/10 text-rose-600 border-rose-200 dark:border-rose-900',
  },
};

const TEST_SCENARIOS = [
  {
    icon: Sparkles,
    title: '1. Service Inquiry',
    subtitle: 'Triggers acknowledgement & 2 options',
    text: "Hi, I'm interested in email automation for our business.",
  },
  {
    icon: DollarSign,
    title: '2. Explore Pricing',
    subtitle: 'Selects option 1 or asks pricing directly',
    text: '1. Explore pricing',
  },
  {
    icon: Calendar,
    title: '3. Book Consultation',
    subtitle: 'Selects option 2 or asks for a meeting',
    text: '2. Book a consultation',
  },
  {
    icon: UserCircle2,
    title: '4. Human Handoff',
    subtitle: 'Requests human support agent',
    text: 'Can I speak with a real human agent?',
  },
  {
    icon: AlertCircle,
    title: '5. Opt-Out',
    subtitle: 'Tests STOP compliance',
    text: 'STOP',
  },
];

export function AiPlayground({ onGoToSetup }: { onGoToSetup?: () => void }) {
  const t = useTranslations('Agents.playground');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [currentStage, setCurrentStage] = useState<string>('STAGE_A_UNDERSTAND');
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [isHandoff, setIsHandoff] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, sending]);

  const send = async (explicitText?: string) => {
    const text = (explicitText !== undefined ? explicitText : input).trim();
    if (!text || sending) return;

    const next: Turn[] = [...turns, { role: 'user', content: text }];
    setTurns(next);
    setInput('');
    setSending(true);

    try {
      const res = await fetch('/api/ai/playground', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next.map((turn) => ({ role: turn.role, content: turn.content })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'ai_not_configured') {
          toast.error(t('notConfigured'));
        } else {
          toast.error(data.error ?? t('noReply'));
        }
        setTurns(turns);
        setInput(text);
        return;
      }

      if (data.stage) setCurrentStage(data.stage);
      if (data.selectedService !== undefined) setSelectedService(data.selectedService);
      if (data.handoff) setIsHandoff(true);

      setTurns([
        ...next,
        {
          role: 'assistant',
          content:
            typeof data.reply === 'string' && data.reply.trim()
              ? data.reply
              : '',
          handoff: Boolean(data.handoff),
        },
      ]);
    } catch {
      toast.error(t('unreachable'));
      setTurns(turns);
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  const resetSession = () => {
    setTurns([]);
    setCurrentStage('STAGE_A_UNDERSTAND');
    setSelectedService(null);
    setIsHandoff(false);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const stageMeta = STAGE_LABELS[currentStage] || {
    label: currentStage,
    color: 'bg-muted text-muted-foreground border-border',
  };

  return (
    <div className="flex h-[72vh] min-h-[540px] flex-col rounded-xl border border-border bg-card shadow-xs overflow-hidden">
      {/* Simulation Sandbox Notice Banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/80 bg-primary/5 px-4 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-semibold text-foreground">
            🧪 WhatsApp Sandbox Environment
          </span>
          <span className="text-muted-foreground hidden sm:inline">
            — Safe multi-tenant simulator. Zero messages sent to Meta WhatsApp API.
          </span>
        </div>
        <div className="flex items-center gap-2">
          {selectedService && (
            <span className="inline-flex items-center gap-1 rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              <CheckCircle2 className="h-3 w-3" /> Service: {selectedService}
            </span>
          )}
          <span
            className={cn(
              'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold',
              isHandoff
                ? 'bg-rose-500/10 text-rose-600 border-rose-300 dark:border-rose-800'
                : stageMeta.color,
            )}
          >
            {isHandoff ? 'Status: Human Handoff' : stageMeta.label}
          </span>
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-card/60">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">{t('title')}</span>
          <span className="text-xs text-muted-foreground hidden md:inline">
            {t('subtitle')}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={resetSession}
          disabled={turns.length === 0 || sending}
          className="text-muted-foreground hover:text-foreground h-8 text-xs"
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> {t('reset')}
        </Button>
      </div>

      {/* Transcript */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4 bg-muted/10">
        {turns.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-3">
              <Bot className="h-6 w-6" />
            </div>
            <p className="font-semibold text-foreground">{t('emptyTitle')}</p>
            <p className="mt-1 text-xs text-muted-foreground max-w-md">
              Test your deterministic conversation flow, service acknowledgement, pricing packages, and consultation booking.
            </p>

            {/* Quick Test Scenarios */}
            <div className="mt-6 w-full max-w-xl">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Quick Test Scenarios
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left">
                {TEST_SCENARIOS.map((scenario, idx) => {
                  const Icon = scenario.icon;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => void send(scenario.text)}
                      className="group flex flex-col justify-between rounded-lg border border-border bg-card p-3 hover:border-primary/50 hover:bg-accent/40 transition-all text-left shadow-2xs"
                    >
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-primary shrink-0" />
                        <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                          {scenario.title}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {scenario.subtitle}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {onGoToSetup && (
              <Button
                variant="link"
                size="sm"
                onClick={onGoToSetup}
                className="mt-4 text-xs text-primary"
              >
                {t('goToSetup')} <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            )}
          </div>
        )}

        {turns.map((turn, i) => (
          <div
            key={i}
            className={cn(
              'flex gap-2.5',
              turn.role === 'user' ? 'justify-end' : 'justify-start',
            )}
          >
            {turn.role === 'assistant' && (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary mt-0.5">
                <Bot className="h-4 w-4" />
              </div>
            )}
            <div
              className={cn(
                'max-w-[82%] rounded-2xl px-4 py-2.5 text-sm',
                turn.role === 'user'
                  ? 'rounded-br-xs bg-primary text-primary-foreground shadow-xs'
                  : 'rounded-bl-xs bg-card border border-border text-foreground shadow-xs',
              )}
            >
              {turn.content && <p className="whitespace-pre-wrap leading-relaxed">{turn.content}</p>}
              {turn.role === 'assistant' && turn.handoff && (
                <div className="mt-2 flex items-center gap-1.5 border-t border-border/60 pt-2 text-xs font-semibold text-amber-600 dark:text-amber-400">
                  <UserCircle2 className="h-3.5 w-3.5" />
                  <span>Agent Handed Off to Human Team</span>
                </div>
              )}
            </div>
            {turn.role === 'user' && (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground mt-0.5">
                <UserCircle2 className="h-4 w-4" />
              </div>
            )}
          </div>
        ))}

        {sending && (
          <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Bot className="h-3.5 w-3.5" />
            </div>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            <span>Evaluating conversation state & generating response…</span>
          </div>
        )}
      </div>

      {/* Contextual Quick Reply Pills */}
      {turns.length > 0 && !sending && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/50 bg-card/40 px-3 py-1.5 text-xs">
          <span className="text-[11px] text-muted-foreground mr-1">Quick actions:</span>
          {currentStage === 'STAGE_B_ACKNOWLEDGE_OPTIONS' && (
            <>
              <button
                type="button"
                onClick={() => void send('1. Explore pricing')}
                className="rounded-full border border-primary/30 bg-primary/5 hover:bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary transition-colors"
              >
                💰 1. Explore pricing
              </button>
              <button
                type="button"
                onClick={() => void send('2. Book a consultation')}
                className="rounded-full border border-primary/30 bg-primary/5 hover:bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary transition-colors"
              >
                📅 2. Book a consultation
              </button>
            </>
          )}
          {currentStage === 'STAGE_C_PRICING' && (
            <button
              type="button"
              onClick={() => void send('I would like to schedule a consultation')}
              className="rounded-full border border-primary/30 bg-primary/5 hover:bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary transition-colors"
            >
              📅 Schedule a consultation
            </button>
          )}
          {currentStage === 'STAGE_D_CONSULTATION' && (
            <>
              <button
                type="button"
                onClick={() => void send('Tomorrow at 10:00 AM')}
                className="rounded-full border border-border bg-card hover:border-primary/40 px-2.5 py-0.5 text-xs text-foreground transition-colors"
              >
                Tomorrow 10:00 AM
              </button>
              <button
                type="button"
                onClick={() => void send('Next Monday at 3:00 PM')}
                className="rounded-full border border-border bg-card hover:border-primary/40 px-2.5 py-0.5 text-xs text-foreground transition-colors"
              >
                Next Monday 3:00 PM
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => void send('Can I speak with a person?')}
            className="rounded-full border border-border bg-card hover:border-amber-400 px-2.5 py-0.5 text-xs text-muted-foreground hover:text-amber-600 transition-colors"
          >
            👤 Human Agent
          </button>
        </div>
      )}

      {/* Composer */}
      <div className="flex items-end gap-2 border-t border-border p-3 bg-card">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('placeholder')}
          rows={1}
          className="flex-1 resize-none rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
        />
        <Button
          size="sm"
          onClick={() => void send()}
          disabled={!input.trim() || sending}
          className="h-9 w-9 shrink-0 p-0 bg-primary hover:bg-primary-hover text-primary-foreground"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
