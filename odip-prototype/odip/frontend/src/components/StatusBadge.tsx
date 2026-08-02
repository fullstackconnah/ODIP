export type StatusBadgeProps = {
  status: string
  label?: string
  colorMap?: Record<string, string>
  pulse?: boolean
  className?: string
}

const STATUS_COLORS: Record<string, string> = {
  // Booking / General
  confirmed: 'bg-[#bbf37c] text-[#0f2000]',
  completed: 'bg-[#bbf37c] text-[#0f2000]',
  available: 'bg-[#bbf37c] text-[#0f2000]',
  active: 'bg-[#bbf37c] text-[#0f2000]',
  draft: 'bg-[#e4e2de] text-[#43493a]',
  proposed: 'bg-[#e4e2de] text-[#43493a]',
  none: 'bg-[#e4e2de] text-[#43493a]',
  cancelled: 'bg-[#ffdad6] text-[#93000a]',
  unavailable: 'bg-[#ffdad6] text-[#93000a]',
  nolongerattending: 'bg-[#ffdad6] text-[#93000a]',
  expired: 'bg-[#ffdad6] text-[#93000a]',
  inactive: 'bg-[#ffdad6] text-[#93000a]',
  overdue: 'bg-[#ffdad6] text-[#93000a]',
  conflict: 'bg-[#ffdad6] text-[#93000a]',

  // Severity
  low: 'bg-[#d5e3fc] text-[#0d1c2e]',
  medium: 'bg-[#fef3c7] text-[#92400e]',
  high: 'bg-[#ffdad6] text-[#93000a]',
  critical: 'bg-[#ffdad6] text-[#93000a]',

  // Claims
  submitted: 'bg-blue-100 text-blue-700',
  paid: 'bg-[#bff285] text-[#294800]',
  rejected: 'bg-red-100 text-red-700',
  partiallypaid: 'bg-amber-100 text-amber-700',

  // QSC
  reportedwithin24h: 'bg-[#bbf37c] text-[#0f2000]',
  reportedlate: 'bg-[#fef3c7] text-[#92400e]',
  required: 'bg-[#ffdad6] text-[#93000a]',
  pending: 'bg-[#fef3c7] text-[#92400e]',
  notrequired: 'bg-[#e4e2de] text-[#43493a]',

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
