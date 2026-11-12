'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { format, parseISO, isToday, isTomorrow, startOfWeek, addDays, isSameDay } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import type { Meeting, SchedulingSettings, Contact } from '@/types';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import {
  Calendar as CalendarIcon,
  Clock,
  Video,
  Phone,
  User,
  CheckCircle2,
  XCircle,
  CalendarPlus,
  Settings as SettingsIcon,
  Search,
  ExternalLink,
  MessageSquare,
  Bot,
  Sparkles,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  List,
  Mail,
  Check,
} from 'lucide-react';

interface MeetingWithContact extends Meeting {
  contact?: Contact;
  qualification?: {
    qualification_state: string;
    service_requested?: string;
    business_type?: string;
    budget?: string;
    urgency?: string;
    qualification_summary?: string;
  };
}

export default function MeetingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accountId } = useAuth();
  const supabase = createClient();

  // State
  const [meetings, setMeetings] = useState<MeetingWithContact[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [settings, setSettings] = useState<SchedulingSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );

  // Modals state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [rescheduleModalOpen, setRescheduleModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [selectedMeeting, setSelectedMeeting] = useState<MeetingWithContact | null>(null);

  // Create form state
  const [createForm, setCreateForm] = useState({
    contactId: '',
    title: 'OPSIYS Discovery Meeting',
    serviceRequested: 'AI Automation',
    startTime: '',
    durationMinutes: 15,
    description: '',
    meetingLink: '',
  });
  const [submittingCreate, setSubmittingCreate] = useState(false);

  // Reschedule form state
  const [newStartTime, setNewStartTime] = useState('');
  const [submittingReschedule, setSubmittingReschedule] = useState(false);

  // Cancel form state
  const [cancelReason, setCancelReason] = useState('');
  const [submittingCancel, setSubmittingCancel] = useState(false);

  // Settings form state (editable Availability Rules)
  const [settingsForm, setSettingsForm] = useState({
    workingHoursStart: '09:00',
    workingHoursEnd: '18:00',
    meetingDurationMinutes: 15,
    minimumNoticeHours: 2,
    bufferAfterMinutes: 10,
    timezone: 'Asia/Kolkata',
    defaultMeetingLink: '',
  });
  const [savingSettings, setSavingSettings] = useState(false);

  // Google Calendar list & disconnect state
  const [googleCalendars, setGoogleCalendars] = useState<Array<{ id: string; summary: string; primary?: boolean }>>([]);
  const [loadingCalendars, setLoadingCalendars] = useState(false);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>('primary');
  const [disconnectingGoogle, setDisconnectingGoogle] = useState(false);

  const fetchGoogleCalendars = useCallback(async () => {
    setLoadingCalendars(true);
    try {
      const res = await fetch('/api/meetings/google/calendars');
      if (res.ok) {
        const data = await res.json();
        if (data.connected && Array.isArray(data.calendars)) {
          setGoogleCalendars(data.calendars);
        }
      }
    } catch (err) {
      console.warn('Failed to load Google calendars:', err);
    } finally {
      setLoadingCalendars(false);
    }
  }, []);

  // Check URL notifications (e.g. connected=google)
  useEffect(() => {
    const connected = searchParams.get('connected');
    const err = searchParams.get('error');
    if (connected === 'google') {
      toast.success('Google Calendar connected successfully! Google Meet links are now active.');
    } else if (err) {
      toast.error(`Google Calendar connection failed: ${err}`);
    }
  }, [searchParams]);

  // Fetch Meetings & Contacts
  const fetchData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      // 1. Fetch meetings
      const res = await fetch('/api/meetings');
      if (res.ok) {
        const data = await res.json();
        setMeetings(data.meetings || []);
      }

      // 2. Fetch settings
      const settingsRes = await fetch('/api/meetings/settings');
      if (settingsRes.ok) {
        const settingsData = await settingsRes.json();
        const s = settingsData.settings || null;
        setSettings(s);
        if (s) {
          setSelectedCalendarId(s.google_calendar_calendar_id || 'primary');
          if (s.google_calendar_enabled && s.google_calendar_status !== 'expired' && s.google_calendar_status !== 'error') {
            fetchGoogleCalendars();
          } else {
            setGoogleCalendars([]);
          }
          setSettingsForm({
            workingHoursStart: s.working_hours_start || '09:00',
            workingHoursEnd: s.working_hours_end || '18:00',
            meetingDurationMinutes: s.meeting_duration_minutes || 15,
            minimumNoticeHours: s.minimum_notice_hours ?? 2,
            bufferAfterMinutes: s.buffer_after_minutes ?? 10,
            timezone: s.timezone || 'Asia/Kolkata',
            defaultMeetingLink: s.default_meeting_link || '',
          });
          if (s.meeting_duration_minutes) {
            setCreateForm((f) => ({
              ...f,
              durationMinutes: s.meeting_duration_minutes,
            }));
          }
        }
      }

      // 3. Fetch contacts for creation picker
      const { data: contactsData } = await supabase
        .from('contacts')
        .select('*')
        .eq('account_id', accountId)
        .order('name', { ascending: true })
        .limit(100);

      if (contactsData) {
        setContacts(contactsData);
      }
    } catch (err) {
      console.error('Failed to load meetings data:', err);
      toast.error('Failed to load meetings. Please check connection.');
    } finally {
      setLoading(false);
    }
  }, [accountId, supabase, fetchGoogleCalendars]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // KPIs
  const kpis = useMemo(() => {
    const total = meetings.length;
    const upcoming = meetings.filter(
      (m) =>
        (m.status === 'confirmed' || m.status === 'scheduled') &&
        new Date(m.start_time) >= new Date()
    ).length;
    const completed = meetings.filter((m) => m.status === 'completed').length;
    const cancelled = meetings.filter((m) => m.status === 'cancelled').length;
    return { total, upcoming, completed, cancelled };
  }, [meetings]);

  // Filtered Meetings
  const filteredMeetings = useMemo(() => {
    return meetings.filter((m) => {
      // Status filter
      if (statusFilter === 'upcoming') {
        if (
          !(m.status === 'confirmed' || m.status === 'scheduled') ||
          new Date(m.start_time) < new Date()
        ) {
          return false;
        }
      } else if (statusFilter !== 'all' && m.status !== statusFilter) {
        return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const contactName = m.contact?.name?.toLowerCase() || '';
        const contactPhone = m.contact?.phone?.toLowerCase() || '';
        const title = m.title?.toLowerCase() || '';
        const service = m.service_requested?.toLowerCase() || '';
        return (
          contactName.includes(q) ||
          contactPhone.includes(q) ||
          title.includes(q) ||
          service.includes(q)
        );
      }

      return true;
    });
  }, [meetings, statusFilter, searchQuery]);

  // Calendar view week days
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));
  }, [currentWeekStart]);

  // Handle Manual Meeting Creation
  const handleCreateMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.contactId || !createForm.startTime) {
      toast.error('Please select a contact and start date/time');
      return;
    }

    setSubmittingCreate(true);
    try {
      const res = await fetch('/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: createForm.contactId,
          title: createForm.title,
          serviceRequested: createForm.serviceRequested,
          startTime: new Date(createForm.startTime).toISOString(),
          durationMinutes: Number(createForm.durationMinutes) || 15,
          description: createForm.description,
          meetingLink: createForm.meetingLink || undefined,
          timezone: settings?.timezone || 'Asia/Kolkata',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create meeting');
      }

      toast.success('Meeting scheduled successfully!');
      setCreateModalOpen(false);
      setCreateForm({
        contactId: '',
        title: 'OPSIYS Discovery Meeting',
        serviceRequested: 'AI Automation',
        startTime: '',
        durationMinutes: settings?.meeting_duration_minutes || 15,
        description: '',
        meetingLink: '',
      });
      fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to schedule';
      toast.error(msg);
    } finally {
      setSubmittingCreate(false);
    }
  };

  // Handle Reschedule
  const handleReschedule = async () => {
    if (!selectedMeeting || !newStartTime) return;
    setSubmittingReschedule(true);
    try {
      const res = await fetch(`/api/meetings/${selectedMeeting.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startTime: new Date(newStartTime).toISOString(),
          durationMinutes: selectedMeeting.duration_minutes || 15,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Reschedule failed');
      }

      toast.success('Meeting rescheduled successfully!');
      setRescheduleModalOpen(false);
      setSelectedMeeting(null);
      setNewStartTime('');
      fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to reschedule';
      toast.error(msg);
    } finally {
      setSubmittingReschedule(false);
    }
  };

  // Handle Cancel
  const handleCancel = async () => {
    if (!selectedMeeting) return;
    setSubmittingCancel(true);
    try {
      const res = await fetch(`/api/meetings/${selectedMeeting.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: cancelReason || 'Cancelled by team member',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Cancellation failed');
      }

      toast.success('Meeting cancelled successfully');
      setCancelModalOpen(false);
      setSelectedMeeting(null);
      setCancelReason('');
      fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to cancel';
      toast.error(msg);
    } finally {
      setSubmittingCancel(false);
    }
  };

  // Mark Completed
  const handleMarkCompleted = async (meeting: MeetingWithContact) => {
    try {
      const res = await fetch(`/api/meetings/${meeting.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      });
      if (!res.ok) throw new Error('Status update failed');
      toast.success('Meeting marked as completed');
      fetchData();
    } catch {
      toast.error('Failed to update status');
    }
  };

  // Auto-fetch calendars when settings modal opens and Google Calendar is active
  useEffect(() => {
    if (
      settingsModalOpen &&
      settings?.google_calendar_enabled &&
      settings?.google_calendar_status !== 'expired' &&
      settings?.google_calendar_status !== 'error'
    ) {
      fetchGoogleCalendars();
    }
  }, [
    settingsModalOpen,
    settings?.google_calendar_enabled,
    settings?.google_calendar_status,
    fetchGoogleCalendars,
  ]);

  // Handle Connect Google Calendar
  const handleConnectGoogle = async () => {
    try {
      const res = await fetch('/api/meetings/google/auth');
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        const errMsg = data.error || 'Failed to start Google OAuth';
        if (errMsg.includes('GOOGLE_CLIENT_ID')) {
          toast.error(
            'Google Calendar integration requires platform setup. The system administrator must configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the deployment environment.',
            { duration: 6000 }
          );
        } else {
          toast.error(errMsg);
        }
      }
    } catch {
      toast.error('Failed to initialize Google authentication');
    }
  };

  const handleSelectCalendar = async (calId: string) => {
    setSelectedCalendarId(calId);
    try {
      const res = await fetch('/api/meetings/google/calendar', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calendarId: calId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update calendar selection');
      }
      toast.success('Calendar selection updated successfully');
      setSettings((prev) => (prev ? { ...prev, google_calendar_calendar_id: calId } : null));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update calendar');
    }
  };

  const handleDisconnectGoogle = async () => {
    if (
      !confirm(
        'Are you sure you want to disconnect Google Calendar? External conflicts will no longer be checked and automatic Google Meet links will be disabled.'
      )
    ) {
      return;
    }
    setDisconnectingGoogle(true);
    try {
      const res = await fetch('/api/meetings/google', { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        setGoogleCalendars([]);
        setSelectedCalendarId('primary');
        toast.success(data.message || 'Google Calendar disconnected');
        fetchData();
      } else {
        toast.error(data.error || 'Failed to disconnect Google Calendar');
      }
    } catch {
      toast.error('Failed to disconnect Google Calendar');
    } finally {
      setDisconnectingGoogle(false);
    }
  };

  // Handle Save Availability Rules
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const res = await fetch('/api/meetings/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsForm),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save availability rules');
      }
      toast.success('Availability rules saved!');
      if (data.settings) {
        setSettings(data.settings);
      }
      setSettingsModalOpen(false);
      fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save rules';
      toast.error(msg);
    } finally {
      setSavingSettings(false);
    }
  };

  // Helper for Status Badge
  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'confirmed':
        return (
          <Badge variant="success" className="flex items-center gap-1 font-medium">
            <CheckCircle2 className="w-3 h-3" /> Confirmed
          </Badge>
        );
      case 'scheduled':
        return (
          <Badge variant="info" className="flex items-center gap-1 font-medium">
            <Clock className="w-3 h-3" /> Scheduled
          </Badge>
        );
      case 'completed':
        return (
          <Badge variant="neutral" className="flex items-center gap-1 font-medium">
            <Check className="w-3 h-3" /> Completed
          </Badge>
        );
      case 'cancelled':
        return (
          <Badge variant="error" className="flex items-center gap-1 font-medium">
            <XCircle className="w-3 h-3" /> Cancelled
          </Badge>
        );
      case 'rescheduled':
        return (
          <Badge variant="pending" className="flex items-center gap-1 font-medium">
            <RefreshCw className="w-3 h-3" /> Rescheduled
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="flex-1 space-y-6 p-6">
      {/* Top Banner / Google Calendar & Availability Status */}
      {settings?.google_calendar_enabled &&
      settings?.google_calendar_status !== 'expired' &&
      settings?.google_calendar_status !== 'error' ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
          <div className="flex items-start sm:items-center gap-2.5">
            <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-600 animate-pulse mt-1 sm:mt-0 shrink-0" />
            <div>
              <p className="font-medium">
                <strong className="font-semibold text-emerald-950">Google Calendar Connected:</strong>{' '}
                Synchronized with {settings.google_calendar_email || 'Google Calendar'} (
                {settings.google_calendar_calendar_id &&
                settings.google_calendar_calendar_id !== 'primary'
                  ? settings.google_calendar_calendar_id
                  : 'Primary Calendar'}
                ). External conflicts are checked in real time and Google Meet links are generated automatically.
              </p>
              <p className="text-xs text-emerald-800 mt-0.5">
                Availability Source: Google Calendar + Native Rules ({settings.timezone || 'Asia/Kolkata'})
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs border-emerald-300 text-emerald-800 hover:bg-emerald-100 bg-white"
              onClick={() => setSettingsModalOpen(true)}
            >
              Availability Rules
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={disconnectingGoogle}
              className="h-8 text-xs text-rose-700 hover:bg-rose-100/60 hover:text-rose-800"
              onClick={handleDisconnectGoogle}
            >
              {disconnectingGoogle ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          </div>
        </div>
      ) : settings?.google_calendar_status === 'expired' ||
        settings?.google_calendar_status === 'error' ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-sm text-rose-950">
          <div className="flex items-start sm:items-center gap-2.5">
            <span className="flex h-2.5 w-2.5 rounded-full bg-rose-600 mt-1 sm:mt-0 shrink-0" />
            <div>
              <p className="font-medium">
                <strong className="font-semibold text-rose-950">
                  {settings?.google_calendar_status === 'error'
                    ? 'Google Calendar Synchronization Error:'
                    : 'Google Calendar Authorization Expired:'}
                </strong>{' '}
                Google access requires reconnection for{' '}
                {settings.google_calendar_email || 'your workspace account'}.
              </p>
              <p className="text-xs text-rose-800 mt-0.5">
                Reconnect your Google account to restore calendar conflict checks and Google Meet links.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
            <Button
              size="sm"
              className="h-8 text-xs bg-rose-600 hover:bg-rose-700 text-white font-medium shadow-sm"
              onClick={handleConnectGoogle}
            >
              Reconnect Google
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={disconnectingGoogle}
              className="h-8 text-xs border-rose-300 text-rose-800 bg-white hover:bg-rose-50"
              onClick={handleDisconnectGoogle}
            >
              {disconnectingGoogle ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-xl border border-primary/20 bg-primary-soft px-4 py-3 text-sm text-foreground">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-primary shrink-0" />
            <p>
              <strong className="font-semibold text-primary">Native Booking Active:</strong> Connect
              Google Calendar for real-time 2-way availability sync and instant Google Meet video
              room links.
            </p>
          </div>
          <Button
            size="sm"
            className="h-8 text-xs bg-primary hover:bg-primary-hover text-primary-foreground font-medium"
            onClick={handleConnectGoogle}
          >
            Connect Google Calendar
          </Button>
        </div>
      )}

      {/* Header & Primary Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <CalendarIcon className="w-6 h-6 text-primary" />
            Meetings & Appointments
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage OPSIYS discovery calls, WhatsApp AI bookings, and calendar availability.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 text-xs font-medium"
            onClick={() => setSettingsModalOpen(true)}
          >
            <SettingsIcon className="w-3.5 h-3.5" />
            Availability Rules
          </Button>

          <Button
            size="sm"
            className="h-9 gap-1.5 text-xs font-medium bg-primary hover:bg-primary/90"
            onClick={() => setCreateModalOpen(true)}
          >
            <CalendarPlus className="w-3.5 h-3.5" />
            Schedule Meeting
          </Button>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card border-border shadow-xs">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium">
              Total Meetings
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-foreground">{kpis.total}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-muted-foreground">
            All recorded appointments
          </CardContent>
        </Card>

        <Card className="bg-card border-border shadow-xs">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium text-[#15803D]">
              Upcoming / Confirmed
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-[#15803D]">{kpis.upcoming}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-muted-foreground">
            Next scheduled discovery calls
          </CardContent>
        </Card>

        <Card className="bg-card border-border shadow-xs">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium text-primary">
              Completed Calls
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-primary">{kpis.completed}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-muted-foreground">
            Conducted by sales team
          </CardContent>
        </Card>

        <Card className="bg-card border-border shadow-xs">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium text-[#B91C1C]">
              Cancelled
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-[#B91C1C]">{kpis.cancelled}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-muted-foreground">
            Client or agent cancellations
          </CardContent>
        </Card>
      </div>

      {/* Filter and View Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 pt-2">
        <div className="flex flex-1 items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by lead, phone, service..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-xs bg-muted/40"
            />
          </div>

          {/* Status Tabs */}
          <Tabs
            value={statusFilter}
            onValueChange={setStatusFilter}
            className="hidden sm:inline-block"
          >
            <TabsList className="h-9 p-0.5 bg-muted/60">
              <TabsTrigger value="all" className="text-xs px-3">
                All
              </TabsTrigger>
              <TabsTrigger value="upcoming" className="text-xs px-3">
                Upcoming
              </TabsTrigger>
              <TabsTrigger value="completed" className="text-xs px-3">
                Completed
              </TabsTrigger>
              <TabsTrigger value="cancelled" className="text-xs px-3">
                Cancelled
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* View Switch: List vs Calendar */}
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
            <Button
              variant={viewMode === 'list' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8 px-2.5 text-xs gap-1"
              onClick={() => setViewMode('list')}
            >
              <List className="w-3.5 h-3.5" />
              List
            </Button>
            <Button
              variant={viewMode === 'calendar' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8 px-2.5 text-xs gap-1"
              onClick={() => setViewMode('calendar')}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              Calendar
            </Button>
          </div>
        </div>
      </div>

      {/* Content Area */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <RefreshCw className="h-8 w-8 animate-spin text-primary mb-3" />
          <p className="text-sm text-muted-foreground">Loading meetings & calendar schedules...</p>
        </div>
      ) : filteredMeetings.length === 0 ? (
        <Card className="border-dashed py-14 text-center">
          <CardContent className="flex flex-col items-center justify-center space-y-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <CalendarIcon className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold text-base">No meetings found</h3>
              <p className="text-xs text-muted-foreground max-w-sm">
                No meetings match your current filter. Meetings booked by WhatsApp AI or scheduled
                manually will appear here.
              </p>
            </div>
            <Button
              size="sm"
              className="text-xs bg-primary hover:bg-primary/90 mt-2"
              onClick={() => setCreateModalOpen(true)}
            >
              <CalendarPlus className="w-3.5 h-3.5 mr-1.5" />
              Schedule a Meeting
            </Button>
          </CardContent>
        </Card>
      ) : viewMode === 'list' ? (
        /* LIST VIEW */
        <div className="space-y-3">
          {filteredMeetings.map((meeting) => {
            const start = parseISO(meeting.start_time);
            const isTodayMeeting = isToday(start);
            const isTomorrowMeeting = isTomorrow(start);

            return (
              <Card
                key={meeting.id}
                className="overflow-hidden border-border bg-card shadow-xs hover:border-primary/40 transition-all"
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between p-4 sm:p-5 gap-4">
                  {/* Left: Date / Time Strip */}
                  <div className="flex items-start gap-4">
                    <div className="flex flex-col items-center justify-center w-14 h-14 rounded-xl bg-primary-soft border border-primary/20 text-center shrink-0">
                      <span className="text-[10px] uppercase font-bold text-primary">
                        {format(start, 'MMM')}
                      </span>
                      <span className="text-lg font-extrabold text-foreground leading-none">
                        {format(start, 'd')}
                      </span>
                      <span className="text-[9px] text-muted-foreground font-medium">
                        {format(start, 'EEE')}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-foreground">{meeting.title}</h3>
                        {renderStatusBadge(meeting.status)}
                        {meeting.booking_source === 'whatsapp_ai' && (
                          <Badge
                            variant="secondary"
                            className="bg-primary-soft text-primary border-primary/20 text-[10px] gap-1"
                          >
                            <Bot className="w-2.5 h-2.5" /> WhatsApp AI
                          </Badge>
                        )}
                        {isTodayMeeting && (
                          <Badge variant="success" className="text-[10px]">Today</Badge>
                        )}
                        {isTomorrowMeeting && (
                          <Badge variant="outline" className="text-[10px]">
                            Tomorrow
                          </Badge>
                        )}
                      </div>

                      {/* Time & Duration */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1 font-medium text-foreground">
                          <Clock className="w-3.5 h-3.5 text-primary" />
                          {format(start, 'hh:mm a')} –{' '}
                          {format(parseISO(meeting.end_time), 'hh:mm a')} ({meeting.duration_minutes}{' '}
                          mins)
                        </span>
                        <span>Timezone: {meeting.timezone}</span>
                        {meeting.service_requested && (
                          <span className="flex items-center gap-1 text-primary">
                            <Sparkles className="w-3 h-3" />
                            {meeting.service_requested}
                          </span>
                        )}
                      </div>

                      {/* Lead Contact Info */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground pt-0.5">
                        <span className="flex items-center gap-1 font-medium text-foreground">
                          <User className="w-3.5 h-3.5 text-muted-foreground" />
                          {meeting.contact?.name || 'Customer'}
                        </span>
                        {meeting.contact?.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="w-3 h-3" />
                            {meeting.contact.phone}
                          </span>
                        )}
                        {meeting.contact?.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="w-3 h-3" />
                            {meeting.contact.email}
                          </span>
                        )}
                      </div>

                      {/* AI Qualification summary if available */}
                      {meeting.qualification?.qualification_summary && (
                        <div className="mt-2 rounded-md bg-muted/40 p-2 text-xs text-muted-foreground border border-border/40">
                          <strong className="text-foreground">AI Lead Note: </strong>
                          {meeting.qualification.qualification_summary}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right: Actions & Video Link */}
                  <div className="flex flex-wrap items-center gap-2 pt-2 lg:pt-0 lg:border-l lg:border-border/60 lg:pl-5">
                    {meeting.meeting_link && (
                      <a
                        href={meeting.meeting_link}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary hover:bg-primary-hover text-white shadow-xs transition-colors"
                      >
                        <Video className="w-3.5 h-3.5" />
                        Join Meeting
                        <ExternalLink className="w-3 h-3 ml-0.5 opacity-80" />
                      </a>
                    )}

                    {meeting.conversation_id && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs gap-1 border-border/80"
                        onClick={() => router.push(`/inbox?conversationId=${meeting.conversation_id}`)}
                      >
                        <MessageSquare className="w-3.5 h-3.5 text-primary" />
                        WhatsApp Chat
                      </Button>
                    )}

                    {meeting.status !== 'completed' && meeting.status !== 'cancelled' && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            setSelectedMeeting(meeting);
                            setNewStartTime(format(start, "yyyy-MM-dd'T'HH:mm"));
                            setRescheduleModalOpen(true);
                          }}
                        >
                          Reschedule
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs text-[#15803D] hover:text-[#166534] hover:bg-emerald-50"
                          onClick={() => handleMarkCompleted(meeting)}
                        >
                          Mark Done
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs text-[#B91C1C] hover:text-[#991B1B] hover:bg-rose-50"
                          onClick={() => {
                            setSelectedMeeting(meeting);
                            setCancelModalOpen(true);
                          }}
                        >
                          Cancel
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        /* CALENDAR VIEW (WEEKLY GRID) */
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <CalendarIcon className="w-4 h-4 text-primary" />
              Week of {format(currentWeekStart, 'MMMM d, yyyy')}
            </h2>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setCurrentWeekStart((d) => addDays(d, -7))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2.5 text-xs"
                onClick={() =>
                  setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))
                }
              >
                Today
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setCurrentWeekStart((d) => addDays(d, 7))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
            {weekDays.map((day) => {
              const dayMeetings = filteredMeetings.filter((m) =>
                isSameDay(parseISO(m.start_time), day)
              );
              const isTodayDay = isToday(day);

              return (
                <div
                  key={day.toISOString()}
                  className={`rounded-xl border p-3 min-h-[220px] flex flex-col ${
                    isTodayDay
                      ? 'border-primary/50 bg-primary-soft/50 shadow-xs'
                      : 'border-border bg-card shadow-xs'
                  }`}
                >
                  <div className="flex items-center justify-between pb-2 border-b border-border/40 mb-2">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">
                      {format(day, 'EEE')}
                    </span>
                    <span
                      className={`text-sm font-bold flex h-6 w-6 items-center justify-center rounded-full ${
                        isTodayDay ? 'bg-primary text-primary-foreground' : 'text-foreground'
                      }`}
                    >
                      {format(day, 'd')}
                    </span>
                  </div>

                  <div className="space-y-2 flex-1">
                    {dayMeetings.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground/60 italic pt-2">
                        No meetings
                      </p>
                    ) : (
                      dayMeetings.map((m) => (
                        <div
                          key={m.id}
                          className="rounded-lg border border-border bg-muted/40 p-2 text-xs space-y-1 hover:border-primary/50 transition-colors cursor-pointer"
                          onClick={() => {
                            setSelectedMeeting(m);
                            setNewStartTime(
                              format(parseISO(m.start_time), "yyyy-MM-dd'T'HH:mm")
                            );
                            setRescheduleModalOpen(true);
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-foreground truncate max-w-[90px]">
                              {m.contact?.name || 'Customer'}
                            </span>
                            <span className="text-[10px] text-primary font-medium">
                              {format(parseISO(m.start_time), 'h:mm a')}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground truncate">{m.title}</p>
                          {m.meeting_link && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-primary font-medium">
                              <Video className="w-2.5 h-2.5" /> Video Call
                            </span>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 1. CREATE MEETING MODAL */}
      {/* ============================================================ */}
      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarPlus className="w-5 h-5 text-primary" />
              Schedule New Meeting
            </DialogTitle>
            <DialogDescription>
              Create an appointment directly for a contact. Synced automatically with Google
              Calendar if connected.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateMeeting} className="space-y-4 pt-2">
            {/* Contact selector */}
            <div className="space-y-1.5">
              <Label className="text-xs">Contact *</Label>
              <Select
                value={createForm.contactId}
                onValueChange={(val) => setCreateForm({ ...createForm, contactId: val || '' })}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Select a contact" />
                </SelectTrigger>
                <SelectContent className="max-h-56">
                  {contacts.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">
                      {c.name || 'Unnamed'} {c.phone ? `(${c.phone})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Title */}
            <div className="space-y-1.5">
              <Label className="text-xs">Meeting Title *</Label>
              <Input
                value={createForm.title}
                onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })}
                className="h-9 text-xs"
                placeholder="e.g. OPSIYS Discovery Meeting"
                required
              />
            </div>

            {/* Service Requested */}
            <div className="space-y-1.5">
              <Label className="text-xs">Service Requested</Label>
              <Select
                value={createForm.serviceRequested}
                onValueChange={(val) => setCreateForm({ ...createForm, serviceRequested: val || '' })}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Select service" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AI Automation" className="text-xs">
                    AI Automation
                  </SelectItem>
                  <SelectItem value="WhatsApp Automation" className="text-xs">
                    WhatsApp Automation
                  </SelectItem>
                  <SelectItem value="Website Development" className="text-xs">
                    Website Development
                  </SelectItem>
                  <SelectItem value="CRM Integration" className="text-xs">
                    CRM Integration
                  </SelectItem>
                  <SelectItem value="Marketing Automation" className="text-xs">
                    Marketing Automation
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Date and Time */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Date & Time *</Label>
                <Input
                  type="datetime-local"
                  value={createForm.startTime}
                  onChange={(e) => setCreateForm({ ...createForm, startTime: e.target.value })}
                  className="h-9 text-xs"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Duration (Minutes)</Label>
                <Select
                  value={String(createForm.durationMinutes)}
                  onValueChange={(val) =>
                    setCreateForm({ ...createForm, durationMinutes: Number(val || 15) })
                  }
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15" className="text-xs">
                      15 minutes
                    </SelectItem>
                    <SelectItem value="30" className="text-xs">
                      30 minutes
                    </SelectItem>
                    <SelectItem value="45" className="text-xs">
                      45 minutes
                    </SelectItem>
                    <SelectItem value="60" className="text-xs">
                      60 minutes
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Notes / Description */}
            <div className="space-y-1.5">
              <Label className="text-xs">Meeting Notes / Agenda</Label>
              <Input
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                className="h-9 text-xs"
                placeholder="Discovery requirements, pain points..."
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCreateModalOpen(false)}
                disabled={submittingCreate}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                className="bg-primary hover:bg-primary/90"
                disabled={submittingCreate}
              >
                {submittingCreate ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" />
                    Booking...
                  </>
                ) : (
                  'Confirm Booking'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ============================================================ */}
      {/* 2. RESCHEDULE MODAL */}
      {/* ============================================================ */}
      <Dialog open={rescheduleModalOpen} onOpenChange={setRescheduleModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-primary" />
              Reschedule Meeting
            </DialogTitle>
            <DialogDescription>
              Select a new date and time for {selectedMeeting?.contact?.name || 'Customer'}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="rounded-lg bg-muted/60 p-3 text-xs space-y-1 border border-border">
              <p className="font-semibold text-foreground">{selectedMeeting?.title}</p>
              <p className="text-muted-foreground">
                Current Time:{' '}
                {selectedMeeting &&
                  format(parseISO(selectedMeeting.start_time), 'EEEE, MMMM d, yyyy hh:mm a')}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">New Date & Time *</Label>
              <Input
                type="datetime-local"
                value={newStartTime}
                onChange={(e) => setNewStartTime(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRescheduleModalOpen(false)}
                disabled={submittingReschedule}
              >
                Back
              </Button>
              <Button
                type="button"
                size="sm"
                className="bg-primary hover:bg-primary/90"
                onClick={handleReschedule}
                disabled={submittingReschedule || !newStartTime}
              >
                {submittingReschedule ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" />
                    Updating...
                  </>
                ) : (
                  'Confirm Reschedule'
                )}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* ============================================================ */}
      {/* 3. CANCEL MODAL */}
      {/* ============================================================ */}
      <Dialog open={cancelModalOpen} onOpenChange={setCancelModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[#B91C1C]">
              <XCircle className="w-5 h-5" />
              Cancel Meeting
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel this appointment? The calendar event will be removed.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Reason for Cancellation</Label>
              <Input
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="e.g. Client requested cancellation via phone"
                className="h-9 text-xs"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCancelModalOpen(false)}
                disabled={submittingCancel}
              >
                Keep Meeting
              </Button>
              <Button
                type="button"
                size="sm"
                className="bg-[#B91C1C] hover:bg-[#991B1B] text-white"
                onClick={handleCancel}
                disabled={submittingCancel}
              >
                {submittingCancel ? 'Cancelling...' : 'Confirm Cancellation'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* ============================================================ */}
      {/* 4. SETTINGS MODAL */}
      {/* ============================================================ */}
      <Dialog open={settingsModalOpen} onOpenChange={setSettingsModalOpen}>
        <DialogContent className="max-w-lg">
          <form onSubmit={handleSaveSettings}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <SettingsIcon className="w-5 h-5 text-primary" />
                Availability &amp; Scheduling Rules
              </DialogTitle>
              <DialogDescription>
                Configure working hours, durations, booking notice, buffers, and Google Calendar sync.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 pt-3 text-xs">
              {/* Google Sync Status */}
              <div className="rounded-xl border border-border/80 bg-muted/40 p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h4 className="font-semibold text-foreground text-sm">Google Calendar Integration</h4>
                    <p className="text-muted-foreground text-xs mt-0.5">
                      {settings?.google_calendar_enabled &&
                      settings?.google_calendar_status !== 'expired' &&
                      settings?.google_calendar_status !== 'error'
                        ? `Connected (${settings.google_calendar_email || 'Primary Calendar'}) — 2-way sync active`
                        : settings?.google_calendar_status === 'expired' ||
                            settings?.google_calendar_status === 'error'
                          ? `Authorization requires reconnection for ${settings.google_calendar_email || 'Google account'}.`
                          : 'Not connected. Operating on native availability rules.'}
                    </p>
                  </div>
                  {settings?.google_calendar_enabled &&
                  settings?.google_calendar_status !== 'expired' &&
                  settings?.google_calendar_status !== 'error' ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="success">Active</Badge>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={disconnectingGoogle}
                        className="h-7 text-xs text-rose-600 hover:text-rose-700 border-rose-200"
                        onClick={handleDisconnectGoogle}
                      >
                        {disconnectingGoogle ? 'Disconnecting...' : 'Disconnect'}
                      </Button>
                    </div>
                  ) : settings?.google_calendar_status === 'expired' ||
                    settings?.google_calendar_status === 'error' ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="error">
                        {settings?.google_calendar_status === 'error' ? 'Error' : 'Expired'}
                      </Badge>
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 text-xs bg-primary hover:bg-primary/90"
                        onClick={handleConnectGoogle}
                      >
                        Reconnect
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={disconnectingGoogle}
                        className="h-7 text-xs text-rose-600 hover:text-rose-700 border-rose-200"
                        onClick={handleDisconnectGoogle}
                      >
                        Disconnect
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 text-xs bg-primary hover:bg-primary/90"
                      onClick={handleConnectGoogle}
                    >
                      Connect
                    </Button>
                  )}
                </div>

                {settings?.google_calendar_enabled &&
                  settings?.google_calendar_status !== 'expired' &&
                  settings?.google_calendar_status !== 'error' && (
                    <div className="pt-2.5 mt-2 border-t border-border/50 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium text-foreground">Synchronized Calendar</Label>
                        {loadingCalendars && (
                          <span className="text-[10px] text-muted-foreground animate-pulse">
                            Loading calendars...
                          </span>
                        )}
                      </div>
                      <select
                        value={selectedCalendarId}
                        disabled={loadingCalendars}
                        onChange={(e) => handleSelectCalendar(e.target.value)}
                        className="w-full h-8 text-xs rounded-md border border-input bg-background px-2.5 py-1 text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      >
                        {googleCalendars.length > 0 ? (
                          googleCalendars.map((cal) => (
                            <option key={cal.id} value={cal.id}>
                              {cal.summary} {cal.primary ? '(Primary)' : ''}
                            </option>
                          ))
                        ) : (
                          <option value={selectedCalendarId || 'primary'}>
                            {selectedCalendarId === 'primary' ? 'Primary Calendar' : selectedCalendarId}
                          </option>
                        )}
                      </select>
                      <p className="text-[11px] text-muted-foreground">
                        Meetings booked via WhatsApp AI and manual scheduling sync directly with this calendar. External events on this calendar block booking slots.
                      </p>
                    </div>
                  )}
              </div>

              {/* Timezone */}
              <div className="space-y-1.5">
                <Label className="text-xs">Business Timezone</Label>
                <Input
                  value={settingsForm.timezone}
                  onChange={(e) => setSettingsForm((f) => ({ ...f, timezone: e.target.value }))}
                  className="h-9 text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  IANA timezone (e.g. Asia/Kolkata). Customer slots are computed and formatted in this timezone.
                </p>
              </div>

              {/* Working Hours & Duration */}
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Start Hour</Label>
                  <Input
                    type="time"
                    value={settingsForm.workingHoursStart}
                    onChange={(e) =>
                      setSettingsForm((f) => ({ ...f, workingHoursStart: e.target.value }))
                    }
                    className="h-9 text-xs"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">End Hour</Label>
                  <Input
                    type="time"
                    value={settingsForm.workingHoursEnd}
                    onChange={(e) =>
                      setSettingsForm((f) => ({ ...f, workingHoursEnd: e.target.value }))
                    }
                    className="h-9 text-xs"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Duration (mins)</Label>
                  <Input
                    type="number"
                    min="5"
                    max="180"
                    step="5"
                    value={settingsForm.meetingDurationMinutes}
                    onChange={(e) =>
                      setSettingsForm((f) => ({
                        ...f,
                        meetingDurationMinutes: parseInt(e.target.value, 10) || 15,
                      }))
                    }
                    className="h-9 text-xs"
                    required
                  />
                </div>
              </div>

              {/* Notice & Buffers */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Minimum Notice (hours)</Label>
                  <Input
                    type="number"
                    min="0"
                    max="72"
                    value={settingsForm.minimumNoticeHours}
                    onChange={(e) =>
                      setSettingsForm((f) => ({
                        ...f,
                        minimumNoticeHours: parseInt(e.target.value, 10) || 0,
                      }))
                    }
                    className="h-9 text-xs"
                    required
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Prevents booking slots too close to current time.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Buffer After Meeting (mins)</Label>
                  <Input
                    type="number"
                    min="0"
                    max="60"
                    step="5"
                    value={settingsForm.bufferAfterMinutes}
                    onChange={(e) =>
                      setSettingsForm((f) => ({
                        ...f,
                        bufferAfterMinutes: parseInt(e.target.value, 10) || 0,
                      }))
                    }
                    className="h-9 text-xs"
                    required
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Rest buffer between consecutive appointments.
                  </p>
                </div>
              </div>

              {/* Default Meeting Link */}
              <div className="space-y-1.5">
                <Label className="text-xs">Default Meeting Link (Native Bookings)</Label>
                <Input
                  type="text"
                  placeholder="e.g. https://meet.google.com/your-room or https://zoom.us/j/..."
                  value={settingsForm.defaultMeetingLink}
                  onChange={(e) =>
                    setSettingsForm((f) => ({ ...f, defaultMeetingLink: e.target.value }))
                  }
                  className="h-9 text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  Used for native bookings when Google Calendar is not connected.
                </p>
              </div>
            </div>

            <DialogFooter className="pt-4">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setSettingsModalOpen(false)}
                disabled={savingSettings}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
                disabled={savingSettings}
              >
                {savingSettings ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
