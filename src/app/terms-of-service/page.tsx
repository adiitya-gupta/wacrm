import type { Metadata } from "next";
import Link from "next/link";
import {
  FileText,
  ShieldCheck,
  AlertTriangle,
  Scale,
  Calendar,
  MessageSquare,
  CreditCard,
  Ban,
  ServerOff,
  UserCheck,
  Building,
  Mail,
} from "lucide-react";
import { LegalHeader } from "@/components/legal/legal-header";
import { LegalFooter } from "@/components/legal/legal-footer";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Terms of Service for Wattomation by OPSIYS. Terms governing WhatsApp automation, AI features, Google Calendar scheduling, and acceptable use policies.",
  robots: {
    index: true,
    follow: true,
  },
};

export default function TermsOfServicePage() {
  const lastUpdated = "November 12, 2026";

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col selection:bg-primary/20 selection:text-primary">
      <LegalHeader activePage="terms" />

      {/* Hero / Header Section */}
      <section className="relative border-b border-border/60 bg-gradient-to-b from-primary/5 via-background to-background py-16 sm:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <Badge
            variant="outline"
            className="mb-4 border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"
          >
            <Scale className="mr-1.5 h-3.5 w-3.5 inline" /> Service Terms &amp; Conditions
          </Badge>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl text-foreground">
            Terms of Service
          </h1>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
            These Terms of Service govern your access to and use of Wattomation by OPSIYS, including our WhatsApp CRM,
            AI automation workflows, and third-party integrations.
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
                <a href="#acceptance" className="hover:text-primary transition-colors">
                  1. Agreement &amp; Acceptance
                </a>
                <a href="#accounts" className="hover:text-primary transition-colors">
                  2. Accounts &amp; Registration
                </a>
                <a href="#billing" className="hover:text-primary transition-colors">
                  3. Subscriptions &amp; Billing
                </a>
                <a href="#whatsapp-policy" className="hover:text-primary transition-colors text-primary font-medium">
                  4. WhatsApp Acceptable Use
                </a>
                <a href="#google-calendar-terms" className="hover:text-primary transition-colors">
                  5. Google Calendar Terms
                </a>
                <a href="#prohibited-activities" className="hover:text-primary transition-colors">
                  6. Prohibited Activities
                </a>
                <a href="#availability" className="hover:text-primary transition-colors">
                  7. Service Availability
                </a>
                <a href="#termination" className="hover:text-primary transition-colors">
                  8. Termination &amp; Suspension
                </a>
                <a href="#liability" className="hover:text-primary transition-colors">
                  9. Limitation of Liability
                </a>
                <a href="#governing-law" className="hover:text-primary transition-colors">
                  10. Governing Law
                </a>
                <a href="#legal-notices" className="hover:text-primary transition-colors">
                  11. Contact &amp; Legal Notices
                </a>
              </nav>
            </div>
          </aside>

          {/* Terms Text Body */}
          <article className="lg:col-span-3 space-y-12 text-sm sm:text-base leading-relaxed text-foreground/90">
            {/* 1. Agreement & Acceptance */}
            <section id="acceptance" className="scroll-mt-24 space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground border-b border-border/60 pb-3 flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" /> 1. Agreement &amp; Acceptance of Terms
              </h2>
              <p>
                These Terms of Service (&ldquo;Terms&rdquo;) constitute a legally binding agreement between you or the organization you represent
                (&ldquo;Customer&rdquo;, &ldquo;you&rdquo;, or &ldquo;your&rdquo;) and <strong>OPSIYS</strong>, operator of <strong>Wattomation by OPSIYS</strong> (&ldquo;OPSIYS&rdquo;, &ldquo;Wattomation&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;),
                governing your access to and use of the Wattomation web application, APIs, and associated services (the &ldquo;Service&rdquo;).
              </p>
              <p>
                By creating an account, accessing, or using the Service, you acknowledge that you have read, understood,
                and agree to be bound by these Terms and our{" "}
                <Link href="/privacy-policy" className="text-primary hover:underline font-semibold">
                  Privacy Policy
                </Link>
                . If you are accepting these Terms on behalf of a business or organization, you represent and warrant
                that you have authority to bind that organization to these Terms.
              </p>
            </section>

            {/* 2. Accounts & Registration */}
            <section id="accounts" className="scroll-mt-24 space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground border-b border-border/60 pb-3 flex items-center gap-2">
                <UserCheck className="h-5 w-5 text-primary" /> 2. Account Registration &amp; Workspace Governance
              </h2>
              <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
                <li>
                  <strong className="text-foreground">Eligibility:</strong> You must be at least 18 years of age or the age of legal majority
                  in your jurisdiction to establish an account and use the Service.
                </li>
                <li>
                  <strong className="text-foreground">Accurate Information:</strong> You agree to provide accurate, current, and complete
                  information during registration and workspace onboarding, and to keep your contact details updated.
                </li>
                <li>
                  <strong className="text-foreground">Credential &amp; API Key Security:</strong> You are responsible for safeguarding your login
                  credentials, third-party AI provider API keys, Meta WhatsApp tokens, and OAuth connections, and for promptly notifying us
                  at <a href="mailto:contact@opsiys.in" className="underline text-primary">contact@opsiys.in</a> of any suspected unauthorized access.
                </li>
                <li>
                  <strong className="text-foreground">Workspace Responsibility:</strong> The designated Workspace Owner is responsible for
                  workspace configuration and all actions, automations, and messages initiated by invited team members (Admins, Agents, and Viewers).
                </li>
              </ul>
            </section>

            {/* 3. Subscriptions & Billing */}
            <section id="billing" className="scroll-mt-24 space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground border-b border-border/60 pb-3 flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-primary" /> 3. Subscriptions, Billing &amp; Payment Terms
              </h2>
              <div className="space-y-3 text-muted-foreground">
                <p>
                  <strong className="text-foreground">Subscription Plans:</strong> Access to the Service is offered under workspace tiers and
                  managed service plans described on our <Link href="/pricing" className="text-primary hover:underline">Pricing Page</Link> or in a
                  separate commercial agreement.
                </p>
                <p>
                  <strong className="text-foreground">Trial &amp; Evaluation Access:</strong> Where offered, trial or starter evaluation workspaces
                  provide limited access without requiring payment card details up front. Moving to a paid plan or renewing a paid plan requires
                  explicit checkout authorization or a mutually agreed invoice.
                </p>
                <p>
                  <strong className="text-foreground">Payments &amp; Processing:</strong> Paid upgrades and plan renewals are processed through integrated
                  third-party payment gateways (such as Razorpay or Stripe, as enabled for your billing workflow), together with applicable taxes.
                </p>
                <p>
                  <strong className="text-foreground">Fee Adjustments:</strong> OPSIYS may update plan pricing upon at least thirty (30) days
                  prior notice before the change takes effect for your next billing period or renewal.
                </p>
                <p>
                  <strong className="text-foreground">Cancellations &amp; Refunds:</strong> You may request plan cancellation, downgrade, or billing support
                  at any time by contacting{" "}
                  <a href="mailto:contact@opsiys.in" className="underline text-primary">contact@opsiys.in</a>. Unless required by applicable law or agreed
                  in writing, fees already paid are non-refundable.
                </p>
              </div>
            </section>

            {/* 4. WhatsApp Automation & Acceptable Use Policy */}
            <section id="whatsapp-policy" className="scroll-mt-24 space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground border-b border-border/60 pb-3 flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-primary" /> 4. WhatsApp Automation &amp; Acceptable Use Policy
              </h2>
              <p>
                Wattomation connects to the Meta WhatsApp Cloud API to support customer messaging and AI-assisted scheduling.
                Your use of WhatsApp messaging features must comply with all applicable anti-spam laws and Meta platform rules.
              </p>

              <Card className="border-primary/40 bg-primary/5">
                <CardContent className="p-4 sm:p-5 space-y-3">
                  <div className="flex items-center gap-2 font-bold text-foreground text-base">
                    <ShieldCheck className="h-5 w-5 text-primary shrink-0" />
                    Mandatory Meta Compliance
                  </div>
                  <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                    You represent and warrant that you will comply with Meta&apos;s{" "}
                    <a
                      href="https://www.whatsapp.com/legal/business-policy"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline text-primary hover:text-primary/80"
                    >
                      WhatsApp Business Policy
                    </a>{" "}
                    and{" "}
                    <a
                      href="https://www.whatsapp.com/legal/commerce-policy"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline text-primary hover:text-primary/80"
                    >
                      WhatsApp Commerce Policy
                    </a>
                    , as updated by Meta Platforms, Inc. from time to time.
                  </p>
                </CardContent>
              </Card>

              <div className="space-y-3 pt-2">
                <h3 className="font-semibold text-foreground text-base">Prohibited WhatsApp Practices:</h3>
                <ul className="list-disc pl-6 space-y-1.5 text-muted-foreground text-sm">
                  <li>
                    <strong className="text-foreground">Unsolicited Broadcasts (Spam):</strong> Sending marketing messages, promotions,
                    or automated sequences to individuals without valid opt-in consent.
                  </li>
                  <li>
                    <strong className="text-foreground">Deceptive or Fraudulent Messages:</strong> Impersonating another person or business,
                    distributing phishing links, or making misleading claims.
                  </li>
                  <li>
                    <strong className="text-foreground">Prohibited Goods &amp; Services:</strong> Offering or promoting categories restricted under
                    WhatsApp Commerce policies.
                  </li>
                  <li>
                    <strong className="text-foreground">Policy Evasion:</strong> Attempting to circumvent WhatsApp template approvals, opt-out signals,
                    or messaging limits.
                  </li>
                </ul>

                <div className="border border-amber-500/30 bg-amber-500/5 rounded-lg p-4 mt-3 space-y-2">
                  <div className="flex items-center gap-2 font-semibold text-amber-500 text-sm">
                    <AlertTriangle className="h-4 w-4 shrink-0" /> Meta Platform Autonomy &amp; Account Quality Disclaimer
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Customer acknowledges that <strong>Meta Platforms, Inc.</strong> exercises independent discretion over
                    WhatsApp Business Account approvals, template reviews, messaging quality ratings, rate limits, and number restrictions.
                    OPSIYS does not control Meta&apos;s enforcement actions and is not liable for delays, throttling, or suspensions imposed by Meta.
                  </p>
                </div>
              </div>
            </section>

            {/* 5. Google Calendar Integration Terms */}
            <section id="google-calendar-terms" className="scroll-mt-24 space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground border-b border-border/60 pb-3 flex items-center gap-2">
                <Calendar className="h-5 w-5 text-primary" /> 5. Google Calendar Integration Terms
              </h2>
              <p>
                Wattomation allows authorized workspace administrators to connect a Google Calendar account via OAuth 2.0 to
                check scheduling availability and manage consultation calendar events.
              </p>
              <ul className="list-disc pl-6 space-y-2 text-muted-foreground text-sm">
                <li>
                  <strong className="text-foreground">Scope of Authorization:</strong> By connecting a Google Account, you authorize
                  Wattomation to read free/busy intervals, list your calendars for selection, read your account email for connection status,
                  and create, update, or remove appointment events on the selected calendar.
                </li>
                <li>
                  <strong className="text-foreground">User Control &amp; Revocation:</strong> You may disconnect Google Calendar at any time
                  in your dashboard (Meetings &rarr; Availability Rules / status banner &rarr; Disconnect) or directly via{" "}
                  <a
                    href="https://myaccount.google.com/permissions"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline text-primary hover:text-primary/80"
                  >
                    myaccount.google.com/permissions
                  </a>
                  .
                </li>
                <li>
                  <strong className="text-foreground">Authorization &amp; Compliance:</strong> You represent that you have authority to link
                  the chosen Google Account to the workspace and that your use complies with Google&apos;s applicable terms.
                </li>
                <li>
                  <strong className="text-foreground">Third-Party API Dependency:</strong> OPSIYS is not responsible for calendar synchronization
                  interruptions caused by Google API outages, expired or revoked OAuth grants, or changes to Google Calendar services.
                </li>
              </ul>
            </section>

            {/* 6. Prohibited Activities */}
            <section id="prohibited-activities" className="scroll-mt-24 space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground border-b border-border/60 pb-3 flex items-center gap-2">
                <Ban className="h-5 w-5 text-primary" /> 6. System Integrity &amp; Prohibited Activities
              </h2>
              <p>In using the Service, you agree that you will not, directly or indirectly:</p>
              <ul className="list-disc pl-6 space-y-2 text-muted-foreground text-sm">
                <li>Reverse engineer, decompile, disassemble, or attempt to extract unauthorized source code or underlying proprietary schemas.</li>
                <li>Probe, scan, or attempt to bypass authentication, multi-tenant isolation, or Row-Level Security (RLS) controls.</li>
                <li>Attempt to access messages, contacts, API credentials, or OAuth tokens belonging to another workspace.</li>
                <li>Use automated scrapers or abusive request volumes to disrupt or overload the Service.</li>
                <li>Resell, sublicense, or redistribute access to the Service without written authorization from OPSIYS.</li>
                <li>Transmit malicious payloads, malware, or unauthorized scripts via webhooks, forms, or API endpoints.</li>
              </ul>
            </section>

            {/* 7. Service Availability & Limitations */}
            <section id="availability" className="scroll-mt-24 space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground border-b border-border/60 pb-3 flex items-center gap-2">
                <ServerOff className="h-5 w-5 text-primary" /> 7. Service Availability, Maintenance &amp; Limitations
              </h2>
              <p>
                We work to maintain reliable platform performance, but the Service is provided on an
                <strong> &ldquo;AS IS&rdquo;</strong> and <strong>&ldquo;AS AVAILABLE&rdquo;</strong> basis without warranties of uninterrupted or error-free operation.
              </p>
              <p className="text-sm text-muted-foreground">
                We may perform updates, scheduled maintenance, or emergency fixes when necessary. Certain capabilities also depend
                on external third-party platforms (including Meta WhatsApp Cloud API, Google APIs, workspace-configured AI inference
                providers, Supabase, and Vercel), and OPSIYS is not liable for third-party service disruptions.
              </p>
            </section>

            {/* 8. Termination & Suspension */}
            <section id="termination" className="scroll-mt-24 space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground border-b border-border/60 pb-3 flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-primary" /> 8. Termination &amp; Account Suspension
              </h2>
              <div className="space-y-3 text-muted-foreground text-sm">
                <p>
                  <strong className="text-foreground">Termination by Customer:</strong> You may stop using the Service or request account closure
                  and data deletion by emailing <a href="mailto:contact@opsiys.in" className="underline text-primary">contact@opsiys.in</a>.
                </p>
                <p>
                  <strong className="text-foreground">Suspension or Termination by OPSIYS:</strong> We may suspend or terminate workspace access
                  if we reasonably determine that:
                </p>
                <ul className="list-disc pl-6 space-y-1">
                  <li>You materially breach these Terms or Meta&apos;s WhatsApp Business Policies.</li>
                  <li>Your workspace transmits unsolicited spam, fraudulent communications, or abusive content.</li>
                  <li>Applicable subscription charges remain overdue after notice.</li>
                  <li>Suspension or termination is required to protect platform security or comply with law.</li>
                </ul>
                <p>
                  <strong className="text-foreground">Effect of Termination:</strong> Upon termination, access rights cease and workspace data is
                  handled in accordance with our Privacy Policy.
                </p>
              </div>
            </section>

            {/* 9. Limitation of Liability */}
            <section id="liability" className="scroll-mt-24 space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground border-b border-border/60 pb-3 flex items-center gap-2">
                <Scale className="h-5 w-5 text-primary" /> 9. Limitation of Liability &amp; Indemnification
              </h2>
              <div className="space-y-3 text-muted-foreground text-sm">
                <p>
                  <strong className="text-foreground uppercase">Disclaimer of Warranties:</strong> TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW,
                  OPSIYS DISCLAIMS ALL WARRANTIES, EXPRESS, IMPLIED, STATUTORY, OR OTHERWISE, INCLUDING WARRANTIES OF
                  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
                </p>
                <p>
                  <strong className="text-foreground uppercase">Exclusion of Consequential Damages:</strong> TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW,
                  OPSIYS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR
                  LOSS OF PROFITS, REVENUE, DATA, OR GOODWILL ARISING OUT OF OR RELATED TO YOUR USE OF OR INABILITY TO USE THE SERVICE.
                </p>
                <p>
                  <strong className="text-foreground uppercase">Monetary Liability Cap:</strong> TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW,
                  OPSIYS&apos;S AGGREGATE LIABILITY ARISING OUT OF OR RELATING TO THESE TERMS OR THE SERVICE SHALL NOT EXCEED THE TOTAL
                  FEES ACTUALLY PAID BY YOU TO OPSIYS FOR THE SERVICE DURING THE TWELVE (12) MONTHS IMMEDIATELY PRECEDING THE EVENT
                  GIVING RISE TO LIABILITY.
                </p>
                <p>
                  <strong className="text-foreground">Customer Indemnification:</strong> You agree to defend, indemnify, and hold harmless OPSIYS
                  against third-party claims, liabilities, damages, and reasonable legal expenses arising from your violation of these
                  Terms, applicable messaging or privacy laws, WhatsApp policies, or third-party rights.
                </p>
              </div>
            </section>

            {/* 10. Governing Law */}
            <section id="governing-law" className="scroll-mt-24 space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground border-b border-border/60 pb-3 flex items-center gap-2">
                <Building className="h-5 w-5 text-primary" /> 10. Governing Law &amp; Dispute Resolution
              </h2>
              <p className="text-sm text-muted-foreground">
                These Terms shall be governed by and construed in accordance with the laws of{" "}
                <strong className="text-foreground">India</strong>, without regard to conflict of law principles. Subject to mandatory
                applicable law, any legal action or proceeding arising out of or relating to these Terms shall be subject to the
                exclusive jurisdiction of the competent courts in <strong className="text-foreground">India</strong>.
              </p>
              <p className="text-sm text-muted-foreground">
                If any provision of these Terms is held invalid or unenforceable, that provision will be enforced to the maximum extent
                permissible and the remaining provisions will remain in full force and effect.
              </p>
            </section>

            {/* 11. Contact & Legal Notices */}
            <section id="legal-notices" className="scroll-mt-24 space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground border-b border-border/60 pb-3 flex items-center gap-2">
                <Mail className="h-5 w-5 text-primary" /> 11. Contact &amp; Legal Notices
              </h2>
              <p>For questions regarding these Terms, support, or legal notices, please contact:</p>

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
                    <p className="font-semibold text-foreground text-sm">Legal &amp; Support Contact:</p>
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
                Understand how we handle and protect your data across all platform features.
              </p>
              <Link
                href="/privacy-policy"
                className="text-xs font-semibold text-primary hover:text-primary/80 inline-flex items-center gap-1"
              >
                Read Privacy Policy &rarr;
              </Link>
            </div>
          </article>
        </div>
      </main>

      <LegalFooter />
    </div>
  );
}

