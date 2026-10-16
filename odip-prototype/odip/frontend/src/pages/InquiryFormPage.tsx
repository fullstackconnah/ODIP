import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Callout } from '@/components/Callout'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { BackButton } from '@/components/BackButton'
import { FormField } from '@/components/FormField'
import { TextField } from '@/components/TextField'
import { TextAreaField } from '@/components/TextAreaField'
import { SelectField } from '@/components/SelectField'
import { PageHeader } from '@/components/PageHeader'
import { PageState } from '@/components/PageState'
import { useCreateParticipantInquiry, useParticipantInquiry, useResendIntakeInvite, useSetIntakeBooking, useUpdateParticipantInquiry } from '@/api/hooks'
import type { CreateParticipantInquiryDto, InquiryContactDto, InquirySource, ParticipantInquiryDetailDto, ParticipantInquiryDto } from '@/api/types/inquiries'
import { fieldErrors } from '@/lib/fieldErrors'
import { formGrid, span } from '@/lib/formGrid'
import { isNotFoundError } from '@/lib/httpStatus'
import { contactRowErrors, contactRowOf, contactsPayload, serverContactErrors, type ContactFieldErrors, type ContactRow } from '@/lib/inquiryContacts'
import {
  DEFAULT_DURATION, FALLBACK_ZONE, FIELD_ORDER, bookingBody, bookingFormOf, cancelNotice, enquirySavedNotice, isPastVisit, refusalOf, sendsInvite,
  serverBookingErrors, validateBooking, type BookingErrors, type BookingField, type BookingForm, type EnquiryNotice,
} from '@/lib/intakeBooking'
import { extractErrorMessage } from '@/lib/utils'
import { BookingFields } from './inquiries/BookingFields'
import { InquiryContactsCard } from './inquiries/InquiryContactsCard'
import { IntakeCancelDialog } from './inquiries/IntakeCancelDialog'
import { IntakeVisitCard, type VisitRefusal } from './inquiries/IntakeVisitCard'
import { useBookingStaff } from './inquiries/useBookingStaff'

/** The form's own state: every field is text while it is being typed. */
type FormState = { firstName: string; lastName: string; phone: string; email: string; source: InquirySource; provenance: string }

const blank = (): FormState => ({ firstName: '', lastName: '', phone: '', email: '', source: 'Phone', provenance: '' })

const fromInquiry = (row: ParticipantInquiryDto): FormState => ({
  // A real enquiry always has a source; only a direct intake (never edited here) has none.
  firstName: row.firstName, lastName: row.lastName, phone: row.phone ?? '', email: row.email ?? '', source: row.source || 'Phone', provenance: row.provenance ?? '',
})

const orNull = (value: string) => value.trim() || null

/** What goes on the wire. A field left blank is sent as null, never "": the API rejects "" as a bad email address. `contacts` only when given. */
const toPayload = (form: FormState, contacts?: InquiryContactDto[]): CreateParticipantInquiryDto => ({
  firstName: form.firstName.trim(),
  lastName: form.lastName.trim(),
  phone: orNull(form.phone),
  email: orNull(form.email),
  source: form.source,
  provenance: orNull(form.provenance),
  ...(contacts ? { contacts } : {}),
})

const DISABLED_LOOK = 'aria-disabled:opacity-50 aria-disabled:cursor-not-allowed'

/**
 * Routed enquiry form. Lives at /participants/new-inquiry. With no ?id= it creates a new enquiry; with ?id=<enquiry-id> it loads that enquiry
 * (GET /inquiries/{id}, with its pending contacts) and submits an update. Either way it navigates back to /participants?tab=enquiries on save.
 *
 * Editing waits for the stored enquiry, fetched fresh for this visit, before it shows a form: a form built from nothing, or from a cached copy, then
 * saves over what is stored (L2-08; the contacts are a full replace, plan check S2). After its own create the page moves to ?id= without remounting
 * (D1), so a refused booking's entries and its reason stay, and a retry is a PUT, never a second enquiry.
 */
