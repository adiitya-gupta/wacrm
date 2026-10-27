'use client';

import React, { useState } from 'react';
import { FileText, Eye, AlertCircle, Check, Copy } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
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
import {
  SUPPORTED_TEMPLATE_VARIABLES,
  validateTemplate,
  renderTemplate,
} from '@/lib/ai/templates';
import { DEFAULT_AI_MESSAGE_TEMPLATES } from '@/lib/ai/defaults';
import type { AiMessageTemplates } from '@/lib/ai/types';

interface AiTemplatesEditorProps {
  templates: AiMessageTemplates;
  onChange: (updated: AiMessageTemplates) => void;
  businessName?: string;
  disabled?: boolean;
}

const TEMPLATE_DEFINITIONS: Array<{
  key: keyof AiMessageTemplates;
  label: string;
  description: string;
  relevantVariables: string[];
}> = [
  {
    key: 'service_acknowledgement',
    label: 'Stage B: Service Acknowledgement & 2 Options',
    description:
      'Sent immediately when a customer selects or mentions a service. Offers pricing vs consultation.',
    relevantVariables: ['business_name', 'service_name', 'service_benefits', 'customer_name'],
  },
  {
    key: 'pricing_response',
    label: 'Stage C: Pricing & Packages Response',
    description:
      'Sent when a customer asks for pricing or selects Option 1. Injects verified pricing.',
    relevantVariables: ['service_name', 'pricing_info', 'business_name'],
  },
  {
    key: 'consultation_invitation',
    label: 'Consultation Menu Invitation',
    description: 'Presents the choice between exploring pricing or scheduling a call.',
    relevantVariables: ['business_name'],
  },
  {
    key: 'booking_detail_collection',
    label: 'Stage D: Booking Details Request',
    description: 'Prompts the customer for their preferred day and time for the consultation.',
    relevantVariables: ['business_name', 'customer_name', 'service_name'],
  },
  {
    key: 'booking_confirmation',
    label: 'Stage D: Booking Confirmation',
    description: 'Sent only AFTER a calendar meeting has been successfully created in the database.',
    relevantVariables: ['meeting_date', 'meeting_time', 'meeting_link', 'service_name', 'business_name'],
  },
  {
    key: 'welcome',
    label: 'Welcome / Greeting',
    description: 'Initial greeting when a customer initiates contact.',
    relevantVariables: ['business_name', 'customer_name'],
  },
  {
    key: 'human_handoff',
    label: 'Human Handoff Notice',
    description: 'Sent when the conversation is escalated to a human agent.',
    relevantVariables: ['business_name', 'customer_name'],
  },
  {
    key: 'pricing_clarification',
    label: 'Pricing Clarification (Custom Scoping)',
    description: 'Sent when a quote depends on requirements and requires a short discovery call.',
    relevantVariables: ['business_name'],
  },
  {
    key: 'follow_up',
    label: 'Follow-Up Message',
    description: 'Used for scheduled follow-ups with leads who have not booked yet.',
    relevantVariables: ['customer_name', 'service_name', 'business_name'],
  },
  {
    key: 'fallback',
    label: 'Error & Fallback Recovery',
    description: 'Sent when unexpected inputs are received or AI generation needs safe recovery.',
    relevantVariables: ['business_name'],
  },
];

export function AiTemplatesEditor({
  templates,
  onChange,
  businessName = 'Our Business',
  disabled = false,
}: AiTemplatesEditorProps) {
  const [selectedKey, setSelectedKey] = useState<keyof AiMessageTemplates>(
    'service_acknowledgement',
  );
  const [copiedVar, setCopiedVar] = useState<string | null>(null);

  const currentDef =
    TEMPLATE_DEFINITIONS.find((d) => d.key === selectedKey) ||
    TEMPLATE_DEFINITIONS[0];

  const currentValue =
    templates[selectedKey] ?? DEFAULT_AI_MESSAGE_TEMPLATES[selectedKey] ?? '';

  const validation = validateTemplate(currentValue);

  const sampleVariables = {
    business_name: businessName,
    customer_name: 'Alex',
    service_name: 'Email & Marketing Automation',
    service_benefits: 'save time and follow up with leads consistently',
    meeting_date: 'Wednesday, Oct 28',
    meeting_time: '3:30 PM (IST)',
    meeting_link: 'https://meet.google.com/xyz-demo',
    pricing_info: '• Starter Package: $499 (one-time setup)\n• Custom Solution: tailored quote',
    consultation_link: 'https://wattomation.com/book',
  };

  const previewText = renderTemplate(currentValue, sampleVariables);

  const handleTextChange = (text: string) => {
    onChange({
      ...templates,
      [selectedKey]: text,
    });
  };

  const insertVariable = (varName: string) => {
    const chip = `{{${varName}}}`;
    handleTextChange(`${currentValue} ${chip}`);
    setCopiedVar(varName);
    setTimeout(() => setCopiedVar(null), 1500);
  };

  const resetToDefault = () => {
    handleTextChange(DEFAULT_AI_MESSAGE_TEMPLATES[selectedKey] || '');
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4 text-primary" /> Message Template Studio
              </CardTitle>
              <CardDescription>
                Customize the exact messages your AI assistant sends at each stage of the conversation.
              </CardDescription>
            </div>
            <div className="w-full sm:w-72">
              <Select
                value={selectedKey}
                onValueChange={(val) => setSelectedKey(val as keyof AiMessageTemplates)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_DEFINITIONS.map((def) => (
                    <SelectItem key={def.key} value={def.key}>
                      {def.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-muted/40 p-3">
            <h4 className="text-sm font-semibold text-foreground">
              {currentDef.label}
            </h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              {currentDef.description}
            </p>
          </div>

          {/* Variable Insertion Chips */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground">
              Insert Supported Variables (Click to append):
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {SUPPORTED_TEMPLATE_VARIABLES.map((v) => {
                const isRelevant = currentDef.relevantVariables.includes(v);
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => !disabled && insertVariable(v)}
                    disabled={disabled}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-mono transition-colors ${
                      isRelevant
                        ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20'
                        : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {copiedVar === v ? (
                      <Check className="h-3 w-3 text-emerald-500" />
                    ) : (
                      <Copy className="h-3 w-3 opacity-60" />
                    )}
                    {`{{${v}}}`}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Template Textarea */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="template-text">Template Content</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                onClick={resetToDefault}
                disabled={disabled}
              >
                Reset to Default
              </Button>
            </div>
            <Textarea
              id="template-text"
              rows={5}
              value={currentValue}
              onChange={(e) => handleTextChange(e.target.value)}
              disabled={disabled}
              className={!validation.valid ? 'border-destructive focus-visible:ring-destructive' : ''}
            />
            {!validation.valid && (
              <div className="flex items-center gap-1.5 text-xs text-destructive mt-1">
                <AlertCircle className="h-3.5 w-3.5" />
                <span>{validation.error}</span>
              </div>
            )}
          </div>

          {/* Live Preview Card */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Eye className="h-3.5 w-3.5 text-primary" /> Live Customer WhatsApp Preview
            </div>
            <div className="rounded-md bg-emerald-950/10 dark:bg-emerald-950/20 border border-emerald-500/20 p-3 text-sm text-foreground whitespace-pre-wrap font-sans">
              {previewText}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Simulated preview with sample variables. Real WhatsApp deliveries use the customer's actual context.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
