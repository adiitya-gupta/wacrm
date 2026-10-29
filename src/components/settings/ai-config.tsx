'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Eye,
  EyeOff,
  Briefcase,
  GitBranch,
  FileText,
  DollarSign,
  Smile,
  KeyRound,
  Save,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SettingsPanelHead } from './settings-panel-head';
import { AiKnowledgeCard } from './ai-knowledge';
import { AiBusinessProfileEditor } from './ai-business-profile';
import { AiFlowSettings } from './ai-flow-settings';
import { AiTemplatesEditor } from './ai-templates-editor';
import { AiPricingSettings } from './ai-pricing-settings';
import { AiPersonalitySettings } from './ai-personality-settings';
import {
  AI_PROVIDER_DEFAULT_MODEL,
  DEFAULT_AI_BUSINESS_PROFILE,
  DEFAULT_AI_CONVERSATION_FLOW,
  DEFAULT_AI_MESSAGE_TEMPLATES,
} from '@/lib/ai/defaults';
import type {
  AiProvider,
  AiBusinessProfile,
  AiConversationFlowConfig,
  AiMessageTemplates,
} from '@/lib/ai/types';
import type { AccountMember } from '@/types';
import { fetchAccountMembers, memberLabel } from '@/lib/account/members';
import { useTranslations } from 'next-intl';

const MASKED_KEY = '••••••••••••••••';
const HANDOFF_QUEUE = '__queue__';

const PROVIDER_LABEL: Record<Exclude<AiProvider, 'openai_compatible'>, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
};

const KEY_PLACEHOLDER: Record<AiProvider, string> = {
  openai: 'sk-...',
  anthropic: 'sk-ant-...',
  openai_compatible: 'your-api-key',
};

type ConfigSubTab =
  | 'profile'
  | 'flow'
  | 'templates'
  | 'pricing'
  | 'personality'
  | 'credentials';