export default function InquiryFormPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const editId = searchParams.get('id')
  const navigate = useNavigate()
  // The enquiry this page created itself: the URL moves to it (replace), so a reload edits it, while the mounted form stays exactly as it is.
  // Only an enquiry opened by URL is loaded.
  const [createdHere, setCreatedHere] = useState<string | null>(null)
  const loadId = editId && editId !== createdHere ? editId : undefined
  const detailQuery = useParticipantInquiry(loadId)
  const existing = detailQuery.data
  // A cached copy is not enough: the form mounts on this visit's own answer, and stays mounted if a later refetch fails behind it.
  const fresh = !!existing && detailQuery.isFetchedAfterMount && !detailQuery.isError
  const [opened, setOpened] = useState<string | null>(null)
  // Remembered during render (React's "adjusting state when a prop changes"), so the form never flickers back to loading.
  if (fresh && loadId && opened !== loadId) setOpened(loadId)
  const ready = fresh || (!!existing && opened === loadId)

  const header = (
    <div className="flex items-start gap-4">
      <BackButton to="/participants?tab=enquiries" label="enquiries" variant="icon" history={false} />
      <div className="flex-1">
        <PageHeader title={editId ? 'Edit enquiry' : 'New enquiry'} />
      </div>
    </div>
  )

  let content
  if (loadId && !ready) {
    // Three facts: still loading (a paused offline request included, review F-1), no such enquiry (a direct intake's id included: the API has
    // no enquiry for it), and a failed load.
    content = !detailQuery.isError
      ? <PageState kind="loading" noun="enquiry" />
      : isNotFoundError(detailQuery.error)
        ? <PageState kind="not-found" noun="enquiry" backTo="/participants?tab=enquiries" backLabel="enquiries" />
        : <PageState kind="error" noun="enquiry" onRetry={() => detailQuery.refetch()} />
  } else {
    content = (
      <InquiryFormBody
        key={loadId ?? 'new'}
        initial={loadId ? existing! : null}
        onCreated={id => { setCreatedHere(id); setSearchParams({ id }, { replace: true }) }}
        onCancel={() => navigate('/participants?tab=enquiries')}
        onDone={enquiryNotice => navigate('/participants?tab=enquiries', { state: { enquiryNotice } })}
      />
    )
  }

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in max-w-[1600px]">
      {header}
      {content}
    </div>
  )
}

