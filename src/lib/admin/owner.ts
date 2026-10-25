// ============================================================
// Authoritative Platform Owner definitions
//
// Safe for import in both server and client components (no Node/headers dependencies).
// ============================================================

export const PERMANENT_PLATFORM_OWNER_EMAIL = 'adityaofficial9918@gmail.com';

/**
 * Check whether a given email address belongs to the permanent Platform Owner.
 * Comparison is case-insensitive and trims whitespace.
 */
export function isPermanentPlatformOwner(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === PERMANENT_PLATFORM_OWNER_EMAIL.toLowerCase();
}
