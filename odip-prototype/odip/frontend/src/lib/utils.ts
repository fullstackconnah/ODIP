import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function maskNdisNumber(ndis: string | null | undefined): string {
  if (!ndis) return '—'
  return '••••••••' + ndis.slice(-1)
}

/**
 * Parses an API-supplied ISO timestamp. The backend serializes some DateTime values
 * (e.g. DateTime.UtcNow) without a timezone suffix even though they are UTC — `new Date(iso)`
 * would then parse them as local time, throwing off elapsed-time math. If the string has no
 * trailing `Z` or `+HH:MM`/`-HH:MM` offset, treat it as UTC by appending `Z`; otherwise parse
 * as-is (it already carries explicit timezone info, e.g. from a DateTimeOffset).
 */
export function parseApiDate(iso: string): Date {
  const hasTimezone = /(Z|[+-]\d{2}:\d{2})$/.test(iso)
  return new Date(hasTimezone ? iso : `${iso}Z`)
}

export function formatDateAu(date: string | null | undefined): string {
  if (!date) return '—'
  const d = new Date(date)
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function getStatusColor(status: string): string {
  const s = status.toLowerCase()
  if (['confirmed', 'completed', 'available'].includes(s)) return 'bg-[#bbf37c] text-[#0f2000]'
  if (['draft', 'proposed'].includes(s)) return 'bg-[#e4e2de] text-[#43493a]'
  if (['cancelled', 'unavailable', 'nolongerattending', 'expired'].includes(s)) return 'bg-[#ffdad6] text-[var(--color-on-error-container)]'
  if (['overdue', 'conflict'].includes(s)) return 'bg-[#ffdad6] text-[var(--color-on-error-container)]'
  if (['none'].includes(s)) return 'bg-[#e4e2de] text-[#43493a]'
  return 'bg-[#fef3c7] text-[#92400e]'
}

export function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return '—'
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(amount)
}
