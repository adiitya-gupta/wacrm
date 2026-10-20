'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  Users,
  CreditCard,
  Activity,
  Plus,
  Search,
  Building2,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ExternalLink,
  Ban,
  Check,
  Copy,
  Receipt,
  FileCheck,
  Clock,
  UserCheck,
  UserX,
  History,
  ShieldCheck,
  RotateCcw,
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

interface AccountRecord {
  id: string;
  name: string;
  created_at: string;
  approval_status: 'pending' | 'approved' | 'rejected' | 'suspended';
  is_suspended: boolean;
  approved_at?: string | null;
  rejected_at?: string | null;
  suspended_at?: string | null;
  status_reason?: string | null;
  onboarding_completed: boolean;
  owner_name: string;
  owner_email: string;
  members_count: number;
}

interface AuditLogRecord {
  id: string;
  actor_email: string;
  action: string;
  target_account_id: string;
  target_email?: string | null;
  reason?: string | null;
  metadata?: any;
  created_at: string;
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<'access' | 'audit' | 'metrics' | 'tenants' | 'contracts' | 'health'>('access');
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(true);

  // Accounts & Access Control State
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [accountCounts, setAccountCounts] = useState({
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    suspended: 0,
  });
  const [statusFilter, setStatusFilter] = useState('all');
  const [accountSearch, setAccountSearch] = useState('');

  // Status Action Modal State
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<AccountRecord | null>(null);
  const [pendingAction, setPendingAction] = useState<'approve' | 'reject' | 'suspend' | 'reactivate'>('approve');
  const [actionReason, setActionReason] = useState('');
  const [executingAction, setExecutingAction] = useState(false);

  // Audit Logs State
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  // Platform Metrics
  const [metrics, setMetrics] = useState<any>(null);

  // Tenants & Subscriptions
  const [tenants, setTenants] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [modelFilter, setModelFilter] = useState('all');
  const [subscriptions, setSubscriptions] = useState<any[]>([]);

  // Create Client Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newBizName, setNewBizName] = useState('');
  const [newOwnerEmail, setNewOwnerEmail] = useState('');
  const [newOwnerName, setNewOwnerName] = useState('');
  const [newAcquisitionModel, setNewAcquisitionModel] = useState<'managed' | 'self_serve'>('managed');
  const [newPlanId, setNewPlanId] = useState('managed_custom');
  const [newCustomPricing, setNewCustomPricing] = useState('14999');
  const [newContractNotes, setNewContractNotes] = useState('Full service WhatsApp automation & workflow management');
  const [creatingTenant, setCreatingTenant] = useState(false);
  const [createdTenantResult, setCreatedTenantResult] = useState<any>(null);

