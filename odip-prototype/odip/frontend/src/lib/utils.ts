import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { AxiosError } from 'axios'
import { statusClass } from './tone'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Surfaces the server's ApiResponse error message (first validation error, else the top-level
 * message, else the caller's fallback) for display in a form/banner. Shared here so the many
 * call sites across the app use one implementation instead of copy-pasted drift.
 */
export function extractErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as AxiosError<{ message?: string; errors?: string[] }>
  return axiosErr?.response?.data?.errors?.[0] || axiosErr?.response?.data?.message || fallback
}

export function maskNdisNumber(ndis: string | null | undefined): string {
  if (!ndis) return '—'
  return '••••••••' + ndis.slice(-1)
}

/**
 * Parses an API-supplied INSTANT (created, logged in, dose given). The API sends every instant as UTC with a trailing `Z` (DESIGN.md, "Time
 * on the wire"), so `new Date(iso)` is already exact; this also reads one that arrives without a zone (an older response, a hand-built
 * fixture) as UTC rather than as the browser's local time, which is 10-11 hours wrong in Sydney. If the string has no trailing `Z` or
 * `+HH:MM`/`-HH:MM` offset it appends `Z`; otherwise it parses as-is. Do NOT use it for a provider-local wall-clock value (an incident time
 * somebody typed, a dose slot): that has no zone on purpose and its digits are the answer, so it goes through lib/wallClock.ts.
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
  // A date-only value ("2026-08-14") is a calendar day: read it as that day, not as UTC midnight, which is the previous day in any zone west of UTC.
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const d = parts ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])) : new Date(date)
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/**
 * The pill colour for a booking, task, vehicle or insurance status (the Dropdown pill triggers and a few inline pills). It is `statusClass`:
 * the one status table of lib/tone.ts, so a word has the same colour here as on a StatusBadge, and a status nobody listed is neutral, never
 * the amber "awaiting a decision" pair. (It used to keep a four-word table of its own, which sent Enquiry, Held, Waitlist, In progress and
 * Not started to amber and disagreed with the trip pills.)
 */
export function getStatusColor(status: string): string {
  return statusClass(status)
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
