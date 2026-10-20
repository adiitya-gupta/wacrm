// ============================================================
// Account Approval & Access Status Helpers
//
// Governs platform-wide authorization where accounts must be explicitly
// approved by the platform administrator before accessing the product.
// ============================================================

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export const APPROVAL_STATUSES: readonly ApprovalStatus[] = [
  'pending',
  'approved',
  'rejected',
  'suspended',
] as const;

export function isApprovalStatus(value: unknown): value is ApprovalStatus {
  return typeof value === 'string' && (APPROVAL_STATUSES as readonly string[]).includes(value);
}

export function isApproved(status: ApprovalStatus | string | null | undefined): boolean {
  return status === 'approved';
}

export function isPending(status: ApprovalStatus | string | null | undefined): boolean {
  return status === 'pending';
}

export function isRejected(status: ApprovalStatus | string | null | undefined): boolean {
  return status === 'rejected';
}

export function isSuspended(
  status: ApprovalStatus | string | null | undefined,
  isSuspendedFlag?: boolean
): boolean {
  return status === 'suspended' || Boolean(isSuspendedFlag);
}

export class AccountAccessDeniedError extends Error {
  readonly status = 403 as const;
  readonly approvalStatus: ApprovalStatus;
  readonly code: string;

  constructor(
    approvalStatus: ApprovalStatus,
    message: string,
    code: string
  ) {
    super(message);
    this.name = 'AccountAccessDeniedError';
    this.approvalStatus = approvalStatus;
    this.code = code;
  }
}

export class AccountPendingError extends AccountAccessDeniedError {
  constructor(message = 'Your account is awaiting platform administrator approval.') {
    super('pending', message, 'ACCOUNT_PENDING');
    this.name = 'AccountPendingError';
  }
}

export class AccountRejectedError extends AccountAccessDeniedError {
  constructor(message = 'Your account registration has been rejected by the administrator.') {
    super('rejected', message, 'ACCOUNT_REJECTED');
    this.name = 'AccountRejectedError';
  }
}

export class AccountSuspendedError extends AccountAccessDeniedError {
  constructor(message = 'Your account access has been suspended by the platform administrator.') {
    super('suspended', message, 'ACCOUNT_SUSPENDED');
    this.name = 'AccountSuspendedError';
  }
}
