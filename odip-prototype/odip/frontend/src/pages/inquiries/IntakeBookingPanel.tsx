import { useEffect, useRef, useState } from 'react'
import { useConfirmIntakeBooking, useResendIntakeInvite, useSetIntakeBooking } from '@/api/hooks'
import type { ParticipantInquiryDto } from '@/api/types/inquiries'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { FormField } from '@/components/FormField'
import { SlideOver } from '@/components/SlideOver'
import {
  DEFAULT_DURATION, FALLBACK_ZONE, FIELD_ORDER, bookingBody, bookingFormOf, inviteEmail, invitee, inviteeEmailLabel, isPastVisit, noInviteWhy, notSentReason, refusalOf, resultLine,
  sendsInvite, serverBookingErrors, validateBooking, visitDay,
  type BookingErrors, type BookingField, type BookingForm,
} from '@/lib/intakeBooking'
import { fullName } from '@/lib/inquiryDetails'
import { BookingFields } from './BookingFields'
import { useBookingStaff } from './useBookingStaff'

export type IntakeBookingPanelProps = {
  /** The enquiry being booked; null while the panel is closed. */
  row: ParticipantInquiryDto | null
  /** Reschedule from the phone menu: focus Date on open. A new booking focuses its first field anyway. */
  focusDate?: boolean
  onClose: () => void
  /** Cancel visit was pressed. The page owns the confirm dialog, which the phone menu opens too. */
  onRequestCancel: (row: ParticipantInquiryDto) => void
}

const DISABLED_LOOK = 'aria-disabled:opacity-50 aria-disabled:cursor-not-allowed'

function savedAnnouncement(kind: 'booked' | 'updated' | 'notes', row: ParticipantInquiryDto): string {
  if (kind === 'notes') return 'Notes saved.'
  // L7: never "sent to null".
  if (!inviteEmail(row)) return kind === 'booked' ? `Intake visit booked. No invite sent: ${noInviteWhy(row)}.` : `Visit updated. No invite went out: ${noInviteWhy(row)}.`
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
  // The email field shows when the enquiry has none, never on a converted enquiry (D7): its contact is the participant's record now.
  const askEmail = !current.email && !current.participantId
  const staff = useBookingStaff(current)
  const effective: BookingForm = { ...form, staffUserId: form.staffUserId || staff.defaultStaff }
  const timeChanged = !booked || form.date !== saved.date || form.time !== saved.time
  // A booked visit whose enquiry email was later cleared asks for one in the panel. Typing it in is a change that sends the invite there (as the server rules).
  const emailGiven = askEmail && !!form.email.trim()
  const sends = sendsInvite(effective, saved, booked) || (booked && emailGiven)
  // L7: with no email the visit is booked, or changed, without an invite.
  const hasEmail = !!inviteEmail(current) || emailGiven
  const dirty = booked
    ? sends || form.notes.trim() !== saved.notes.trim()
    : !!(form.email || form.date || form.time || form.location || form.notes || form.staffUserId) || form.duration !== String(DEFAULT_DURATION)
  const result = resultLine(current, zone, form.email)

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
    const found = validateBooking(effective, { askEmail: askEmail && sends, timeChanged, zone, pastVisitChange: past && sends })
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
      const mapped = serverBookingErrors(error)
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
            {busy === 'save'
              ? (!booked ? (hasEmail ? 'Sending…' : 'Booking…') : sends && hasEmail ? 'Sending…' : 'Saving…')
              : !booked ? (hasEmail ? 'Send invite' : 'Book visit') : sends ? (hasEmail ? 'Send updated invite' : 'Save changes') : 'Save notes'}
          </Button>
        )}
      </div>
    </>
  )

  return (
    <SlideOver
      open
      onClose={onClose}
      title={`Intake visit for ${fullName(current.firstName, current.lastName)}`}
      description={booked ? undefined : inviteEmail(current) ? `Pick a time and we'll email ${invitee(current)} an invite with a calendar file.` : current.email ? "Pick a time. The email on file can't take an invite, so the visit is booked without one." : 'Pick a time. With no email, the visit is booked without an invite.'}
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
                actions={past || !inviteEmail(current) ? undefined : (
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
                    : `Not confirmed yet. Mark it when ${invitee(current)} replies or calls.`}
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
              label={inviteeEmailLabel(current)}
              error={errors.email}
              hint={errors.email ? undefined : 'Optional. With it, we send the invite and save the address to the enquiry.'}
            >
              <input ref={firstFieldRef} type="email" autoComplete="off" value={form.email} onChange={e => set('email', e.target.value)} />
            </FormField>
          ) : inviteEmail(current) ? (
            <div className="text-sm">
              <p>The invite goes to <span className="font-medium break-all">{current.email}</span>.</p>
              <p className="mt-0.5 text-[13px] text-[var(--color-muted-foreground)]">To use another address, edit the enquiry.</p>
            </div>
          ) : current.email && (
            <div className="text-sm">
              {!booked && <p>No invite will go out: the email on file, <span className="font-medium break-all">{current.email}</span>, can't take one.</p>}
              <p className={`${booked ? '' : 'mt-0.5 '}text-[13px] text-[var(--color-muted-foreground)]`}>The email can't be changed here: the enquiry is the participant's record now.</p>
            </div>
          )}
        </div>

        <BookingFields form={effective} errors={errors} zone={zone} staff={staff} onChange={set} dateRef={askEmail ? undefined : firstFieldRef} />
      </div>
    </SlideOver>
  )
}
