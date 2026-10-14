import { useEffect, useMemo, useRef, useState } from 'react'
import { useConfirmIntakeBooking, useResendIntakeInvite, useSetIntakeBooking, useStaff } from '@/api/hooks'
import type { ParticipantInquiryDto } from '@/api/types/inquiries'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { FormField } from '@/components/FormField'
import { SearchableSelect } from '@/components/SearchableSelect'
import { SlideOver } from '@/components/SlideOver'
import { TextAreaField } from '@/components/TextAreaField'
import { fieldErrors } from '@/lib/fieldErrors'
import { modalGrid } from '@/lib/formGrid'
import {
  DEFAULT_DURATION, DURATIONS, FALLBACK_ZONE, SERVER_FIELD, bookingBody, bookingFormOf, durationLabel, endsLabel, isPastVisit, noAnswer,
  notSentReason, sendsInvite, staffOptions, validateBooking, visitDay, visitWhen,
  type BookingErrors, type BookingField, type BookingForm,
} from '@/lib/intakeBooking'
import { usePermissions } from '@/lib/permissions'
import { extractErrorMessage } from '@/lib/utils'
import { providerLocalToUtcInstant } from '@/pages/portal/shift/shiftTime'

export type IntakeBookingPanelProps = {
  /** The enquiry being booked; null while the panel is closed. */
  row: ParticipantInquiryDto | null
  /** Reschedule from the phone menu: focus Date on open. A new booking focuses its first field anyway. */
  focusDate?: boolean
  onClose: () => void
  /** Cancel visit was pressed. The page owns the confirm dialog, which the phone menu opens too. */
  onRequestCancel: (row: ParticipantInquiryDto) => void
}

const FIELD_ORDER: BookingField[] = ['email', 'date', 'time', 'duration', 'location', 'staffUserId', 'notes']
const NO_CONNECTION = "Couldn't reach ODIP. Check your connection and try again. Your entries are kept."
const DISABLED_LOOK = 'aria-disabled:opacity-50 aria-disabled:cursor-not-allowed'

/** The server's sentence for a refusal: the first field message of a ValidationProblemDetails, else its message, else the fallback. */
function refusalOf(error: unknown, fallback: string): string {
  return noAnswer(error) ? NO_CONNECTION : Object.values(fieldErrors(error)).find(Boolean) ?? extractErrorMessage(error, fallback)
}

/** The result line, from the stored outcome of the latest send (as SignInEmailOutcome does for the set-password email). */
function resultLine(row: ParticipantInquiryDto, zone: string): { tone: 'success' | 'warning'; text: string } {
  if (row.intakeInviteError === 'NotConfigured')
    return { tone: 'warning', text: `Invite not sent: email isn't set up yet. The visit is still booked, so let ${row.firstName} know another way.` }
  if (row.intakeInviteError) return { tone: 'warning', text: "Invite not sent: the email couldn't be sent. The visit is still booked." }
  // An enquiry whose email was cleared after the send has no address to name.
  if (row.intakeInviteSentAt) return { tone: 'success', text: `Invite sent${row.email ? ` to ${row.email}` : ''} on ${visitWhen(row.intakeInviteSentAt, zone)}.` }
  return { tone: 'warning', text: 'No invite has gone out yet.' }
}

function savedAnnouncement(kind: 'booked' | 'updated' | 'notes', row: ParticipantInquiryDto): string {
  if (kind === 'notes') return 'Notes saved.'
  const what = kind === 'booked' ? 'Intake visit booked. Invite' : 'Updated invite'
  return row.intakeInviteError ? `${what} not sent: ${notSentReason(row.intakeInviteError)}.` : `${what} sent to ${row.email}.`
}

/**
 * The intake visit panel (SHAPE.md section 2): book a visit and send the invite, then the booked view in place. That view shows the result line
 * with Send again, the confirmation line, and the visit's details, whose edits reschedule it. Mounted per enquiry, so its state never leaks to
 * another row.
 */