export function AiConfig() {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const t = useTranslations('Settings.aiConfig');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);

  const [activeSubTab, setActiveSubTab] = useState<ConfigSubTab>('profile');

  // Core Agent Credentials State
  const [configured, setConfigured] = useState(false);
  const [provider, setProvider] = useState<AiProvider>('openai');
  const [model, setModel] = useState(AI_PROVIDER_DEFAULT_MODEL.openai);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [embeddingsKey, setEmbeddingsKey] = useState('');
  const [embeddingsKeyEdited, setEmbeddingsKeyEdited] = useState(false);
  const [hasStoredEmbeddingsKey, setHasStoredEmbeddingsKey] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [maxPerConversation, setMaxPerConversation] = useState(3);
  const [handoffAgentId, setHandoffAgentId] = useState('');
  const [members, setMembers] = useState<AccountMember[]>([]);

  // Multi-Tenant Business Profile, Flow, and Templates State
  const [businessProfile, setBusinessProfile] = useState<AiBusinessProfile>(
    DEFAULT_AI_BUSINESS_PROFILE,
  );
  const [conversationFlow, setConversationFlow] =
    useState<AiConversationFlowConfig>(DEFAULT_AI_CONVERSATION_FLOW);
  const [messageTemplates, setMessageTemplates] = useState<AiMessageTemplates>(
    DEFAULT_AI_MESSAGE_TEMPLATES,
  );

  const loadedAccountIdRef = useRef<string | null>(null);
  const savedSnapshotRef = useRef<string | null>(null);

  const buildSnapshot = useCallback(() => {
    return JSON.stringify({
      provider,
      model: model.trim(),
      baseUrl: baseUrl.trim(),
      systemPrompt: systemPrompt.trim(),
      isActive,
      autoReplyEnabled,
      maxPerConversation,
      handoffAgentId,
      apiKey: keyEdited ? apiKey.trim() : hasStoredKey ? 'STORED' : '',
      embeddingsKey: embeddingsKeyEdited ? embeddingsKey.trim() : hasStoredEmbeddingsKey ? 'STORED' : '',
      businessProfile,
      conversationFlow,
      messageTemplates,
    });
  }, [
    provider,
    model,
    baseUrl,
    systemPrompt,
    isActive,
    autoReplyEnabled,
    maxPerConversation,
    handoffAgentId,
    apiKey,
    keyEdited,
    hasStoredKey,
    embeddingsKey,
    embeddingsKeyEdited,
    hasStoredEmbeddingsKey,
    businessProfile,
    conversationFlow,
    messageTemplates,
  ]);

  const isDirty =
    savedSnapshotRef.current !== null &&
    buildSnapshot() !== savedSnapshotRef.current;

  // Prevent accidental loss of unsaved changes when closing tab or reloading
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/config');
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t('loadFailed'));
        return;
      }

      let loadedBusinessProfile = DEFAULT_AI_BUSINESS_PROFILE;
      let loadedConversationFlow = DEFAULT_AI_CONVERSATION_FLOW;
      let loadedMessageTemplates = DEFAULT_AI_MESSAGE_TEMPLATES;

      if (data.configured) {
        setConfigured(true);
        setProvider(data.provider);
        setModel(data.model);
        setBaseUrl(data.base_url ?? '');
        setSystemPrompt(data.system_prompt ?? '');
        setIsActive(data.is_active);
        setAutoReplyEnabled(data.auto_reply_enabled);
        setMaxPerConversation(data.auto_reply_max_per_conversation ?? 3);
        setHandoffAgentId(data.handoff_agent_id ?? '');
        setHasStoredKey(Boolean(data.has_key));
        setApiKey(data.has_key ? MASKED_KEY : '');
        setKeyEdited(false);
        setHasStoredEmbeddingsKey(Boolean(data.has_embeddings_key));
        setEmbeddingsKey(data.has_embeddings_key ? MASKED_KEY : '');
        setEmbeddingsKeyEdited(false);
      }

      // Load multi-tenant business profile, flow, and templates if saved.
      // These are loaded REGARDLESS of data.configured so profile data persists reliably across reloads.
      if (data.business_profile && typeof data.business_profile === 'object') {
        loadedBusinessProfile = {
          ...DEFAULT_AI_BUSINESS_PROFILE,
          ...data.business_profile,
        };
      } else {
        loadedBusinessProfile = DEFAULT_AI_BUSINESS_PROFILE;
      }
      setBusinessProfile(loadedBusinessProfile);

      if (data.conversation_flow && typeof data.conversation_flow === 'object') {
        loadedConversationFlow = {
          ...DEFAULT_AI_CONVERSATION_FLOW,
          ...data.conversation_flow,
        };
      } else {
        loadedConversationFlow = DEFAULT_AI_CONVERSATION_FLOW;
      }
      setConversationFlow(loadedConversationFlow);

      if (data.message_templates && typeof data.message_templates === 'object') {
        loadedMessageTemplates = {
          ...DEFAULT_AI_MESSAGE_TEMPLATES,
          ...data.message_templates,
        };
      } else {
        loadedMessageTemplates = DEFAULT_AI_MESSAGE_TEMPLATES;
      }
      setMessageTemplates(loadedMessageTemplates);

      // Initialize saved snapshot
      savedSnapshotRef.current = JSON.stringify({
        provider: data.configured ? data.provider : provider,
        model: data.configured ? (data.model || '').trim() : model.trim(),
        baseUrl: (data.base_url ?? '').trim(),
        systemPrompt: (data.system_prompt ?? '').trim(),
        isActive: Boolean(data.is_active),
        autoReplyEnabled: Boolean(data.auto_reply_enabled),
        maxPerConversation: data.auto_reply_max_per_conversation ?? 3,
        handoffAgentId: data.handoff_agent_id ?? '',
        apiKey: data.has_key ? 'STORED' : '',
        embeddingsKey: data.has_embeddings_key ? 'STORED' : '',
        businessProfile: loadedBusinessProfile,
        conversationFlow: loadedConversationFlow,
        messageTemplates: loadedMessageTemplates,
      });
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [provider, model, t]);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchConfig();
    void fetchAccountMembers().then(setMembers);
  }, [accountId, fetchConfig]);

  const handleProviderChange = (next: AiProvider) => {
    setProvider(next);
    const isDefaultModel =
      model === AI_PROVIDER_DEFAULT_MODEL.openai ||
      model === AI_PROVIDER_DEFAULT_MODEL.anthropic ||
      model === AI_PROVIDER_DEFAULT_MODEL.openai_compatible ||
      model.trim() === '';
    if (isDefaultModel)
      setModel(
        next === 'openai_compatible' ? '' : AI_PROVIDER_DEFAULT_MODEL[next],
      );
  };

  const keyPayload = () => (keyEdited ? apiKey.trim() : undefined);
  const embeddingsKeyPayload = () =>
    embeddingsKeyEdited ? embeddingsKey.trim() || null : undefined;

  const buildBody = () => ({
    provider,
    model: model.trim(),
    base_url: provider === 'openai_compatible' ? baseUrl.trim() : null,
    api_key: keyPayload(),
    embeddings_api_key: embeddingsKeyPayload(),
    system_prompt: systemPrompt.trim() || null,
    is_active: isActive,
    auto_reply_enabled: autoReplyEnabled,
    auto_reply_max_per_conversation: maxPerConversation,
    handoff_agent_id: handoffAgentId || null,
    business_profile: businessProfile,
    conversation_flow: conversationFlow,
    message_templates: messageTemplates,
  });

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: model.trim(),
          base_url: provider === 'openai_compatible' ? baseUrl.trim() : null,
          api_key: keyPayload(),
        }),
      });
      const data = await res.json();
      if (res.ok) toast.success(t('testSuccess'));
      else toast.error(data.error ?? t('testRejected'));
    } catch {
      toast.error(t('testNetworkError'));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    const isEnablingAi = isActive || autoReplyEnabled;
    if (isEnablingAi && !model.trim()) {
      toast.error(t('missingModel'));
      setActiveSubTab('credentials');
      return;
    }
    if (isEnablingAi && provider === 'openai_compatible' && !baseUrl.trim()) {
      toast.error(t('missingBaseUrl'));
      setActiveSubTab('credentials');
      return;
    }
    if (isEnablingAi && !configured && !keyEdited) {
      toast.error(t('missingApiKey'));
      setActiveSubTab('credentials');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody()),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(t('saveSuccess'));
        await fetchConfig();
      } else {
        toast.error(data.error ?? t('saveFailed'));
      }
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      const res = await fetch('/api/ai/config', { method: 'DELETE' });
      if (res.ok) {
        toast.success(t('removeSuccess'));
        setConfigured(false);
        setBaseUrl('');
        setHasStoredKey(false);
        setApiKey('');
        setKeyEdited(false);
        setIsActive(false);
        setAutoReplyEnabled(false);
        setSystemPrompt('');
        setHandoffAgentId('');
      } else {
        const data = await res.json();
        toast.error(data.error ?? t('removeFailed'));
      }
    } catch {
      toast.error(t('removeFailed'));
    } finally {
      setRemoving(false);
    }
  };

  if (loading || profileLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading AI configuration...
      </div>
    );
  }

  const disabled = !canEdit || saving;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <SettingsPanelHead
          title={t('title')}
          description="Configure your multi-tenant business profile, conversational flows, verified pricing, and message templates."
        />
        <div className="flex items-center gap-3">
          {isDirty ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 px-2.5 py-1 rounded-full">
              <AlertCircle className="h-3 w-3" /> Unsaved changes
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 px-2.5 py-1 rounded-full">
              <CheckCircle2 className="h-3 w-3" /> All changes saved
            </span>
          )}
          <Button
            onClick={handleSave}
            disabled={disabled}
            className="shadow-xs"
          >
            {saving ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-4 w-4" />
            )}
            Save Configuration
          </Button>
        </div>
      </div>

      {/* Conversation Owner Status Banner */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Active Conversation Owner:
            </span>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold',
                (conversationFlow.conversationMode ?? 'ai_agent') === 'ai_agent'
                  ? 'bg-primary/10 text-primary border border-primary/20'
                  : 'bg-muted text-foreground border border-border',
              )}
            >
              <Sparkles className="h-3 w-3" />
              {(conversationFlow.conversationMode ?? 'ai_agent') === 'ai_agent'
                ? 'AI Agent First (Recommended)'
                : conversationFlow.conversationMode === 'flow_first'
                  ? 'Visual Flow First'
                  : 'Automation First'}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveSubTab('flow')}
            className="text-xs text-muted-foreground hover:text-foreground h-7"
          >
            Change Mode in Flows & Stages &rarr;
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
          {(conversationFlow.conversationMode ?? 'ai_agent') === 'ai_agent'
            ? 'The AI Agent owns customer-facing conversational replies, answering queries and qualifying leads naturally. Background automations execute without conflicting text.'
            : conversationFlow.conversationMode === 'flow_first'
              ? 'Active visual flow owns structured dialogue with branching interactive buttons. AI responds only upon explicit handoff.'
              : 'Matching conversational automations own initial replies; AI acts as fallback when no automation responds.'}
        </p>
      </div>

      {!canEdit && (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {t('adminOnlyConfig')}
        </p>
      )}

      {/* Sub-tabs Navigation */}
      <Tabs
        value={activeSubTab}
        onValueChange={(v) => setActiveSubTab(v as ConfigSubTab)}
        className="space-y-6"
      >
        <TabsList className="grid grid-cols-2 md:grid-cols-6 h-auto p-1 bg-muted/60">
          <TabsTrigger value="profile" className="py-2 text-xs">
            <Briefcase className="mr-1.5 h-3.5 w-3.5" /> Business Profile
          </TabsTrigger>
          <TabsTrigger value="flow" className="py-2 text-xs">
            <GitBranch className="mr-1.5 h-3.5 w-3.5" /> Flows & Stages
          </TabsTrigger>
          <TabsTrigger value="templates" className="py-2 text-xs">
            <FileText className="mr-1.5 h-3.5 w-3.5" /> Message Templates
          </TabsTrigger>
          <TabsTrigger value="pricing" className="py-2 text-xs">
            <DollarSign className="mr-1.5 h-3.5 w-3.5" /> Pricing & Booking
          </TabsTrigger>
          <TabsTrigger value="personality" className="py-2 text-xs">
            <Smile className="mr-1.5 h-3.5 w-3.5" /> Tone & Language
          </TabsTrigger>
          <TabsTrigger value="credentials" className="py-2 text-xs">
            <KeyRound className="mr-1.5 h-3.5 w-3.5" /> Model & Rules
          </TabsTrigger>
        </TabsList>

        {/* 1. Business Profile & Knowledge */}
        <TabsContent value="profile" className="space-y-6">
          <AiBusinessProfileEditor
            profile={businessProfile}
            onChange={setBusinessProfile}
            disabled={disabled}
          />
          <AiKnowledgeCard
            accountId={accountId}
            canEdit={canEdit}
            hasEmbeddingsKey={
              embeddingsKeyEdited
                ? embeddingsKey.trim().length > 0
                : hasStoredEmbeddingsKey
            }
          />
        </TabsContent>

        {/* 2. Conversation Flow */}
        <TabsContent value="flow" className="space-y-6">
          <AiFlowSettings
            flowConfig={conversationFlow}
            onChange={setConversationFlow}
            disabled={disabled}
          />
        </TabsContent>

        {/* 3. Message Templates */}
        <TabsContent value="templates" className="space-y-6">
          <AiTemplatesEditor
            templates={messageTemplates}
            onChange={setMessageTemplates}
            businessName={businessProfile.businessName}
            disabled={disabled}
          />
        </TabsContent>

        {/* 4. Pricing & Meeting Setup */}
        <TabsContent value="pricing" className="space-y-6">
          <AiPricingSettings
            profile={businessProfile}
            onChange={setBusinessProfile}
            disabled={disabled}
          />
        </TabsContent>

        {/* 5. Personality & Language */}
        <TabsContent value="personality" className="space-y-6">
          <AiPersonalitySettings
            profile={businessProfile}
            onChange={setBusinessProfile}
            disabled={disabled}
          />
        </TabsContent>

        {/* 6. AI Model Credentials & Handoff Rules */}
        <TabsContent value="credentials" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-primary" /> AI Model & BYO Provider Key
              </CardTitle>
              <CardDescription>{t('encryptionNotice')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('provider')}</Label>
                  <Select
                    value={provider}
                    onValueChange={(v) => handleProviderChange(v as AiProvider)}
                    disabled={disabled}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai">{PROVIDER_LABEL.openai}</SelectItem>
                      <SelectItem value="anthropic">
                        {PROVIDER_LABEL.anthropic}
                      </SelectItem>
                      <SelectItem value="openai_compatible">
                        {t('providerOpenAiCompatible')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ai-model">{t('model')}</Label>
                  <Input
                    id="ai-model"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={AI_PROVIDER_DEFAULT_MODEL[provider]}
                    disabled={disabled}
                  />
                </div>

                {provider === 'openai_compatible' && (
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="ai-base-url">{t('baseUrl')}</Label>
                    <Input
                      id="ai-base-url"
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      placeholder="https://api.example.com/v1"
                      disabled={disabled}
                      autoComplete="off"
                    />
                    <p className="text-xs text-muted-foreground">
                      {t('baseUrlHint')}
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-key">{t('apiKey')}</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id="ai-key"
                      type={showKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={(e) => {
                        setApiKey(e.target.value);
                        setKeyEdited(true);
                      }}
                      onFocus={() => {
                        if (!keyEdited && hasStoredKey) {
                          setApiKey('');
                          setKeyEdited(true);
                        }
                      }}
                      placeholder={KEY_PLACEHOLDER[provider]}
                      disabled={disabled}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((s) => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showKey ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <Button
                    variant="outline"
                    onClick={handleTest}
                    disabled={disabled || testing}
                  >
                    {testing ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    )}
                    {t('testKey')}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-embeddings-key">
                  {t('embeddingsKey')}{' '}
                  <span className="font-normal text-muted-foreground">
                    {t('optionalSemanticSearch')}
                  </span>
                </Label>
                <Input
                  id="ai-embeddings-key"
                  type="password"
                  value={embeddingsKey}
                  onChange={(e) => {
                    setEmbeddingsKey(e.target.value);
                    setEmbeddingsKeyEdited(true);
                  }}
                  onFocus={() => {
                    if (!embeddingsKeyEdited && hasStoredEmbeddingsKey) {
                      setEmbeddingsKey('');
                      setEmbeddingsKeyEdited(true);
                    }
                  }}
                  placeholder="sk-... (OpenAI)"
                  disabled={disabled}
                  autoComplete="off"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('behaviour')}</CardTitle>
              <CardDescription>{t('behaviourDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ai-prompt">{t('businessContext')}</Label>
                <Textarea
                  id="ai-prompt"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder={t('promptPlaceholder')}
                  rows={4}
                  disabled={disabled}
                />
              </div>

              <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t('enableAssistant')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('enableAssistantDesc')}
                  </p>
                </div>
                <Switch
                  checked={isActive}
                  onCheckedChange={setIsActive}
                  disabled={disabled}
                />
              </div>

              <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t('autoReply')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('autoReplyDesc')}
                  </p>
                </div>
                <Switch
                  checked={autoReplyEnabled}
                  onCheckedChange={setAutoReplyEnabled}
                  disabled={disabled || !isActive}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="ai-max">{t('maxAutoReplies')}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t('maxAutoRepliesDesc')}
                  </p>
                </div>
                <Input
                  id="ai-max"
                  type="number"
                  min={1}
                  max={20}
                  value={maxPerConversation}
                  onChange={(e) =>
                    setMaxPerConversation(
                      Math.min(20, Math.max(1, Number(e.target.value) || 1)),
                    )
                  }
                  disabled={disabled || !autoReplyEnabled}
                  className="w-20"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-handoff">{t('handoffTo')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('handoffToDesc')}
                </p>
                <Select
                  value={handoffAgentId || HANDOFF_QUEUE}
                  onValueChange={(v) =>
                    setHandoffAgentId(!v || v === HANDOFF_QUEUE ? '' : v)
                  }
                  disabled={disabled || !autoReplyEnabled}
                >
                  <SelectTrigger id="ai-handoff">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={HANDOFF_QUEUE}>
                      {t('handoffQueue')}
                    </SelectItem>
                    {members.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        {memberLabel(m)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Bottom Action Bar */}
      <div className="flex items-center justify-between pt-4 border-t border-border">
        {configured ? (
          <Button
            variant="ghost"
            onClick={handleRemove}
            disabled={!canEdit || removing}
            className="text-destructive hover:text-destructive"
          >
            {removing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            {t('remove')}
          </Button>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-3">
          {isDirty ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 px-2.5 py-1 rounded-full">
              <AlertCircle className="h-3 w-3" /> Unsaved changes
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 px-2.5 py-1 rounded-full">
              <CheckCircle2 className="h-3 w-3" /> All changes saved
            </span>
          )}
          <Button onClick={handleSave} disabled={disabled}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Configuration
          </Button>
        </div>
      </div>
    </div>
  );
}
