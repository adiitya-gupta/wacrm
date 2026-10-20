# External Cron Scheduling Guide (Vercel Hobby & Self-Hosted)

This guide explains how to schedule background jobs for Wattomation when deploying on the **Vercel Hobby plan** or running on a containerized/self-hosted environment.

---

## Why External Scheduling is Used

On the **Vercel Hobby plan**, Vercel restricts built-in cron jobs to run at most **once per 24 hours**. Schedules more frequent than once a day (such as every minute `* * * * *`) are rejected by Vercel during deployment.

Wattomation features two time-sensitive background maintenance tasks that require frequent execution:

1. **Automations Pending Executions Runner** (`/api/automations/cron`):
   - **Method**: `GET`
   - **Recommended Frequency**: Every 1 minute (`* * * * *`)
   - **What it does**: Drains pending delay/wait steps in WhatsApp automations (e.g. *Wait 10 minutes then send message*) and expires unreplied interactive menus once their 24-hour reply window passes.
   - **Impact if omitted**: Follow-up messages will not trigger at the scheduled time.

2. **Flows Stale Run Sweeper** (`/api/flows/cron`):
   - **Method**: `GET`
   - **Recommended Frequency**: Every 1 to 5 minutes (`*/5 * * * *`)
   - **What it does**: Sweeps abandoned interactive flow runs whose inactivity exceeds the flow's timeout policy (default 24 hours), marking them `timed_out`.
   - **Impact if omitted**: Abandoned runs will continue to hold the partial unique index lock (`idx_one_active_run_per_contact`), preventing contacts from triggering new flows.

---

## Authentication & Security

Both endpoints are protected with constant-time cryptographic verification against the environment variable:

```bash
AUTOMATION_CRON_SECRET=your-32-byte-random-secret
```

### Security Rules
- **Header Only**: Always pass the secret in the HTTP request header:
  - Header name: `x-cron-secret` (or `Authorization: Bearer <secret>`)
  - Value: The exact value of `AUTOMATION_CRON_SECRET`
- **Never put secrets in URLs**: Do not append the secret as a query parameter (e.g. `?secret=...`). Query parameters can leak into access logs, browser history, and proxy headers.
- **Never commit secrets**: Do not hardcode or commit `AUTOMATION_CRON_SECRET` to source control.

---

## Setup with Free External Schedulers

### Option 1: cron-job.org (Free, 1-Minute Precision)

1. Create a free account at [cron-job.org](https://cron-job.org).
2. Create **Cronjob 1 (Automations)**:
   - **Title**: `Wattomation - Automations Cron`
   - **URL**: `https://<your-vercel-domain>/api/automations/cron`
   - **Request Method**: `GET`
   - **Schedule**: `Every 1 minute`
   - **Advanced > Request Headers**:
     - Key: `x-cron-secret`
     - Value: `<your-AUTOMATION_CRON_SECRET>`
3. Create **Cronjob 2 (Flows)**:
   - **Title**: `Wattomation - Flows Sweeper`
   - **URL**: `https://<your-vercel-domain>/api/flows/cron`
   - **Request Method**: `GET`
   - **Schedule**: `Every 1 minute` (or `Every 5 minutes`)
   - **Advanced > Request Headers**:
     - Key: `x-cron-secret`
     - Value: `<your-AUTOMATION_CRON_SECRET>`

---

### Option 2: Linux / Server Crontab

If you run a companion Linux server or background VPS, add the following to `crontab -e`:

```bash
# Wattomation Automations Cron (every minute)
* * * * * curl -s -H "x-cron-secret: $AUTOMATION_CRON_SECRET" https://<your-vercel-domain>/api/automations/cron > /dev/null

# Wattomation Flows Stale Run Sweep (every 5 minutes)
*/5 * * * * curl -s -H "x-cron-secret: $AUTOMATION_CRON_SECRET" https://<your-vercel-domain>/api/flows/cron > /dev/null
```

---

### Option 3: Supabase `pg_cron` (Database-Native)

If your Supabase project has `pg_cron` and `pg_net` enabled:

```sql
SELECT cron.schedule(
  'wattomation-automations-cron',
  '* * * * *',
  $$
  SELECT net.http_get(
    url := 'https://<your-vercel-domain>/api/automations/cron',
    headers := jsonb_build_object('x-cron-secret', '<your-AUTOMATION_CRON_SECRET>')
  );
  $$
);

SELECT cron.schedule(
  'wattomation-flows-cron',
  '*/5 * * * *',
  $$
  SELECT net.http_get(
    url := 'https://<your-vercel-domain>/api/flows/cron',
    headers := jsonb_build_object('x-cron-secret', '<your-AUTOMATION_CRON_SECRET>')
  );
  $$
);
```

---

## Verifying Endpoint Responses

You can verify both endpoints from your terminal using `curl`:

```bash
# 1. Automations Cron (expect HTTP 200 {"processed":0,"expired":0})
curl -i -H "x-cron-secret: YOUR_SECRET" https://<your-vercel-domain>/api/automations/cron

# 2. Flows Cron (expect HTTP 200 {"swept":0})
curl -i -H "x-cron-secret: YOUR_SECRET" https://<your-vercel-domain>/api/flows/cron
```

If the secret is missing or incorrect, both endpoints return:
```json
HTTP/1.1 401 Unauthorized
{"error": "Unauthorized"}
```

If `AUTOMATION_CRON_SECRET` is unset in the environment, both endpoints return:
```json
HTTP/1.1 503 Service Unavailable
{"error": "cron not configured"}
```
