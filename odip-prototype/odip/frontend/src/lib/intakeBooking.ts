// The intake visit as the screens show and edit it. Times are instants (UTC, Z) shown and entered in the PROVIDER's zone (the DTO's
// timeZoneId), never the browser's, so a coordinator in another state still sees the family's 10:00 am. Pure and JSX-free.
import type { CancelIntakeBookingResultDto, IntakeInviteError, IntakeVisitDto, ParticipantInquiryDto, SetIntakeBookingDto } from '@/api/types/inquiries'
import type { StaffListDto } from '@/api/types'
import { parseApiDate } from '@/lib/utils'
import { providerLocalToUtcInstant, utcInstantToProviderLocal } from '@/pages/portal/shift/shiftTime'

/** The server's own fallback zone (ProviderLocalTime.FallbackZoneId), for a response that carries none. */
export const FALLBACK_ZONE = 'Australia/Sydney'
export const DEFAULT_DURATION = 90
/** How long's options, in minutes: inside the server's 15 to 480. */
export const DURATIONS = [30, 45, 60, 90, 120, 150, 180, 240]

export function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return [hours === 0 ? '' : hours === 1 ? '1 hour' : `${hours} hours`, rest ? `${rest} min` : ''].filter(Boolean).join(' ')
}

// The emails' month names (invariant culture, "Sep"). en-AU ICU says "Sept", and the screen and the invite must agree.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Built from parts, not from a formatted string: ICU versions differ in the space before "am", in commas and in month abbreviations.
function partsIn(iso: string, zone: string) {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: zone, weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(parseApiDate(iso))
  const v = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? ''
  // Numeric month makes en-AU pad the day and hour ("07"); read them as numbers.
  const clock = `${Number(v('hour'))}:${v('minute')}`
  const period = v('dayPeriod').toLowerCase()
  return { weekday: v('weekday'), day: String(Number(v('day'))), month: MONTHS[Number(v('month')) - 1], year: v('year'), clock, period, time: `${clock} ${period}` }
}

const plusMinutes = (iso: string, minutes: number) => new Date(parseApiDate(iso).getTime() + minutes * 60_000).toISOString()

/** "Fri 16 Oct, 10:00 am"; with the year when it is not this year in the provider's zone: "Thu 7 Jan 2027, 10:00 am". */
export function visitWhen(iso: string, zone: string, now: Date = new Date()): string {
  const p = partsIn(iso, zone)
  const year = p.year === partsIn(now.toISOString(), zone).year ? '' : ` ${p.year}`
  return `${p.weekday} ${p.day} ${p.month}${year}, ${p.time}`
}

/** A date and time that never breaks across lines in running text ("10:00" / "am"): every space becomes a no-break space. */
export const unbroken = (text: string) => text.replaceAll(' ', ' ')

/** "Thu 15 Oct" */
export function visitDay(iso: string, zone: string): string {
  const p = partsIn(iso, zone)
  return `${p.weekday} ${p.day} ${p.month}`
}

/** "10:00 am – 11:30 am"; compact ("10:00 – 11:30 am") drops a repeated am or pm. */
export function visitTimes(iso: string, minutes: number, zone: string, compact = false): string {
  const start = partsIn(iso, zone)
  const end = partsIn(plusMinutes(iso, minutes), zone)
  return compact && start.period === end.period ? `${start.clock} – ${end.time}` : `${start.time} – ${end.time}`
}

export function endsLabel(iso: string, minutes: number, zone: string): string {
  return `Ends ${partsIn(plusMinutes(iso, minutes), zone).time}`
}

export function isPastVisit(iso: string, minutes: number, now: Date = new Date()): boolean {
  return parseApiDate(iso).getTime() + minutes * 60_000 <= now.getTime()
}

export function notSentReason(code: IntakeInviteError): string {
  return code === 'NotConfigured' ? "email isn't set up yet" : "the email couldn't be sent"
}

