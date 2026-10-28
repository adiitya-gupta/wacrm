# Wattomation AI Conversation Fix & Safe Deployment Operations Manual

## 1. Executive Summary & Root Cause

### 1.1 Problem Statement
In Wattomation, multi-turn WhatsApp customer conversations ceased after the AI Agent asked:
> *"Thanks Siddharth Pandey! What's your work email?"*

When customers provided their work email address (e.g. `siddharth@example.com`), Wattomation stopped generating responses, leaving the customer in dead silence.

### 1.2 Root Cause Analysis
Runtime tracing and database forensics across account `7498de6d-f333-457d-8545-ef34fdd10c54`, contact `d515a448-b4b1-4f35-ab35-9ae28a5fffe2` (Siddharth Pandey), conversation `d0dbac44-08f4-4790-b6d6-1bc5c9b84c65`, and flow run `a6aff673-51bf-4028-a40d-801c81f41c07` identified three distinct points of failure:

1. **Lead Capture Visual Flow Silent Termination:**
   - In `src/lib/flows/templates.ts`, the `lead_capture` flow asked for name, work email, and company, followed by a `handoff` node.
   - The template had no `handoff_message` defined.
   - In `src/lib/flows/engine.ts` (`executeHandoff`), `if (cfg.handoff_message)` evaluated to `false`. Zero WhatsApp messages were dispatched, the flow run was terminated as `handed_off`, and captured contact fields (`run.vars`) were never synced to the `contacts` table.

2. **AI Qualification Engine Email False-Positive & Missing Acknowledgment:**
   - In `src/lib/ai/flow-manager.ts` (`matchServiceFromCatalog`), the string comparison `(lower.includes('email') && sLower.includes('email'))` falsely matched the service *"Email & Marketing Automation"* whenever a customer provided an email address or stated `"my email is..."`, prematurely forcing the conversation into Stage B (`STAGE_B_ACKNOWLEDGE_SERVICE`).
   - If handled in discovery mode, `processConversationFlow` lacked email address extraction, never persisted the email to `state.informationCollected['email']` or `contacts.email`, and did not transition qualification state, causing the conversation to stall.

3. **Webhook Conversation Mode Resolution Fallback:**
   - In `src/lib/ai/config.ts`, `loadAiConfig` threw an uncaught exception if API key decryption failed.
   - During mode resolution in `src/app/api/whatsapp/webhook/route.ts`, this exception caused `aiConfig` to be `null`, resulting in `resolveConversationMode(null)` falling back to `'flow_first'`, which routed the customer into the silent visual flow.

---

## 2. Inventory of Files Changed & Technical Rationale

| File Path | Description of Changes |
|---|---|
| `src/lib/ai/flow-manager.ts` | Added `isStatingEmail` & `hasEmailServiceIntent` checks to `matchServiceFromCatalog` to prevent false-positives; extracted email and name into `state.informationCollected` and persisted to `contacts`; added Step 8B acknowledging work email by name (`"Thanks [name]! I've noted your work email ([email]). Which of our core services would make the biggest difference for your business right now?..."`) and advancing qualification state to `STAGE_A_UNDERSTAND` / `REQUIREMENT_DISCOVERY` while keeping `handoff: false`. |
| `src/lib/flows/templates.ts` | Added `handoff_message: t("lead_capture.handoffMessage", { name: "{{vars.name}}" })` to the `handoff` node of the `LEAD_CAPTURE` starter template. |
| `src/lib/flows/engine.ts` | Updated `executeHandoff` to sync `run.vars` (`name`, `email`, `company`) to `contacts` table with tenant-scoping (`.eq("account_id", run.account_id)`); provided a safe fallback handoff message to eliminate dead-end silence; updated `interpolateVars` regex to support both `{{vars.foo}}` and `{{foo}}`. |
| `src/lib/ai/config.ts` | Added `requireDecryptedKey?: boolean` (default `true`) to `loadAiConfig`. When `false`, key decryption errors set `apiKey = ''` without throwing. |
| `src/app/api/whatsapp/webhook/route.ts` | Configured mode resolution to call `loadAiConfig` with `{ requireActive: false, requireDecryptedKey: false }` to avoid unexpected fallback to `'flow_first'`. |
| `messages/en.json`, `es.json`, `ko.json`, `pt.json` | Added `StarterFlows.lead_capture.handoffMessage` across all locale catalogs. |
| `src/lib/ai/flow-manager.test.ts` | Added tests verifying email false-positive prevention and end-to-end multi-turn continuity past the work email step through pricing inquiry. |
| `src/app/api/whatsapp/webhook/conversation-ownership.test.ts` | Added webhook tests verifying Turns 1 through 4 under single-ownership anti-contradiction rules. |

---

## 3. Conversation Ownership Modes

Wattomation enforces three distinct conversation ownership policies:

1. **`ai_agent` (Default Recommended):**
   - The AI Agent owns natural dialogue, greetings, and qualification.
   - Conversational automations with static greetings (e.g. `Welcome Message`) are automatically suppressed (`suppressConversationalReplies: true`) to avoid duplicate greetings.
   - Non-conversational automations (e.g. tag additions, webhooks, internal notifications) continue to execute in the background.

2. **`flow_first`:**
   - Active visual Flows (e.g. `Welcome menu` or `Lead capture`) take precedence.
   - Inbound messages consumed by an active flow do not trigger plain-text AI replies.
   - Handoff nodes can delegate control to a human agent or to the AI Agent (`target: "ai_agent"`).

3. **`automation_first`:**
   - Explicitly configured conversational automations handle initial responses.
   - AI auto-reply stands down when an automation replies.

---

## 4. Verification & Testing Evidence

