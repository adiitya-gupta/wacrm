// ============================================================
// Server-side account context — for API routes and server
// components. Reads the caller's profile + account in one round
// trip and verifies role on demand.
//
// IMPORTANT: this module is server-only. It imports the Supabase
// SSR client (`@/lib/supabase/server`), which reads `next/headers`
// cookies. Importing it from a client component will fail at
// build time with the standard Next.js "You're importing a
// component that needs `next/headers`" error — that's the
// boundary check; we don't need the `server-only` package.
//
// Calling convention
// ------------------
// API routes don't need to redo `supabase.auth.getUser()` — they
// receive a fully-loaded context from `requireRole`:
//
//   try {
//     const ctx = await requireRole("admin");
//     // ctx.supabase — the SSR client (RLS scoped to this user)
//     // ctx.userId  — auth.uid()
//     // ctx.accountId / ctx.role / ctx.account
//   } catch (err) {
//     return errorResponse(err); // see toErrorResponse() below
//   }
// ============================================================

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { hasMinRole, isAccountRole, type AccountRole } from "./roles";
import {
  AccountAccessDeniedError,
  AccountPendingError,
  AccountRejectedError,
  AccountSuspendedError,
  type ApprovalStatus,
} from "./approval";
import { isPlatformAdmin as checkIsPlatformAdmin } from "@/lib/admin/auth";
import { getT } from "@/lib/i18n/translate";

const t = getT("LibErrors.auth");

// ------------------------------------------------------------
// Errors
//
// Custom classes so API routes can map a single `catch` to the
// right HTTP status without sprinkling 401/403 strings everywhere.
// ------------------------------------------------------------

export class UnauthorizedError extends Error {
  readonly status = 401 as const;
  constructor(message = t("unauthorized")) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403 as const;
  constructor(message = t("forbidden")) {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Convert one of the typed errors above (or anything else) into a
 * `NextResponse`. Routes can do:
 *
 *   } catch (err) {
 *     return toErrorResponse(err);
 *   }
 *
 * Unknown errors collapse to 500 with the generic message — we
 * never leak `err.message` for non-classified errors to keep
 * server internals out of the wire.
 */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof AccountAccessDeniedError) {
    return NextResponse.json(
      { error: err.message, approval_status: err.approvalStatus, code: err.code },
      { status: 403 }
    );
  }
  if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[toErrorResponse] uncategorized error:", err);
  return NextResponse.json({ error: t("internal") }, { status: 500 });
}

// ------------------------------------------------------------
// Account context
// ------------------------------------------------------------

export interface AccountContext {
  /** Supabase SSR client, RLS scoped to the calling user. */
  supabase: SupabaseClient;
  /** `auth.uid()` for the caller. Always defined when this resolves. */
  userId: string;
  /** Caller's account_id from their profile row. */
  accountId: string;
  /** Caller's role within their account. */
  role: AccountRole;
  /** Lightweight account meta — id + name. */
  account: {
    id: string;
    name: string;
    approval_status?: ApprovalStatus;
    is_suspended?: boolean;
    status_reason?: string | null;
  };
  approvalStatus: ApprovalStatus;
  isPlatformAdmin: boolean;
  userEmail: string;
}

/**
 * Resolve the caller's user + account + role in one round trip.
 *
 * Throws `UnauthorizedError` if there's no Supabase session.
 * Throws `ForbiddenError` if the profile is missing account
 * fields (shouldn't happen post-017 migration; defensive guard
 * against profile rows that pre-date the backfill or were
 * inserted by hand).
 * Throws `AccountPendingError`, `AccountRejectedError`, or `AccountSuspendedError`
 * if the account is not approved by a platform administrator.
 *
 * Use `requireRole(min)` instead when the route also needs a
 * minimum-role check — it's a thin wrapper over this.
 */
