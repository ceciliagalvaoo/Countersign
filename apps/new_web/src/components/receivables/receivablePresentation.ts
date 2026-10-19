import type { ChainProgress, Receivable } from '../../types/receivableChain';

export const receivablePanel = 'bg-cream-deep/70 border border-navy/10 rounded-card p-6 md:p-8 shadow-ink';
export const receivableInput = 'w-full rounded-lg px-3 py-2 bg-white/5 border border-white/15 text-white text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-cobalt focus:border-transparent transition';
export const primaryButton = 'inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
export const secondaryButton = 'inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

const labels: Record<string, string> = {
  NOT_REGISTERED: 'Not registered', PENDING: 'Pending', PAID: 'Paid', DISTRIBUTED: 'Distributed',
  CONFIRMED: 'Confirmed', PENDING_SIGNATURES: 'Awaiting signatures',
  SUBMITTED_UNVERIFIED: 'Awaiting verification', NOT_STARTED: 'Not started', EXPIRED: 'Expired',
};
export const statusLabel = (status: string) => labels[status] || status;
export const badgeClass = (status: string) =>
  ['CONFIRMED', 'DISTRIBUTED'].includes(status) ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' :
    status === 'PAID' ? 'border-sky-400/30 bg-sky-400/10 text-sky-200' :
      status === 'EXPIRED' ? 'border-red-400/30 bg-red-400/10 text-red-200' :
        ['PENDING', 'PENDING_SIGNATURES', 'SUBMITTED_UNVERIFIED'].includes(status) ? 'border-amber-400/30 bg-amber-400/10 text-amber-200' :
          'border-white/15 bg-white/5 text-white/60';

export const visibleSteps = (item: Receivable, progress?: ChainProgress | null) =>
  progress?.steps.filter(step => item.paidValue != null || !['pay', 'distribute'].includes(step.stepId || '')) || [];

export const formatReceivableDate = (value?: string | null) => value ?
  new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value)) : 'Not recorded';

export const formatReceivableTime = (value: string) => new Intl.DateTimeFormat('en-US', {
  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
}).format(new Date(value));