export function IntakeBookingPanel({ row, ...props }: IntakeBookingPanelProps) {
  return row ? <BookingPanel key={row.id} row={row} {...props} /> : null
}

function BookingPanel({ row, focusDate = false, onClose, onRequestCancel }: Omit<IntakeBookingPanelProps, 'row'> & { row: ParticipantInquiryDto }) {
  const { id: myId } = usePermissions()
  const staffQuery = useStaff({ isActive: 'true' })
  const save = useSetIntakeBooking()
  const confirm = useConfirmIntakeBooking()
  const resend = useResendIntakeInvite()

  // The latest server copy: the row at open, then each answer, so the booked view always shows what was stored.
  const [current, setCurrent] = useState(row)
  const [saved, setSaved] = useState<BookingForm>(() => bookingFormOf(row, ''))
  const [form, setForm] = useState<BookingForm>(() => bookingFormOf(row, ''))
  const [errors, setErrors] = useState<BookingErrors>({})
  const [refusal, setRefusal] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [busy, setBusy] = useState<'save' | 'resend' | 'confirm' | null>(null)
  // The click guard: aria-disabled does not stop a click, and a second press before the re-render must not send a second invite.
  const inFlight = useRef(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const firstFieldRef = useRef<HTMLInputElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  const refusalRef = useRef<HTMLDivElement>(null)
  // Where focus goes once the next render is on screen: the booked view or the refusal does not exist yet when the answer arrives.
  const focusNext = useRef<'result' | 'refusal' | BookingField | null>(null)
  useEffect(() => {
    const target = focusNext.current
    if (!target) return
    focusNext.current = null
    if (target === 'result') resultRef.current?.focus()
    else if (target === 'refusal') refusalRef.current?.focus()
    else bodyRef.current?.querySelector<HTMLElement>(`[data-field="${target}"] :is(input, select, textarea, button)`)?.focus()
  })

  const zone = current.timeZoneId || FALLBACK_ZONE
  const booked = !!current.intakeStartsAt
  const past = booked && isPastVisit(current.intakeStartsAt!, current.intakeDurationMinutes ?? DEFAULT_DURATION)
  const askEmail = !current.email
  const staffItems = useMemo(
    () => staffOptions(staffQuery.data ?? [], myId, { id: current.intakeStaffUserId, name: current.intakeStaffName }),
    [staffQuery.data, myId, current.intakeStaffUserId, current.intakeStaffName],
  )
  // A new booking defaults to the signed-in user when they can go: whoever books often goes, and the choice is visible and changeable.
  const defaultStaff = !booked && myId && staffItems.some(i => i.value === myId) ? myId : ''
  const effective: BookingForm = { ...form, staffUserId: form.staffUserId || defaultStaff }
  const timeChanged = !booked || form.date !== saved.date || form.time !== saved.time
  // A booked visit whose enquiry email was later cleared asks for one in the panel. Typing it in is a change that sends the invite there (as the server rules).
  const emailGiven = askEmail && !!form.email.trim()
  const sends = sendsInvite(effective, saved, booked) || (booked && emailGiven)
  const dirty = booked
    ? sends || form.notes.trim() !== saved.notes.trim()
    : !!(form.email || form.date || form.time || form.location || form.notes || form.staffUserId) || form.duration !== String(DEFAULT_DURATION)
  const startIso = form.date && form.time ? providerLocalToUtcInstant(`${form.date}T${form.time}`, zone) : null
  const durations = DURATIONS.includes(Number(form.duration)) ? DURATIONS : [...DURATIONS, Number(form.duration)].sort((a, b) => a - b)
  const result = resultLine(current, zone)

  const set = (field: BookingField, value: string) => {
    setForm(f => ({ ...f, [field]: value }))
    setErrors(e => ({ ...e, [field]: undefined }))
  }

  async function run<T>(kind: 'save' | 'resend' | 'confirm', action: () => Promise<T>): Promise<T | undefined> {
    if (inFlight.current) return undefined
    inFlight.current = true
    setBusy(kind)
    try {
      return await action()
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }

  async function submit() {
    if (inFlight.current) return
    // The email is asked for only by a save that emails: notes on a visit whose enquiry has lost its address still save.
    const found = validateBooking(effective, { askEmail: askEmail && sends, firstName: current.firstName, timeChanged, zone, pastVisitChange: past && sends })
    setErrors(found)
    setRefusal(null)
    const firstBad = FIELD_ORDER.find(f => found[f])
    if (firstBad) {
      focusNext.current = firstBad
      return
    }
    const kind = !booked ? 'booked' : sends ? 'updated' : 'notes'
    try {
      const answer = await run('save', () => save.mutateAsync({ id: current.id, data: bookingBody(effective, zone, emailGiven) }))
      if (!answer) return
      const next = bookingFormOf(answer, '')
      setCurrent(answer)
      setSaved(next)
      setForm(next)
      setAnnouncement(savedAnnouncement(kind, answer))
      // The button that was pressed is gone (Send invite) or about to go (the form is no longer dirty): focus the outcome instead.
      focusNext.current = kind === 'notes' ? 'notes' : 'result'
    } catch (error) {
      const mapped: BookingErrors = {}
      for (const [key, message] of Object.entries(fieldErrors(error))) if (SERVER_FIELD[key] && message) mapped[SERVER_FIELD[key]] = message
      setErrors(mapped)
      setRefusal(refusalOf(error, "The visit wasn't saved. Try again."))
      focusNext.current = FIELD_ORDER.find(f => mapped[f]) ?? 'refusal'
    }
  }

  async function sendAgain() {
    try {
      const answer = await run('resend', () => resend.mutateAsync(current.id))
      if (!answer) return
      setCurrent(answer)
      setAnnouncement(answer.intakeInviteError ? `Invite still not sent: ${notSentReason(answer.intakeInviteError)}.` : `Invite sent again to ${answer.email}.`)
    } catch (error) {
      setRefusal(refusalOf(error, "The invite wasn't sent. Try again."))
    }
  }

  async function toggleConfirmed() {
    const confirmed = !current.intakeConfirmedAt
    try {
      const answer = await run('confirm', () => confirm.mutateAsync({ id: current.id, confirmed }))
      if (!answer) return
      setCurrent(answer)
      setAnnouncement(confirmed ? 'Marked confirmed.' : 'Marked not confirmed.')
    } catch (error) {
      setRefusal(refusalOf(error, "The visit wasn't changed. Try again."))
    }
  }

  const footer = (
    <>
      {booked && !past ? <Button variant="ghost-danger" onClick={() => onRequestCancel(current)}>Cancel visit</Button> : <span />}
      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={onClose}>{booked ? 'Close' : 'Cancel'}</Button>
        {(!booked || dirty) && (
          <Button onClick={submit} aria-disabled={busy === 'save' || undefined} className={DISABLED_LOOK}>
            {busy === 'save' ? (sends ? 'Sending…' : 'Saving…') : !booked ? 'Send invite' : sends ? 'Send updated invite' : 'Save notes'}
          </Button>
        )}
      </div>
    </>
  )

  return (
    <SlideOver
      open
      onClose={onClose}
      title={`Intake visit for ${current.firstName} ${current.lastName}`}
      description={booked ? undefined : `Pick a time and we'll email ${current.firstName} an invite with a calendar file.`}
      dirty={dirty}
      initialFocusRef={!booked || focusDate ? firstFieldRef : undefined}
      footerClassName="flex items-center justify-between gap-3"
      footer={footer}
    >
      {/* Mounted first and kept in place, so each outcome written into it is announced once (the visible Callouts do not announce). */}
      <AnnouncementRegion message={announcement} />
      <div ref={bodyRef} className="flex flex-col gap-[var(--field-gap-y)]">
        {refusal && (
          <div ref={refusalRef} tabIndex={-1} className="focus:outline-none">
            <Callout tone="danger" title={booked ? "Couldn't save the changes" : "Couldn't book the visit"}>
              <span className="break-words">{refusal}</span>
            </Callout>
          </div>
        )}
        {booked && (
          <>
            <div ref={resultRef} tabIndex={-1} className="focus:outline-none">
              <Callout
                tone={result.tone}
                announce={false}
                actions={past || askEmail ? undefined : (
                  <Button variant="secondary" size="sm" onClick={sendAgain} aria-disabled={busy === 'resend' || undefined} className={DISABLED_LOOK}>
                    {busy === 'resend' ? 'Sending…' : 'Send again'}
                  </Button>
                )}
              >
                <span className="break-words">{result.text}</span>
              </Callout>
            </div>
            {past ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">This visit's time has passed. To book another time, change the date and time.</p>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <p className="text-sm">
                  {current.intakeConfirmedAt
                    ? `Confirmed. Marked on ${visitDay(current.intakeConfirmedAt, zone)}.`
                    : `Not confirmed yet. Mark it when ${current.firstName} replies or calls.`}
                </p>
                <Button variant="secondary" size="sm" onClick={toggleConfirmed} aria-disabled={busy === 'confirm' || undefined} className={DISABLED_LOOK}>
                  {current.intakeConfirmedAt ? 'Mark not confirmed' : 'Mark confirmed'}
                </Button>
              </div>
            )}
            <h3 className="font-display text-sm font-semibold text-foreground">Visit details</h3>
          </>
        )}

        <div data-field="email">
          {askEmail ? (
            <FormField
              label={`${current.firstName}'s email`}
              required
              error={errors.email}
              hint={errors.email ? undefined : `${current.firstName}'s enquiry has no email yet. The invite goes here, and it's saved to the enquiry.`}
            >
              <input ref={firstFieldRef} type="email" autoComplete="off" value={form.email} onChange={e => set('email', e.target.value)} />
            </FormField>
          ) : (
            <div className="text-sm">
              <p>The invite goes to <span className="font-medium break-all">{current.email}</span>.</p>
              <p className="mt-0.5 text-[13px] text-[var(--color-muted-foreground)]">To use another address, edit the enquiry.</p>
            </div>
          )}
        </div>

        <div className={modalGrid}>
          <div data-field="date">
            <FormField label="Date" required error={errors.date}>
              <input ref={askEmail ? undefined : firstFieldRef} type="date" value={form.date} onChange={e => set('date', e.target.value)} />
            </FormField>
          </div>
          <div data-field="time">
            <FormField label="Start time" required error={errors.time}>
              <input type="time" value={form.time} onChange={e => set('time', e.target.value)} />
            </FormField>
          </div>
          <div data-field="duration">
            <FormField label="How long" hint={startIso ? endsLabel(startIso, Number(form.duration), zone) : undefined}>
              <select value={form.duration} onChange={e => set('duration', e.target.value)}>
                {durations.map(minutes => <option key={minutes} value={String(minutes)}>{durationLabel(minutes)}</option>)}
              </select>
            </FormField>
          </div>
        </div>

        <div data-field="location">
          <FormField label="Where" required error={errors.location} hint={errors.location ? undefined : "Their home address, or wherever you're meeting."}>
            <input type="text" maxLength={300} value={form.location} onChange={e => set('location', e.target.value)} />
          </FormField>
        </div>

        <div data-field="staffUserId">
          <FormField label="Who's going" required error={errors.staffUserId} hint={errors.staffUserId ? undefined : 'Only coordinators and admins can do an intake.'}>
            <SearchableSelect
              items={staffItems}
              value={effective.staffUserId}
              onChange={value => set('staffUserId', value)}
              placeholder="Choose who's going"
              loading={staffQuery.isLoading}
              // A refusal focuses the field to fix: it must show who was chosen, not an empty search over an open list.
              openOnFocus={false}
            />
          </FormField>
        </div>

        <div data-field="notes">
          <TextAreaField
            label="Notes for your team (optional)"
            rows={3}
            maxLength={1000}
            error={errors.notes}
            hint={errors.notes ? undefined : "Only your team sees these. They aren't in the invite."}
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
          />
        </div>
      </div>
    </SlideOver>
  )
}