/** The table's second line, from the latest send's stored outcome: the server owns the rule, the client only reads it. */
export function inviteLine(row: Pick<ParticipantInquiryDto, 'intakeInviteError' | 'intakeInviteSentAt'>): { text: string; failed: boolean } | null {
  if (row.intakeInviteError) return { text: `Invite not sent: ${notSentReason(row.intakeInviteError)}`, failed: true }
  return row.intakeInviteSentAt ? { text: 'Invite sent', failed: false } : null
}

export type BookingForm = { email: string; date: string; time: string; duration: string; location: string; staffUserId: string; notes: string }
export type BookingField = keyof BookingForm
export type BookingErrors = Partial<Record<BookingField, string>>

/** The panel's fields: the booking as the provider's wall clock, or a new one at 1 hour 30 min with `defaultStaffId` going. */
export function bookingFormOf(row: ParticipantInquiryDto, defaultStaffId: string): BookingForm {
  const local = row.intakeStartsAt ? utcInstantToProviderLocal(row.intakeStartsAt, row.timeZoneId || FALLBACK_ZONE) : ''
  return {
    email: '', date: local.slice(0, 10), time: local.slice(11, 16), duration: String(row.intakeDurationMinutes ?? DEFAULT_DURATION),
    location: row.intakeLocation ?? '', staffUserId: row.intakeStaffUserId ?? defaultStaffId, notes: row.intakeNotes ?? '',
  }
}

/** Whether saving emails the contact: anything the invite states. Notes alone do not (the server's rule in IntakeBookingsController.Set). */
export function sendsInvite(form: BookingForm, saved: BookingForm, booked: boolean): boolean {
  return !booked || form.date !== saved.date || form.time !== saved.time || form.duration !== saved.duration
    || form.location.trim() !== saved.location.trim() || form.staffUserId !== saved.staffUserId
}

const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/

/** The client's mirror of the server's checks, in the brief's words. The server is the floor. A past time is checked only when the time changed. */
export function validateBooking(
  form: BookingForm,
  /** pastVisitChange: the saved visit has passed and this save would send an invite (the server refuses it unless the time changes). */
  opts: { askEmail: boolean; firstName: string; timeChanged: boolean; zone: string; now?: Date; pastVisitChange?: boolean },
): BookingErrors {
  const errors: BookingErrors = {}
  if (opts.askEmail && !form.email.trim()) errors.email = `Add ${opts.firstName}'s email to send the invite.`
  else if (opts.askEmail && !EMAIL.test(form.email.trim())) errors.email = 'Enter a full email address, like name@example.com.'
  if (!form.date) errors.date = 'Choose a date.'
  if (!form.time) errors.time = 'Choose a start time.'
  if (form.date && form.time && opts.timeChanged) {
    const start = providerLocalToUtcInstant(`${form.date}T${form.time}`, opts.zone)
    if (!start || parseApiDate(start).getTime() <= (opts.now ?? new Date()).getTime()) errors.time = "Choose a time that hasn't passed."
  }
  if (opts.pastVisitChange && !opts.timeChanged) errors.time = 'This visit has passed. Change the date and time to book another.'
  if (!form.location.trim()) errors.location = 'Say where the visit is.'
  else if (form.location.trim().length > 300) errors.location = 'Keep it under 300 characters.'
  if (!form.staffUserId) errors.staffUserId = "Choose who's going."
  if (form.notes.trim().length > 1000) errors.notes = 'Keep notes under 1,000 characters.'
  return errors
}

/** The PUT body: the start as an instant with Z, and the email only when the panel asked for one. */
export function bookingBody(form: BookingForm, zone: string, askEmail: boolean): SetIntakeBookingDto {
  return {
    startsAt: providerLocalToUtcInstant(`${form.date}T${form.time}`, zone) ?? '',
    durationMinutes: Number(form.duration),
    location: form.location.trim(),
    staffUserId: form.staffUserId,
    notes: form.notes.trim() || null,
    ...(askEmail ? { contactEmail: form.email.trim() } : {}),
  }
}

