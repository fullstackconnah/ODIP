export type StatusBadgeSize = 'sm' | 'md'

export type StatusBadgeProps = {
  status: string
  label?: string
  colorMap?: Record<string, string>
  pulse?: boolean
  className?: string
  /**
   * `sm` (default) is the 12px pill used in tables and inline. `md` is the 13px semibold, 24px-tall pill that
   * leads the meta row of a detail-page header (see `PageHeaderMeta`). Colour is the same at both sizes.
   */
  size?: StatusBadgeSize
}

// `sm` is exactly the pill every existing caller renders; only `md` is new.
const SIZE_CLASS: Record<StatusBadgeSize, string> = {
  sm: 'text-xs px-2 py-0.5',
  md: 'text-[13px] leading-5 font-semibold px-2.5 py-0.5',
}

const STATUS_COLORS: Record<string, string> = {
  // Booking / General
  confirmed: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
  completed: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
  available: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
  active: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
  draft: 'bg-[var(--color-input)] text-[var(--color-muted-foreground)]',
  proposed: 'bg-[var(--color-input)] text-[var(--color-muted-foreground)]',
  none: 'bg-[var(--color-input)] text-[var(--color-muted-foreground)]',
  archived: 'bg-[var(--color-input)] text-[var(--color-muted-foreground)]',
  cancelled: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
  unavailable: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
  nolongerattending: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
  expired: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
  inactive: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
  overdue: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
  conflict: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',

  // Severity
  low: 'bg-[var(--color-secondary-container)] text-[var(--color-info)]',
  medium: 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]',
  high: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
  critical: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',

  // Claims
  submitted: 'bg-[var(--color-secondary-container)] text-[var(--color-info)]',
  paid: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
  rejected: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
  partiallypaid: 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]',

  // QSC
  reportedwithin24h: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
  reportedlate: 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]',
  required: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
  pending: 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]',
  notrequired: 'bg-[var(--color-input)] text-[var(--color-muted-foreground)]',

  // Plan types
  ndiamanaged: 'bg-[var(--color-secondary-container)] text-[var(--color-info)]',
  planmanaged: 'bg-[var(--color-accessible-container)] text-[var(--color-on-accessible-container)]',
  selfmanaged: 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]',

  // Lifecycle worklists (Inquiries/Onboarding)
  new: 'bg-[var(--color-surface-container)] text-[var(--color-muted-foreground)]',
  draftintake: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
  complete: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
  needsattention: 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]',
  blocked: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
  // Stalled: in progress but not moving (no progress, still open). Muted warning, not an error.
  stalled: 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]',

  // Service agreement drafts
  unapproveddraft: 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]',
  approvedforelectronicsigning: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
}

const DEFAULT_COLOR = 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]'

export function StatusBadge({ status, label, colorMap, pulse, className, size = 'sm' }: StatusBadgeProps) {
  const key = status.toLowerCase().replace(/\s+/g, '')
  const color = colorMap?.[key] ?? STATUS_COLORS[key] ?? DEFAULT_COLOR
  return (
    <span className={`${SIZE_CLASS[size]} rounded-full ${color} ${pulse ? 'animate-pulse' : ''} ${className ?? ''}`}>
      {label ?? status}
    </span>
  )
}
