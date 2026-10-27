'use client';

import React from 'react';
import { GitBranch, CheckCircle2, MessageSquare, DollarSign, Calendar, Users } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { AiConversationFlowConfig, FlowPresetType } from '@/lib/ai/types';

interface AiFlowSettingsProps {
  flowConfig: AiConversationFlowConfig;
  onChange: (updated: AiConversationFlowConfig) => void;
  disabled?: boolean;
}

const PRESET_OPTIONS: Array<{
  id: FlowPresetType;
  title: string;
  description: string;
  badge: string;
}> = [
  {
    id: 'service_to_conversion',
    title: 'Service Inquiry → Pricing or Consultation (Recommended)',
    description:
      'Identifies the service, acknowledges it with grounded benefits, and offers two clear paths: explore pricing or book a consultation.',
    badge: 'High Conversion',
  },
  {
    id: 'lead_qualification',
    title: 'Lead Qualification → Consultation Booking',
    description:
      'Asks 2 focused qualification questions before guiding qualified prospects toward a discovery call.',
    badge: 'Consultative',
  },
  {
    id: 'pricing_inquiry',
    title: 'Pricing & Package Inquiry',
    description:
      'Explains packages and verified pricing up front, then invites to a consultation for tailored requirements.',
    badge: 'Direct Pricing',
  },
  {
    id: 'appointment_booking',
    title: 'Direct Appointment Booking',
    description:
      'Recognizes scheduling intent and checks calendar availability immediately to book time slots.',
    badge: 'Calendar First',
  },
  {
    id: 'support_faq',
    title: 'Customer Support & FAQ',
    description:
      'Answers common queries from your knowledge base and escalates to a human agent when needed.',
    badge: 'Support',
  },
  {
    id: 'human_handoff',
    title: 'Hybrid / Human-Handoff Flow',
    description:
      'Welcomes the customer, collects preliminary requirements, and immediately routes to a human agent.',
    badge: 'Escalation',
  },
];

export function AiFlowSettings({
  flowConfig,
  onChange,
  disabled = false,
}: AiFlowSettingsProps) {
  const updateField = <K extends keyof AiConversationFlowConfig>(
    field: K,
    value: AiConversationFlowConfig[K],
  ) => {
    onChange({ ...flowConfig, [field]: value });
  };

  return (
    <div className="space-y-6">
      {/* 1. Preset Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GitBranch className="h-4 w-4 text-primary" /> Conversation Flow Presets
          </CardTitle>
          <CardDescription>
            Choose how your AI agent guides incoming WhatsApp conversations toward your business goal.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {PRESET_OPTIONS.map((preset) => {
              const isSelected = flowConfig.preset === preset.id;
              return (
                <div
                  key={preset.id}
                  onClick={() => !disabled && updateField('preset', preset.id)}
                  className={cn(
                    'relative flex cursor-pointer flex-col justify-between rounded-lg border p-4 transition-all',
                    isSelected
                      ? 'border-primary bg-primary/5 shadow-xs ring-1 ring-primary'
                      : 'border-border hover:border-muted-foreground/40 bg-card',
                    disabled && 'pointer-events-none opacity-60',
                  )}
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-foreground">
                        {preset.title.split(' (')[0]}
                      </span>
                      {isSelected && (
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {preset.description}
                    </p>
                  </div>
                  <div className="mt-3">
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {preset.badge}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* 2. Visual Stage Progression Stepper */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stage Progression Architecture</CardTitle>
          <CardDescription>
            The deterministic stages enforced by the conversation flow manager for each incoming lead.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-center">
              <span className="text-[10px] font-bold uppercase text-primary">Stage A</span>
              <div className="mt-1 flex items-center justify-center gap-1 font-medium text-xs">
                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" /> Understand
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Max {flowConfig.maxDiscoveryQuestions || 2} questions; skips if service already stated
              </p>
            </div>

            <div className="rounded-lg border border-border bg-muted/20 p-3 text-center">
              <span className="text-[10px] font-bold uppercase text-primary">Stage B</span>
              <div className="mt-1 flex items-center justify-center gap-1 font-medium text-xs">
                <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" /> Acknowledge
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Compliment + Grounded benefit + Offers 2 Options
              </p>
            </div>

            <div className="rounded-lg border border-border bg-muted/20 p-3 text-center">
              <span className="text-[10px] font-bold uppercase text-primary">Stage C</span>
              <div className="mt-1 flex items-center justify-center gap-1 font-medium text-xs">
                <DollarSign className="h-3.5 w-3.5 text-muted-foreground" /> Pricing Path
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Verified pricing packages + Consultation offer
              </p>
            </div>

            <div className="rounded-lg border border-border bg-muted/20 p-3 text-center">
              <span className="text-[10px] font-bold uppercase text-primary">Stage D</span>
              <div className="mt-1 flex items-center justify-center gap-1 font-medium text-xs">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" /> Consultation
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Checks live slots & books meeting atomically
              </p>
            </div>

            <div className="rounded-lg border border-border bg-muted/20 p-3 text-center">
              <span className="text-[10px] font-bold uppercase text-primary">Stage E</span>
              <div className="mt-1 flex items-center justify-center gap-1 font-medium text-xs">
                <Users className="h-3.5 w-3.5 text-muted-foreground" /> Resolution
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Stops discovery; human handoff or completion
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3. Flow Transition Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Discovery & Transition Rules</CardTitle>
          <CardDescription>
            Fine-tune discovery bounds so customers are never stuck in repetitive qualification loops.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Maximum Discovery Questions</Label>
              <Select
                value={String(flowConfig.maxDiscoveryQuestions ?? 2)}
                onValueChange={(val) => updateField('maxDiscoveryQuestions', Number(val))}
                disabled={disabled}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 Question (Fast-track)</SelectItem>
                  <SelectItem value="2">2 Questions (Recommended default)</SelectItem>
                  <SelectItem value="3">3 Questions (Standard)</SelectItem>
                  <SelectItem value="4">4 Questions (Deep qualification)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Once this limit is reached, the agent stops asking discovery questions and presents your core services.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Service Acknowledgement Style</Label>
              <Select
                value={flowConfig.acknowledgementStyle || 'compliment_and_benefit'}
                onValueChange={(val) =>
                  updateField('acknowledgementStyle', val as AiConversationFlowConfig['acknowledgementStyle'])
                }
                disabled={disabled}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="compliment_and_benefit">
                    Positive Compliment + Verified Benefit
                  </SelectItem>
                  <SelectItem value="direct_benefit">
                    Direct Benefit Only
                  </SelectItem>
                  <SelectItem value="concise">
                    Ultra-Concise Confirmation
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Controls the tone when acknowledging a customer&apos;s selected service.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">
                Offer Exactly Two Clear Options
              </Label>
              <p className="text-xs text-muted-foreground">
                When a service is identified, prompts the customer with: 1. Explore pricing, 2. Book a consultation.
              </p>
            </div>
            <Switch
              checked={flowConfig.twoOptionChoice !== false}
              onCheckedChange={(checked) => updateField('twoOptionChoice', checked)}
              disabled={disabled}
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-foreground">Test Conversation Flow in Sandbox</p>
              <p className="text-xs text-muted-foreground">
                Simulate customer messages, verify service acknowledgements, and test next-step options without sending live WhatsApp messages.
              </p>
            </div>
            <a
              href="/agents"
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium shadow-xs hover:bg-accent hover:text-accent-foreground shrink-0 transition-colors gap-1.5"
            >
              Open AI Playground →
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

