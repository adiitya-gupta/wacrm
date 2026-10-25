"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  MessageSquare,
  Bot,
  GitBranch,
  Zap,
  Globe,
  Radio,
  ShieldCheck,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Users,
  Calendar,
  Lock,
  ChevronRight,
  Menu,
  X,
  Send,
  Database,
  Cpu,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export default function HomePage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activePreviewTab, setActivePreviewTab] = useState<"inbox" | "pipeline" | "flows">("inbox");

  // Handle client-side hash redirects from Supabase Auth fallbacks
  useEffect(() => {
    if (typeof window === "undefined" || !window.location.hash) return;
    const hash = window.location.hash;
    if (hash.includes("error=") || hash.includes("error_code=")) {
      if (hash.includes("type=recovery") || hash.includes("reset")) {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- deliberate full navigation to transfer auth hash
        window.location.href = `/reset-password${window.location.search}${hash}`;
      } else {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- deliberate full navigation to transfer auth hash
        window.location.href = `/login${window.location.search}${hash}`;
      }
    } else if (hash.includes("type=recovery") && hash.includes("access_token=")) {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- deliberate full navigation to transfer auth hash
      window.location.href = `/reset-password${window.location.search}${hash}`;
    }
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/20 selection:text-primary">
      {/* Background Subtle Gradient Glows */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-gradient-to-b from-primary/10 via-primary/5 to-transparent blur-3xl opacity-70" />
        <div className="absolute top-1/3 -right-40 w-[600px] h-[400px] bg-gradient-to-br from-emerald-500/10 to-transparent blur-3xl opacity-50" />
      </div>

      {/* Navigation Header */}
      <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/20">
              <MessageSquare className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <span className="text-lg font-bold tracking-tight text-foreground">Wattomation</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold -mt-1">
                by OPSIYS
              </span>
            </div>
          </div>

          {/* Desktop Nav Links */}
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-muted-foreground">
            <a href="#product" className="transition-colors hover:text-foreground">
              Product
            </a>
            <a href="#features" className="transition-colors hover:text-foreground">
              Features
            </a>
            <a href="#use-cases" className="transition-colors hover:text-foreground">
              Use Cases
            </a>
            <a href="#security" className="transition-colors hover:text-foreground">
              Architecture
            </a>
          </nav>

          {/* Desktop Actions */}
          <div className="hidden md:flex items-center gap-3">
            <Link href="/login">
              <Button variant="ghost" className="text-sm font-medium hover:text-foreground">
                Sign In
              </Button>
            </Link>
            <Link href="/login">
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90 font-medium shadow-sm shadow-primary/25">
                Get Started <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </Link>
          </div>

          {/* Mobile Menu Button */}
          <div className="flex md:hidden">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 text-muted-foreground hover:text-foreground rounded-lg"
              aria-label="Toggle Navigation"
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Dropdown Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-b border-border bg-background/95 backdrop-blur-xl px-4 py-4 space-y-3">
            <nav className="flex flex-col gap-2.5 text-sm font-medium text-muted-foreground">
              <a
                href="#product"
                onClick={() => setMobileMenuOpen(false)}
                className="py-1.5 hover:text-foreground"
              >
                Product
              </a>
              <a
                href="#features"
                onClick={() => setMobileMenuOpen(false)}
                className="py-1.5 hover:text-foreground"
              >
                Features
              </a>
              <a
                href="#use-cases"
                onClick={() => setMobileMenuOpen(false)}
                className="py-1.5 hover:text-foreground"
              >
                Use Cases
              </a>
              <a
                href="#security"
                onClick={() => setMobileMenuOpen(false)}
                className="py-1.5 hover:text-foreground"
              >
                Architecture
              </a>
            </nav>
            <div className="flex flex-col gap-2 pt-2 border-t border-border">
              <Link href="/login" onClick={() => setMobileMenuOpen(false)}>
                <Button variant="outline" className="w-full text-sm">
                  Sign In
                </Button>
              </Link>
              <Link href="/login" onClick={() => setMobileMenuOpen(false)}>
                <Button className="w-full bg-primary text-primary-foreground text-sm">
                  Get Started
                </Button>
              </Link>
            </div>
          </div>
        )}
      </header>

      <main className="relative z-10">
        {/* HERO SECTION */}
        <section className="relative pt-20 pb-16 md:pt-28 md:pb-24 overflow-hidden">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            {/* Pill Badge */}
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary mb-6 animate-fade-in">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Next-Gen WhatsApp Business CRM & Automation</span>
            </div>

            {/* H1 Heading */}
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-foreground max-w-4xl mx-auto leading-[1.12]">
              Convert WhatsApp Conversations into <span className="bg-gradient-to-r from-primary to-[#14B8A6] bg-clip-text text-transparent">Predictable Revenue</span>
            </h1>

            {/* Subheading */}
            <p className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto font-normal leading-relaxed">
              Unify team inbox messaging, deploy intelligent 24/7 AI agents, organize deals on visual sales pipelines, and automate interactive customer flows.
            </p>

            {/* CTA Buttons */}
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link href="/login" className="w-full sm:w-auto">
                <Button size="lg" className="w-full sm:w-auto h-12 px-7 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold shadow-md shadow-primary/25 text-base">
                  Get Started <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <a href="#features" className="w-full sm:w-auto">
                <Button size="lg" variant="outline" className="w-full sm:w-auto h-12 px-7 border-border hover:bg-muted/60 font-medium text-base">
                  Explore Platform
                </Button>
              </a>
            </div>

            {/* Trust Points */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-xs text-muted-foreground font-medium">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Official WhatsApp Cloud API
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Bring-Your-Own AI Key (OpenAI / Anthropic)
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Multi-Tenant Row-Level Security
              </span>
            </div>

            {/* INTERACTIVE PRODUCT DASHBOARD PREVIEW */}
            <div id="product" className="mt-14 max-w-5xl mx-auto">
              <div className="rounded-2xl border border-border bg-card shadow-2xl shadow-primary/5 overflow-hidden transition-all duration-300">
                {/* Browser Frame Bar */}
                <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-red-400/80 inline-block" />
                    <span className="h-3 w-3 rounded-full bg-amber-400/80 inline-block" />
                    <span className="h-3 w-3 rounded-full bg-emerald-400/80 inline-block" />
                    <span className="ml-2 text-xs font-mono text-muted-foreground hidden sm:inline-block">
                      app.wattomation.com/dashboard
                    </span>
                  </div>

                  {/* Preview Mode Switcher */}
                  <div className="flex items-center rounded-lg bg-background p-1 border border-border text-xs font-medium">
                    <button
                      type="button"
                      onClick={() => setActivePreviewTab("inbox")}
                      className={`px-3 py-1 rounded-md transition-colors ${
                        activePreviewTab === "inbox" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Team Inbox
                    </button>
                    <button
                      type="button"
                      onClick={() => setActivePreviewTab("pipeline")}
                      className={`px-3 py-1 rounded-md transition-colors ${
                        activePreviewTab === "pipeline" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Sales Pipeline
                    </button>
                    <button
                      type="button"
                      onClick={() => setActivePreviewTab("flows")}
                      className={`px-3 py-1 rounded-md transition-colors ${
                        activePreviewTab === "flows" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      AI & Automation
                    </button>
                  </div>
                </div>

                {/* Dashboard Screen Content */}
                <div className="p-4 sm:p-6 bg-card text-left">
                  {activePreviewTab === "inbox" && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-[420px]">
                      {/* Threads List */}
                      <div className="border border-border rounded-xl bg-muted/20 p-3 space-y-2 overflow-hidden flex flex-col">
                        <div className="flex items-center justify-between pb-2 border-b border-border text-xs font-semibold text-muted-foreground">
                          <span>Active Conversations (14)</span>
                          <Badge variant="outline" className="text-[10px] text-emerald-500 border-emerald-500/30">Live</Badge>
                        </div>
                        <div className="space-y-1.5 overflow-y-auto pr-1">
                          <div className="p-2.5 rounded-lg bg-primary/10 border border-primary/20 text-xs space-y-1">
                            <div className="flex items-center justify-between font-semibold text-foreground">
                              <span>Marcus Vance</span>
                              <span className="text-[10px] text-primary font-normal">Just now</span>
                            </div>
                            <p className="text-muted-foreground truncate">
                              Yes, could you schedule a walkthrough demo for tomorrow?
                            </p>
                            <div className="flex gap-1 pt-1">
                              <Badge className="text-[9px] bg-primary/20 text-primary border-none">Hot Lead</Badge>
                              <Badge variant="outline" className="text-[9px]">AI Qualified</Badge>
                            </div>
                          </div>

                          <div className="p-2.5 rounded-lg bg-card border border-border text-xs space-y-1 hover:bg-muted/40 cursor-pointer">
                            <div className="flex items-center justify-between font-semibold text-foreground">
                              <span>Sarah Jenkins</span>
                              <span className="text-[10px] text-muted-foreground font-normal">12m ago</span>
                            </div>
                            <p className="text-muted-foreground truncate">
                              Received the proposal. Reviewing contract with our finance team.
                            </p>
                            <Badge variant="outline" className="text-[9px]">Negotiation</Badge>
                          </div>

                          <div className="p-2.5 rounded-lg bg-card border border-border text-xs space-y-1 hover:bg-muted/40 cursor-pointer">
                            <div className="flex items-center justify-between font-semibold text-foreground">
                              <span>Elena Rostova</span>
                              <span className="text-[10px] text-muted-foreground font-normal">1h ago</span>
                            </div>
                            <p className="text-muted-foreground truncate">
                              Thanks for the automatic WhatsApp receipt update!
                            </p>
                            <Badge variant="outline" className="text-[9px]">Customer</Badge>
                          </div>
                        </div>
                      </div>

                      {/* Conversation Center View */}
                      <div className="md:col-span-2 border border-border rounded-xl bg-card p-4 flex flex-col justify-between">
                        <div className="flex items-center justify-between pb-3 border-b border-border">
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center font-bold text-xs text-primary">
                              MV
                            </div>
                            <div>
                              <div className="font-semibold text-sm text-foreground">Marcus Vance (+1 415-555-0192)</div>
                              <div className="text-[11px] text-muted-foreground">Account: Vance Logistics Inc.</div>
                            </div>
                          </div>
                          <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-xs">
                            Assigned: AI Sales Agent
                          </Badge>
                        </div>

                        {/* Chat Messages */}
                        <div className="py-4 space-y-3 text-xs overflow-y-auto">
                          <div className="flex justify-start">
                            <div className="max-w-[75%] bg-muted/60 rounded-2xl rounded-tl-sm px-3.5 py-2 text-foreground">
                              Hi! We operate 250 daily shipments and need WhatsApp dispatch alerts integrated with our ERP. What are the setup steps?
                            </div>
                          </div>

                          <div className="flex justify-end">
                            <div className="max-w-[75%] bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-3.5 py-2 space-y-1">
                              <p>
                                Hello Marcus! Wattomation connects directly via official WhatsApp Cloud API and webhooks. We can trigger automated order updates, delivery location pins, and driver dispatch notes.
                              </p>
                              <div className="text-[9px] opacity-80 flex items-center justify-end gap-1">
                                <Sparkles className="h-2.5 w-2.5" /> Handled by Sophia AI Agent
                              </div>
                            </div>
                          </div>

                          <div className="flex justify-start">
                            <div className="max-w-[75%] bg-muted/60 rounded-2xl rounded-tl-sm px-3.5 py-2 text-foreground">
                              Yes, could you schedule a walkthrough demo for tomorrow?
                            </div>
                          </div>
                        </div>

                        {/* AI Quick Response Action */}
                        <div className="pt-2 border-t border-border flex items-center gap-2">
                          <div className="flex-1 bg-muted/40 border border-border rounded-lg px-3 py-2 text-xs text-muted-foreground flex items-center justify-between">
                            <span>Drafting: Booking confirmation for Tuesday 2:00 PM EST...</span>
                            <Sparkles className="h-3.5 w-3.5 text-primary animate-pulse" />
                          </div>
                          <Button size="sm" className="bg-primary text-primary-foreground h-9 px-3">
                            <Send className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {activePreviewTab === "pipeline" && (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 h-[420px] overflow-hidden">
                      <div className="bg-muted/20 border border-border rounded-xl p-3 flex flex-col gap-2">
                        <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
                          <span>New Leads</span>
                          <Badge variant="outline" className="text-[10px]">4</Badge>
                        </div>
                        <div className="p-3 bg-card rounded-lg border border-border shadow-xs text-xs space-y-1">
                          <span className="font-semibold text-foreground">Skyline Retail</span>
                          <div className="text-muted-foreground">$4,200 · WhatsApp Inbound</div>
                        </div>
                        <div className="p-3 bg-card rounded-lg border border-border shadow-xs text-xs space-y-1">
                          <span className="font-semibold text-foreground">Dr. Chen Clinic</span>
                          <div className="text-muted-foreground">$2,800 · Website Widget</div>
                        </div>
                      </div>

                      <div className="bg-muted/20 border border-border rounded-xl p-3 flex flex-col gap-2">
                        <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
                          <span>AI Qualified</span>
                          <Badge variant="outline" className="text-[10px]">6</Badge>
                        </div>
                        <div className="p-3 bg-card rounded-lg border border-primary/30 shadow-xs text-xs space-y-1">
                          <span className="font-semibold text-foreground">Vance Logistics</span>
                          <div className="text-emerald-500 font-semibold">$14,500 / yr</div>
                          <Badge className="text-[9px] bg-primary/10 text-primary border-none">High Intent</Badge>
                        </div>
                      </div>

                      <div className="bg-muted/20 border border-border rounded-xl p-3 flex flex-col gap-2">
                        <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
                          <span>Demo Scheduled</span>
                          <Badge variant="outline" className="text-[10px]">3</Badge>
                        </div>
                        <div className="p-3 bg-card rounded-lg border border-border shadow-xs text-xs space-y-1">
                          <span className="font-semibold text-foreground">Nexus Motors</span>
                          <div className="text-muted-foreground">$9,600 · Tomorrow 3 PM</div>
                        </div>
                      </div>

                      <div className="bg-muted/20 border border-border rounded-xl p-3 flex flex-col gap-2">
                        <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
                          <span>Closed Won</span>
                          <Badge className="bg-emerald-500/10 text-emerald-500 border-none text-[10px]">8</Badge>
                        </div>
                        <div className="p-3 bg-emerald-500/5 rounded-lg border border-emerald-500/20 shadow-xs text-xs space-y-1">
                          <span className="font-semibold text-foreground">Apex Properties</span>
                          <div className="text-emerald-600 dark:text-emerald-400 font-bold">$22,000</div>
                          <div className="text-[10px] text-muted-foreground">Live on WhatsApp API</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {activePreviewTab === "flows" && (
                    <div className="h-[420px] rounded-xl border border-border bg-muted/10 p-6 flex flex-col justify-center items-center text-center relative overflow-hidden">
                      <div className="flex flex-col md:flex-row items-center gap-4 z-10">
                        <div className="p-4 rounded-xl border border-border bg-card shadow-md text-xs space-y-1 w-52">
                          <div className="flex items-center gap-1.5 font-bold text-foreground">
                            <Zap className="h-4 w-4 text-amber-500" /> WhatsApp Message In
                          </div>
                          <p className="text-[11px] text-muted-foreground">Trigger on customer inquiry</p>
                        </div>

                        <ArrowRight className="h-5 w-5 text-muted-foreground hidden md:block" />

                        <div className="p-4 rounded-xl border border-primary/40 bg-primary/5 shadow-md text-xs space-y-1 w-56">
                          <div className="flex items-center gap-1.5 font-bold text-primary">
                            <Bot className="h-4 w-4" /> AI Knowledge Retrieval
                          </div>
                          <p className="text-[11px] text-muted-foreground">Match query against business docs</p>
                        </div>

                        <ArrowRight className="h-5 w-5 text-muted-foreground hidden md:block" />

                        <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 shadow-md text-xs space-y-1 w-52">
                          <div className="flex items-center gap-1.5 font-bold text-emerald-600 dark:text-emerald-400">
                            <Calendar className="h-4 w-4" /> Calendar Booking
                          </div>
                          <p className="text-[11px] text-muted-foreground">Send invite link & confirm</p>
                        </div>
                      </div>

                      <div className="mt-8 text-xs text-muted-foreground max-w-md">
                        Drag-and-drop visual workflow designer with condition nodes, wait delays, team assignments, and webhook dispatches.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CORE PLATFORM CAPABILITIES */}
        <section id="features" className="py-20 border-t border-border bg-muted/20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto">
              <Badge variant="outline" className="mb-3 text-xs font-semibold uppercase tracking-wider text-primary border-primary/20">
                Core Capabilities
              </Badge>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
                Everything You Need to Run Your Business on WhatsApp
              </h2>
              <p className="mt-3 text-muted-foreground text-base">
                Engineered from the ground up for modern teams, agency operators, and high-growth commercial enterprises.
              </p>
            </div>

            <div className="mt-14 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Feature 1 */}
              <Card className="border-border bg-card hover:border-primary/40 transition-all duration-200">
                <CardContent className="p-6 space-y-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                    <MessageSquare className="h-5 w-5" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">Shared Team Inbox</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Collaborate across support and sales teams with simultaneous agent assignments, customer tags, internal notes, media previews, and presence detection.
                  </p>
                </CardContent>
              </Card>

              {/* Feature 2 */}
              <Card className="border-border bg-card hover:border-primary/40 transition-all duration-200">
                <CardContent className="p-6 space-y-3">
                  <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                    <Bot className="h-5 w-5" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">Intelligent AI Agents</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Deploy autonomous conversational agents powered by OpenAI or Anthropic. Provide custom business knowledge bases, automatic drafts, and seamless agent handoffs.
                  </p>
                </CardContent>
              </Card>

              {/* Feature 3 */}
              <Card className="border-border bg-card hover:border-primary/40 transition-all duration-200">
                <CardContent className="p-6 space-y-3">
                  <div className="h-10 w-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500">
                    <GitBranch className="h-5 w-5" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">Visual Sales Pipelines</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Organize contacts into custom Kanban sales stages. Track deal amounts, target close dates, currency conversions, and stage progression directly from WhatsApp chat.
                  </p>
                </CardContent>
              </Card>

              {/* Feature 4 */}
              <Card className="border-border bg-card hover:border-primary/40 transition-all duration-200">
                <CardContent className="p-6 space-y-3">
                  <div className="h-10 w-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-500">
                    <Zap className="h-5 w-5" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">Visual Flow Automations</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Design automated interactive trees using condition nodes, wait steps, tag attachments, and CRM actions without writing code.
                  </p>
                </CardContent>
              </Card>

              {/* Feature 5 */}
              <Card className="border-border bg-card hover:border-primary/40 transition-all duration-200">
                <CardContent className="p-6 space-y-3">
                  <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500">
                    <Radio className="h-5 w-5" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">Targeted Broadcast Campaigns</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Dispatch approved Meta message templates to segmented contact cohorts. Monitor real-time delivery metrics, read receipts, and incoming replies.
                  </p>
                </CardContent>
              </Card>

              {/* Feature 6 */}
              <Card className="border-border bg-card hover:border-primary/40 transition-all duration-200">
                <CardContent className="p-6 space-y-3">
                  <div className="h-10 w-10 rounded-xl bg-teal-500/10 flex items-center justify-center text-teal-500">
                    <Globe className="h-5 w-5" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">Website Integration & SDK</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Embed our lightweight JavaScript widget on your website to capture inbound leads and trigger instant automated WhatsApp follow-ups in seconds.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* GENUINE USE CASES */}
        <section id="use-cases" className="py-20 border-t border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto">
              <Badge variant="outline" className="mb-3 text-xs font-semibold uppercase tracking-wider text-emerald-500 border-emerald-500/20">
                Industry Solutions
              </Badge>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
                Built for High-Trust Conversational Commerce
              </h2>
              <p className="mt-3 text-muted-foreground text-base">
                Discover how businesses utilize Wattomation to replace disjointed tools with an all-in-one conversational platform.
              </p>
            </div>

            <div className="mt-14 grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Use Case 1 */}
              <div className="rounded-2xl border border-border bg-card p-7 space-y-4">
                <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
                  <Calendar className="h-4 w-4" /> Consultation & High-Value Sales
                </div>
                <h3 className="text-xl font-bold text-foreground">
                  Instant Lead Qualification & Meeting Booking
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Inbound leads from Meta Ads or websites are immediately greeted by your custom AI agent. The agent asks qualifying questions, matches criteria against your knowledge base, and schedules Google Meet bookings directly on the contact&apos;s deal card.
                </p>
                <div className="flex flex-wrap gap-2 pt-2">
                  <Badge variant="secondary" className="text-xs">Automated Qualification</Badge>
                  <Badge variant="secondary" className="text-xs">Meeting Coordination</Badge>
                  <Badge variant="secondary" className="text-xs">Deal Pipeline Sync</Badge>
                </div>
              </div>

              {/* Use Case 2 */}
              <div className="rounded-2xl border border-border bg-card p-7 space-y-4">
                <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-500">
                  <Users className="h-4 w-4" /> Multi-Agent Customer Support
                </div>
                <h3 className="text-xl font-bold text-foreground">
                  Collaborative Shared Inbox for Customer Service
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Eliminate multiple phones and shared WhatsApp Web sessions. Give every team member distinct accounts with custom roles (admin, agent, viewer). Assign customer conversations, leave internal team notes, and maintain a complete audit trail.
                </p>
                <div className="flex flex-wrap gap-2 pt-2">
                  <Badge variant="secondary" className="text-xs">Multi-Agent Routing</Badge>
                  <Badge variant="secondary" className="text-xs">Internal Notes</Badge>
                  <Badge variant="secondary" className="text-xs">Role Permissions</Badge>
                </div>
              </div>

              {/* Use Case 3 */}
              <div className="rounded-2xl border border-border bg-card p-7 space-y-4">
                <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-500">
                  <Radio className="h-4 w-4" /> Outbound Marketing & Retention
                </div>
                <h3 className="text-xl font-bold text-foreground">
                  Segmented WhatsApp Broadcasts with Verified Templates
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Upload CSV contacts, filter by custom customer tags, and dispatch official Meta-approved message templates. Prevent account bans with rate-limited dispatching, retry logic, and automatic opt-out handling.
                </p>
                <div className="flex flex-wrap gap-2 pt-2">
                  <Badge variant="secondary" className="text-xs">Template Verification</Badge>
                  <Badge variant="secondary" className="text-xs">Tag Segmentation</Badge>
                  <Badge variant="secondary" className="text-xs">Delivery Receipts</Badge>
                </div>
              </div>

              {/* Use Case 4 */}
              <div className="rounded-2xl border border-border bg-card p-7 space-y-4">
                <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-purple-500">
                  <Globe className="h-4 w-4" /> Full-Stack Business Integrations
                </div>
                <h3 className="text-xl font-bold text-foreground">
                  Seamless Webhook & Website Event Automation
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Connect your existing web apps, checkout pages, and lead forms. When a customer registers, submits a form, or books an appointment, Wattomation dispatches personalized WhatsApp confirmations instantly.
                </p>
                <div className="flex flex-wrap gap-2 pt-2">
                  <Badge variant="secondary" className="text-xs">SDK Event Tracker</Badge>
                  <Badge variant="secondary" className="text-xs">Webhook Signatures</Badge>
                  <Badge variant="secondary" className="text-xs">Dynamic Variables</Badge>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECURITY & ARCHITECTURE */}
        <section id="security" className="py-20 border-t border-border bg-muted/20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto">
              <Badge variant="outline" className="mb-3 text-xs font-semibold uppercase tracking-wider text-primary border-primary/20">
                Security & Isolation
              </Badge>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
                Strict Multi-Tenant Protection & Access Governance
              </h2>
              <p className="mt-3 text-muted-foreground text-base">
                Your business data is strictly isolated. Every tenant is cryptographically partitioned and governed by server-side authorization.
              </p>
            </div>

            <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="rounded-xl border border-border bg-card p-6 space-y-3">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                  <Lock className="h-5 w-5" />
                </div>
                <h3 className="text-base font-bold text-foreground">Administrator-Governed Access</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  No user can access product workspaces without explicit platform administrator approval. Valid credentials alone do not grant access, preventing unvetted accounts from entering the system.
                </p>
              </div>

              <div className="rounded-xl border border-border bg-card p-6 space-y-3">
                <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                  <Database className="h-5 w-5" />
                </div>
                <h3 className="text-base font-bold text-foreground">PostgreSQL Row-Level Security</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Enforced at the database engine level via security definer membership functions. Customers can never read, modify, or leak another tenant&apos;s contacts, messages, or configurations.
                </p>
              </div>

              <div className="rounded-xl border border-border bg-card p-6 space-y-3">
                <div className="h-10 w-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-500">
                  <Cpu className="h-5 w-5" />
                </div>
                <h3 className="text-base font-bold text-foreground">AES-256-GCM Credential Encryption</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Sensitive credentials, including Meta WhatsApp Cloud API access tokens and AI provider API keys, are stored encrypted at rest with hardware-grade AES-256-GCM.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* BOTTOM CALL TO ACTION */}
        <section className="py-20 border-t border-border">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
              Ready to Upgrade Your Customer Conversations?
            </h2>
            <p className="mt-4 text-base text-muted-foreground max-w-xl mx-auto">
              Join businesses automating sales, support, and marketing on WhatsApp. Register today to request your verified workspace.
            </p>
            <div className="mt-8 flex justify-center">
              <Link href="/login">
                <Button size="lg" className="h-12 px-8 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold shadow-md shadow-primary/25 text-base">
                  Get Started <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER - Strictly no admin links */}
      <footer className="border-t border-border bg-card/60 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm shadow-primary/20">
              <MessageSquare className="h-4 w-4" />
            </div>
            <div className="flex flex-col">
              <span className="font-semibold text-sm text-foreground">Wattomation</span>
              <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider -mt-0.5">by OPSIYS</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-6 text-xs text-muted-foreground font-medium">
            <a href="#product" className="hover:text-foreground transition-colors">Product</a>
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#use-cases" className="hover:text-foreground transition-colors">Use Cases</a>
            <a href="#security" className="hover:text-foreground transition-colors">Architecture</a>
            <Link href="/login" className="hover:text-foreground transition-colors">Sign In</Link>
            <Link href="/login" className="hover:text-foreground transition-colors">Get Started</Link>
          </div>

          <div className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Wattomation by OPSIYS. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
