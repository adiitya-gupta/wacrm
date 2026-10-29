"use client"

import Link from "next/link"
import { Bot, Zap, Workflow, CheckCircle2, AlertTriangle, ArrowRight } from "lucide-react"
import type { SystemHealthData } from "@/lib/dashboard/types"
import { Badge } from "@/components/ui/badge"

interface SystemHealthProps {
  data: SystemHealthData | null
  loading: boolean
}

export function SystemHealth({ data, loading }: SystemHealthProps) {
  if (loading || !data) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 shadow-xs animate-pulse">
        <div className="flex items-center justify-between">
          <div className="h-5 w-40 rounded bg-muted" />
          <div className="h-6 w-28 rounded-full bg-muted" />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="h-24 rounded-lg bg-muted/60" />
          <div className="h-24 rounded-lg bg-muted/60" />
          <div className="h-24 rounded-lg bg-muted/60" />
        </div>
      </div>
    )
  }

  const { aiStatus, automations, flows, recentErrorsCount } = data
  const hasErrors = recentErrorsCount > 0

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-xs transition-all">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Automation & AI Engine Health
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Real-time status of conversational AI, active triggers, and workflow executions
          </p>
        </div>
        <div>
          {hasErrors ? (
            <Badge
              variant="outline"
              className="gap-1.5 border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium px-2.5 py-1"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>{recentErrorsCount} issue{recentErrorsCount === 1 ? "" : "s"} in 24h</span>
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="gap-1.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-medium px-2.5 py-1"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>All Systems Operational</span>
            </Badge>
          )}
        </div>
      </div>

      {/* Health Grid */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* AI Agent Tile */}
        <Link
          href="/agents"
          className="group relative flex flex-col justify-between rounded-lg border border-border/80 bg-background/50 p-3.5 transition-all hover:border-primary/40 hover:bg-muted/30"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-soft text-primary">
                <Bot className="h-4 w-4" />
              </div>
              <span className="text-xs font-semibold text-foreground">AI Sales Agent</span>
            </div>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                aiStatus.active && aiStatus.autoReplyEnabled
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : aiStatus.configured
                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {aiStatus.active && aiStatus.autoReplyEnabled
                ? "Active"
                : aiStatus.configured
                ? "Standby"
                : "Not Configured"}
            </span>
          </div>
          <div className="mt-3">
            <p className="text-xs text-muted-foreground truncate">
              {aiStatus.model ? `${aiStatus.provider || "AI"} · ${aiStatus.model}` : "Configured profile & catalog"}
            </p>
            <div className="mt-1 flex items-center text-[11px] font-medium text-primary group-hover:underline">
              <span>Manage agent</span>
              <ArrowRight className="ml-1 h-3 w-3 transition-transform group-hover:translate-x-0.5" />
            </div>
          </div>
        </Link>

        {/* Automations Tile */}
        <Link
          href="/automations"
          className="group relative flex flex-col justify-between rounded-lg border border-border/80 bg-background/50 p-3.5 transition-all hover:border-primary/40 hover:bg-muted/30"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-soft text-primary">
                <Zap className="h-4 w-4" />
              </div>
              <span className="text-xs font-semibold text-foreground">Automations</span>
            </div>
            <span className="inline-flex items-center rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary">
              {automations.activeCount} / {automations.totalCount} Active
            </span>
          </div>
          <div className="mt-3">
            <p className="text-xs text-muted-foreground">Keyword triggers & quick replies</p>
            <div className="mt-1 flex items-center text-[11px] font-medium text-primary group-hover:underline">
              <span>View automations</span>
              <ArrowRight className="ml-1 h-3 w-3 transition-transform group-hover:translate-x-0.5" />
            </div>
          </div>
        </Link>

        {/* Visual Flows Tile */}
        <Link
          href="/flows"
          className="group relative flex flex-col justify-between rounded-lg border border-border/80 bg-background/50 p-3.5 transition-all hover:border-primary/40 hover:bg-muted/30"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-soft text-primary">
                <Workflow className="h-4 w-4" />
              </div>
              <span className="text-xs font-semibold text-foreground">Visual Flows</span>
            </div>
            <span className="inline-flex items-center rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary">
              {flows.activeCount} / {flows.totalCount} Active
            </span>
          </div>
          <div className="mt-3">
            <p className="text-xs text-muted-foreground">Multi-step interactive funnels</p>
            <div className="mt-1 flex items-center text-[11px] font-medium text-primary group-hover:underline">
              <span>Open flow builder</span>
              <ArrowRight className="ml-1 h-3 w-3 transition-transform group-hover:translate-x-0.5" />
            </div>
          </div>
        </Link>
      </div>

      {/* Error Callout if any */}
      {hasErrors && (
        <div className="mt-3.5 flex items-center justify-between rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              {recentErrorsCount} automation step execution{recentErrorsCount === 1 ? "" : "s"} failed in the past 24 hours.
            </span>
          </div>
          <Link
            href="/automations"
            className="font-medium underline hover:text-amber-900 dark:hover:text-amber-200"
          >
            Review logs
          </Link>
        </div>
      )}
    </div>
  )
}
