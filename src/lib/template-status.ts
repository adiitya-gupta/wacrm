/**
 * Shared display config for message_templates.status.
 *
 * The DB stores Meta's raw enum (DRAFT / APPROVED / PENDING / REJECTED /
 * PAUSED / DISABLED / IN_APPEAL / PENDING_DELETION) — the UI maps it to
 * a human label + dark-theme badge classes here so the template manager,
 * inbox picker, and broadcast picker stay aligned.
 */

import type { MessageTemplateStatus } from '@/types';
import { getT } from '@/lib/i18n/translate';

export interface TemplateStatusDisplay {
  label: string;
  classes: string;
}

const t = getT('TemplateStatus');

export const templateStatusConfig: Record<
  MessageTemplateStatus,
  TemplateStatusDisplay
> = {
  DRAFT: {
    label: t('DRAFT'),
    classes: 'bg-[#F1F5F9] text-[#64748B] border-[#E5E9F2]',
  },
  PENDING: {
    label: t('PENDING'),
    classes: 'bg-[#FEF3C7] text-[#D97706] border-[#FDE68A]',
  },
  APPROVED: {
    label: t('APPROVED'),
    classes: 'bg-[#DCFCE7] text-[#16A34A] border-[#BBF7D0]',
  },
  REJECTED: {
    label: t('REJECTED'),
    classes: 'bg-[#FEE2E2] text-[#DC2626] border-[#FECACA]',
  },
  PAUSED: {
    label: t('PAUSED'),
    classes: 'bg-[#FEF3C7] text-[#D97706] border-[#FDE68A]',
  },
  DISABLED: {
    label: t('DISABLED'),
    classes: 'bg-[#FEE2E2] text-[#DC2626] border-[#FECACA]',
  },
  IN_APPEAL: {
    label: t('IN_APPEAL'),
    classes: 'bg-[#E0F2FE] text-[#0284C7] border-[#BAE6FD]',
  },
  PENDING_DELETION: {
    label: t('PENDING_DELETION'),
    classes: 'bg-[#F1F5F9] text-[#64748B] border-[#E5E9F2]',
  },
};
