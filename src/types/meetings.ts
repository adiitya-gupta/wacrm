import type { Contact } from "./index";

export type MeetingStatus =
  | "scheduled"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "rescheduled"
  | "no_show";

export type BookingSource = "whatsapp_ai" | "manual" | "web_link";

export type CalendarProvider = "native" | "google_calendar";

export type CalendarSyncStatus = "synced" | "pending" | "failed" | "local_only";

export interface Meeting {
  id: string;
  account_id: string;
  contact_id: string;
  conversation_id: string | null;
  assigned_user_id: string | null;
  title: string;
  description: string | null;
  service_requested: string | null;
  start_time: string;
  end_time: string;
  timezone: string;
  duration_minutes: number;
  status: MeetingStatus;
  meeting_link: string | null;
  booking_source: BookingSource;
  calendar_provider: CalendarProvider;
  calendar_event_id: string | null;
  calendar_sync_status: CalendarSyncStatus;
  lead_summary: string | null;
  cancellation_reason: string | null;
  idempotency_key: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;

  // Joined relations
  contact?: Contact;
  assigned_user?: {
    id: string;
    full_name?: string | null;
    email?: string | null;
  };
}

export interface SchedulingSettings {
  id?: string;
  account_id: string;
  meeting_duration_minutes: number;
  working_days: number[]; // 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 7=Sun
  working_hours_start: string; // '09:00'
  working_hours_end: string; // '18:00'
  timezone: string; // 'Asia/Kolkata'
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  minimum_notice_hours: number;
  max_advance_days: number;
  google_calendar_enabled: boolean;
  google_calendar_email: string | null;
  default_meeting_link: string | null;
  created_at?: string;
  updated_at?: string;
}

export type QualificationState =
  | "NEW_LEAD"
  | "GREETING"
  | "REQUIREMENT_DISCOVERY"
  | "LEAD_QUALIFIED"
  | "MEETING_OFFERED"
  | "SLOT_SELECTION"
  | "MEETING_BOOKED"
  | "HUMAN_HANDOFF"
  | "FOLLOW_UP_REQUIRED"
  | "MEETING_CANCELLED";

export interface TimeSlot {
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  formattedDate: string; // e.g. "Monday, Oct 20, 2026"
  formattedTime: string; // e.g. "3:00 PM"
  timezone: string;
}

export interface AiLeadQualification {
  id: string;
  account_id: string;
  contact_id: string;
  conversation_id: string;
  state: QualificationState;
  business_type: string | null;
  requested_service: string | null;
  pain_points: string | null;
  urgency: string | null;
  budget: string | null;
  qualification_notes: string | null;
  proposed_slots: TimeSlot[];
  selected_slot: string | null;
  meeting_id: string | null;
  message_count: number;
  last_interaction_at: string;
  created_at: string;
  updated_at: string;
}

export interface BookingResult {
  success: boolean;
  meeting_id?: string;
  status?: string;
  start_time?: string;
  end_time?: string;
  meeting_link?: string | null;
  error?: string;
  message?: string;
  is_idempotent_replay?: boolean;
}