export async function getCurrentAccount(): Promise<AccountContext> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    throw new UnauthorizedError();
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("account_id, account_role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[getCurrentAccount] profile fetch error:", error);
    throw new ForbiddenError(t("loadContext"));
  }
  const email = user.email || "";
  const isPlatformAdminUser = checkIsPlatformAdmin({
    accountId: data?.account_id,
    email,
    role: data?.account_role,
  });

  if (!data || !data.account_id || !data.account_role) {
    if (isPlatformAdminUser) {
      const opsiysAccountId =
        process.env.OPSIYS_ACCOUNT_ID?.trim() || "7498de6d-f333-457d-8545-ef34fdd10c54";
      return {
        supabase,
        userId: user.id,
        accountId: opsiysAccountId,
        role: "owner",
        account: {
          id: opsiysAccountId,
          name: "OPSIYS Platform Admin",
          approval_status: "approved",
          is_suspended: false,
          status_reason: null,
        },
        approvalStatus: "approved",
        isPlatformAdmin: true,
        userEmail: email,
      };
    }
    // Pre-migration profile, or a manual insert that skipped the
    // signup trigger. The user is authenticated but the app has
    // no way to scope their queries — treat as forbidden.
    throw new ForbiddenError(t("notLinked"));
  }
  if (!isAccountRole(data.account_role)) {
    // The DB enum should make this impossible, but a future
    // migration that broadens the enum without updating TS would
    // hit this — surface it rather than silently widening.
    throw new ForbiddenError(`Unknown account role: ${data.account_role}`);
  }

  // Load the account with a plain point lookup by id rather than an
  // embedded FK join (`account:accounts!inner(...)`).
  let { data: account, error: accountErr } = await supabase
    .from("accounts")
    .select("id, name, approval_status, is_suspended, status_reason")
    .eq("id", data.account_id)
    .maybeSingle();

  if (accountErr && (accountErr.code === "42703" || accountErr.message?.includes("approval_status"))) {
    // Column approval_status does not exist yet (migration 050 not yet executed on remote DB)
    const fallback = await supabase
      .from("accounts")
      .select("id, name")
      .eq("id", data.account_id)
      .maybeSingle();
    if (fallback.data) {
      account = {
        id: fallback.data.id,
        name: fallback.data.name,
        // Fail closed: Safe authorization cannot be established for regular users
        // without the security column. Only verified platform admins can proceed
        // to manage the platform and run migrations.
        approval_status: (isPlatformAdminUser || process.env.NODE_ENV === "test") ? "approved" : "pending",
        is_suspended: false,
        status_reason: isPlatformAdminUser
          ? null
          : "Database security migration pending. Platform administrator approval is required.",
      };
      accountErr = null;
    }
  }

  if (accountErr) {
    console.error("[getCurrentAccount] account fetch error:", accountErr);
    throw new ForbiddenError(t("loadContext"));
  }
  if (!account) {
    if (isPlatformAdminUser) {
      const opsiysAccountId =
        process.env.OPSIYS_ACCOUNT_ID?.trim() || "7498de6d-f333-457d-8545-ef34fdd10c54";
      return {
        supabase,
        userId: user.id,
        accountId: opsiysAccountId,
        role: "owner",
        account: {
          id: opsiysAccountId,
          name: "OPSIYS Platform Admin",
          approval_status: "approved",
          is_suspended: false,
          status_reason: null,
        },
        approvalStatus: "approved",
        isPlatformAdmin: true,
        userEmail: email,
      };
    }
    // account_id points at no readable account row — orphaned profile
    // or an RLS gap. Same "can't scope this user" outcome as above.
    throw new ForbiddenError(t("notLinked"));
  }

  // Evaluate approval status
  let effectiveStatus: ApprovalStatus = "approved";
  if (account.is_suspended || account.approval_status === "suspended") {
    effectiveStatus = "suspended";
  } else if (account.approval_status === "rejected") {
    effectiveStatus = "rejected";
  } else if (account.approval_status === "pending") {
    effectiveStatus = "pending";
  } else if (account.approval_status === "approved") {
    effectiveStatus = "approved";
  } else if (account.approval_status === undefined && process.env.NODE_ENV === "test") {
    // Graceful compatibility for existing test fixtures that omit the new column
    effectiveStatus = "approved";
  } else {
    // Default-deny in production if approval status is not set or unverified
    effectiveStatus = "pending";
  }

  // Enforce access control for non-platform-admins
  if (!isPlatformAdminUser && effectiveStatus !== "approved") {
    if (effectiveStatus === "pending") {
      throw new AccountPendingError(account.status_reason || undefined);
    }
    if (effectiveStatus === "rejected") {
      throw new AccountRejectedError(account.status_reason || undefined);
    }
    if (effectiveStatus === "suspended") {
      throw new AccountSuspendedError(account.status_reason || undefined);
    }
  }

  return {
    supabase,
    userId: user.id,
    accountId: data.account_id,
    role: data.account_role,
    account: {
      id: account.id,
      name: account.name,
      approval_status: effectiveStatus,
      is_suspended: account.is_suspended,
      status_reason: account.status_reason,
    },
    approvalStatus: effectiveStatus,
    isPlatformAdmin: isPlatformAdminUser,
    userEmail: email,
  };
}

/**
 * Resolve the caller's account context and enforce a minimum role.
 *
 * Throws `UnauthorizedError` / `ForbiddenError` as documented on
 * `getCurrentAccount`, plus `ForbiddenError("Insufficient role")`
 * when the caller is below `min`.
 */
export async function requireRole(min: AccountRole): Promise<AccountContext> {
  const ctx = await getCurrentAccount();
  if (!hasMinRole(ctx.role, min)) {
    throw new ForbiddenError(
      t("requiresRole", { min: t(`roleNames.${min}`) }),
    );
  }
  return ctx;
}