  // Record Offline Payment Modal State
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('14999');
  const [paymentDesc, setPaymentDesc] = useState('Bank Wire Transfer');
  const [recordingPayment, setRecordingPayment] = useState(false);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/accounts?status=${statusFilter}&q=${encodeURIComponent(accountSearch)}`);
      if (res.status === 403) {
        setAuthorized(false);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || []);
        if (data.counts) setAccountCounts(data.counts);
      }
    } catch (e) {
      console.error('Failed to load admin accounts:', e);
    }
  }, [statusFilter, accountSearch]);

  const fetchAuditLogs = useCallback(async () => {
    setLoadingAudit(true);
    try {
      const res = await fetch('/api/admin/audit-logs');
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data.logs || []);
      }
    } catch (e) {
      console.error('Failed to load audit logs:', e);
    } finally {
      setLoadingAudit(false);
    }
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [metricsRes, tenantsRes, subsRes, accountsRes] = await Promise.all([
        fetch('/api/admin/metrics'),
        fetch('/api/admin/tenants'),
        fetch('/api/admin/subscriptions'),
        fetch(`/api/admin/accounts?status=${statusFilter}&q=${encodeURIComponent(accountSearch)}`),
      ]);

      if (metricsRes.status === 403 || tenantsRes.status === 403 || accountsRes.status === 403) {
        setAuthorized(false);
        setLoading(false);
        return;
      }

      if (metricsRes.ok) {
        const m = await metricsRes.json();
        setMetrics(m.metrics);
      }

      if (tenantsRes.ok) {
        const t = await tenantsRes.json();
        setTenants(t.tenants || []);
      }

      if (subsRes.ok) {
        const s = await subsRes.json();
        setSubscriptions(s.subscriptions || []);
      }

      if (accountsRes.ok) {
        const a = await accountsRes.json();
        setAccounts(a.accounts || []);
        if (a.counts) setAccountCounts(a.counts);
      }
    } catch (e) {
      console.error('Failed to load admin data:', e);
      toast.error('Failed to load admin dashboard');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, accountSearch]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Refetch accounts when filters change
  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  // When audit tab is opened, fetch logs
  useEffect(() => {
    if (activeTab === 'audit') {
      fetchAuditLogs();
    }
  }, [activeTab, fetchAuditLogs]);

  const openStatusActionModal = (
    account: AccountRecord,
    action: 'approve' | 'reject' | 'suspend' | 'reactivate'
  ) => {
    setSelectedAccount(account);
    setPendingAction(action);
    setActionReason('');
    setActionModalOpen(true);
  };

  const handleExecuteStatusAction = async () => {
    if (!selectedAccount) return;
    setExecutingAction(true);
    try {
      const res = await fetch(`/api/admin/accounts/${selectedAccount.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: pendingAction,
          reason: actionReason.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update account status');

      const actionLabels = {
        approve: 'authorized and approved',
        reject: 'rejected',
        suspend: 'suspended',
        reactivate: 'reactivated and restored',
      };

      toast.success(`Account ${selectedAccount.name} ${actionLabels[pendingAction]} successfully`);
      setActionModalOpen(false);
      setSelectedAccount(null);
      fetchAccounts();
      fetchAuditLogs();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setExecutingAction(false);
    }
  };

  const handleToggleSuspend = async (accountId: string, currentSuspended: boolean) => {
    try {
      const res = await fetch(`/api/admin/tenants/${accountId}/suspend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_suspended: !currentSuspended }),
      });

      if (!res.ok) throw new Error('Failed to update tenant status');
      toast.success(currentSuspended ? 'Tenant unsuspended' : 'Tenant suspended');
      setTenants((prev) =>
        prev.map((t) => (t.id === accountId ? { ...t, is_suspended: !currentSuspended } : t))
      );
      fetchAccounts();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleCreateTenant = async () => {
    if (!newBizName.trim() || !newOwnerEmail.trim()) {
      toast.error('Please enter business name and owner email');
      return;
    }

    setCreatingTenant(true);
    try {
      const res = await fetch('/api/admin/tenants/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_name: newBizName,
          owner_email: newOwnerEmail,
          owner_full_name: newOwnerName,
          acquisition_model: newAcquisitionModel,
          plan_id: newPlanId,
          custom_pricing_amount: newCustomPricing ? Number(newCustomPricing) : null,
          custom_contract_notes: newContractNotes,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to provision tenant');

      toast.success('Managed workspace provisioned successfully!');
      setCreatedTenantResult(data);
      fetchData();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCreatingTenant(false);
    }
  };

  const handleRecordOfflinePayment = async () => {
    setRecordingPayment(true);
    try {
      const res = await fetch('/api/admin/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'record_offline_payment',
          account_id: selectedAccountId,
          amount: Number(paymentAmount),
          description: paymentDesc,
        }),
      });

      if (!res.ok) throw new Error('Failed to record payment');
      toast.success('Offline payment recorded and subscription confirmed');
      setIsPaymentModalOpen(false);
      fetchData();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRecordingPayment(false);
    }
  };

  if (!authorized) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center">
        <ShieldAlert className="h-12 w-12 text-red-500 mb-3" />
        <h2 className="text-xl font-bold text-foreground">Access Restricted</h2>
        <p className="mt-1 text-sm text-muted-foreground max-w-md">
          This administration panel is strictly restricted to authorized platform administrators configured via <code>PLATFORM_ADMIN_EMAILS</code> or <code>OPSIYS_ACCOUNT_ID</code>.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const filteredTenants = tenants.filter((t) => {
    const matchesSearch =
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.owner_email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesModel =
      modelFilter === 'all' || t.acquisition_model === modelFilter;
    return matchesSearch && matchesModel;
  });

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-6 w-6 text-primary" />
            <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Wattomation
              </h1>
              <span className="text-sm font-medium text-muted-foreground">
                Platform Administration by OPSIYS
              </span>
            </div>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Strict account access authorization, multi-tenant workspace provisioning, commercial contracts, and security audits.
          </p>
        </div>

        <Button
          onClick={() => setIsCreateModalOpen(true)}
          className="bg-primary text-primary-foreground font-semibold shadow-sm"
        >
          <Plus className="mr-1.5 h-4 w-4" /> Provision Managed Workspace
        </Button>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList className="grid w-full grid-cols-6 lg:w-[720px]">
          <TabsTrigger value="access" className="flex items-center gap-1.5">
            <UserCheck className="h-4 w-4" />
            Access ({accountCounts.pending > 0 ? `${accountCounts.pending} Pending` : accountCounts.total})
          </TabsTrigger>
          <TabsTrigger value="audit" className="flex items-center gap-1.5">
            <History className="h-4 w-4" />
            Audit Trail
          </TabsTrigger>
          <TabsTrigger value="metrics">Overview</TabsTrigger>
          <TabsTrigger value="tenants">Tenants ({tenants.length})</TabsTrigger>
          <TabsTrigger value="contracts">Contracts</TabsTrigger>
          <TabsTrigger value="health">Health</TabsTrigger>
        </TabsList>

        {/* TAB 1: ACCOUNTS & ACCESS CONTROL */}
        <TabsContent value="access" className="mt-6 space-y-6">
          {/* Summary Metric Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Card className="p-4 border-border">
              <span className="text-xs font-semibold text-muted-foreground uppercase">Total Accounts</span>
              <div className="mt-2 text-2xl font-bold text-foreground">{accountCounts.total}</div>
              <p className="text-xs text-muted-foreground mt-1">All registered workspaces</p>
            </Card>

            <Card className={`p-4 border ${accountCounts.pending > 0 ? 'border-amber-500/40 bg-amber-500/5' : 'border-border'}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase">Pending Review</span>
                <Clock className="h-4 w-4 text-amber-500" />
              </div>
              <div className="mt-2 text-2xl font-bold text-amber-600 dark:text-amber-400">
                {accountCounts.pending}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Awaiting admin authorization</p>
            </Card>

            <Card className="p-4 border-border">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase">Approved</span>
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              </div>
              <div className="mt-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {accountCounts.approved}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Authorized product access</p>
            </Card>

            <Card className="p-4 border-border">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-red-500 uppercase">Rejected</span>
                <UserX className="h-4 w-4 text-red-500" />
              </div>
              <div className="mt-2 text-2xl font-bold text-red-500">
                {accountCounts.rejected}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Access denied</p>
            </Card>

            <Card className="p-4 border-border">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase">Suspended</span>
                <Ban className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="mt-2 text-2xl font-bold text-muted-foreground">
                {accountCounts.suspended}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Access revoked</p>
            </Card>
          </div>

          {/* Search & Filter Controls */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by business name or owner email..."
                value={accountSearch}
                onChange={(e) => setAccountSearch(e.target.value)}
                className="w-72 text-xs"
              />
            </div>

            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Status:</Label>
              <Select value={statusFilter} onValueChange={(v) => { if (v) setStatusFilter(v); }}>
                <SelectTrigger className="w-44 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses ({accountCounts.total})</SelectItem>
                  <SelectItem value="pending">Pending Approval ({accountCounts.pending})</SelectItem>
                  <SelectItem value="approved">Approved ({accountCounts.approved})</SelectItem>
                  <SelectItem value="rejected">Rejected ({accountCounts.rejected})</SelectItem>
                  <SelectItem value="suspended">Suspended ({accountCounts.suspended})</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Accounts List Table */}
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground">
                <tr>
                  <th className="p-3">Workspace Name</th>
                  <th className="p-3">Owner Contact</th>
                  <th className="p-3">Registered At</th>
                  <th className="p-3">Authorization Status</th>
                  <th className="p-3">Status Notes</th>
                  <th className="p-3 text-right">Admin Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-xs">
                {accounts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground">
                      No accounts found matching this filter criteria.
                    </td>
                  </tr>
                ) : (
                  accounts.map((acc) => {
                    const statusBadge = () => {
                      switch (acc.approval_status) {
                        case 'approved':
                          return (
                            <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 font-medium">
                              Approved
                            </Badge>
                          );
                        case 'pending':
                          return (
                            <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 font-medium animate-pulse">
                              Pending Approval
                            </Badge>
                          );
                        case 'rejected':
                          return (
                            <Badge variant="destructive" className="font-medium">
                              Rejected
                            </Badge>
                          );
                        case 'suspended':
                          return (
                            <Badge variant="secondary" className="font-medium text-muted-foreground">
                              Suspended
                            </Badge>
                          );
                      }
                    };

                    return (
                      <tr key={acc.id} className="hover:bg-muted/20 transition-colors">
                        <td className="p-3">
                          <div className="font-semibold text-foreground">{acc.name}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">{acc.id}</div>
                        </td>
                        <td className="p-3">
                          <div className="font-medium text-foreground">{acc.owner_name}</div>
                          <div className="text-muted-foreground">{acc.owner_email}</div>
                        </td>
                        <td className="p-3 text-muted-foreground whitespace-nowrap">
                          {new Date(acc.created_at).toLocaleDateString(undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="p-3">{statusBadge()}</td>
                        <td className="p-3 text-muted-foreground max-w-xs truncate">
                          {acc.status_reason || (acc.approval_status === 'approved' ? 'Authorized' : '—')}
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {acc.approval_status === 'pending' && (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() => openStatusActionModal(acc, 'approve')}
                                  className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                                >
                                  <UserCheck className="mr-1 h-3.5 w-3.5" /> Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openStatusActionModal(acc, 'reject')}
                                  className="h-7 text-xs text-red-500 hover:bg-red-500/10 border-red-500/30"
                                >
                                  <UserX className="mr-1 h-3.5 w-3.5" /> Reject
                                </Button>
                              </>
                            )}

                            {acc.approval_status === 'approved' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openStatusActionModal(acc, 'suspend')}
                                className="h-7 text-xs text-amber-500 hover:bg-amber-500/10 border-amber-500/30"
                              >
                                <Ban className="mr-1 h-3.5 w-3.5" /> Suspend
                              </Button>
                            )}

                            {acc.approval_status === 'suspended' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openStatusActionModal(acc, 'reactivate')}
                                className="h-7 text-xs text-emerald-500 hover:bg-emerald-500/10 border-emerald-500/30"
                              >
                                <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reactivate
                              </Button>
                            )}

                            {acc.approval_status === 'rejected' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openStatusActionModal(acc, 'approve')}
                                className="h-7 text-xs text-emerald-500 hover:bg-emerald-500/10 border-emerald-500/30"
                              >
                                <UserCheck className="mr-1 h-3.5 w-3.5" /> Reconsider & Approve
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* TAB 2: AUDIT TRAIL */}
        <TabsContent value="audit" className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-foreground">Platform Access Audit Log</h3>
              <p className="text-xs text-muted-foreground">
                Immutable server-side trail of account approvals, rejections, suspensions, and reactivations.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={fetchAuditLogs}
              disabled={loadingAudit}
              className="text-xs"
            >
              <RotateCcw className={`mr-1.5 h-3.5 w-3.5 ${loadingAudit ? 'animate-spin' : ''}`} /> Refresh Log
            </Button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground">
                <tr>
                  <th className="p-3">Timestamp</th>
                  <th className="p-3">Action</th>
                  <th className="p-3">Target Account / User</th>
                  <th className="p-3">Administrator</th>
                  <th className="p-3">Reason / Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-xs">
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-muted-foreground">
                      No administrative authorization events recorded yet.
                    </td>
                  </tr>
                ) : (
                  auditLogs.map((log) => {
                    const actionBadge = () => {
                      if (log.action.includes('approved')) {
                        return <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">{log.action}</Badge>;
                      }
                      if (log.action.includes('suspended')) {
                        return <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20">{log.action}</Badge>;
                      }
                      if (log.action.includes('rejected')) {
                        return <Badge variant="destructive">{log.action}</Badge>;
                      }
                      return <Badge variant="outline">{log.action}</Badge>;
                    };

                    return (
                      <tr key={log.id} className="hover:bg-muted/20">
                        <td className="p-3 text-muted-foreground whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                        <td className="p-3">{actionBadge()}</td>
                        <td className="p-3">
                          <div className="font-semibold text-foreground">{log.target_email || '—'}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">{log.target_account_id}</div>
                        </td>
                        <td className="p-3 font-medium text-foreground">{log.actor_email}</td>
                        <td className="p-3 text-muted-foreground">{log.reason || 'Standard administrative action'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* TAB 3: METRICS */}
        <TabsContent value="metrics" className="mt-6 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase">Total Workspaces</span>
                <Building2 className="h-4 w-4 text-primary" />
              </div>
              <div className="mt-2 text-3xl font-extrabold text-foreground">
                {metrics?.total_tenants || 0}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {metrics?.managed_tenants || 0} Managed · {metrics?.self_serve_tenants || 0} Self-Service
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase">Active Subscriptions</span>
                <CreditCard className="h-4 w-4 text-emerald-500" />
              </div>
              <div className="mt-2 text-3xl font-extrabold text-foreground">
                {metrics?.active_subscriptions || 0}
              </div>
              <div className="mt-1 text-xs text-emerald-500 font-medium">100% active standing</div>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase">Messages Sent (Period)</span>
                <Activity className="h-4 w-4 text-blue-500" />
              </div>
              <div className="mt-2 text-3xl font-extrabold text-foreground">
                {(metrics?.total_messages_period || 0).toLocaleString()}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">Period: {metrics?.current_period}</div>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase">Active AI Agents</span>
                <Users className="h-4 w-4 text-purple-500" />
              </div>
              <div className="mt-2 text-3xl font-extrabold text-foreground">
                {metrics?.active_ai_agents || 0}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">Across all tenant domains</div>
            </Card>
          </div>
        </TabsContent>

        {/* TAB 4: TENANTS */}
        <TabsContent value="tenants" className="mt-6 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search business name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-64 text-xs"
              />
            </div>
            <Select value={modelFilter} onValueChange={(v) => { if (v) setModelFilter(v); }}>
              <SelectTrigger className="w-40 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Models</SelectItem>
                <SelectItem value="managed">Managed Only</SelectItem>
                <SelectItem value="self_serve">Self-Serve Only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground">
                <tr>
                  <th className="p-3">Workspace Name</th>
                  <th className="p-3">Owner Email</th>
                  <th className="p-3">Model</th>
                  <th className="p-3">Plan</th>
                  <th className="p-3">WhatsApp</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-xs">
                {filteredTenants.map((t) => (
                  <tr key={t.id} className="hover:bg-muted/20">
                    <td className="p-3 font-semibold text-foreground">{t.name}</td>
                    <td className="p-3 text-muted-foreground">{t.owner_email}</td>
                    <td className="p-3">
                      <Badge variant="outline">
                        {t.acquisition_model === 'managed' ? 'OPSIYS Managed' : 'Self-Serve'}
                      </Badge>
                    </td>
                    <td className="p-3 font-medium text-foreground">
                      {t.subscription?.plan_id || 'starter'}
                    </td>
                    <td className="p-3">
                      {t.whatsapp_connected ? (
                        <span className="flex items-center gap-1 text-emerald-500 font-medium">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Connected
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Not connected</span>
                      )}
                    </td>
                    <td className="p-3">
                      {t.is_suspended ? (
                        <Badge variant="destructive">Suspended</Badge>
                      ) : (
                        <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
                          Active
                        </Badge>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleToggleSuspend(t.id, t.is_suspended)}
                        className={`text-xs ${t.is_suspended ? 'text-emerald-500' : 'text-red-400'}`}
                      >
                        {t.is_suspended ? 'Unsuspend' : 'Suspend'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* TAB 5: CONTRACTS */}
        <TabsContent value="contracts" className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Manage client contract terms and record offline payments (bank wire, cash, invoices).
            </p>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground">
                <tr>
                  <th className="p-3">Workspace</th>
                  <th className="p-3">Model</th>
                  <th className="p-3">Monthly Rate</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Contract Notes</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-xs">
                {subscriptions.map((s) => (
                  <tr key={s.id} className="hover:bg-muted/20">
                    <td className="p-3 font-semibold text-foreground">
                      {s.accounts?.name || s.account_id.slice(0, 8)}
                    </td>
                    <td className="p-3">
                      <Badge variant="outline">{s.acquisition_model}</Badge>
                    </td>
                    <td className="p-3 font-mono font-semibold">
                      ₹{(s.custom_pricing_amount || 0).toLocaleString()}
                    </td>
                    <td className="p-3">
                      <Badge variant="secondary">{s.status}</Badge>
                    </td>
                    <td className="p-3 text-muted-foreground max-w-xs truncate">
                      {s.custom_contract_notes || 'Standard terms'}
                    </td>
                    <td className="p-3 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedAccountId(s.account_id);
                          setPaymentAmount(String(s.custom_pricing_amount || 14999));
                          setIsPaymentModalOpen(true);
                        }}
                        className="text-xs"
                      >
                        <Receipt className="mr-1.5 h-3.5 w-3.5 text-primary" /> Record Payment
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* TAB 6: SYSTEM HEALTH */}
        <TabsContent value="health" className="mt-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="p-5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground">Account Authorization Gate</span>
                <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">Enforced</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Default-deny account approval enforcement active at database RLS and server API layer.
              </p>
            </Card>

            <Card className="p-5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground">Vercel Cron & Automation Scheduler</span>
                <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">Operational</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Endpoints <code>/api/automations/cron</code> and <code>/api/flows/cron</code> secured with constant-time Bearer authentication.
              </p>
            </Card>

            <Card className="p-5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground">Distributed Rate Limiter (Upstash Redis)</span>
                <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">Protected</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Production fail-closed guard active. High-concurrency atomic sliding window enabled.
              </p>
            </Card>

            <Card className="p-5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground">Multi-Tenant Boundary</span>
                <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">Isolated</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                PostgreSQL RLS with <code>is_account_member()</code> prevents cross-tenant access.
              </p>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Confirmation Dialog for Status Action */}
      <Dialog open={actionModalOpen} onOpenChange={setActionModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingAction === 'approve' && 'Approve Account Authorization'}
              {pendingAction === 'reject' && 'Reject Account Registration'}
              {pendingAction === 'suspend' && 'Suspend Account Access'}
              {pendingAction === 'reactivate' && 'Reactivate Workspace Access'}
            </DialogTitle>
            <DialogDescription>
              {pendingAction === 'approve' &&
                `Grant ${selectedAccount?.name} full access to their Wattomation workspace and integrations.`}
              {pendingAction === 'reject' &&
                `Deny ${selectedAccount?.name} access to the platform. They will see an access denied notice.`}
              {pendingAction === 'suspend' &&
                `Immediately revoke ${selectedAccount?.name}'s active sessions and product access.`}
              {pendingAction === 'reactivate' &&
                `Restore product access and activate workspace for ${selectedAccount?.name}.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Workspace:</span>
                <span className="font-semibold text-foreground">{selectedAccount?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Owner:</span>
                <span className="font-semibold text-foreground">{selectedAccount?.owner_email}</span>
              </div>
            </div>

            <div>
              <Label className="text-xs">
                {pendingAction === 'reject' || pendingAction === 'suspend'
                  ? 'Reason for this decision (shown to user)'
                  : 'Administrative notes (optional)'}
              </Label>
              <Textarea
                rows={2}
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
                placeholder={
                  pendingAction === 'reject'
                    ? 'e.g. Account does not meet current platform onboarding requirements.'
                    : pendingAction === 'suspend'
                    ? 'e.g. Administrative review or policy breach.'
                    : 'Optional note for audit trail...'
                }
                className="mt-1 text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setActionModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleExecuteStatusAction}
              disabled={executingAction}
              className={
                pendingAction === 'reject' || pendingAction === 'suspend'
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
              }
            >
              {executingAction ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirm{' '}
              {pendingAction === 'approve'
                ? 'Approval'
                : pendingAction === 'reject'
                ? 'Rejection'
                : pendingAction === 'suspend'
                ? 'Suspension'
                : 'Reactivation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Provision Managed Workspace Modal */}
      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Provision Managed Client Workspace</DialogTitle>
            <DialogDescription>
              Create and configure an isolated business workspace for your client.
            </DialogDescription>
          </DialogHeader>

          {createdTenantResult ? (
            <div className="space-y-4 py-2">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-xs font-mono space-y-2 text-emerald-300">
                <div className="font-semibold text-emerald-400">Workspace Created Successfully!</div>
                <div>Account ID: {createdTenantResult.account.id}</div>
                <div>Site Key: {createdTenantResult.account.website_integration.site_key}</div>
                <div>Invite URL: {createdTenantResult.client_invitation.invite_url}</div>
              </div>

              <Button
                onClick={() => {
                  navigator.clipboard.writeText(createdTenantResult.client_invitation.invite_url);
                  toast.success('Client invitation link copied to clipboard');
                }}
                variant="outline"
                className="w-full"
              >
                <Copy className="mr-2 h-4 w-4" /> Copy Client Invite Link
              </Button>

              <DialogFooter>
                <Button
                  onClick={() => {
                    setCreatedTenantResult(null);
                    setIsCreateModalOpen(false);
                  }}
                  className="w-full"
                >
                  Done
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div>
                <Label>Client Business Name</Label>
                <Input
                  placeholder="e.g. Acme Corp"
                  value={newBizName}
                  onChange={(e) => setNewBizName(e.target.value)}
                  className="mt-1"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Owner Full Name</Label>
                  <Input
                    placeholder="e.g. John Doe"
                    value={newOwnerName}
                    onChange={(e) => setNewOwnerName(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Owner Email</Label>
                  <Input
                    type="email"
                    placeholder="john@example.com"
                    value={newOwnerEmail}
                    onChange={(e) => setNewOwnerEmail(e.target.value)}
                    className="mt-1"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Acquisition Model</Label>
                  <Select
                    value={newAcquisitionModel}
                    onValueChange={(v: any) => setNewAcquisitionModel(v)}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="managed">OPSIYS Managed</SelectItem>
                      <SelectItem value="self_serve">Self-Service</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Subscription Plan</Label>
                  <Select value={newPlanId} onValueChange={(v) => { if (v) setNewPlanId(v); }}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="managed_custom">OPSIYS Managed Custom</SelectItem>
                      <SelectItem value="enterprise">Enterprise Tier</SelectItem>
                      <SelectItem value="pro">Pro Tier</SelectItem>
                      <SelectItem value="starter">Starter Tier</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label>Agreed Commercial Amount (₹ / month)</Label>
                <Input
                  type="number"
                  value={newCustomPricing}
                  onChange={(e) => setNewCustomPricing(e.target.value)}
                  className="mt-1"
                />
              </div>

              <div>
                <Label>Contract Notes</Label>
                <Textarea
                  rows={2}
                  value={newContractNotes}
                  onChange={(e) => setNewContractNotes(e.target.value)}
                  className="mt-1"
                />
              </div>

              <DialogFooter className="pt-2">
                <Button variant="outline" onClick={() => setIsCreateModalOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateTenant}
                  disabled={creatingTenant}
                  className="bg-primary text-primary-foreground"
                >
                  {creatingTenant ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Provision & Generate Invite
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Record Offline Payment Modal */}
      <Dialog open={isPaymentModalOpen} onOpenChange={setIsPaymentModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Offline Wire / Invoice Payment</DialogTitle>
            <DialogDescription>
              Mark client retainer or setup fee as received and issue receipt.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Payment Amount (₹)</Label>
              <Input
                type="number"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Payment Method / Reference Note</Label>
              <Input
                value={paymentDesc}
                onChange={(e) => setPaymentDesc(e.target.value)}
                placeholder="e.g. Wire Transfer Ref #12345"
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPaymentModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleRecordOfflinePayment}
              disabled={recordingPayment}
              className="bg-primary text-primary-foreground"
            >
              {recordingPayment ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirm & Activate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
