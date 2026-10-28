# Wattomation by OPSIYS

> Enterprise WhatsApp CRM, Autonomous AI Agents, Visual Funnels & Meeting Scheduling Platform.

[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth-3ecf8e?logo=supabase)](https://supabase.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-CSS%20v4-38bdf8?logo=tailwindcss)](https://tailwindcss.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](./LICENSE)

**Wattomation by OPSIYS** transforms WhatsApp into a full-funnel customer relationship management, sales automation, and AI-powered support engine. Engineered with enterprise security, complete tenant isolation, and modern cloud scalability.

---

## Capabilities & Architecture

### 1. Unified WhatsApp Shared Inbox
- Multi-agent collaboration on official WhatsApp Business API numbers.
- Real-time message streaming, conversation assignment, custom tags, and internal notes.
- Inbound media mirroring and rich message rendering (audio notes, documents, location, interactive list & button replies).

### 2. Autonomous AI Agents & Knowledge Bases
- Bring-your-own-key (BYOK) AI integrations supporting OpenAI (GPT-4o) and Anthropic (Claude 3.5).
- Custom knowledge base retrieval via Postgres pgvector and full-text search.
- Clean human handoff protocols and per-conversation auto-reply safety controls.

### 3. Visual Pipelines & Deal Management
- Multi-stage Kanban pipeline boards linked directly to WhatsApp conversations.
- Real-time pipeline analytics, deal value tracking, and conversion velocity metrics.

### 4. Broadcast Campaigns & Meta Templates
- Meta-approved template management, submission, and sync directly from the dashboard.
- High-concurrency broadcast engine with personalized variable substitution and delivery/read tracking.

### 5. Visual No-Code Automations
- Trigger automations on inbound messages, keyword detection, contact creation, or schedule.
- Conditional branching, wait timers, webhook dispatching, and dynamic tag assignments.

### 6. Website Integrations & Event SDK
- Client-side tracking script (`/sdk/wacrm.js`) for capturing user events, page views, and form submissions.
- Real-time webhook ingestion triggering automated WhatsApp follow-ups.

### 7. Meeting Scheduling & Calendar Sync
- Natural language datetime parsing for inbound appointment requests.
- Bi-directional Google Calendar availability checking and conflict-free booking.

### 8. Enterprise Governance & Security
- Fail-closed authorization with multi-tenant Supabase Row Level Security (RLS).
- Pending-by-default registration with Platform Admin approval workflows.
- AES-256-GCM encryption for stored API keys and webhook secrets.
- Scoped, revocable REST API keys (`/api/v1`) with distributed rate limiting.

---

## Quick Start (Local Development)

### Prerequisites
- Node.js `>=22.12.0`
- A Supabase project (Postgres, Auth, Storage)
- A Meta Cloud API (WhatsApp Business) account

### Setup

```bash
# 1. Clone the repository
git clone https://github.com/adiitya-gupta/wattomation-by-opsiys.git
cd wattomation-by-opsiys

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.local.example .env.local
# Edit .env.local with your Supabase URL, anon key, and Meta secrets

# 4. Start the development server
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) to view your workspace.

---

## Production Deployment (Vercel)

Wattomation is optimized for deployment on **Vercel** with **Supabase**.

1. Connect your repository (`adiitya-gupta/wattomation-by-opsiys`) to Vercel.
2. Ensure Node.js version is set to `22.x` in Project Settings.
3. Configure the required environment variables in your Vercel Project Settings:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ENCRYPTION_KEY` (64 hex characters)
   - `AUTOMATION_CRON_SECRET` (generate a secure random 32-byte secret)
   - `PLATFORM_ADMIN_EMAILS`
   - `UPSTASH_REDIS_REST_URL` & `UPSTASH_REDIS_REST_TOKEN`
4. Deploy the project on Vercel.

### Scheduling Automations & Flows (Vercel Hobby & External Schedulers)

Vercel Hobby accounts do not permit sub-daily cron jobs (such as `* * * * *`). To preserve 1-minute execution fidelity for timed WhatsApp follow-ups and flow sweeps without requiring Vercel Pro, configure a free external scheduler (e.g. [cron-job.org](https://cron-job.org), Upstash QStash, or your server's crontab) to trigger the two cron endpoints via HTTP `GET`:

1. **Automations Pending Executions Runner**:
   - **Method**: `GET`
   - **URL**: `https://<your-deployment-domain>/api/automations/cron`
   - **HTTP Header**: `x-cron-secret: <AUTOMATION_CRON_SECRET>`
   - **Frequency**: Every minute (`* * * * *`)
   - **Purpose**: Drains due delay/wait steps in WhatsApp automations and expires lapsed reply deadlines.

2. **Flows Stale Run Sweeper**:
   - **Method**: `GET`
   - **URL**: `https://<your-deployment-domain>/api/flows/cron`
   - **HTTP Header**: `x-cron-secret: <AUTOMATION_CRON_SECRET>`
   - **Frequency**: Every minute or every 5 minutes (`*/5 * * * *`)
   - **Purpose**: Sweeps abandoned interactive flows past their timeout (default 24h) and frees contacts to start new flows.

> [!SECURITY]
> **Security Requirement**: Always pass the secret securely in the `x-cron-secret` HTTP header (or `Authorization: Bearer <secret>`). Never pass the secret in URL query parameters, client-side code, or commit it to Git.

---

## Documentation

- [**Complete User Manual**](./docs/manuals/WATTOMATION_COMPLETE_USER_MANUAL.md) — Comprehensive guide to AI Agents, Visual Flows (Beta), Automations, and CRM modules.
- [**Operator Quick-Start Guide**](./docs/manuals/WATTOMATION_QUICK_START.md) — Fast-track 15-minute setup checklist for new workspaces.
- [**Documentation Master Index**](./docs/README.md) — Index of all operational manuals, technical audits, and API references.

---

## Tech Stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **Runtime**: React 19, Node.js 22
- **Language**: TypeScript (Strict Mode)
- **Styling**: Tailwind CSS v4, Lucide Icons
- **Database & Auth**: Supabase (Postgres, Auth, RLS, Storage, Vector)
- **Messaging**: Meta Cloud API (WhatsApp Business Platform)
- **Rate Limiting**: Upstash Redis (Distributed fail-closed)
- **Model Context Protocol**: MCP Server in `mcp-server/`

---

## License

This project is licensed under the [MIT License](./LICENSE).

**Wattomation** is a brand of **OPSIYS**. All rights reserved.
