import type { IncidentSeverity, IncidentType, QscReportingStatus, ReportableClass } from '@/api/types/enums'
import { toDatetimeInputValue } from '@/lib/wallClock'

// Mirrors QscReporting.DefaultClass on the server: a critical incident, one of these types, or an unauthorised restrictive practice is due within 24 hours.
const REQUIRED_TYPES: readonly IncidentType[] = ['Abuse', 'Neglect', 'Death', 'RestrictivePracticeUse', 'MissingPerson']

export function defaultReportableClass(
  severity: IncidentSeverity | string | undefined,
  incidentType: IncidentType | string | undefined,
  isRestrictivePracticeAuthorised?: boolean | null,
): ReportableClass {
  // The flag decides on its own: an unauthorised restrictive practice is due in 24 hours whatever the type.
  return severity === 'Critical' || REQUIRED_TYPES.includes(incidentType as IncidentType) || isRestrictivePracticeAuthorised === false
    ? 'Within24h' : 'None'
}

/** "Fri 30 Oct 2026, 3:15 pm". Built from parts: en-AU puts a comma after the weekday and may print a narrow space before pm. No-break spaces keep the date together and the time with its am/pm. */
function formatParts(date: Date, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-AU', { ...options, timeZone }).formatToParts(date)
  } catch {
    parts = new Intl.DateTimeFormat('en-AU', options).formatToParts(date)
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('weekday')}\u00a0${get('day')}\u00a0${get('month')}\u00a0${get('year')}, ${get('hour')}:${get('minute')}\u00a0${get('dayPeriod').toLowerCase()}`
}

export const formatDueWhen = (iso: string, timeZone: string) => formatParts(new Date(iso), timeZone)

/** A provider-local wall-clock value (no zone) in the same form. */
const formatWallWhen = (wall: string) => formatParts(new Date(`${toDatetimeInputValue(wall)}:00Z`), 'UTC')

/** Whole units: minutes under an hour, hours under 2 days, then days. */
export function formatGap(ms: number): string {
  const minutes = Math.floor(Math.abs(ms) / 60_000)
  if (minutes < 1) return 'less than a minute'
  const unit = (n: number, word: string) => `${n}\u00a0${word}${n === 1 ? '' : 's'}`
  if (minutes < 60) return unit(minutes, 'minute')
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? unit(hours, 'hour') : unit(Math.floor(hours / 24), 'day')
}

export type ReportingDueInput = {
  reportableClass: ReportableClass
  qscReportingStatus: QscReportingStatus
  qscReportedAt: string | null
  notifyDueAt: string | null
  detailedReportDueAt: string | null
  commissionDetailedReportedAt: string | null
  dueCountedWithoutHolidays: boolean
  timeZoneId: string
}

export type DueLine = { text: string; tone?: 'overdue' | 'muted' }

/** The incident page's "NDIS Commission reporting" lines. Pure: the caller passes now. */
export function reportingDueLines(i: ReportingDueInput, now: Date): DueLine[] {
  if (i.reportableClass === 'None') return [{ text: 'Not reportable' }]
  const lines: DueLine[] = []
  const tz = i.timeZoneId
  if (i.qscReportingStatus === 'ReportedWithin24h') lines.push({ text: 'Reported on time' })
  else if (i.qscReportingStatus === 'ReportedLate') lines.push({ text: 'Reported late' })
  else if (i.notifyDueAt) {
    const gap = new Date(i.notifyDueAt).getTime() - now.getTime()
    lines.push(gap > 0
      ? { text: `Tell the NDIS Commission by ${formatDueWhen(i.notifyDueAt, tz)} (in\u00a0${formatGap(gap)})` }
      : { text: `Overdue by ${formatGap(gap)}`, tone: 'overdue' })
  }
  if (i.reportableClass === 'Within24h' && i.detailedReportDueAt) {
    if (i.commissionDetailedReportedAt) lines.push({ text: `5-day report sent ${formatWallWhen(i.commissionDetailedReportedAt)}` })
    else {
      const gap = new Date(i.detailedReportDueAt).getTime() - now.getTime()
      lines.push(gap > 0
        ? { text: `5-day report due by ${formatDueWhen(i.detailedReportDueAt, tz)}` }
        : { text: `5-day report overdue by ${formatGap(gap)}`, tone: 'overdue' })
    }
  }
  if (i.dueCountedWithoutHolidays) lines.push({ text: 'Counted without public holidays', tone: 'muted' })
  return lines
}