function InquiryFormBody({ initial, onCreated, onCancel, onDone }: {
  initial: ParticipantInquiryDetailDto | null
  onCreated: (id: string) => void
  onCancel: () => void
  onDone: (notice: EnquiryNotice) => void
}) {
  // The stored copy (null until the first save), apart from what is being typed.
  const [row, setRow] = useState<ParticipantInquiryDto | null>(initial)
  const [form, setForm] = useState<FormState>(() => (initial ? fromInquiry(initial) : blank()))
  const [contacts, setContacts] = useState<ContactRow[]>(() => (initial?.contacts ?? []).map(contactRowOf))
  const [contactErrors, setContactErrors] = useState<ContactFieldErrors>({})
  const [listError, setListError] = useState<string | undefined>()
  const [emailError, setEmailError] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'saving' | 'booking' | 'resending' | null>(null)
  // The visit (SHAPE.md section 3). `savedBooking` is the stored visit as the fields show it.
  const [bookingOn, setBookingOn] = useState(false)
  const [booking, setBooking] = useState<BookingForm>(() => bookingFormOf(initial ?? {}, ''))
  const [savedBooking, setSavedBooking] = useState<BookingForm>(booking)
  const [visitErrors, setVisitErrors] = useState<BookingErrors>({})
  const [visitRefusal, setVisitRefusal] = useState<VisitRefusal | null>(null)
  const [resendOn, setResendOn] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelled, setCancelled] = useState<ReturnType<typeof cancelNotice> | null>(null)
  const create = useCreateParticipantInquiry()
  const update = useUpdateParticipantInquiry()
  const setVisit = useSetIntakeBooking()
  const resend = useResendIntakeInvite()
  const staff = useBookingStaff(row)
  // The click guard: aria-disabled does not stop a click, and Enter or a second press before the re-render must never send a second POST.
  const inFlight = useRef(false)
  const formRef = useRef<HTMLFormElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const refusalRef = useRef<HTMLDivElement>(null)
  const cancelledRef = useRef<HTMLDivElement>(null)
  // Where focus goes once the next render is on screen: the errors and notices are not in the DOM yet when they are found.
  const focusNext = useRef<'first-invalid' | 'error' | 'visit-refusal' | 'cancelled' | BookingField | null>(null)
  useEffect(() => {
    const target = focusNext.current
    if (!target) return
    focusNext.current = null
    if (target === 'error') errorRef.current?.focus()
    else if (target === 'visit-refusal') refusalRef.current?.focus()
    else if (target === 'cancelled') cancelledRef.current?.focus()
    else if (target === 'first-invalid') formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    else if (target === 'email') formRef.current?.querySelector<HTMLElement>('#inquiry-email')?.focus()
    else formRef.current?.querySelector<HTMLElement>(`[data-field="${target}"] :is(input, select, textarea, button)`)?.focus()
  })

  const converted = row?.participantId ? { participantId: row.participantId, firstName: row.firstName } : null
  // Before the first save the zone is only for checking: the booking is sent in the zone the save answered with (lead decision 6).
  const zone = row?.timeZoneId || FALLBACK_ZONE
  const booked = !!row?.intakeStartsAt
  const past = booked && isPastVisit(row!.intakeStartsAt!, row!.intakeDurationMinutes ?? DEFAULT_DURATION)
  const effective: BookingForm = { ...booking, staffUserId: booking.staffUserId || staff.defaultStaff }
  // What this Save does about the visit: book it (box ticked), change it (a field differs; notes alone email nobody), or nothing.
  const sends = booked ? sendsInvite(effective, savedBooking, true) : bookingOn
  const wantsVisit = booked ? sends || effective.notes.trim() !== savedBooking.notes.trim() : bookingOn
  // Send again (D2, SHAPE 3c): only when this save won't email anyway, and the invite went to another address or its last send failed.
  const typedEmail = form.email.trim()
  const offerResend = booked && !past && !sends && !!typedEmail
    && (!!row!.intakeInviteError || (!!row!.intakeInviteSentAt && typedEmail !== (row!.email ?? '')))
  const needsEmail = sends || (offerResend && resendOn)

  function changeContacts(next: ContactRow[], changed?: { key: string; field: string }) {
    setContacts(next)
    if (changed) setContactErrors(e => (e[changed.key] ? { ...e, [changed.key]: { ...e[changed.key], [changed.field]: undefined } } : e))
  }

  const setBookingField = (field: BookingField, value: string) => {
    setBooking(b => ({ ...b, [field]: value }))
    setVisitErrors(e => ({ ...e, [field]: undefined }))
  }

  /** The enquiry was refused: nothing was saved. The reason on its fields, else the Callout; every value kept. */
  function refuseEnquiry(err: unknown) {
    setError(extractErrorMessage(err, row ? 'Could not update this enquiry. Check the details and try again.' : 'Could not capture this enquiry. Check the details and try again.'))
    const mapped = serverContactErrors(err, contacts)
    setContactErrors(mapped)
    setListError(fieldErrors(err).contacts)
    focusNext.current = Object.keys(mapped).length > 0 ? 'first-invalid' : 'error'
  }

  /** The visit, or its resend, was refused after the enquiry saved (SHAPE section 4): the reason on its field, else the card's Callout. */
  function refuseVisit(kind: VisitRefusal['kind'], err: unknown) {
    const mapped = kind === 'resend' ? {} : serverBookingErrors(err)
    setEmailError(mapped.email)   // the server's contactEmail ("can't be used") belongs to the enquiry's Email field here
    setVisitErrors({ ...mapped, email: undefined })
    setVisitRefusal({ kind, message: refusalOf(err, kind === 'resend' ? "The invite wasn't sent again. Try again." : "The visit wasn't saved. Try again.") })
    focusNext.current = FIELD_ORDER.find(f => mapped[f]) ?? 'visit-refusal'   // Who's going for staff busy
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (inFlight.current) return
    // 1. The whole form, here: nothing is sent while anything is wrong (SHAPE 6). The invite goes to the Email above (D2).
    const missingEmail = needsEmail && !typedEmail ? 'Add an email to send the invite to.' : undefined
    const rowErrors = contactRowErrors(contacts)
    const timeChanged = !booked || booking.date !== savedBooking.date || booking.time !== savedBooking.time
    const found = wantsVisit ? validateBooking(effective, { askEmail: false, firstName: form.firstName, timeChanged, zone, pastVisitChange: past && sends }) : {}
    setEmailError(missingEmail); setContactErrors(rowErrors); setVisitErrors(found); setVisitRefusal(null); setError(null); setListError(undefined); setCancelled(null)
    if (missingEmail || Object.keys(rowErrors).length > 0 || Object.keys(found).length > 0) {
      focusNext.current = 'first-invalid'
      return
    }
    inFlight.current = true
    try {
      // 2. The enquiry and its contacts in one request: saved together or not at all (D5). A converted enquiry's contacts are the participant's.
      setBusy('saving')
      let saved: ParticipantInquiryDto
      try {
        const body = toPayload(form, converted ? undefined : contactsPayload(contacts))
        // The version this form holds goes back with the edit, so a save since then makes this one a 409 rather than overwrite it (deep review S2).
        saved = row ? await update.mutateAsync({ id: row.id, data: row.updatedAt ? { ...body, expectedUpdatedAt: row.updatedAt } : body }) : await create.mutateAsync(body)
      } catch (err) {
        refuseEnquiry(err)
        return
      }
      if (!row) onCreated(saved.id)   // D1: from here a retry is a PUT, never a second POST
      setRow(saved)
      // 3. The visit: a request of its own. Refused, the enquiry stays saved and the page stays, in edit mode, to retry (owner decision 3).
      let visit: ParticipantInquiryDto | null = null
      if (wantsVisit) {
        setBusy('booking')
        try {
          visit = await setVisit.mutateAsync({ id: saved.id, data: bookingBody(effective, saved.timeZoneId || FALLBACK_ZONE, false) })
        } catch (err) {
          refuseVisit(booked ? 'changed' : 'new', err)
          return
        }
        const next = bookingFormOf(visit, '')
        setRow(visit); setBooking(next); setSavedBooking(next)
      }
      // 4. Send again, when ticked: to the address just saved.
      let resent: ParticipantInquiryDto | null = null
      if (offerResend && resendOn) {
        setBusy('resending')
        try {
          resent = await resend.mutateAsync(saved.id)
        } catch (err) {
          refuseVisit('resend', err)
          return
        }
      }
      onDone(enquirySavedNotice({
        created: !initial, enquiry: resent ?? visit ?? saved, visit: visit ? (booked ? (sends ? 'moved' : null) : 'booked') : null,
        resent: !!resent, contacts: converted ? null : contactsPayload(contacts).length,
      }))
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }

  const title = row ? 'Edit enquiry' : 'New enquiry'
  const resendHint = row?.intakeInviteError ? "The last invite wasn't sent." : `The invite went to ${row?.email ?? ''}. Saving won't resend it unless you tick this.`

  return (
    <>
      <form ref={formRef} className="flex flex-col gap-[var(--section-gap)]" onSubmit={submit} aria-label={title}>
        <Card title={title}>
          <div className={formGrid}>
            <TextField
              id="inquiry-first-name"
              className={span.medium}
              label="First name"
              required
              autoComplete="given-name"
              value={form.firstName}
              onChange={e => setForm({ ...form, firstName: e.target.value })}
            />
            <TextField
              id="inquiry-last-name"
              className={span.medium}
              label="Last name"
              required
              autoComplete="family-name"
              value={form.lastName}
              onChange={e => setForm({ ...form, lastName: e.target.value })}
            />
            <TextField
              id="inquiry-phone"
              className={span.medium}
              label="Phone"
              type="tel"
              autoComplete="tel"
              value={form.phone}
              onChange={e => setForm({ ...form, phone: e.target.value })}
            />
            {/* FormField, not TextField: a native required would let the browser block Save before "Add an email to send the invite to." shows. */}
            <FormField label="Email" required={needsEmail} error={emailError} className={span.medium}>
              <input
                id="inquiry-email"
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={e => { setForm({ ...form, email: e.target.value }); setEmailError(undefined) }}
              />
            </FormField>
            <SelectField
              id="inquiry-source"
              className={span.short}
              label="Source"
              value={form.source}
              onChange={e => setForm({ ...form, source: e.target.value as InquirySource })}
              options={[{ value: 'Web', label: 'Web' }, { value: 'Email', label: 'Email' }, { value: 'Phone', label: 'Phone' }]}
            />
            <TextAreaField
              id="inquiry-provenance"
              className={span.long}
              label="Provenance or referral notes"
              hint="Where this enquiry came from: who referred them, and anything worth knowing."
              rows={3}
              maxLength={2000}
              value={form.provenance}
              onChange={e => setForm({ ...form, provenance: e.target.value })}
            />
          </div>
        </Card>

        <InquiryContactsCard
          rows={contacts}
          errors={contactErrors}
          listError={listError}
          enquirer={{ phone: form.phone, email: form.email }}
          converted={converted}
          onChange={changeContacts}
        />

        <IntakeVisitCard
          row={row}
          booked={booked}
          past={past}
          zone={zone}
          bookingOn={bookingOn}
          onBookingOn={setBookingOn}
          email={typedEmail}
          sends={sends}
          fields={<BookingFields form={effective} errors={visitErrors} zone={zone} staff={staff} onChange={setBookingField} />}
          resend={offerResend ? { on: resendOn, onChange: setResendOn, hint: resendHint } : null}
          refusal={visitRefusal}
          refusalRef={refusalRef}
          cancelled={cancelled}
          cancelledRef={cancelledRef}
          onCancelVisit={() => setCancelling(true)}
        />

        {error && (
          <div ref={errorRef} tabIndex={-1} className="focus:outline-none">
            <Callout tone="error">{error}</Callout>
          </div>
        )}
        <div className="flex gap-2">
          <Button type="submit" aria-disabled={busy ? true : undefined} className={DISABLED_LOOK}>
            {busy === 'saving' ? 'Saving…' : busy === 'booking' ? 'Booking the visit…' : busy === 'resending' ? 'Sending the invite…' : row ? 'Save enquiry' : 'Capture enquiry'}
          </Button>
          <Button variant="secondary" onClick={onCancel}>{!initial && row ? 'Back to enquiries' : 'Cancel'}</Button>
        </div>
      </form>

      <IntakeCancelDialog
        row={cancelling ? row : null}
        onCancel={() => setCancelling(false)}
        onDone={(cancelledRow, email, cleared) => {
          // Back to the not-booked card, with every other entry on the form kept (SHAPE 3c).
          setCancelling(false)
          setRow(cleared)
          setBooking(bookingFormOf({}, '')); setSavedBooking(bookingFormOf({}, ''))
          setBookingOn(false); setVisitErrors({}); setVisitRefusal(null); setResendOn(false)
          setCancelled(cancelNotice(email, `${cancelledRow.firstName} ${cancelledRow.lastName}`))
          focusNext.current = 'cancelled'
        }}
      />
    </>
  )
}
