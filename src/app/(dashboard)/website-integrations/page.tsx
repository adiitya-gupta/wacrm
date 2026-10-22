'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Globe,
  Code2,
  Zap,
  History,
  Play,
  Copy,
  Check,
  Plus,
  Trash2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import type {
  WebsiteIntegrationRule,
  WebsiteEventLog,
} from '@/types/website-integrations';

type IntegrationTab = 'setup' | 'rules' | 'logs' | 'test';
type ActionType = 'send_whatsapp_message' | 'send_template' | 'assign_tag';

interface TestEventResult {
  success?: boolean;
  error?: string;
  [key: string]: unknown;
}

export default function WebsiteIntegrationsPage() {
  const [activeTab, setActiveTab] = useState<IntegrationTab>('setup');
  const [loading, setLoading] = useState(true);

  // Credentials
  const [siteKey, setSiteKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [domains, setDomains] = useState('');
  const [savingDomains, setSavingDomains] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  // Rules & Logs
  const [rules, setRules] = useState<WebsiteIntegrationRule[]>([]);
  const [logs, setLogs] = useState<WebsiteEventLog[]>([]);
  const [refreshingLogs, setRefreshingLogs] = useState(false);

  // Rule creation modal
  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false);
  const [newEventType, setNewEventType] = useState('lead.submitted');
  const [newActionType, setNewActionType] = useState<ActionType>('send_whatsapp_message');
  const [newMessageBody, setNewMessageBody] = useState('Hi {{name}}! Thank you for reaching out. We received your inquiry and will be in touch shortly.');
  const [newTagName, setNewTagName] = useState('Website Lead');
  const [creatingRule, setCreatingRule] = useState(false);

  // Test Tool state
  const [testEventType, setTestEventType] = useState('lead.submitted');
  const [testPhone, setTestPhone] = useState('+14155552671');
  const [testName, setTestName] = useState('Jane Smith');
  const [testEmail, setTestEmail] = useState('jane@example.com');
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<TestEventResult | null>(null);

  const fetchIntegrationData = useCallback(async () => {
    setLoading(true);
    try {
      const [credRes, rulesRes, logsRes] = await Promise.all([
        fetch('/api/website-integrations'),
        fetch('/api/website-integrations/rules'),
        fetch('/api/website-integrations/logs'),
      ]);

      if (credRes.ok) {
        const cred = await credRes.json();
        setSiteKey(cred.site_key || '');
        setWebhookSecret(cred.webhook_secret || '');
        setDomains((cred.domain_whitelist || []).join(', '));
      }

      if (rulesRes.ok) {
        const r = await rulesRes.json();
        setRules(r.rules || []);
      }

      if (logsRes.ok) {
        const l = await logsRes.json();
        setLogs(l.logs || []);
      }
    } catch (e) {
      console.error('Failed to load website integration data:', e);
      toast.error('Failed to load website integration details');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIntegrationData();
  }, [fetchIntegrationData]);

  const handleSaveDomains = async () => {
    setSavingDomains(true);
    try {
      const list = domains
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean);

      const res = await fetch('/api/website-integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain_whitelist: list }),
      });

      if (!res.ok) throw new Error('Failed to save domains');
      toast.success('Allowed domains updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save domains');
    } finally {
      setSavingDomains(false);
    }
  };

  const handleCreateRule = async () => {
    setCreatingRule(true);
    try {
      const config: Record<string, string> = {};
      if (newActionType === 'send_whatsapp_message') {
        config.message_body = newMessageBody;
      } else if (newActionType === 'assign_tag') {
        config.tag_name = newTagName;
      }

      const res = await fetch('/api/website-integrations/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: newEventType,
          action_type: newActionType,
          config,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create rule');
      }

      toast.success('Automation rule created');
      setIsRuleModalOpen(false);
      fetchIntegrationData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create rule');
    } finally {
      setCreatingRule(false);
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    try {
      const res = await fetch(`/api/website-integrations/rules/${ruleId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete rule');
      toast.success('Rule removed');
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete rule');
    }
  };

  const handleRunTest = async () => {
    setTestRunning(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/website-integrations/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: testEventType,
          phone: testPhone,
          name: testName,
          email: testEmail,
        }),
      });

      const data = await res.json();
      setTestResult(data);
      if (res.ok && data.success) {
        toast.success('Test event executed successfully!');
      } else {
        toast.error(data.error || 'Test event failed');
      }
      fetchIntegrationData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test event failed');
    } finally {
      setTestRunning(false);
    }
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://wacrm.opsiys.com';
  const snippet = `<script src="${origin}/sdk/wacrm.js" data-site-key="${siteKey}" defer></script>`;

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Globe className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Website Integrations
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect your website to capture inbound leads and trigger automated WhatsApp follow-ups.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as IntegrationTab)}>
        <TabsList className="grid w-full grid-cols-4 lg:w-[480px]">
          <TabsTrigger value="setup">
            <Code2 className="mr-1.5 h-4 w-4" /> Setup & SDK
          </TabsTrigger>
          <TabsTrigger value="rules">
            <Zap className="mr-1.5 h-4 w-4" /> Rules ({rules.length})
          </TabsTrigger>
          <TabsTrigger value="logs">
            <History className="mr-1.5 h-4 w-4" /> Logs ({logs.length})
          </TabsTrigger>
          <TabsTrigger value="test">
            <Play className="mr-1.5 h-4 w-4" /> Test Tool
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: SETUP */}
        <TabsContent value="setup" className="mt-6 space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Credentials Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Integration Credentials</CardTitle>
                <CardDescription>
                  Your unique public Site Key and private Webhook Secret.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Public Site Key (Safe for browser code)</Label>
                  <div className="mt-1 flex items-center gap-2">
                    <Input readOnly value={siteKey} className="font-mono text-xs bg-muted" />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard.writeText(siteKey);
                        setCopiedKey(true);
                        setTimeout(() => setCopiedKey(false), 2000);
                        toast.success('Site key copied');
                      }}
                    >
                      {copiedKey ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                <div>
                  <Label>Webhook Secret (For HMAC SHA-256 verification)</Label>
                  <div className="mt-1 flex items-center gap-2">
                    <Input readOnly type="password" value={webhookSecret} className="font-mono text-xs bg-muted" />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard.writeText(webhookSecret);
                        setCopiedSecret(true);
                        setTimeout(() => setCopiedSecret(false), 2000);
                        toast.success('Webhook secret copied');
                      }}
                    >
                      {copiedSecret ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                <div>
                  <Label>Allowed Domain Whitelist</Label>
                  <Input
                    placeholder="e.g. example.com, app.example.com (comma separated)"
                    value={domains}
                    onChange={(e) => setDomains(e.target.value)}
                    className="mt-1"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Restricts JavaScript SDK event submission to your authorized domains. Leave blank to allow any origin during development.
                  </p>
                </div>
              </CardContent>
              <CardFooter className="border-t border-border/40 pt-4 flex justify-end">
                <Button onClick={handleSaveDomains} disabled={savingDomains} size="sm">
                  {savingDomains ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save Allowed Domains
                </Button>
              </CardFooter>
            </Card>

            {/* JavaScript SDK Snippet Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">JavaScript Website SDK</CardTitle>
                <CardDescription>
                  Embed this zero-dependency snippet on your website to track forms and button clicks.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg bg-zinc-950 p-4 font-mono text-xs text-zinc-100 dark:bg-zinc-900 border border-border">
                  <pre className="overflow-x-auto whitespace-pre-wrap">{snippet}</pre>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(snippet);
                    setCopiedSnippet(true);
                    setTimeout(() => setCopiedSnippet(false), 2000);
                    toast.success('Snippet copied');
                  }}
                  className="w-full"
                >
                  {copiedSnippet ? <Check className="mr-2 h-4 w-4 text-emerald-500" /> : <Copy className="mr-2 h-4 w-4" />}
                  Copy Script Tag
                </Button>

                <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground space-y-2">
                  <div className="font-semibold text-foreground">Auto-Bind HTML Lead Forms:</div>
                  <pre className="font-mono text-xs bg-muted p-2 rounded">
{`window.WACRM.bindForm('#contact-form', {
  event: 'lead.submitted'
});`}
                  </pre>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Webhook & REST API Reference */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Server-to-Server Webhook / REST Ingestion</CardTitle>
              <CardDescription>
                Send events directly from your backend server or webhook providers.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Webhook Ingestion URL</Label>
                <div className="mt-1 flex items-center gap-2">
                  <Input readOnly value={`${origin}/api/v1/website/events`} className="font-mono text-xs bg-muted" />
                </div>
              </div>
              <div className="rounded-lg bg-zinc-950 p-4 font-mono text-xs text-zinc-100 dark:bg-zinc-900 border border-border overflow-x-auto">
{`curl -X POST ${origin}/api/v1/website/events \\
  -H "Content-Type: application/json" \\
  -H "x-site-key: ${siteKey}" \\
  -d '{
    "event_type": "lead.submitted",
    "phone": "+14155552671",
    "name": "Jane Doe",
    "email": "jane@example.com",
    "metadata": { "interest": "Enterprise SaaS" }
  }'`}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 2: RULES */}
        <TabsContent value="rules" className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Define what action Wattomation takes when a specific website event occurs.
            </p>
            <Button onClick={() => setIsRuleModalOpen(true)} className="bg-primary text-primary-foreground">
              <Plus className="mr-1.5 h-4 w-4" /> Create Rule
            </Button>
            <Dialog open={isRuleModalOpen} onOpenChange={setIsRuleModalOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Website Trigger Rule</DialogTitle>
                  <DialogDescription>
                    Automatically trigger WhatsApp messages or assign tags when an event is received.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div>
                    <Label>Event Type</Label>
                    <Select value={newEventType} onValueChange={(v) => { if (v) setNewEventType(v); }}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="lead.submitted">lead.submitted (Form Submission)</SelectItem>
                        <SelectItem value="user.registered">user.registered (User Signup)</SelectItem>
                        <SelectItem value="appointment.booked">appointment.booked (Booking)</SelectItem>
                        <SelectItem value="order.updated">order.updated (Ecommerce)</SelectItem>
                        <SelectItem value="custom">custom (Custom Event)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Action to Execute</Label>
                    <Select value={newActionType} onValueChange={(v) => setNewActionType(v as ActionType)}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="send_whatsapp_message">Send WhatsApp Text Message</SelectItem>
                        <SelectItem value="assign_tag">Assign CRM Tag</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {newActionType === 'send_whatsapp_message' && (
                    <div>
                      <Label>WhatsApp Message Body</Label>
                      <Textarea
                        rows={3}
                        value={newMessageBody}
                        onChange={(e) => setNewMessageBody(e.target.value)}
                        className="mt-1 font-sans text-sm"
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        Supports variables like <code>{'{{name}}'}</code>, <code>{'{{phone}}'}</code>, <code>{'{{event_type}}'}</code>.
                      </p>
                    </div>
                  )}

                  {newActionType === 'assign_tag' && (
                    <div>
                      <Label>Tag Name</Label>
                      <Input
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                        placeholder="e.g. Website Lead, VIP"
                        className="mt-1"
                      />
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsRuleModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreateRule} disabled={creatingRule} className="bg-primary text-primary-foreground">
                    {creatingRule ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Save Rule
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {rules.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center p-12 text-center">
                <Zap className="h-10 w-10 text-muted-foreground mb-3 opacity-40" />
                <h3 className="text-base font-semibold text-foreground">No Automation Rules Configured</h3>
                <p className="mt-1 text-sm text-muted-foreground max-w-sm">
                  Create a rule so incoming website events automatically message leads or tag contacts.
                </p>
                <Button onClick={() => setIsRuleModalOpen(true)} className="mt-4 bg-primary text-primary-foreground">
                  <Plus className="mr-1.5 h-4 w-4" /> Create First Rule
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {rules.map((rule) => (
                <Card key={rule.id} className="p-4 flex items-center justify-between border-border">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
                        {rule.event_type}
                      </Badge>
                      <span className="text-xs text-muted-foreground">→</span>
                      <span className="text-sm font-semibold text-foreground">
                        {rule.action_type === 'send_whatsapp_message'
                          ? 'Send WhatsApp Message'
                          : rule.action_type === 'assign_tag'
                          ? `Assign Tag: "${rule.config.tag_name || 'Website Lead'}"`
                          : rule.action_type}
                      </span>
                    </div>
                    {rule.action_type === 'send_whatsapp_message' && (
                      <p className="text-xs text-muted-foreground line-clamp-1 italic">
                        &quot;{rule.config.message_body}&quot;
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDeleteRule(rule.id)}
                    className="text-muted-foreground hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* TAB 3: LOGS */}
        <TabsContent value="logs" className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Audit trail of website events received and actions dispatched.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                setRefreshingLogs(true);
                await fetchIntegrationData();
                setRefreshingLogs(false);
                toast.success('Logs refreshed');
              }}
            >
              <RefreshCw className={`mr-1.5 h-4 w-4 ${refreshingLogs ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          </div>

          {logs.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center p-12 text-center">
                <History className="h-10 w-10 text-muted-foreground mb-3 opacity-40" />
                <h3 className="text-base font-semibold text-foreground">No Website Events Recorded</h3>
                <p className="mt-1 text-sm text-muted-foreground max-w-sm">
                  Events will appear here as soon as your website form submits or you run a test event.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-muted/50 text-xs font-semibold text-muted-foreground">
                  <tr>
                    <th className="p-3">Time</th>
                    <th className="p-3">Event</th>
                    <th className="p-3">Phone</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Actions Dispatched</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-muted/30">
                      <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="p-3 font-medium text-foreground">
                        <Badge variant="secondary" className="text-xs">
                          {log.event_type}
                        </Badge>
                      </td>
                      <td className="p-3 font-mono text-xs text-foreground">
                        {String(log.payload.phone || 'N/A')}
                      </td>
                      <td className="p-3">
                        {log.status === 'processed' ? (
                          <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
                            Processed
                          </Badge>
                        ) : log.status === 'failed' ? (
                          <Badge variant="destructive">Failed</Badge>
                        ) : (
                          <Badge variant="outline">{log.status}</Badge>
                        )}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {log.dispatched_actions?.length
                          ? `${log.dispatched_actions.length} action(s)`
                          : 'No rules matched'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* TAB 4: TEST TOOL */}
        <TabsContent value="test" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Simulate Live Website Event</CardTitle>
              <CardDescription>
                Test your triggers, contact creation, and WhatsApp messaging in real-time.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Event Type</Label>
                  <Select value={testEventType} onValueChange={(v) => { if (v) setTestEventType(v); }}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lead.submitted">lead.submitted</SelectItem>
                      <SelectItem value="user.registered">user.registered</SelectItem>
                      <SelectItem value="appointment.booked">appointment.booked</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Prospect Phone Number (E.164)</Label>
                  <Input
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    placeholder="+14155552671"
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label>Prospect Full Name</Label>
                  <Input
                    value={testName}
                    onChange={(e) => setTestName(e.target.value)}
                    placeholder="Jane Doe"
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label>Prospect Email</Label>
                  <Input
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    placeholder="jane@example.com"
                    className="mt-1"
                  />
                </div>
              </div>

              {testResult && (
                <div className={`mt-4 rounded-xl border p-4 text-xs font-mono ${
                  testResult.success
                    ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300'
                    : 'border-red-500/20 bg-red-500/5 text-red-300'
                }`}>
                  <div className="font-semibold mb-2">Execution Response:</div>
                  <pre className="overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(testResult, null, 2)}
                  </pre>
                </div>
              )}
            </CardContent>
            <CardFooter className="border-t border-border/40 pt-4 flex justify-end">
              <Button onClick={handleRunTest} disabled={testRunning} className="bg-primary text-primary-foreground">
                {testRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                Fire Test Event
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
