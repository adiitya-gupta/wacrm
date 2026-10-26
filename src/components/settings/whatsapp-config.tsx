'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Eye,
  EyeOff,
  Copy,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  Zap,
  AlertTriangle,
  RotateCcw,
  Smartphone,
  KeyRound,
  Pencil,
  Check,
  Send,
  RefreshCw,
  Trash2,
  HelpCircle,
  ShieldCheck,
  Radio,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { SettingsPanelHead } from './settings-panel-head';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { WhatsAppConfig as WhatsAppConfigType } from '@/types';

const MASKED_TOKEN = '••••••••••••••••';

type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';
type ResetReason = 'token_corrupted' | 'meta_api_error' | null;

const META_ID_RE = /^\d+$/;

type MetaErrorMeta = {
  code: number | null;
  subcode: number | null;
  fbtrace_id: string | null;
  step: string;
  field?: string | null;
  message?: string | null;
};
type MetaFailure = { message: string; meta: MetaErrorMeta | null };
type WabaSubscription = {
  checked: boolean;
  subscribed: boolean | null;
  app_id_match: boolean | null;
  error?: string;
};

type PhoneInfo = {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  status?: string;
};

type RegistrationProbe = {
  live: boolean;
  checks: Record<string, boolean | null>;
  errors?: string[];
  last_registration_error?: string | null;
  registered_at?: string | null;
  subscribed_apps_at?: string | null;
};

