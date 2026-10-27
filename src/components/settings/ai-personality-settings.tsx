'use client';

import React from 'react';
import { Smile, Globe, Target, Sliders } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import type { AiBusinessProfile } from '@/lib/ai/types';

interface AiPersonalitySettingsProps {
  profile: AiBusinessProfile;
  onChange: (updated: AiBusinessProfile) => void;
  disabled?: boolean;
}

export function AiPersonalitySettings({
  profile,
  onChange,
  disabled = false,
}: AiPersonalitySettingsProps) {
  const updateField = <K extends keyof AiBusinessProfile>(
    field: K,
    value: AiBusinessProfile[K],
  ) => {
    onChange({ ...profile, [field]: value });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Smile className="h-4 w-4 text-primary" /> Personality, Tone & Language
          </CardTitle>
          <CardDescription>
            Control the conversational character and communication style of your AI assistant.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Conversational Tone</Label>
              <Select
                value={profile.tone || 'consultative'}
                onValueChange={(val: any) => updateField('tone', val)}
                disabled={disabled}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="consultative">
                    Consultative (Expert, helpful, solution-focused)
                  </SelectItem>
                  <SelectItem value="professional">
                    Professional (Formal, courteous, polished)
                  </SelectItem>
                  <SelectItem value="friendly">
                    Friendly & Warm (Approachable, engaging)
                  </SelectItem>
                  <SelectItem value="casual">
                    Casual & Direct (Modern, relaxed, conversational)
                  </SelectItem>
                  <SelectItem value="formal">
                    Executive / Corporate (Strictly formal)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Response Length Preference</Label>
              <Select
                value={profile.responseLength || 'concise'}
                onValueChange={(val: any) => updateField('responseLength', val)}
                disabled={disabled}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="concise">
                    Concise (2-3 sentences, ideal for WhatsApp)
                  </SelectItem>
                  <SelectItem value="balanced">
                    Balanced (3-5 sentences with context)
                  </SelectItem>
                  <SelectItem value="detailed">
                    Detailed (Comprehensive responses)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pref-lang">Preferred Language / Dialect</Label>
              <Input
                id="pref-lang"
                placeholder="e.g. English, Hinglish, Spanish, French"
                value={profile.preferredLanguage || 'English'}
                onChange={(e) => updateField('preferredLanguage', e.target.value)}
                disabled={disabled}
              />
              <p className="text-[11px] text-muted-foreground">
                The agent will mirror the customer's language while anchoring in this preference.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Primary Conversion Goal</Label>
              <Select
                value={profile.primaryConversionGoal || 'schedule_consultation'}
                onValueChange={(val: any) => updateField('primaryConversionGoal', val)}
                disabled={disabled}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="schedule_consultation">
                    Schedule a Consultation / Discovery Call
                  </SelectItem>
                  <SelectItem value="explore_pricing">
                    Review Packages & Pricing
                  </SelectItem>
                  <SelectItem value="lead_qualification">
                    Qualify Inbound Leads for Human Team
                  </SelectItem>
                  <SelectItem value="direct_booking">
                    Direct Calendar Appointment Booking
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                The ultimate objective the AI guides conversations toward.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="persona-desc">Persona Description (Optional)</Label>
            <Input
              id="persona-desc"
              placeholder="e.g. Senior Automation & Solutions Specialist"
              value={profile.personality || ''}
              onChange={(e) => updateField('personality', e.target.value)}
              disabled={disabled}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
