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

/**
 * Reads the browser's IANA time zone (e.g. "Australia/Sydney") to attach to a client-captured
 * timestamp — see MED-04 (RecordAdministrationModal). Returns undefined rather than throwing in
 * environments where `Intl` support is missing/unusual (very old browsers, some jsdom/test
 * configs); callers omitting the field is exactly the documented no-JS-timestamp fallback shape
 * the backend already handles gracefully.
 */
export function getClientTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
  }
}

/**
 * Formats an API timestamp using the time zone it was actually recorded in, when known — so the
 * MAR, administration report, and witness-approvals queue show a dose time the way it looked to
 * the person who gave it, rather than reinterpreting the same UTC instant in whichever zone the
 * *viewing* browser happens to be in right now. Falls back to the viewer's local zone when
 * `timeZone` is null/undefined (no client-supplied timestamp was captured — the no-JS fallback —
 * or the record predates this field) or when it's a string `Intl` doesn't recognise (defensive:
 * never let a bad/legacy zone value blank out a timestamp).
 */
export function formatWithTimeZone(
  iso: string | null | undefined,
  timeZone: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
  locale: string | undefined = 'en-AU',
): string {
  if (!iso) return '—'
  const date = parseApiDate(iso)
  try {
    return date.toLocaleString(locale, timeZone ? { ...options, timeZone } : options)
  } catch {
    return date.toLocaleString(locale, options)
  }
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

/**
 * Formats "HH:mm:ss" or "HH:mm" as "h:mma" (lowercase, no space) for compact tabular display —
 * e.g. shift times on the rostering board and routine times on the participant detail page.
 * Shared here so both call sites use one implementation instead of two copies drifting apart.
 */
export function formatShiftTime(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const period = h >= 12 ? 'pm' : 'am'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hour12}${period}` : `${hour12}:${String(m).padStart(2, '0')}${period}`
}