export function WhatsAppConfig() {
  const t = useTranslations('Settings.whatsapp');
  const supabase = createClient();
  const {
    user,
    accountId,
    loading: authLoading,
    profileLoading,
    canEditSettings,
  } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [phoneInfo, setPhoneInfo] = useState<PhoneInfo | null>(null);
  const [isEditingCredentials, setIsEditingCredentials] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [config, setConfig] = useState<WhatsAppConfigType | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('unknown');
  const [resetReason, setResetReason] = useState<ResetReason>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [statusMeta, setStatusMeta] = useState<MetaErrorMeta | null>(null);
  const [saveFailure, setSaveFailure] = useState<MetaFailure | null>(null);
  const [wabaSubscription, setWabaSubscription] = useState<WabaSubscription | null>(null);
  const loadedAccountIdRef = useRef<string | null>(null);

  // Form Fields
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [pin, setPin] = useState('');
  const [tokenEdited, setTokenEdited] = useState(false);

  // Pre-flight Validation
  const [validating, setValidating] = useState(false);
  const [validationSuccess, setValidationSuccess] = useState<{
    phone_info?: PhoneInfo;
    waba_id?: string | null;
    phone_number_id?: string | null;
  } | null>(null);

  // Inbound-media mirror
  const [mirrorMedia, setMirrorMedia] = useState(true);
  const [savingMirror, setSavingMirror] = useState(false);

  // Registration probe
  const [verifyingRegistration, setVerifyingRegistration] = useState(false);
  const [registrationProbe, setRegistrationProbe] = useState<RegistrationProbe | null>(null);

  // Test Message Feature
  const [showTestMessageCard, setShowTestMessageCard] = useState(false);
  const [testRecipient, setTestRecipient] = useState('');
  const [testCustomMessage, setTestCustomMessage] = useState('');
  const [sendingTestMessage, setSendingTestMessage] = useState(false);
  const [testMessageResponse, setTestMessageResponse] = useState<{
    success: boolean;
    messageId?: string;
    error?: string;
    meta?: MetaErrorMeta | null;
  } | null>(null);

  // Disconnect Confirmation Dialog
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);

  const isRegistered = Boolean(config?.registered_at) && !config?.last_registration_error;
  const lastRegistrationError = config?.last_registration_error ?? null;

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/whatsapp/webhook`
      : '';

  const fetchConfig = useCallback(async (acctId: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('whatsapp_config')
        .select('*')
        .eq('account_id', acctId)
        .maybeSingle();

      if (error) {
        console.error('Failed to load config row:', error);
      }

      if (data) {
        setConfig(data);
        setPhoneNumberId(data.phone_number_id || '');
        setWabaId(data.waba_id || '');
        setAccessToken(MASKED_TOKEN);
        setPin('');
        setTokenEdited(false);
        setMirrorMedia(data.mirror_inbound_media !== false);
      } else {
        setConfig(null);
        setPhoneNumberId('');
        setWabaId('');
        setAccessToken('');
        setPin('');
        setTokenEdited(false);
        setMirrorMedia(true);
      }
      setRegistrationProbe(null);
      setValidationSuccess(null);

      if (data) {
        try {
          const res = await fetch('/api/whatsapp/config', { method: 'GET' });
          const payload = await res.json();

          if (payload.connected) {
            setConnectionStatus('connected');
            setResetReason(null);
            setStatusMessage('');
            setStatusMeta(null);
            setWabaSubscription(payload.waba_subscription ?? null);
            if (payload.phone_info) {
              setPhoneInfo(payload.phone_info);
            }
          } else {
            setConnectionStatus('disconnected');
            setResetReason(payload.needs_reset ? 'token_corrupted' : payload.reason === 'meta_api_error' ? 'meta_api_error' : null);
            setStatusMessage(payload.message || '');
            setStatusMeta(payload.meta ?? null);
            setWabaSubscription(null);
            setPhoneInfo(null);
          }
        } catch (err) {
          console.error('Health check failed:', err);
          setConnectionStatus('disconnected');
          setPhoneInfo(null);
        }
      } else {
        setConnectionStatus('disconnected');
        setResetReason(null);
        setStatusMessage('');
        setStatusMeta(null);
        setWabaSubscription(null);
        setPhoneInfo(null);
        setIsEditingCredentials(false);
      }
    } catch (err) {
      console.error('fetchConfig error:', err);
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [supabase, t]);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!user || !accountId) {
      loadedAccountIdRef.current = null;
      setLoading(false);
      return;
    }
    if (loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    fetchConfig(accountId);
  }, [authLoading, profileLoading, user?.id, accountId, fetchConfig]);

  async function handleToggleMirrorMedia(next: boolean) {
    if (!config || !accountId || savingMirror) return;
    const previous = mirrorMedia;
    setMirrorMedia(next);
    setSavingMirror(true);
    try {
      const { error } = await supabase
        .from('whatsapp_config')
        .update({ mirror_inbound_media: next })
        .eq('account_id', accountId);
      if (error) throw new Error(error.message);
      setConfig({ ...config, mirror_inbound_media: next });
    } catch (error) {
      console.error('Failed to update media retention setting:', error);
      setMirrorMedia(previous);
      toast.error(t('mirrorInboundSaveFailed'));
    } finally {
      setSavingMirror(false);
    }
  }

  // Pre-flight credential validation
  async function handleValidateCredentials() {
    const cleanPhone = phoneNumberId.trim();
    const cleanWaba = wabaId.trim();
    const cleanToken = accessToken.trim();

    if (!cleanPhone && !cleanWaba) {
      toast.error('Please enter a Phone Number ID or WABA ID to validate.');
      return;
    }
    if (cleanPhone && !META_ID_RE.test(cleanPhone)) {
      toast.error(t('phoneNumberIdNotNumeric'));
      return;
    }
    if (cleanWaba && !META_ID_RE.test(cleanWaba)) {
      toast.error(t('wabaIdNotNumeric'));
      return;
    }
    if (!config && (!cleanToken || cleanToken === MASKED_TOKEN)) {
      toast.error(t('accessTokenRequired'));
      return;
    }

    try {
      setValidating(true);
      setValidationSuccess(null);
      setSaveFailure(null);

      const payload: Record<string, unknown> = {
        phone_number_id: cleanPhone || null,
        waba_id: cleanWaba || null,
        validate_only: true,
      };

      if (tokenEdited && cleanToken && cleanToken !== MASKED_TOKEN) {
        payload.access_token = cleanToken;
      } else if (!config) {
        payload.access_token = cleanToken;
      }

      const res = await fetch('/api/whatsapp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setSaveFailure({
          message: data.error || 'Credential validation failed',
          meta: data.meta ?? null,
        });
        toast.error(data.error || 'Validation failed', { duration: 8000 });
        return;
      }

      setValidationSuccess({
        phone_info: data.phone_info,
        waba_id: data.waba_id,
        phone_number_id: data.phone_number_id,
      });

      const verifiedDisplayName = data.phone_info?.verified_name || data.phone_info?.display_phone_number || 'Business Account';
      toast.success(`Validated successfully! Connected to: ${verifiedDisplayName}`);
    } catch (err) {
      console.error('Validation error:', err);
      toast.error('Failed to communicate with Meta API');
    } finally {
      setValidating(false);
    }
  }

  async function handleSave() {
    const cleanPhone = phoneNumberId.trim();
    const cleanWaba = wabaId.trim();
    const cleanToken = accessToken.trim();

    if (!cleanPhone && !cleanWaba) {
      toast.error(
        t('phoneNumberOrWabaRequired', {
          defaultMessage:
            'Please provide either a Phone Number ID or a WhatsApp Business Account ID (WABA ID).',
        })
      );
      return;
    }
    if (cleanPhone && !META_ID_RE.test(cleanPhone)) {
      toast.error(t('phoneNumberIdNotNumeric'));
      return;
    }
    if (cleanWaba && !META_ID_RE.test(cleanWaba)) {
      toast.error(t('wabaIdNotNumeric'));
      return;
    }
    if (!config && (!cleanToken || cleanToken === MASKED_TOKEN)) {
      toast.error(t('accessTokenRequired'));
      return;
    }

    try {
      setSaving(true);

      const payload: Record<string, unknown> = {
        phone_number_id: cleanPhone || null,
        waba_id: cleanWaba || null,
        pin: pin.trim() || null,
      };

      if (tokenEdited && cleanToken && cleanToken !== MASKED_TOKEN) {
        payload.access_token = cleanToken;
      } else if (!config) {
        payload.access_token = cleanToken;
      }

      const res = await fetch('/api/whatsapp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setSaveFailure({
          message: data.error || t('saveFailed'),
          meta: data.meta ?? null,
        });
        toast.error(data.error || t('saveFailed'), { duration: 10000 });
        setSaving(false);
        return;
      }
      setSaveFailure(null);

      if (data.phone_info) {
        setPhoneInfo(data.phone_info);
      }
      setIsEditingCredentials(false);
      setValidationSuccess(null);

      if (data.registered === false && data.registration_error) {
        setSaveFailure({
          message: t('savedButRegistrationFailed', { error: data.registration_error }),
          meta: data.meta ?? null,
        });
        toast.error(
          t('savedButRegistrationFailed', { error: data.registration_error }),
          { duration: 12000 },
        );
      } else if (data.registration_skipped) {
        toast.success(
          data.notice || t('savedRegistrationSkipped'),
          { duration: 10000 },
        );
        setPin('');
      } else {
        toast.success(
          data.phone_info?.verified_name
            ? t('liveWithName', { name: data.phone_info.verified_name })
            : t('connectedGeneric'),
        );
        setPin('');
      }

      if (accountId) await fetchConfig(accountId);
    } catch (err) {
      console.error('Save error:', err);
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    try {
      setTesting(true);
      const res = await fetch('/api/whatsapp/config', { method: 'GET' });
      const payload = await res.json();

      if (payload.connected) {
        setConnectionStatus('connected');
        setResetReason(null);
        setStatusMessage('');
        setStatusMeta(null);
        setWabaSubscription(payload.waba_subscription ?? null);
        if (payload.phone_info) {
          setPhoneInfo(payload.phone_info);
        }
        toast.success(
          payload.phone_info?.verified_name
            ? t('connectedTo', { name: payload.phone_info.verified_name })
            : t('apiConnectionOk')
        );
      } else {
        setConnectionStatus('disconnected');
        setResetReason(payload.needs_reset ? 'token_corrupted' : payload.reason === 'meta_api_error' ? 'meta_api_error' : null);
        setStatusMessage(payload.message || '');
        setStatusMeta(payload.meta ?? null);
        setWabaSubscription(null);
        toast.error(payload.message || t('apiConnectionFailed'), { duration: 10000 });
      }
    } catch (err) {
      console.error('Test connection error:', err);
      setConnectionStatus('disconnected');
      toast.error(t('connectionTestFailed'));
    } finally {
      setTesting(false);
    }
  }

  async function handleSendTestMessage() {
    const cleanPhone = testRecipient.trim();
    if (!cleanPhone) {
      toast.error('Please enter a recipient phone number with country code (e.g. +1234567890).');
      return;
    }

    try {
      setSendingTestMessage(true);
      setTestMessageResponse(null);

      const res = await fetch('/api/whatsapp/config/test-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: cleanPhone,
          message: testCustomMessage.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setTestMessageResponse({
          success: false,
          error: data.error || 'Failed to send test message',
          meta: data.meta ?? null,
        });
        toast.error(data.error || 'Test message failed', { duration: 8000 });
        return;
      }

      setTestMessageResponse({
        success: true,
        messageId: data.message_id,
      });
      toast.success('Test message sent successfully!');
    } catch (err) {
      console.error('Test message send error:', err);
      toast.error('Failed to communicate with test message endpoint');
    } finally {
      setSendingTestMessage(false);
    }
  }

  async function handleVerifyRegistration() {
    setVerifyingRegistration(true);
    setRegistrationProbe(null);
    try {
      const res = await fetch('/api/whatsapp/config/verify-registration', {
        method: 'GET',
      });
      const data = (await res.json()) as RegistrationProbe;
      setRegistrationProbe(data);
      if (data.live) {
        toast.success(t('fullyWired'));
      } else {
        toast.error(t('notFullyRegistered'), { duration: 8000 });
      }
      if (accountId) await fetchConfig(accountId);
    } catch (err) {
      console.error('verify-registration failed:', err);
      toast.error(t('verifyEndpointUnreachable'));
    } finally {
      setVerifyingRegistration(false);
    }
  }

  async function handleDisconnectConfirm() {
    try {
      setResetting(true);
      const res = await fetch('/api/whatsapp/config', { method: 'DELETE' });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || t('resetFailed'));
        return;
      }

      toast.success('WhatsApp integration disconnected successfully.');
      setConfig(null);
      setPhoneNumberId('');
      setWabaId('');
      setAccessToken('');
      setTokenEdited(false);
      setConnectionStatus('disconnected');
      setResetReason(null);
      setStatusMessage('');
      setStatusMeta(null);
      setSaveFailure(null);
      setWabaSubscription(null);
      setPhoneInfo(null);
      setIsEditingCredentials(false);
      setValidationSuccess(null);
      setShowTestMessageCard(false);
      setDisconnectDialogOpen(false);
    } catch (err) {
      console.error('Disconnect error:', err);
      toast.error(t('resetFailed'));
    } finally {
      setResetting(false);
    }
  }

  function handleCopyWebhookUrl() {
    navigator.clipboard.writeText(webhookUrl);
    toast.success(t('webhookCopied'));
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead
          title={t("title")}
          description={t("description")}
        />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  const showResetBanner = resetReason === 'token_corrupted';

  const renderMetaDetails = (meta: MetaErrorMeta) => (
    <div className="mt-2 space-y-0.5 text-[11px] leading-relaxed text-muted-foreground break-all">
      <p>
        {t('metaErrorStep')}: <code>{meta.step}</code>
        {meta.code !== null && meta.code !== undefined && (
          <>
            {' · '}
            {t('metaErrorCode')}:{' '}
            <code>
              {meta.code}
              {meta.subcode !== null && meta.subcode !== undefined ? `/${meta.subcode}` : ''}
            </code>
          </>
        )}
        {meta.fbtrace_id && (
          <>
            {' · '}
            {t('metaErrorTrace')}: <code>{meta.fbtrace_id}</code>
          </>
        )}
      </p>
      {meta.message && (
        <p>
          {t('metaErrorMessage')}: {meta.message}
        </p>
      )}
      <p>{t('metaErrorDetailsHint')}</p>
    </div>
  );

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title={t("title")}
        description={t("description")}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* Main Section */}
        <div className="space-y-6">
          {/* Corrupted-token reset banner */}
          {showResetBanner && (
            <Alert className="bg-amber-950/40 border-amber-600/40">
              <div className="flex items-start gap-3">
                <AlertTriangle className="size-5 text-amber-400 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <AlertTitle className="text-amber-200 mb-1">
                    {t('tokenCorrupted')}
                  </AlertTitle>
                  <AlertDescription className="text-amber-100/80 text-sm">
                    {statusMessage}
                  </AlertDescription>
                  <Button
                    onClick={() => setDisconnectDialogOpen(true)}
                    disabled={resetting}
                    size="sm"
                    className="mt-3 bg-amber-600 hover:bg-amber-700 text-white"
                  >
                    <RotateCcw className="size-4 mr-1.5" />
                    Reset Credentials
                  </Button>
                </div>
              </div>
            </Alert>
          )}

          {/* Last save or validation failed */}
          {saveFailure && (
            <Alert className="bg-destructive/10 border-destructive/30">
              <div className="flex items-start gap-3">
                <XCircle className="size-5 text-destructive mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <AlertTitle className="text-destructive font-semibold mb-1">
                    {t('lastSaveFailed')}
                  </AlertTitle>
                  <AlertDescription className="text-destructive/90 text-sm">
                    {saveFailure.message}
                  </AlertDescription>
                  {saveFailure.meta && renderMetaDetails(saveFailure.meta)}
                </div>
              </div>
            </Alert>
          )}

          {/* Connected WhatsApp Business Account Card (Hero View) */}
          {config && connectionStatus === 'connected' && !isEditingCredentials && (
            <Card className="border-emerald-500/40 bg-card shadow-sm overflow-hidden">
              <div className="h-1.5 bg-gradient-to-r from-emerald-500 via-teal-500 to-primary" />
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                      <Smartphone className="size-6" />
                    </div>
                    <div>
                      <CardTitle className="text-foreground text-base flex items-center gap-2 flex-wrap">
                        {phoneInfo?.verified_name || t('connectedGeneric', { defaultMessage: 'WhatsApp Business Number' })}
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 gap-1.5 font-medium py-0.5">
                          <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          Connected
                        </Badge>
                        {isRegistered ? (
                          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 font-medium py-0.5">
                            Cloud API Live
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20 font-medium py-0.5">
                            Registration Pending PIN
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="text-muted-foreground text-xs mt-0.5">
                        {phoneInfo?.display_phone_number
                          ? `Active on ${phoneInfo.display_phone_number} · Cloud API messaging enabled`
                          : 'Cloud API messaging and automation active'}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleTestConnection}
                      disabled={testing}
                      className="border-border text-foreground hover:bg-muted text-xs h-8"
                    >
                      {testing ? (
                        <Loader2 className="size-3.5 animate-spin mr-1.5" />
                      ) : (
                        <Zap className="size-3.5 mr-1.5 text-amber-500" />
                      )}
                      Test Connection
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowTestMessageCard(!showTestMessageCard)}
                      className="border-border text-foreground hover:bg-muted text-xs h-8"
                    >
                      <Send className="size-3.5 mr-1.5 text-primary" />
                      Test Message
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setIsEditingCredentials(true);
                        setTokenEdited(false);
                        setAccessToken(MASKED_TOKEN);
                      }}
                      className="border-border text-foreground hover:bg-muted text-xs h-8"
                    >
                      <Pencil className="size-3.5 mr-1.5 text-muted-foreground" />
                      Update
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDisconnectDialogOpen(true)}
                      className="border-destructive/30 text-destructive hover:bg-destructive/10 text-xs h-8"
                    >
                      <Trash2 className="size-3.5 mr-1.5" />
                      Disconnect
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4 pt-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-2 border-t border-border/60 text-xs">
                  <div className="rounded-lg border border-border/70 bg-muted/40 p-2.5">
                    <span className="text-muted-foreground block text-[11px] font-medium">{t('phoneNumberId')}</span>
                    <div className="flex items-center justify-between mt-1">
                      <span className="font-mono text-foreground font-semibold">{config.phone_number_id}</span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(config.phone_number_id);
                          toast.success('Phone Number ID copied');
                        }}
                        className="text-muted-foreground hover:text-foreground p-0.5"
                        title="Copy Phone Number ID"
                      >
                        <Copy className="size-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/70 bg-muted/40 p-2.5">
                    <span className="text-muted-foreground block text-[11px] font-medium">{t('wabaId')}</span>
                    <div className="flex items-center justify-between mt-1">
                      <span className="font-mono text-foreground font-semibold">{config.waba_id || 'Auto-discovered'}</span>
                      {config.waba_id && (
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(config.waba_id!);
                            toast.success('WABA ID copied');
                          }}
                          className="text-muted-foreground hover:text-foreground p-0.5"
                          title="Copy WABA ID"
                        >
                          <Copy className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/70 bg-muted/40 p-2.5">
                    <span className="text-muted-foreground block text-[11px] font-medium">Webhook Delivery</span>
                    <div className="flex items-center gap-1.5 mt-1 font-medium">
                      {wabaSubscription?.subscribed === true ? (
                        <>
                          <CheckCircle2 className="size-3.5 text-emerald-600" />
                          <span className="text-emerald-700 dark:text-emerald-400">Subscribed & Delivering</span>
                        </>
                      ) : wabaSubscription?.subscribed === false ? (
                        <>
                          <AlertTriangle className="size-3.5 text-amber-500" />
                          <span className="text-amber-600">Pending WABA Subscription</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="size-3.5 text-emerald-600" />
                          <span className="text-muted-foreground">Active</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4 flex-wrap text-xs text-muted-foreground pt-1">
                  <div className="flex items-center gap-3">
                    {phoneInfo?.quality_rating && (
                      <div className="flex items-center gap-1.5">
                        <span>Quality Rating:</span>
                        <Badge variant="secondary" className="text-[11px] font-medium uppercase py-0">
                          {phoneInfo.quality_rating}
                        </Badge>
                      </div>
                    )}
                    {config.connected_at && (
                      <span>Connected since {new Date(config.connected_at).toLocaleDateString()}</span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleVerifyRegistration}
                    disabled={verifyingRegistration}
                    className="text-xs h-7 text-muted-foreground hover:text-foreground gap-1.5"
                  >
                    {verifyingRegistration ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3" />
                    )}
                    Refresh Registration Status
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Registration Warning Banner when not registered */}
          {config && !isRegistered && (
            <Alert className="bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-200">
              <div className="flex items-start gap-3">
                <AlertTriangle className="size-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <div className="flex-1 space-y-2">
                  <AlertTitle className="font-semibold text-sm">
                    Phone Number Not Yet Registered for Cloud API
                  </AlertTitle>
                  <AlertDescription className="text-xs leading-relaxed opacity-90">
                    {lastRegistrationError ? (
                      <span>Registration attempt returned: &quot;{lastRegistrationError}&quot;.</span>
                    ) : (
                      <span>
                        Your credentials are saved, but inbound Cloud API event delivery is not yet active.
                        If this number is active on the WhatsApp Business mobile app, direct Cloud API registration requires a 6-digit PIN and will disconnect your mobile app.
                        If this is a dedicated number, click Update Credentials and enter the 6-digit PIN set in WhatsApp Manager → Phone Numbers → Two-Step Verification.
                      </span>
                    )}
                  </AlertDescription>
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleVerifyRegistration}
                      disabled={verifyingRegistration}
                      className="border-amber-500/40 text-amber-800 dark:text-amber-300 hover:bg-amber-500/20 text-xs h-7"
                    >
                      {verifyingRegistration ? <Loader2 className="size-3 animate-spin mr-1.5" /> : <RefreshCw className="size-3 mr-1.5" />}
                      Re-check with Meta
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setIsEditingCredentials(true);
                        setTokenEdited(false);
                        setAccessToken(MASKED_TOKEN);
                      }}
                      className="border-amber-500/40 text-amber-800 dark:text-amber-300 hover:bg-amber-500/20 text-xs h-7"
                    >
                      <Pencil className="size-3 mr-1.5" />
                      Enter 2-Step PIN
                    </Button>
                  </div>
                </div>
              </div>
            </Alert>
          )}

          {/* Safe Test Message Card */}
          {config && connectionStatus === 'connected' && showTestMessageCard && (
            <Card className="border-primary/30 bg-card shadow-sm animate-in fade-in-50 duration-200">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Send className="size-4 text-primary" />
                    <CardTitle className="text-foreground text-sm">Send Safe Test Message</CardTitle>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowTestMessageCard(false)}
                    className="text-xs h-7 text-muted-foreground hover:text-foreground"
                  >
                    Close
                  </Button>
                </div>
                <CardDescription className="text-xs text-muted-foreground">
                  Verify outbound messaging through your Meta Cloud API connection safely by sending a message to your own WhatsApp number.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-foreground">
                    Destination Phone Number (with Country Code)
                  </Label>
                  <Input
                    placeholder="e.g. +15551234567 or +919876543210"
                    value={testRecipient}
                    onChange={(e) => setTestRecipient(e.target.value)}
                    className="bg-muted border-border font-mono text-xs"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Must be in full international format (e.g. +91 for India, +1 for US/Canada). Note: Free-form text messages can only be delivered to recipients within an active 24-hour customer service window.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-foreground">
                    Test Message Text (Optional)
                  </Label>
                  <Textarea
                    placeholder="Hello from Wattomation! This is a test message confirming your WhatsApp Cloud API connection is active."
                    value={testCustomMessage}
                    onChange={(e) => setTestCustomMessage(e.target.value)}
                    rows={2}
                    className="bg-muted border-border text-xs resize-none"
                  />
                </div>

                {testMessageResponse && (
                  <div
                    className={
                      'rounded-md p-2.5 text-xs border ' +
                      (testMessageResponse.success
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
                        : 'bg-destructive/10 border-destructive/30 text-destructive')
                    }
                  >
                    {testMessageResponse.success ? (
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                        <div>
                          <p className="font-medium">Test message dispatched successfully!</p>
                          <p className="font-mono text-[11px] opacity-80 mt-0.5">
                            Message ID: {testMessageResponse.messageId}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <p className="font-medium">{testMessageResponse.error}</p>
                        {testMessageResponse.meta && renderMetaDetails(testMessageResponse.meta)}
                      </div>
                    )}
                  </div>
                )}

                <div className="pt-1 flex items-center gap-2">
                  <Button
                    onClick={handleSendTestMessage}
                    disabled={sendingTestMessage || !testRecipient.trim()}
                    size="sm"
                    className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs"
                  >
                    {sendingTestMessage ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin mr-1.5" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send className="size-3.5 mr-1.5" />
                        Send Test Message
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Manual WhatsApp Cloud API Setup Wizard (When disconnected or editing) */}
          {(!config || isEditingCredentials || connectionStatus !== 'connected') && (
            <div className="space-y-6">
              {/* Wizard Steps Header Card */}
              <Card className="border-border bg-card shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
                        <KeyRound className="size-5" />
                      </div>
                      <div>
                        <CardTitle className="text-foreground text-base">
                          {isEditingCredentials
                            ? 'Update WhatsApp Cloud API Credentials'
                            : 'Manual WhatsApp Cloud API Configuration'}
                        </CardTitle>
                        <CardDescription className="text-muted-foreground text-xs mt-0.5">
                          {isEditingCredentials
                            ? 'Update your access token, WABA ID, or phone number ID. Your current token is preserved if unchanged.'
                            : 'Connect your own Meta WhatsApp Business Account using your developer credentials.'}
                        </CardDescription>
                      </div>
                    </div>
                    {isEditingCredentials && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setIsEditingCredentials(false);
                          setValidationSuccess(null);
                          if (config) {
                            setPhoneNumberId(config.phone_number_id || '');
                            setWabaId(config.waba_id || '');
                            setAccessToken(MASKED_TOKEN);
                            setTokenEdited(false);
                          }
                        }}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </CardHeader>

                <CardContent className="space-y-6 pt-2">
                  {/* Step A — Meta Developer App Guide */}
                  <div className="rounded-xl border border-border/80 bg-muted/30 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-primary text-primary-foreground text-xs font-semibold px-2 py-0.5">
                        Step A
                      </Badge>
                      <h4 className="font-semibold text-sm text-foreground">
                        Meta Developer App & Permissions
                      </h4>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      To connect your WhatsApp number manually, you will use your own Meta Developer App and WhatsApp Business Account:
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg border border-border/60 bg-card p-3 space-y-1.5">
                        <span className="font-medium text-foreground flex items-center gap-1.5">
                          <CheckCircle2 className="size-3.5 text-primary" /> 1. Meta Developer App
                        </span>
                        <p className="text-muted-foreground text-[11px] leading-relaxed">
                          Create a Business App on Meta for Developers and add the <strong>WhatsApp</strong> product.
                        </p>
                        <a
                          href="https://developers.facebook.com/apps"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline font-medium pt-1"
                        >
                          Meta for Developers <ExternalLink className="size-3" />
                        </a>
                      </div>

                      <div className="rounded-lg border border-border/60 bg-card p-3 space-y-1.5">
                        <span className="font-medium text-foreground flex items-center gap-1.5">
                          <ShieldCheck className="size-3.5 text-primary" /> 2. System User Token
                        </span>
                        <p className="text-muted-foreground text-[11px] leading-relaxed">
                          In Business Settings → System Users, generate a permanent token with:
                          <code className="block font-mono text-[10px] text-foreground mt-0.5">whatsapp_business_management</code>
                          <code className="block font-mono text-[10px] text-foreground">whatsapp_business_messaging</code>
                        </p>
                        <a
                          href="https://business.facebook.com/settings/system-users"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline font-medium pt-1"
                        >
                          Meta Business Settings <ExternalLink className="size-3" />
                        </a>
                      </div>
                    </div>
                  </div>

                  {/* Step B — WhatsApp Business Account Credentials Form */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-primary text-primary-foreground text-xs font-semibold px-2 py-0.5">
                        Step B
                      </Badge>
                      <h4 className="font-semibold text-sm text-foreground">
                        Enter API Credentials
                      </h4>
                    </div>

                    {/* Permanent Access Token */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-foreground font-medium text-xs flex items-center gap-1">
                          {t('accessToken')}
                          <span className="text-destructive">*</span>
                        </Label>
                        <span className="text-[11px] text-muted-foreground">Permanent System User Token</span>
                      </div>
                      <div className="relative">
                        <Input
                          type={showToken ? 'text' : 'password'}
                          placeholder={
                            config && !tokenEdited
                              ? '•••••••••••••••• (Leave unchanged to keep current token)'
                              : t('accessTokenPlaceholder')
                          }
                          value={accessToken}
                          onChange={(e) => {
                            setAccessToken(e.target.value);
                            setTokenEdited(true);
                          }}
                          onFocus={() => {
                            if (accessToken === MASKED_TOKEN) {
                              setAccessToken('');
                              setTokenEdited(true);
                            }
                          }}
                          className="bg-muted border-border text-foreground placeholder:text-muted-foreground pr-10 font-mono text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => setShowToken(!showToken)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Never enter your Meta App Secret here. Only paste a System User Permanent Access Token with WhatsApp permissions.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* WhatsApp Business Account ID (WABA ID) */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label className="text-foreground font-medium text-xs">
                            {t('wabaId')}
                          </Label>
                          <span className="text-[11px] text-muted-foreground">Numeric ID</span>
                        </div>
                        <Input
                          placeholder={t('wabaIdPlaceholder')}
                          value={wabaId}
                          onChange={(e) => setWabaId(e.target.value)}
                          className="bg-muted border-border text-foreground placeholder:text-muted-foreground font-mono text-xs"
                        />
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          Found in WhatsApp Manager under Account Settings, or in WhatsApp &gt; API Setup.
                        </p>
                      </div>

                      {/* Phone Number ID */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label className="text-foreground font-medium text-xs">
                            {t('phoneNumberId')}
                          </Label>
                          <span className="text-[11px] text-muted-foreground">Numeric ID</span>
                        </div>
                        <Input
                          placeholder={t('phoneNumberIdPlaceholder')}
                          value={phoneNumberId}
                          onChange={(e) => setPhoneNumberId(e.target.value)}
                          className="bg-muted border-border text-foreground placeholder:text-muted-foreground font-mono text-xs"
                        />
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          Found in Meta WhatsApp Manager under Phone Numbers or API Setup.
                        </p>
                      </div>
                    </div>

                    {/* Two-step PIN with Registration Safety Warning */}
                    <div className="space-y-2 pt-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-foreground font-medium text-xs flex items-center gap-1.5">
                          {t('twoStepPin')}
                          <span className="text-muted-foreground font-normal">{t('optional')}</span>
                        </Label>
                        <span className="text-[11px] text-muted-foreground">6-digit PIN</span>
                      </div>
                      <Input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder={t('pinPlaceholder')}
                        value={pin}
                        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        className="bg-muted border-border text-foreground placeholder:text-muted-foreground tracking-widest font-mono text-xs w-full max-w-xs"
                      />

                      {/* Registration Safety Callout */}
                      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-900 dark:text-amber-200 space-y-1 leading-relaxed">
                        <div className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="size-3.5 shrink-0" />
                          Registration Safety & WhatsApp Mobile App Coexistence
                        </div>
                        <p className="text-[11px] opacity-90">
                          Standard Cloud API registration is designed for dedicated numbers. If this phone number is currently active in the <strong>WhatsApp Business mobile app</strong>, registering it with Cloud API will <strong>disconnect mobile app access</strong> (standard manual credentials do not support mobile-app Coexistence).
                        </p>
                        <p className="text-[11px] opacity-90">
                          • If this number is already registered with Cloud API, leave this PIN blank.
                          <br />
                          • If this is a dedicated Cloud API number that needs registration, enter the 6-digit PIN set in WhatsApp Manager → Phone numbers → Two-step verification.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Step C — Validate Credentials (Pre-flight Test) */}
                  <div className="rounded-xl border border-border/80 bg-muted/20 p-4 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <Badge className="bg-primary text-primary-foreground text-xs font-semibold px-2 py-0.5">
                          Step C
                        </Badge>
                        <h4 className="font-semibold text-sm text-foreground">
                          Validate Credentials Pre-Flight
                        </h4>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleValidateCredentials}
                        disabled={validating || (!phoneNumberId.trim() && !wabaId.trim())}
                        className="border-primary/40 text-primary hover:bg-primary/10 text-xs h-8"
                      >
                        {validating ? (
                          <>
                            <Loader2 className="size-3.5 animate-spin mr-1.5" />
                            Validating with Meta...
                          </>
                        ) : (
                          <>
                            <ShieldCheck className="size-3.5 mr-1.5" />
                            Validate Credentials
                          </>
                        )}
                      </Button>
                    </div>

                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Test your access token and IDs with Meta Graph API before saving. This verifies permissions and retrieves your verified business name and phone number.
                    </p>

                    {validationSuccess && (
                      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 space-y-2 text-xs text-emerald-800 dark:text-emerald-300 animate-in fade-in-50">
                        <div className="flex items-center gap-2 font-semibold">
                          <CheckCircle2 className="size-4 text-emerald-600" />
                          <span>Credentials Validated Successfully</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] pt-1 border-t border-emerald-500/20">
                          <div>
                            <span className="text-muted-foreground block">Verified Business:</span>
                            <span className="font-medium text-foreground">
                              {validationSuccess.phone_info?.verified_name || 'Verified on Meta'}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground block">Display Phone:</span>
                            <span className="font-mono font-medium text-foreground">
                              {validationSuccess.phone_info?.display_phone_number || 'Confirmed'}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground block">Phone Number ID:</span>
                            <span className="font-mono text-foreground">
                              {validationSuccess.phone_number_id || validationSuccess.phone_info?.id}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground block">Quality Rating:</span>
                            <span className="font-medium text-foreground uppercase">
                              {validationSuccess.phone_info?.quality_rating || 'UNKNOWN'}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Step D — Webhook Configuration */}
                  <div className="rounded-xl border border-border/80 bg-muted/20 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-primary text-primary-foreground text-xs font-semibold px-2 py-0.5">
                        Step D
                      </Badge>
                      <h4 className="font-semibold text-sm text-foreground">
                        Configure Webhook in Meta Dashboard
                      </h4>
                    </div>

                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Enter Wattomation&apos;s Webhook Callback URL in your Meta Developer App to receive inbound messages and status updates:
                    </p>

                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Webhook Callback URL</Label>
                      <div className="flex gap-2">
                        <Input
                          readOnly
                          value={webhookUrl}
                          className="bg-muted border-border text-foreground font-mono text-xs"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={handleCopyWebhookUrl}
                          className="shrink-0 border-border text-muted-foreground hover:text-foreground"
                          title="Copy Webhook URL"
                        >
                          <Copy className="size-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-lg bg-card border border-border/60 p-3 text-xs space-y-1.5 text-muted-foreground">
                      <p className="font-medium text-foreground">Required Meta Developer Dashboard Actions:</p>
                      <ol className="list-decimal list-inside space-y-1 text-[11px] leading-relaxed">
                        <li>In your App, navigate to <strong>WhatsApp → Configuration → Webhook</strong>.</li>
                        <li>Click <strong>Edit</strong> and paste the Callback URL above.</li>
                        <li>Enter your platform Verify Token (matches your server environment configuration).</li>
                        <li>In Webhook fields, click <strong>Manage</strong> and subscribe to <strong>messages</strong>.</li>
                      </ol>
                    </div>
                  </div>

                  {/* Step E — Save & Connect Button */}
                  <div className="pt-2 flex items-center gap-3">
                    <Button
                      id="connect-whatsapp-btn"
                      onClick={handleSave}
                      disabled={saving || !canEditSettings}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium shadow-xs"
                    >
                      {saving ? (
                        <>
                          <Loader2 className="size-4 animate-spin mr-1.5" />
                          {t('saving')}
                        </>
                      ) : isEditingCredentials ? (
                        <>
                          <Check className="size-4 mr-1.5" />
                          Save Credentials & Subscriptions
                        </>
                      ) : (
                        <>
                          <Zap className="size-4 mr-1.5" />
                          Connect WhatsApp Cloud API
                        </>
                      )}
                    </Button>

                    {isEditingCredentials && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setIsEditingCredentials(false);
                          setValidationSuccess(null);
                          if (config) {
                            setPhoneNumberId(config.phone_number_id || '');
                            setWabaId(config.waba_id || '');
                            setAccessToken(MASKED_TOKEN);
                            setTokenEdited(false);
                          }
                        }}
                        className="border-border text-foreground hover:bg-muted"
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Webhook Configuration Reference Card */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-foreground text-sm flex items-center gap-2">
                  <Radio className="size-4 text-emerald-600" />
                  {t('webhookTitle')}
                </CardTitle>
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 text-[11px]">
                  Multi-Tenant Routing Active
                </Badge>
              </div>
              <CardDescription className="text-xs text-muted-foreground">
                Inbound WhatsApp events delivered to this webhook are cryptographically verified and routed automatically to your workspace based on your registered Phone Number ID.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t('webhookUrl')}</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={webhookUrl}
                    className="bg-muted border-border text-muted-foreground font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleCopyWebhookUrl}
                    className="shrink-0 border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Attachment Storage Card */}
          {config && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-foreground text-sm">{t('mediaTitle')}</CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  {t('mediaDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {t('mirrorInbound')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('mirrorInboundDesc')}
                    </p>
                    {!mirrorMedia && (
                      <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">
                        {t('mirrorInboundOffWarning')}
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={mirrorMedia}
                    onCheckedChange={handleToggleMirrorMedia}
                    disabled={savingMirror || !canEditSettings}
                    aria-label={t('mirrorInbound')}
                  />
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar — Setup Instructions Accordion */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-foreground text-sm flex items-center gap-2">
                <HelpCircle className="size-4 text-primary" />
                {t('setupInstructions')}
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Detailed Meta Developer Dashboard setup reference.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion>
                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline text-xs py-2.5">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">1</span>
                      {t('step1')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground text-xs">
                    <ol className="list-decimal list-inside space-y-1 text-xs">
                      <li dangerouslySetInnerHTML={{ __html: t('step1_1') }} />
                      <li>{t('step1_2')}</li>
                      <li>{t('step1_3')}</li>
                      <li>{t('step1_4')}</li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline text-xs py-2.5">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">2</span>
                      {t('step2')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground text-xs">
                    <ol className="list-decimal list-inside space-y-1 text-xs">
                      <li>{t('step2_1')}</li>
                      <li>{t('step2_2')}</li>
                      <li>{t('step2_3')}</li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline text-xs py-2.5">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">3</span>
                      {t('step3')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground text-xs">
                    <ol className="list-decimal list-inside space-y-1 text-xs">
                      <li>{t('step3_1')}</li>
                      <li dangerouslySetInnerHTML={{ __html: t.raw('step3_2') }} />
                      <li dangerouslySetInnerHTML={{ __html: t.raw('step3_3') }} />
                      <li dangerouslySetInnerHTML={{ __html: t.raw('step3_4') }} />
                    </ol>
                    <div className="mt-2.5 rounded-md bg-muted/60 p-2.5 text-[11px] space-y-1 text-muted-foreground border border-border/50">
                      <p className="font-semibold text-foreground">
                        Permanent Token Instructions:
                      </p>
                      <p>1. In Business Settings &gt; System Users, select your System User.</p>
                      <p>2. Under Assets, add your WhatsApp Business Account with Full Control.</p>
                      <p>3. Generate Token with <code className="text-foreground font-mono">whatsapp_business_management</code> and <code className="text-foreground font-mono">whatsapp_business_messaging</code>.</p>
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline text-xs py-2.5">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">4</span>
                      {t('step4')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground text-xs">
                    <ol className="list-decimal list-inside space-y-1 text-xs">
                      <li>{t('step4_1')}</li>
                      <li>{t('step4_2')}</li>
                      <li dangerouslySetInnerHTML={{ __html: t.raw('step4_3') }} />
                      <li dangerouslySetInnerHTML={{ __html: t.raw('step4_4') }} />
                      <li>{t('step4_5')}</li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              <div className="mt-4 pt-4 border-t border-border">
                <a
                  href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors"
                >
                  <ExternalLink className="size-3.5" />
                  {t('metaDocs')}
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Disconnect Confirmation Dialog */}
      <Dialog open={disconnectDialogOpen} onOpenChange={setDisconnectDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" />
              Disconnect WhatsApp Integration
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground leading-relaxed pt-2">
              Are you sure you want to disconnect WhatsApp from Wattomation?
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs space-y-2 leading-relaxed text-foreground">
            <p className="font-medium text-destructive">What disconnecting does:</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground text-[11px]">
              <li>Removes your WhatsApp API credentials from this Wattomation workspace.</li>
              <li>Stops messaging automations, bots, and inbound event routing for this account.</li>
            </ul>

            <p className="font-medium text-emerald-600 dark:text-emerald-400 pt-1">What disconnecting does NOT do:</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground text-[11px]">
              <li>Does <strong>NOT</strong> delete or alter your Meta WhatsApp Business Account.</li>
              <li>Does <strong>NOT</strong> deregister your phone number from Meta.</li>
              <li>Does <strong>NOT</strong> delete any message templates or business settings on Meta.</li>
            </ul>
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              variant="outline"
              onClick={() => setDisconnectDialogOpen(false)}
              disabled={resetting}
              size="sm"
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDisconnectConfirm}
              disabled={resetting}
              size="sm"
              className="text-xs"
            >
              {resetting ? (
                <>
                  <Loader2 className="size-3.5 animate-spin mr-1.5" />
                  Disconnecting...
                </>
              ) : (
                'Disconnect WhatsApp'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
