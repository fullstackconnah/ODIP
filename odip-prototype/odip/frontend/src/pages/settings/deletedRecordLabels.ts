import type { AuditChange } from '@/api/hooks'
import { formatServiceDate } from '@/lib/format'
import { parseApiDate } from '@/lib/utils'
import { formatTime } from '@/lib/itineraryRows'

/** The record types the Deleted records filter lists, by the server's entity name; any other type still shows under All types. */
const TYPE_NAMES: Record<string, string> = {
  Shift: 'Shift',
  ShiftPattern: 'Shift pattern',
  StaffAvailability: 'Availability',
  ParticipantRiskEntry: 'Risk entry',
  ParticipantRoutine: 'Routine',
  ParticipantContactRole: 'Contact role',
  ComplianceItem: 'Compliance item',
  RestrictivePractice: 'Restrictive practice',
  RestrictivePracticeMonthlyReport: 'Restrictive practice report',
  ClaimLineItem: 'Claim line item',
}

/** "RestrictivePractice" -> "Restrictive practice" for a type with no entry above. */
const splitCase = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().replace(/^./, c => c.toUpperCase())

export const typeName = (entityType: string) => TYPE_NAMES[entityType] ?? splitCase(entityType)

export const TYPE_FILTER_ITEMS = [
  { value: '', label: 'All types' },
  ...Object.entries(TYPE_NAMES).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
]

// What the audit writes for a value is `ToString()` of the property, so a date or time arrives in whichever culture wrote it: ISO or d/M/yyyy,
// 24-hour or "9:00 AM". Anything not recognised is shown as it was kept, never dropped.
const held = (fields: AuditChange[], name: string) => fields.find(f => f.field === name)?.old?.toString().trim() || null

function dateText(value: string | null) {
  if (!value) return null
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(value)
  return formatServiceDate(dmy ? `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}` : value) || value
}

function timeText(value: string | null) {
  if (!value) return null
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/.exec(value)
  if (!m) return value
  if (!m[3]) return formatTime(`${m[1]}:${m[2]}`)
  return `${Number(m[1])}:${m[2]}${m[3].toLowerCase()}`
}

// An availability starts at an instant: its day is the viewer's, not the UTC one.
const instantDay = (value: string | null) => (value ? formatServiceDate(parseApiDate(value).toLocaleDateString('en-CA')) || value : null)

const NBSP = String.fromCharCode(160)
const range = (from: string | null, to: string | null) => (from && to ? `${from}${NBSP}${String.fromCharCode(0x2013, 0x2060)}${NBSP}${to}` : from ?? to)
const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ')

/** The first line of a deleted row: what it was, from the values it held. A type missing its fields falls back to its name or title, then to the type name. */
export function recordLabel(entityType: string, fields: AuditChange[]): string {
  const times = range(timeText(held(fields, 'StartTime')), timeText(held(fields, 'EndTime')))
  const fromFields =
    entityType === 'Shift' ? join(dateText(held(fields, 'ServiceDate')), times)
    : entityType === 'ShiftPattern' ? join(held(fields, 'DayOfWeek') && `Every ${held(fields, 'DayOfWeek')}`, times)
    : entityType === 'StaffAvailability' ? join(splitCase(held(fields, 'AvailabilityType') ?? ''), instantDay(held(fields, 'StartDateTime')))
    : entityType === 'ParticipantRiskEntry' ? held(fields, 'Description') ?? ''
    : ''
  return fromFields || ['Name', 'Title', 'Description', 'Notes'].map(f => held(fields, f)).find(Boolean) || typeName(entityType)
}
