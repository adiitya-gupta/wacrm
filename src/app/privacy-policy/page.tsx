import type { Metadata } from "next";
import Link from "next/link";
import {
  Shield,
  Lock,
  Calendar,
  MessageSquare,
  FileText,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Cpu,
  Database,
  Trash2,
  Mail,
  Building,
} from "lucide-react";
import { LegalHeader } from "@/components/legal/legal-header";
import { LegalFooter } from "@/components/legal/legal-footer";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Privacy Policy for Wattomation by OPSIYS. Learn how we collect, handle, and protect your data, WhatsApp messaging, and Google Calendar OAuth integration.",
  robots: {
    index: true,
    follow: true,
  },
};

export default function PrivacyPolicyPage() {
  const lastUpdated = "November 12, 2026";

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col selection:bg-primary/20 selection:text-primary">
      <LegalHeader activePage="privacy" />

      {/* Hero / Header Section */}
      <section className="relative border-b border-border/60 bg-gradient-to-b from-primary/5 via-background to-background py-16 sm:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <Badge
            variant="outline"
            className="mb-4 border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"
          >
            <Shield className="mr-1.5 h-3.5 w-3.5 inline" /> Legal & Data Protection Notice
          </Badge>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl text-foreground">
            Privacy Policy
          </h1>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
            This Privacy Policy explains how Wattomation by OPSIYS collects, uses, stores, and protects
            information across our WhatsApp automation platform, customer CRM, and Google Calendar integration.
          </p>
          <div className="mt-4 text-xs font-medium text-muted-foreground flex items-center justify-center gap-2">
            <span>Last Updated: {lastUpdated}</span>
            <span>•</span>
            <span>Version 1.3</span>
          </div>
        </div>
      </section>

      {/* Main Content Layout */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-10">
          {/* Table of Contents - Sticky Sidebar on Desktop */}
          <aside className="hidden lg:block lg:col-span-1">
            <div className="sticky top-24 space-y-2 border-r border-border/60 pr-6 text-sm">
              <p className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-3">
                Contents
              </p>
              <nav className="flex flex-col space-y-2 text-muted-foreground">
                <a href="#overview" className="hover:text-primary transition-colors">
                  1. Overview & Scope
                </a>
                <a href="#information-collected" className="hover:text-primary transition-colors">
                  2. Information Collected
                </a>
                <a href="#whatsapp-messaging" className="hover:text-primary transition-colors">
                  3. WhatsApp & AI Data
                </a>
                <a href="#google-calendar" className="hover:text-primary transition-colors text-primary font-medium">
                  4. Google Calendar OAuth
                </a>
                <a href="#security-encryption" className="hover:text-primary transition-colors">
                  5. Security & Encryption
                </a>
                <a href="#third-party-services" className="hover:text-primary transition-colors">
                  6. Third-Party Services
                </a>
                <a href="#retention-deletion" className="hover:text-primary transition-colors">
                  7. Retention & Deletion
                </a>
                <a href="#revocation" className="hover:text-primary transition-colors">
                  8. Disconnect & Revoke
                </a>
                <a href="#user-rights" className="hover:text-primary transition-colors">
                  9. Your Rights & Choices
                </a>
                <a href="#contact" className="hover:text-primary transition-colors">
                  10. Contact Information
                </a>
              </nav>
            </div>
          </aside>

          {/* Policy Text Body */}
          <article className="lg:col-span-3 space-y-12 text-sm sm:text-base leading-relaxed text-foreground/90">
            {/* 1. Overview & Scope */}
            <section id="overview" className="scroll-mt-24 space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground border-b border-border/60 pb-3 flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" /> 1. Overview & Scope
              </h2>
              <p>
                Wattomation is a WhatsApp CRM, AI conversation automation, and consultation scheduling
                platform operated by <strong>OPSIYS</strong> (&ldquo;OPSIYS&rdquo;, &ldquo;Wattomation&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;).
              </p>
              <p>
                This Privacy Policy applies to all individuals and business entities who access or use the Wattomation
                platform, web application, APIs, or website (collectively, the &ldquo;Service&rdquo;), as well as contacts whose
                information is processed by our business customers through the Service.
              </p>
              <p>
                In operating the Service, Wattomation acts primarily as a <strong>data processor</strong> on behalf of our
                business customers (tenants), who act as data controllers determining the purpose and means of
                processing their customer contacts and WhatsApp conversations.
              </p>
            </section>

            {/* 2. Information Collected */}
            <section id="information-collected" className="scroll-mt-24 space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground border-b border-border/60 pb-3 flex items-center gap-2">
                <Database className="h-5 w-5 text-primary" /> 2. Information We Collect
              </h2>
              <p>We collect information in the following categories to provide and maintain the Service:</p>
              <div className="space-y-4 pt-2">
                <div className="rounded-lg border border-border/80 bg-card p-4 space-y-1.5">
                  <h3 className="font-semibold text-foreground text-base">A. Account and Registration Information</h3>
                  <p className="text-sm text-muted-foreground">
                    When an account is created, we collect details including full name, business email address,
                    organization/workspace name, authentication credentials, and account role (Owner, Admin, Agent, or Viewer).
                  </p>
                </div>

                <div className="rounded-lg border border-border/80 bg-card p-4 space-y-1.5">
                  <h3 className="font-semibold text-foreground text-base">B. Customer and Contact CRM Records</h3>
                  <p className="text-sm text-muted-foreground">
                    Businesses maintain contact records in Wattomation. This data includes customer names, WhatsApp-enabled
                    phone numbers, optional email addresses, pipeline stages, custom tags, and internal agent notes uploaded
                    by the business or captured via website integrations.
                  </p>
                </div>

                <div className="rounded-lg border border-border/80 bg-card p-4 space-y-1.5">
                  <h3 className="font-semibold text-foreground text-base">C. Billing and Subscription Information</h3>
                  <p className="text-sm text-muted-foreground">
                    Billing details (subscription tier, billing contact, and transaction or gateway reference IDs)
                    are processed through third-party payment gateways (such as Razorpay or Stripe).
                    <strong> Wattomation never collects or stores full credit card numbers, debit card numbers, or CVVs.</strong>
                  </p>
                </div>

                <div className="rounded-lg border border-border/80 bg-card p-4 space-y-1.5">
                  <h3 className="font-semibold text-foreground text-base">D. System Telemetry and Technical Metadata</h3>
                  <p className="text-sm text-muted-foreground">
                    We collect application diagnostic logs, request metadata, IP addresses, inbound webhook timestamps,
                    and delivery performance metrics solely to monitor platform stability, detect unauthorized access,
                    and troubleshoot integration or message delivery errors.
                  </p>
                </div>
              </div>
            </section>

            {/* 3. WhatsApp Messaging & AI Data */}
            <section id="whatsapp-messaging" className="scroll-mt-24 space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground border-b border-border/60 pb-3 flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-primary" /> 3. WhatsApp Messaging & AI Automation Data
              </h2>
              <p>
                Wattomation integrates with the <strong>Meta WhatsApp Cloud API</strong> to send and receive
                messages on behalf of connected WhatsApp Business Accounts (WABAs):
              </p>
              <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
                <li>
                  <strong className="text-foreground">Message Ingestion & Transmission:</strong> Inbound and outbound message
                  content, media attachments (images, audio, documents), message IDs, delivery status receipts (sent, delivered, read),
                  and interactive replies are ingested, routed, and stored in your workspace inbox.
                </li>
                <li>
                  <strong className="text-foreground">Meta Platform Governance:</strong> Inbound and outbound WhatsApp communications
                  transmit through Meta Platforms, Inc. infrastructure and are subject to Meta&apos;s applicable privacy and WhatsApp Business policies.
                </li>
                <li>
                  <strong className="text-foreground">AI Auto-Reply Processing:</strong> When a workspace enables AI auto-reply features,
                  relevant conversation messages and workspace-configured prompt context are sent via encrypted API requests to the AI
                  provider configured by that workspace (such as OpenAI, Anthropic, or an OpenAI-compatible provider like Cloudflare Workers AI)
                  to generate responses.
                </li>
              </ul>

              <Card className="border-primary/30 bg-primary/5 mt-4">
                <CardContent className="p-4 sm:p-5 flex items-start gap-3">
                  <Cpu className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  <div className="text-sm space-y-1">
                    <p className="font-bold text-foreground">No Platform AI Model Training</p>
                    <p className="text-muted-foreground">
                      OPSIYS does <strong>not</strong> use customer message history, contact records, or Google Calendar data to
                      train AI or machine learning models. When workspaces enable third-party AI inference, conversation context
                      is transmitted to their configured provider strictly to generate the requested response, subject to that provider&apos;s API terms.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </section>

            {/* 4. Google Account & Google Calendar Integration (OAuth Compliance) */}
            <section id="google-calendar" className="scroll-mt-24 space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground border-b border-border/60 pb-3 flex items-center gap-2">
                <Calendar className="h-5 w-5 text-primary" /> 4. Google Account & Google Calendar Integration
              </h2>
              <p>
                Wattomation provides an optional Google Calendar integration allowing workspaces to check real-time availability,
                avoid scheduling conflicts, and synchronize appointments created manually or via WhatsApp AI scheduling flows.
              </p>

              <div className="space-y-4 pt-2">
                <h3 className="font-semibold text-foreground text-base">A. Google OAuth Scopes Requested</h3>
                <p className="text-sm text-muted-foreground">
                  When a workspace administrator connects a Google Account, Wattomation requests authorization strictly for the following scopes:
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="border border-border rounded-lg p-3 bg-card space-y-1">
                    <span className="text-xs font-mono font-semibold text-primary">calendar.events</span>
                    <p className="text-xs text-muted-foreground">
                      Create, update, and delete calendar events on your selected calendar for scheduled consultations.
                    </p>
                  </div>
                  <div className="border border-border rounded-lg p-3 bg-card space-y-1">
                    <span className="text-xs font-mono font-semibold text-primary">calendar.readonly</span>
                    <p className="text-xs text-muted-foreground">
                      Query free/busy intervals to check availability and list your calendars so you can choose which calendar to sync.
                    </p>
                  </div>
                  <div className="border border-border rounded-lg p-3 bg-card sm:col-span-2 space-y-1">
                    <span className="text-xs font-mono font-semibold text-primary">userinfo.email</span>
                    <p className="text-xs text-muted-foreground">
                      Retrieve the connected Google Account email address and account identifier to display active connection status in your workspace.
                    </p>
                  </div>
                </div>

                <h3 className="font-semibold text-foreground text-base pt-2">B. How Calendar Data Is Used</h3>
                <ul className="list-disc pl-6 space-y-2 text-muted-foreground text-sm">
                  <li>
                    <strong className="text-foreground">Availability & Conflict Checks:</strong> When offering booking slots or
                    validating a requested time, Wattomation queries FreeBusy intervals on the workspace&apos;s selected calendar to
                    prevent double-booking. Busy intervals are evaluated transiently and are not archived or shared externally.
                  </li>
                  <li>
                    <strong className="text-foreground">Event Creation & Google Meet Links:</strong> When a consultation is booked,
                    Wattomation sends the appointment summary/title, description (which may include service requested and lead qualification summary),
                    start and end times with timezone, optional attendee email and name when stored on the CRM contact, and a request for a Google Meet conference link.
                  </li>
                  <li>
                    <strong className="text-foreground">Rescheduling & Cancellation:</strong> When an appointment is rescheduled or cancelled
                    in Wattomation, the corresponding Google Calendar event is updated or removed on the synchronized calendar while preserving local workspace history.
                  </li>
                </ul>

                {/* Google Limited Use Disclosure Box */}
                <Card className="border-amber-500/30 bg-amber-500/5 mt-4">
                  <CardContent className="p-4 sm:p-5 space-y-3">
                    <div className="flex items-center gap-2 font-bold text-amber-500 text-base">
                      <AlertCircle className="h-5 w-5 shrink-0" />
                      Google API Services User Data Policy Compliance
                    </div>
                    <p className="text-sm text-foreground/90 leading-relaxed font-medium">
                      Wattomation&apos;s use and transfer to any other app of information received from Google APIs adheres to the{" "}
                      <a
                        href="https://developers.google.com/terms/api-services-user-data-policy"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline text-primary hover:text-primary/80 inline-flex items-center gap-1"
                      >
                        Google API Services User Data Policy
                        <ExternalLink className="h-3 w-3 inline" />
                      </a>
                      , including the <strong>Limited Use</strong> requirements.
                    </p>
                    <div className="text-xs text-muted-foreground space-y-1.5 pt-1">
                      <p>Specifically:</p>
                      <ul className="list-disc pl-5 space-y-1">
                        <li>We <strong>never</strong> use Google Calendar data for advertising, marketing, or behavioral profiling.</li>
                        <li>We <strong>never</strong> sell, rent, or transfer Google Calendar data to data brokers, advertising platforms, or third-party AI training pipelines.</li>
                        <li>We <strong>never</strong> allow human reading of Google Calendar data except with your explicit consent for support/troubleshooting, as necessary for security or abuse prevention, or as required by applicable law.</li>
                      </ul>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </section>

            {/* 5. Security & Encryption */}
            <section id="security-encryption" className="scroll-mt-24 space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground border-b border-border/60 pb-3 flex items-center gap-2">
                <Lock className="h-5 w-5 text-primary" /> 5. Security & Credential Protection
              </h2>
              <p>
                We implement technical and organizational security safeguards designed to protect workspace credentials and data:
              </p>
              <div className="grid gap-4 sm:grid-cols-2 pt-2">
                <div className="border border-border rounded-lg p-4 bg-card space-y-2">
                  <div className="flex items-center gap-2 text-foreground font-semibold">
                    <Lock className="h-4 w-4 text-primary" /> AES-256-GCM Encryption at Rest
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Google OAuth access and refresh tokens, WhatsApp access credentials, AI provider API keys, and
                    encrypted OAuth state parameters are encrypted using AES-256-GCM before storage and kept restricted
                    to server-side administrative contexts.
                  </p>
                </div>
                <div className="border border-border rounded-lg p-4 bg-card space-y-2">
                  <div className="flex items-center gap-2 text-foreground font-semibold">
                    <Database className="h-4 w-4 text-primary" /> Tenant Isolation via Row-Level Security
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Workspace records are partitioned by account ID and protected with PostgreSQL Row-Level Security (RLS)
                    policies and column-level access controls so OAuth tokens are never exposed to client browser queries
                    or other workspaces.
                  </p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground pt-1">
                All network communications between your browser, our application servers, and integrated third-party APIs
                (Google, Meta, Supabase) are protected in transit using HTTPS / TLS encryption.
              </p>
            </section>

            {/* 6. Third-Party Services */}
            <section id="third-party-services" className="scroll-mt-24 space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground border-b border-border/60 pb-3 flex items-center gap-2">
                <Building className="h-5 w-5 text-primary" /> 6. Third-Party Services and Infrastructure Providers
              </h2>
              <p>
                To operate the Service, Wattomation relies on third-party infrastructure and API providers strictly as needed for core functionality:
              </p>
              <div className="border border-border rounded-lg overflow-x-auto">
                <table className="w-full text-left text-xs sm:text-sm">
                  <thead className="bg-muted/50 border-b border-border text-foreground font-semibold">
                    <tr>
                      <th className="p-3">Provider</th>
                      <th className="p-3">Role / Service</th>
                      <th className="p-3">Data Processed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60 text-muted-foreground">
                    <tr>
                      <td className="p-3 font-medium text-foreground">Meta Platforms, Inc.</td>
                      <td className="p-3">WhatsApp Business Cloud API</td>
                      <td className="p-3">Inbound/outbound WhatsApp messages, media, templates, status receipts</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-medium text-foreground">Google LLC</td>
                      <td className="p-3">Google Calendar API & OAuth 2.0</td>
                      <td className="p-3">Authenticated account email, calendar list, free/busy slots, appointment events</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-medium text-foreground">Supabase Inc.</td>
                      <td className="p-3">Managed PostgreSQL Database & Auth</td>
                      <td className="p-3">Account records, CRM data, encrypted tokens/credentials, session authentication</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-medium text-foreground">Vercel Inc.</td>
                      <td className="p-3">Application Hosting & Delivery</td>
                      <td className="p-3">Web requests, API execution, technical runtime logs</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-medium text-foreground">Workspace-Configured AI Providers</td>
                      <td className="p-3">OpenAI, Anthropic, or OpenAI-compatible APIs (e.g., Cloudflare Workers AI)</td>
                      <td className="p-3">Message context submitted for real-time auto-reply generation when AI replies are enabled</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-medium text-foreground">Payment Gateways (Razorpay / Stripe)</td>
                      <td className="p-3">Payment Checkout & Webhooks</td>
                      <td className="p-3">Order/payment identifiers and billing confirmation records</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* 7. Retention & Deletion */}
            <section id="retention-deletion" className="scroll-mt-24 space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground border-b border-border/60 pb-3 flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-primary" /> 7. Data Storage, Retention, and Deletion
              </h2>
              <p>
                We retain workspace records for as long as your account remains active or as necessary to operate the Service,
                maintain scheduling audit history, comply with legal obligations, resolve disputes, and enforce our agreements.
              </p>
              <ul className="list-disc pl-6 space-y-2 text-muted-foreground text-sm">
                <li>
                  <strong className="text-foreground">Google Calendar Integration Purge:</strong> Disconnecting Google Calendar
                  in your dashboard immediately deletes the stored encrypted access token, refresh token, connected email,
                  Google account ID, and custom calendar selection from your workspace settings row and attempts OAuth token revocation with Google.
                </li>
                <li>
                  <strong className="text-foreground">Contact & Record Management:</strong> Workspace members with appropriate
                  permissions can remove contact records from their workspace CRM. Local appointment history and cancellation
                  records remain visible in the workspace schedule audit log unless erased upon account closure request.
                </li>
                <li>
                  <strong className="text-foreground">Workspace Closure & Data Erasure:</strong> Account owners may request
                  workspace closure and permanent deletion of stored workspace data by emailing{" "}
                  <a href="mailto:contact@opsiys.in" className="underline text-primary hover:text-primary/80">
                    contact@opsiys.in
                  </a>
                  .
                </li>
              </ul>
            </section>

            {/* 8. Disconnect Google Calendar & Revoke Permissions */}
            <section id="revocation" className="scroll-mt-24 space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground border-b border-border/60 pb-3 flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-primary" /> 8. How to Disconnect Google Calendar and Revoke Permissions
              </h2>
              <p>
                You retain full control over your connected Google Account at all times. Workspace administrators can
                disconnect Wattomation and revoke calendar access through either of the following methods:
              </p>

              <div className="space-y-4 pt-2">
                <div className="border border-border rounded-lg p-4 bg-card space-y-2">
                  <h3 className="font-semibold text-foreground text-base">Method 1: In-App Disconnection (Instant)</h3>
                  <ol className="list-decimal pl-5 space-y-1.5 text-sm text-muted-foreground">
                    <li>Log in to your Wattomation dashboard as a Workspace Admin or Owner.</li>
                    <li>Navigate to <strong>Meetings</strong> in the sidebar.</li>
                    <li>
                      Click <strong>Disconnect</strong> in the top Google Calendar banner, or open <strong>Availability Rules</strong> and click <strong>Disconnect</strong> in the Google Calendar Integration card.
                    </li>
                  </ol>
                  <p className="text-xs text-muted-foreground pt-1">
                    This action immediately purges your stored encrypted tokens, connected email, Google account ID, and selected calendar ID from the database and requests revocation from Google&apos;s OAuth revocation endpoint.
                  </p>
                </div>

                <div className="border border-border rounded-lg p-4 bg-card space-y-2">
                  <h3 className="font-semibold text-foreground text-base">Method 2: Directly via Google Account Security</h3>
                  <ol className="list-decimal pl-5 space-y-1.5 text-sm text-muted-foreground">
                    <li>
                      Visit your Google Account third-party permissions page at{" "}
                      <a
                        href="https://myaccount.google.com/permissions"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline text-primary hover:text-primary/80 inline-flex items-center gap-1"
                      >
                        myaccount.google.com/permissions
                        <ExternalLink className="h-3 w-3 inline" />
                      </a>
                      .
                    </li>
                    <li>Select <strong>Wattomation</strong> under third-party apps &amp; services.</li>
                    <li>Click <strong>Remove Access</strong> to revoke permissions immediately.</li>
                  </ol>
                  <p className="text-xs text-muted-foreground pt-1">
                    Once revoked, Google rejects further token refreshes and Wattomation marks the workspace integration as expired until reconnected.
                  </p>
                </div>
              </div>
            </section>

            {/* 9. User Rights */}
            <section id="user-rights" className="scroll-mt-24 space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground border-b border-border/60 pb-3 flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" /> 9. Your Rights and Data Choices
              </h2>
              <p>Depending on applicable law, you may request to exercise rights regarding personal data we process:</p>
              <ul className="list-disc pl-6 space-y-1.5 text-muted-foreground text-sm">
                <li><strong className="text-foreground">Access & Export Inquiries:</strong> Request information about the personal data associated with your account.</li>
                <li><strong className="text-foreground">Correction:</strong> Update inaccurate profile or CRM details within your workspace settings or via support.</li>
                <li><strong className="text-foreground">Deletion / Erasure:</strong> Request deletion of your account and workspace records by contacting us.</li>
                <li><strong className="text-foreground">Withdraw Consent:</strong> Disconnect optional integrations such as Google Calendar at any time.</li>
              </ul>
              <p className="text-sm text-muted-foreground">
                End-customers whose phone numbers or messages are managed by a business workspace should direct privacy requests
                to that business (the data controller), or contact us for assistance routing the inquiry.
              </p>
            </section>

            {/* 10. Contact Information */}
            <section id="contact" className="scroll-mt-24 space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground border-b border-border/60 pb-3 flex items-center gap-2">
                <Mail className="h-5 w-5 text-primary" /> 10. Contact Information
              </h2>
              <p>
                If you have questions, concerns, or privacy requests regarding this Privacy Policy or our data practices,
                please contact us:
              </p>

              <div className="rounded-lg border border-border bg-card p-5 space-y-3">
                <div className="flex items-start gap-3">
                  <Building className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-foreground text-sm">Service &amp; Brand Operator:</p>
                    <p className="text-sm text-muted-foreground">
                      OPSIYS (Wattomation by OPSIYS)
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Jurisdiction: India
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 pt-2 border-t border-border/60">
                  <Mail className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-foreground text-sm">Privacy &amp; Data Protection Contact:</p>
                    <p className="text-sm text-muted-foreground">
                      Email:{" "}
                      <a
                        href="mailto:contact@opsiys.in"
                        className="underline text-primary hover:text-primary/80 font-mono"
                      >
                        contact@opsiys.in
                      </a>
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* Cross-Link Banner */}
            <div className="pt-6 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4">
              <p className="text-xs text-muted-foreground">
                Review our Terms of Service governing your workspace and platform usage.
              </p>
              <Link
                href="/terms-of-service"
                className="text-xs font-semibold text-primary hover:text-primary/80 inline-flex items-center gap-1"
              >
                Read Terms of Service &rarr;
              </Link>
            </div>
          </article>
        </div>
      </main>

      <LegalFooter />
    </div>
  );
}

