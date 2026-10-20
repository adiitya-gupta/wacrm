"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import Link from "next/link";
import type { Contact, Deal, ContactNote, Tag, Meeting, AiLeadQualification } from "@/types";
import {
  Phone,
  Mail,
  Copy,
  Check,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  Calendar,
  Bot,
  Sparkles,
  Video,
  ExternalLink,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { contactHandle } from "@/lib/whatsapp/wa-identity";

interface ContactSidebarProps {
  contact: Contact | null;
}

export function ContactSidebar({ contact }: ContactSidebarProps) {
  const tSidebar = useTranslations("Inbox.sidebar");
  const tThread = useTranslations("Inbox.messageThread");

  const { accountId } = useAuth();
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [qualification, setQualification] = useState<AiLeadQualification | null>(null);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch deals, notes, tags, meetings, and AI qualification in parallel
    const [dealsRes, notesRes, tagsRes, meetingsRes, qualRes] = await Promise.all([
      supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*)")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
      supabase
        .from("meetings")
        .select("*")
        .eq("contact_id", contact.id)
        .order("start_time", { ascending: false }),
      supabase
        .from("ai_lead_qualifications")
        .select("*")
        .eq("contact_id", contact.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (meetingsRes.data) setMeetings(meetingsRes.data);
    if (qualRes.data) setQualification(qualRes.data);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
  }, [contact]);

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    // Copies whatever the row displays — a BSUID-only contact has no
    // phone number to copy, but its @username still identifies them.
    const handle = contact ? contactHandle(contact) : '';
    if (!handle) return;
    await navigator.clipboard.writeText(handle);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  if (!contact) {
    return (
      <div className="flex h-full w-70 items-center justify-center border-l border-border bg-card">
        <p className="text-sm text-muted-foreground">{tThread("selectConversation")}</p>
      </div>
    );
  }

  const displayName = contact.name || contactHandle(contact);
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex h-full w-70 flex-col border-l border-border bg-card">
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-soft text-lg font-semibold text-primary border border-primary/20">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-xs text-muted-foreground">{contact.company}</p>
            )}
          </div>

          {/* Phone */}
          <div className="mt-4 space-y-2">
            <button
              onClick={handleCopyPhone}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-secondary-text transition-colors hover:bg-muted/70"
            >
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 text-left font-medium">
                {contactHandle(contact)}
              </span>
              {copied ? (
                <Check className="h-3.5 w-3.5 text-primary" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>

            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Tags */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <TagIcon className="h-3 w-3" />
              {tSidebar("tags")}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noTags")}</p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.contact_tag_id}
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* AI Lead Qualification */}
          <div>
            <div className="flex items-center justify-between px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Bot className="h-3.5 w-3.5 text-primary" />
                AI Lead Qualification
              </span>
              {qualification && (
                <Badge
                  variant={
                    qualification.state === "MEETING_BOOKED" ? "success" :
                    qualification.state === "LEAD_QUALIFIED" ? "info" :
                    qualification.state === "HUMAN_HANDOFF" ? "pending" : "neutral"
                  }
                  className="text-[9px] px-1.5 py-0 uppercase font-semibold"
                >
                  {qualification.state.replace("_", " ")}
                </Badge>
              )}
            </div>

            <div className="mt-2 space-y-2">
              {!qualification ? (
                <p className="px-1 text-xs text-muted-foreground">No AI qualification data yet</p>
              ) : (
                <div className="rounded-lg bg-card p-2.5 text-xs space-y-1.5 border border-border shadow-xs">
                  {qualification.requested_service && (
                    <div className="flex items-center justify-between text-foreground">
                      <span className="text-muted-foreground">Service:</span>
                      <span className="font-medium flex items-center gap-1 text-primary">
                        <Sparkles className="w-2.5 h-2.5" />
                        {qualification.requested_service}
                      </span>
                    </div>
                  )}

                  {qualification.business_type && (
                    <div className="flex items-center justify-between text-foreground">
                      <span className="text-muted-foreground">Business:</span>
                      <span className="font-medium">{qualification.business_type}</span>
                    </div>
                  )}

                  {qualification.urgency && (
                    <div className="flex items-center justify-between text-foreground">
                      <span className="text-muted-foreground">Timeline:</span>
                      <span className="font-medium">{qualification.urgency}</span>
                    </div>
                  )}

                  {qualification.budget && (
                    <div className="flex items-center justify-between text-foreground">
                      <span className="text-muted-foreground">Budget:</span>
                      <span className="font-medium">{qualification.budget}</span>
                    </div>
                  )}

                  {qualification.qualification_notes && (
                    <div className="mt-1 pt-1.5 border-t border-border/40 text-[11px] text-muted-foreground">
                      <strong className="text-foreground">Summary: </strong>
                      {qualification.qualification_notes}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Meetings & Appointments */}
          <div>
            <div className="flex items-center justify-between px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-primary" />
                Meetings
              </span>
              <Link
                href="/meetings"
                className="text-[10px] text-primary hover:underline flex items-center gap-0.5 normal-case font-medium"
              >
                All <ExternalLink className="w-2.5 h-2.5" />
              </Link>
            </div>

            <div className="mt-2 space-y-2">
              {meetings.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">No meetings booked yet</p>
              ) : (
                meetings.map((m) => (
                  <div
                    key={m.id}
                    className="rounded-lg bg-card p-2.5 text-xs space-y-1.5 border border-border shadow-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-foreground truncate max-w-[140px]">
                        {m.title}
                      </span>
                      <Badge
                        variant={
                          m.status === "confirmed" ? "success" :
                          m.status === "scheduled" ? "info" :
                          m.status === "cancelled" ? "error" : "neutral"
                        }
                        className="text-[9px] px-1.5 py-0 uppercase font-semibold"
                      >
                        {m.status}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Clock className="w-3 h-3 text-primary" />
                      {format(new Date(m.start_time), "MMM d, yyyy h:mm a")}
                    </div>

                    {m.meeting_link && (
                      <div className="pt-1">
                        <a
                          href={m.meeting_link}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:text-primary-hover transition-colors"
                        >
                          <Video className="w-3 h-3" />
                          Join Call
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Active Deals */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <DollarSign className="h-3 w-3" />
              {tSidebar("deals")}
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noDeals")}</p>
              ) : (
                deals.map((deal) => (
                  <div
                    key={deal.id}
                    className="rounded-lg border border-border bg-card px-3 py-2 shadow-xs"
                  >
                    <p className="text-sm font-medium text-foreground">
                      {deal.title}
                    </p>
                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {deal.currency ?? "$"}
                        {deal.value.toLocaleString()}
                      </span>
                      {deal.stage && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: `${deal.stage.color}20`,
                            color: deal.stage.color,
                          }}
                        >
                          {deal.stage.name}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <StickyNote className="h-3 w-3" />
              {tSidebar("notes")}
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={tSidebar("addNotePlaceholder")}
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2 hover:bg-primary-hover"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg border border-border bg-card px-3 py-2 shadow-xs"
                  >
                    <p className="whitespace-pre-wrap text-xs text-secondary-text">
                      {note.note_text}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
