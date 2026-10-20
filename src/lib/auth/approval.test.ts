import { describe, expect, it } from 'vitest';
import {
  isApprovalStatus,
  isApproved,
  isPending,
  isRejected,
  isSuspended,
  AccountPendingError,
  AccountRejectedError,
  AccountSuspendedError,
} from './approval';

describe('Account Approval Helpers', () => {
  it('validates approval statuses correctly', () => {
    expect(isApprovalStatus('pending')).toBe(true);
    expect(isApprovalStatus('approved')).toBe(true);
    expect(isApprovalStatus('rejected')).toBe(true);
    expect(isApprovalStatus('suspended')).toBe(true);
    expect(isApprovalStatus('invalid')).toBe(false);
    expect(isApprovalStatus(null)).toBe(false);
  });

  it('evaluates status predicates correctly', () => {
    expect(isApproved('approved')).toBe(true);
    expect(isApproved('pending')).toBe(false);

    expect(isPending('pending')).toBe(true);
    expect(isPending('approved')).toBe(false);

    expect(isRejected('rejected')).toBe(true);
    expect(isRejected('approved')).toBe(false);

    expect(isSuspended('suspended')).toBe(true);
    expect(isSuspended('approved', true)).toBe(true);
    expect(isSuspended('approved', false)).toBe(false);
  });

  it('constructs typed access denied errors with status 403 and codes', () => {
    const pendingErr = new AccountPendingError();
    expect(pendingErr.status).toBe(403);
    expect(pendingErr.approvalStatus).toBe('pending');
    expect(pendingErr.code).toBe('ACCOUNT_PENDING');

    const rejectedErr = new AccountRejectedError();
    expect(rejectedErr.status).toBe(403);
    expect(rejectedErr.approvalStatus).toBe('rejected');
    expect(rejectedErr.code).toBe('ACCOUNT_REJECTED');

    const suspendedErr = new AccountSuspendedError();
    expect(suspendedErr.status).toBe(403);
    expect(suspendedErr.approvalStatus).toBe('suspended');
    expect(suspendedErr.code).toBe('ACCOUNT_SUSPENDED');
  });
});
