export type StatusBadgeProps = {
  status: string
  label?: string
  colorMap?: Record<string, string>
  pulse?: boolean
  className?: string
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
  cancelled: 'bg-[var(--color-error-container)] text-[#93000a]',
  unavailable: 'bg-[var(--color-error-container)] text-[#93000a]',
  nolongerattending: 'bg-[var(--color-error-container)] text-[#93000a]',
  expired: 'bg-[var(--color-error-container)] text-[#93000a]',
  inactive: 'bg-[var(--color-error-container)] text-[#93000a]',
  overdue: 'bg-[var(--color-error-container)] text-[#93000a]',
  conflict: 'bg-[var(--color-error-container)] text-[#93000a]',

  // Severity
  low: 'bg-[var(--color-secondary-container)] text-[#0d1c2e]',
  medium: 'bg-[#fef3c7] text-[#92400e]',
  high: 'bg-[var(--color-error-container)] text-[#93000a]',
  critical: 'bg-[var(--color-error-container)] text-[#93000a]',

  // Claims
  submitted: 'bg-blue-100 text-blue-700',
  paid: 'bg-[#bff285] text-[#294800]',
  rejected: 'bg-red-100 text-red-700',
  partiallypaid: 'bg-amber-100 text-amber-700',

  // QSC
  reportedwithin24h: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
  reportedlate: 'bg-[#fef3c7] text-[#92400e]',
  required: 'bg-[var(--color-error-container)] text-[#93000a]',
  pending: 'bg-[#fef3c7] text-[#92400e]',
  notrequired: 'bg-[var(--color-input)] text-[var(--color-muted-foreground)]',

  // Plan types
  ndiamanaged: 'bg-blue-100 text-blue-700',
  planmanaged: 'bg-purple-100 text-purple-700',
  selfmanaged: 'bg-orange-100 text-orange-700',
}

const DEFAULT_COLOR = 'bg-[#fef3c7] text-[#92400e]'

export function StatusBadge({ status, label, colorMap, pulse, className }: StatusBadgeProps) {
  const key = status.toLowerCase().replace(/\s+/g, '')
  const color = colorMap?.[key] ?? STATUS_COLORS[key] ?? DEFAULT_COLOR
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${color} ${pulse ? 'animate-pulse' : ''} ${className ?? ''}`}>
      {label ?? status}
    </span>
  )
}
