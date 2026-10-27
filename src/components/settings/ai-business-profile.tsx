'use client';

import React from 'react';
import { Plus, Trash2, Briefcase, ShieldAlert, Sparkles } from 'lucide-react';
import { Input } from '@/components/ui/input';
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
import type { AiBusinessProfile, ServiceItem } from '@/lib/ai/types';

interface AiBusinessProfileProps {
  profile: AiBusinessProfile;
  onChange: (updated: AiBusinessProfile) => void;
  disabled?: boolean;
}

export function AiBusinessProfileEditor({
  profile,
  onChange,
  disabled = false,
}: AiBusinessProfileProps) {
  const updateField = <K extends keyof AiBusinessProfile>(
    field: K,
    value: AiBusinessProfile[K],
  ) => {
    onChange({ ...profile, [field]: value });
  };

  const addService = () => {
    const newService: ServiceItem = {
      id: `srv-${Date.now()}`,
      name: '',
      description: '',
      benefits: ['save time and effort'],
      keywords: [],
    };
    updateField('services', [...(profile.services || []), newService]);
  };

  const updateService = (index: number, updates: Partial<ServiceItem>) => {
    const updated = [...(profile.services || [])];
    updated[index] = { ...updated[index], ...updates };
    updateField('services', updated);
  };

  const removeService = (index: number) => {
    const updated = (profile.services || []).filter((_, i) => i !== index);
    updateField('services', updated);
  };

  return (
    <div className="space-y-6">
      {/* 1. Core Business Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Briefcase className="h-4 w-4 text-primary" /> Business Profile & Target Audience
          </CardTitle>
          <CardDescription>
            Grounded facts about your business that the AI uses to qualify leads accurately without hallucinations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="biz-name">Business Name</Label>
              <Input
                id="biz-name"
                placeholder="e.g. Acme Automation or OPSIYS"
                value={profile.businessName || ''}
                onChange={(e) => updateField('businessName', e.target.value)}
                disabled={disabled}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="biz-industry">Industry / Niche</Label>
              <Input
                id="biz-industry"
                placeholder="e.g. Technology & Marketing Agency, Real Estate, Clinic"
                value={profile.industry || ''}
                onChange={(e) => updateField('industry', e.target.value)}
                disabled={disabled}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="biz-desc">Business Description & Core Offer</Label>
            <Textarea
              id="biz-desc"
              rows={3}
              placeholder="Describe what your business does and the main outcomes you deliver..."
              value={profile.businessDescription || ''}
              onChange={(e) => updateField('businessDescription', e.target.value)}
              disabled={disabled}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="biz-audience">Target Customers</Label>
            <Input
              id="biz-audience"
              placeholder="e.g. Business Owners, Founders, Clinic Directors, Home Buyers"
              value={profile.targetCustomers || ''}
              onChange={(e) => updateField('targetCustomers', e.target.value)}
              disabled={disabled}
            />
          </div>
        </CardContent>
      </Card>

      {/* 2. Structured Services Catalog with Grounded Benefits */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" /> Services & Customer Benefits Catalog
            </CardTitle>
            <CardDescription>
              When a customer expresses interest in a service, the AI immediately acknowledges it and explains these verified benefits.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addService}
            disabled={disabled}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Service
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {(!profile.services || profile.services.length === 0) ? (
            <p className="rounded-lg border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
              No services configured yet. Click &quot;Add Service&quot; above to define your offerings.
            </p>
          ) : (
            profile.services.map((service, idx) => (
              <div
                key={service.id || idx}
                className="relative rounded-lg border border-border bg-muted/20 p-4 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs font-semibold text-muted-foreground">
                      Service Name #{idx + 1}
                    </Label>
                    <Input
                      placeholder="e.g. Email & Marketing Automation, WhatsApp AI Bot"
                      value={service.name}
                      onChange={(e) =>
                        updateService(idx, { name: e.target.value })
                      }
                      disabled={disabled}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => removeService(idx)}
                    disabled={disabled}
                    title="Remove Service"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-muted-foreground">
                    Description
                  </Label>
                  <Input
                    placeholder="Brief description of what this service entails..."
                    value={service.description}
                    onChange={(e) =>
                      updateService(idx, { description: e.target.value })
                    }
                    disabled={disabled}
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-muted-foreground">
                    Customer Benefits (Comma-separated)
                  </Label>
                  <Input
                    placeholder="e.g. save time and follow up with leads consistently, tailor workflow to your business"
                    value={(service.benefits || []).join(', ')}
                    onChange={(e) =>
                      updateService(idx, {
                        benefits: e.target.value
                          .split(',')
                          .map((b) => b.trim())
                          .filter(Boolean),
                      })
                    }
                    disabled={disabled}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    These benefits are highlighted to the customer when they select this service.
                  </p>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* 3. Custom Instructions & Prohibited Claims */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-primary" /> Directives & Guardrails
          </CardTitle>
          <CardDescription>
            Specify rules the AI must follow, and claims it is strictly prohibited from making.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="custom-instructions">Special Instructions for Your Agent</Label>
            <Textarea
              id="custom-instructions"
              rows={3}
              placeholder="e.g. Always emphasize our 15-minute quick discovery call. If customer asks about refunds, refer to our 30-day policy."
              value={profile.customInstructions || ''}
              onChange={(e) => updateField('customInstructions', e.target.value)}
              disabled={disabled}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="prohibited-claims">Prohibited Claims (One per line)</Label>
            <Textarea
              id="prohibited-claims"
              rows={2}
              placeholder="e.g. Never guarantee exact revenue or follower figures.&#10;Never quote prices below $500 without owner approval."
              value={(profile.prohibitedClaims || []).join('\n')}
              onChange={(e) =>
                updateField(
                  'prohibitedClaims',
                  e.target.value
                    .split('\n')
                    .map((l) => l.trim())
                    .filter(Boolean),
                )
              }
              disabled={disabled}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