All validation gates passed with exit code 0:

| Verification Suite | Command | Result |
|---|---|---|
| AI Flow Manager Tests | `npx vitest run src/lib/ai/flow-manager.test.ts` | **12 / 12 passed** |
| Conversation Ownership Webhook Tests | `npx vitest run src/app/api/whatsapp/webhook/conversation-ownership.test.ts` | **16 / 16 passed** |
| Visual Flow Engine Tests | `npx vitest run src/lib/flows/` | **120 / 120 passed** (6 files) |
| Automation Engine Tests | `npx vitest run src/lib/automations/` | **93 / 93 passed** (4 files) |
| Multi-Tenant Isolation & Contact Tests | `npx vitest run src/lib/contacts/ src/lib/auth/cross-tenant-isolation.test.ts` | **53 / 53 passed** (6 files) |
| Internationalization Parity Tests | `npx vitest run src/i18n/` | **11 / 11 passed** (2 files) |
| Full Test Suite | `npm test` | **1,656 / 1,656 passed** (144 files) |
| TypeScript Compiler Check | `npx tsc --noEmit` | **0 errors (Exit 0)** |
| ESLint Check (Modified Modules) | `npx eslint src/app/api/whatsapp/webhook/ src/lib/ai/ src/lib/flows/ src/lib/automations/ src/components/flows/ src/components/settings/` | **0 errors (Exit 0)** |
| Whitespace & Git Diff Check | `git diff --check` | **0 errors (Exit 0)** |
| Next.js Production Build | `npm run build` | **Compiled in 3.3s, 82/82 static pages generated (Exit 0)** |

---

## 5. Existing Configuration Preservation & Read-Only Audit

A read-only baseline database audit confirmed all production records remain intact:

- **Accounts:** 2 active accounts (`7498de6d-f333-457d-8545-ef34fdd10c54` and `f76c6222-7a65-4253-bafb-bdbc3926cbc6`).
- **AI Configurations:** 1 active configuration (`5924af99-547e-47d9-b2a8-e47d6eac6687`), provider `openai_compatible`, model `@cf/meta/llama-3.1-8b-instruct`, `is_active: true`, `auto_reply_enabled: true`.
- **Flows:** 2 active flows:
  - `745579b4-e1f7-4ec4-a441-9d2debfcf787` (`Welcome menu`, keyword-triggered, active).
  - `20247df1-089a-4030-bdf7-930bf653d5dd` (`Lead capture`, first-inbound-triggered, active).
- **Automations:** 1 automation (`d957505e-3ad7-4778-b084-13fa1af6be1d`, `Welcome Message`, inactive).
- **WhatsApp Phone Pairing:** Active phone number ID `1348674765006699`, WABA ID `2274535760034702`, status `connected`, `mirror_inbound_media: true`.
- **Database Schema:** Zero destructive migrations required or applied.

---

## 6. How to Test & Verify in Staging

### 6.1 Multi-Turn AI Qualification Sequence
1. Send `hello` from a test phone number.
   - *Expected:* AI sends a personalized welcome and asks for the contact's name.
2. Reply with your name (e.g. `Siddharth Pandey`).
   - *Expected:* AI responds: *"Thanks Siddharth Pandey! What's your work email?"*.
3. Reply with your work email (e.g. `siddharth@example.com`).
   - *Expected:* AI confirms receipt of the email and presents the service catalog.
4. Reply asking about a specific service (e.g. `Can you tell me about modern web development and pricing?`).
   - *Expected:* AI continues naturally with service details, pricing information, and an invitation to schedule a call.

### 6.2 Visual Flow Handoff Verification
1. Open Flow Builder and run the Lead Capture flow with a test contact.
2. Provide name, email, and company.
3. *Expected:* The handoff node executes, sends the configured handoff message, updates the contact's `name` and `email`, and transitions the conversation to `pending` or delegates to AI.

---

## 7. Diagnostic & Troubleshooting Guide

### 7.1 Inbound Message Not Received
- Verify Meta webhook configuration in Meta App Dashboard → WhatsApp → Configuration.
- Test endpoint health:
  ```bash
  curl -I https://wattomation-by-opsiys-lhmn.vercel.app/api/whatsapp/webhook
  # Expected: HTTP 400 {"error":"Missing verification parameters"}
  ```
- Check server logs for `[webhook] verification failed` or signature mismatches (`META_APP_SECRET`).

### 7.2 Inbound Received but No AI Reply
- Check if human agent is assigned (`conversations.assigned_agent_id`): human assignment suspends AI auto-reply.
- Check if conversation is opted-out (`conversations.ai_autoreply_disabled = true`).
- Check if conversation cap was reached (`conversations.ai_reply_count >= ai_configs.auto_reply_max_per_conversation`).
- Check server logs for `[ai config] API key could not be decrypted`.

### 7.3 Outbound WhatsApp Send Failure
- Check Meta API token validity in `whatsapp_config`.
- Inspect Meta API error code in logs:
  - Error `131030`: Recipient phone number not in allowed list for test WABAs.
  - Error `131026`: Message outside the 24-hour customer care window.

---

## 8. Rollback Procedure

If unexpected behavior occurs in production:

1. **Git Commit Rollback:**
   ```bash
   git revert HEAD
   git push github main
   ```
   Or checkout previous verified commit `ee9b497297debb3bbea5e22a9f74c429328d7b97`.

2. **Vercel Instant Rollback:**
   - Open Vercel Dashboard → `wattomation-by-opsiys` → Deployments.
   - Locate the previous stable deployment (`dpl_3GPhEbZtjnuYy2To7xU5gPpKj3ck` or previous commit `ee9b497`).
   - Click `...` → **Promote to Production**.
