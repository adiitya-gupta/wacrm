'use client';

import React from 'react';
import { DollarSign, Plus, Trash2, Calendar, FileQuestion } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import type { AiBusinessProfile, PricingPackage, PricingRule } from '@/lib/ai/types';

interface AiPricingSettingsProps {
  profile: AiBusinessProfile;
  onChange: (updated: AiBusinessProfile) => void;
  disabled?: boolean;
}

export function AiPricingSettings({
  profile,
  onChange,
  disabled = false,
}: AiPricingSettingsProps) {
  const updateField = <K extends keyof AiBusinessProfile>(
    field: K,
    value: AiBusinessProfile[K],
  ) => {
    onChange({ ...profile, [field]: value });
  };

  const addPackage = () => {
    const newPkg: PricingPackage = {
      id: `pkg-${Date.now()}`,
      name: '',
      price: '',
      billingPeriod: 'one-time setup',
      description: '',
      features: [],
    };
    updateField('pricingPackages', [...(profile.pricingPackages || []), newPkg]);
  };

  const updatePackage = (index: number, updates: Partial<PricingPackage>) => {
    const updated = [...(profile.pricingPackages || [])];
    updated[index] = { ...updated[index], ...updates };
    updateField('pricingPackages', updated);
  };

  const removePackage = (index: number) => {
    const updated = (profile.pricingPackages || []).filter((_, i) => i !== index);
    updateField('pricingPackages', updated);
  };

  const addRule = () => {
    const newRule: PricingRule = {
      id: `rule-${Date.now()}`,
      title: 'Custom Scoping Rule',
      rule: 'Exact pricing is tailored on our discovery call based on volume and requirements.',
    };
    updateField('pricingRules', [...(profile.pricingRules || []), newRule]);
  };

  const updateRule = (index: number, updates: Partial<PricingRule>) => {
    const updated = [...(profile.pricingRules || [])];
    updated[index] = { ...updated[index], ...updates };
    updateField('pricingRules', updated);
  };

  const removeRule = (index: number) => {
    const updated = (profile.pricingRules || []).filter((_, i) => i !== index);
    updateField('pricingRules', updated);
  };

  return (
    <div className="space-y-6">
      {/* 1. Verified Packages */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-4 w-4 text-primary" /> Verified Pricing Packages
            </CardTitle>
            <CardDescription>
              These packages are cited when a customer inquires about pricing. The AI never fabricates prices outside these definitions.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addPackage}
            disabled={disabled}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Package
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {(!profile.pricingPackages || profile.pricingPackages.length === 0) ? (
            <p className="rounded-lg border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
              No pricing packages defined yet. Click &quot;Add Package&quot; above.
            </p>
          ) : (
            profile.pricingPackages.map((pkg, idx) => (
              <div
                key={pkg.id || idx}
                className="relative rounded-lg border border-border bg-muted/20 p-4 space-y-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 flex-1">
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold text-muted-foreground">
                        Package Name
                      </Label>
                      <Input
                        placeholder="e.g. Starter Automation"
                        value={pkg.name}
                        onChange={(e) => updatePackage(idx, { name: e.target.value })}
                        disabled={disabled}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold text-muted-foreground">
                        Price
                      </Label>
                      <Input
                        placeholder="e.g. $499 or Starting at ₹25,000"
                        value={pkg.price}
                        onChange={(e) => updatePackage(idx, { price: e.target.value })}
                        disabled={disabled}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold text-muted-foreground">
                        Billing Term
                      </Label>
                      <Input
                        placeholder="e.g. one-time setup, /month"
                        value={pkg.billingPeriod || ''}
                        onChange={(e) =>
                          updatePackage(idx, { billingPeriod: e.target.value })
                        }
                        disabled={disabled}
                      />
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => removePackage(idx)}
                    disabled={disabled}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-muted-foreground">
                    Description & Inclusions
                  </Label>
                  <Input
                    placeholder="Brief summary of what is included in this tier..."
                    value={pkg.description || ''}
                    onChange={(e) =>
                      updatePackage(idx, { description: e.target.value })
                    }
                    disabled={disabled}
                  />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* 2. Custom Pricing Rules */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileQuestion className="h-4 w-4 text-primary" /> Pricing Rules & Scope Clarification
            </CardTitle>
            <CardDescription>
              Instructions for handling complex, custom, or variable scope quotes.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addRule}
            disabled={disabled}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Rule
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {(!profile.pricingRules || profile.pricingRules.length === 0) ? (
            <p className="rounded-lg border border-dashed border-border py-4 text-center text-xs text-muted-foreground">
              No custom pricing rules specified. Standard packages apply.
            </p>
          ) : (
            profile.pricingRules.map((rule, idx) => (
              <div
                key={rule.id || idx}
                className="flex items-center gap-2 rounded-lg border border-border p-3"
              >
                <div className="flex-1 space-y-1">
                  <Input
                    placeholder="Rule title (e.g. Discovery Call Quote)"
                    value={rule.title}
                    onChange={(e) => updateRule(idx, { title: e.target.value })}
                    disabled={disabled}
                    className="h-8 text-xs font-semibold"
                  />
                  <Input
                    placeholder="Rule directive..."
                    value={rule.rule}
                    onChange={(e) => updateRule(idx, { rule: e.target.value })}
                    disabled={disabled}
                    className="text-xs"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeRule(idx)}
                  disabled={disabled}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* 3. Meeting & Consultation Rules */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="h-4 w-4 text-primary" /> Consultation & Booking Rules
          </CardTitle>
          <CardDescription>
            Configure how consultations and discovery calls are scheduled via WhatsApp.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Consultation Duration</Label>
              <Select
                value={String(profile.meetingRules?.durationMinutes ?? 15)}
                onValueChange={(val) =>
                  updateField('meetingRules', {
                    ...profile.meetingRules,
                    durationMinutes: Number(val),
                  })
                }
                disabled={disabled}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="15">15 Minutes (Quick discovery call)</SelectItem>
                  <SelectItem value="30">30 Minutes (Standard consultation)</SelectItem>
                  <SelectItem value="45">45 Minutes (Deep dive demo)</SelectItem>
                  <SelectItem value="60">60 Minutes (Full strategy session)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="meeting-link">Default Video Meeting Link (Optional)</Label>
              <Input
                id="meeting-link"
                placeholder="e.g. https://meet.google.com/abc-xyz or Calendly"
                value={profile.meetingRules?.defaultMeetingLink || ''}
                onChange={(e) =>
                  updateField('meetingRules', {
                    ...profile.meetingRules,
                    defaultMeetingLink: e.target.value.trim() || undefined,
                  })
                }
                disabled={disabled}
              />
              <p className="text-[11px] text-muted-foreground">
                Injected into booking confirmations if Google Calendar integration is not active.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