/** The server's field keys (ValidationProblemDetails), as the panel's fields. */
export const SERVER_FIELD: Record<string, BookingField> = {
  startsAt: 'time', durationMinutes: 'duration', location: 'location', staffUserId: 'staffUserId', notes: 'notes', contactEmail: 'email',
}

/** A request that got no answer at all (offline, server unreachable), as opposed to a refusal. */
export function noAnswer(error: unknown): boolean {
  const e = error as { isAxiosError?: boolean; response?: unknown } | null
  return !!e?.isAxiosError && !e.response
}

/** Who can go: Admins and Coordinators (never SuperAdmin, never filtered on `position`), "(you)" on the signed-in user. A booked person who no
 * longer qualifies stays listed as they are, so an old visit still shows who was going until someone else is chosen. */
export function staffOptions(staff: Pick<StaffListDto, 'id' | 'fullName' | 'role'>[], myId: string | null, booked?: { id?: string | null; name?: string | null }) {
  const items = staff
    .filter(s => s.role === 'Admin' || s.role === 'Coordinator')
    .map(s => ({ value: s.id, label: s.id === myId ? `${s.fullName} (you)` : s.fullName }))
  if (booked?.id && !items.some(i => i.value === booked.id)) items.unshift({ value: booked.id, label: booked.name ?? 'Current staff member' })
  return items
}

/** The notice after a cancel (SHAPE.md section 5, "Row notices"): who was emailed, or that nobody was and why. */
export function cancelNotice(email: CancelIntakeBookingResultDto['cancellationEmail'], name: string): { tone: 'success' | 'danger'; title: string; message: string } {
  if (email === 'Sent') return { tone: 'success', title: 'Intake visit cancelled', message: `We've emailed ${name} a cancellation.` }
  if (email === 'NoInvite') return { tone: 'success', title: 'Intake visit cancelled', message: 'No invite had gone out, so nobody was emailed.' }
  const why = email === 'NotConfigured' ? "Email isn't set up yet" : "The email couldn't be sent"
  return { tone: 'danger', title: 'Intake visit cancelled, email not sent', message: `${why}, so ${name} wasn't told. Let them know another way.` }
}

/** Where a visit's intake has got to, read as the enquiry stage is: not started, a draft in progress, or done (complete, or a participant). */
export function visitStage(v: Pick<IntakeVisitDto, 'participantId' | 'participantIsDraft' | 'participantIntakeCompletedAt'>): 'new' | 'draftintake' | 'complete' {
  if (!v.participantId) return 'new'
  return v.participantIsDraft === false || v.participantIntakeCompletedAt ? 'complete' : 'draftintake'
}

const localStart = (v: IntakeVisitDto) => utcInstantToProviderLocal(v.startsAt, v.timeZoneId || FALLBACK_ZONE)

/** Visits grouped by the provider-local date of their start ("2026-10-16"), as the shift day groups are. */
export function visitsByDay(visits: IntakeVisitDto[]): Map<string, IntakeVisitDto[]> {
  const byDay = new Map<string, IntakeVisitDto[]>()
  for (const visit of visits) {
    const day = localStart(visit).slice(0, 10)
    byDay.set(day, [...(byDay.get(day) ?? []), visit])
  }
  return byDay
}

/** A day's shifts and visits in start order: a visit is a sibling of the shift cards, placed by its provider-local start time. */
export function withVisits<S extends { startTime: string }>(shifts: S[], visits: IntakeVisitDto[]): ({ kind: 'shift'; shift: S } | { kind: 'visit'; visit: IntakeVisitDto })[] {
  return [
    ...shifts.map(shift => ({ at: shift.startTime.slice(0, 5), entry: { kind: 'shift' as const, shift } })),
    ...visits.map(visit => ({ at: localStart(visit).slice(11, 16), entry: { kind: 'visit' as const, visit } })),
  ].sort((a, b) => a.at.localeCompare(b.at)).map(x => x.entry)
}
