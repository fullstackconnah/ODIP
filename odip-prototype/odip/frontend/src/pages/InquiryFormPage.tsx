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
import { useCreateParticipantInquiry, useParticipantInquiries, useParticipantInquiry, useResendIntakeInvite, useSetIntakeBooking, useUpdateParticipantInquiry } from '@/api/hooks'
import type { ContactRoleType, PlanType } from '@/api/types/enums'
import type { CreateParticipantInquiryDto, InquiryContactDto, InquirySource, ParticipantInquiryDetailDto, ParticipantInquiryDto } from '@/api/types/inquiries'
import { fieldErrors } from '@/lib/fieldErrors'
import { formGrid, span } from '@/lib/formGrid'
import { isNotFoundError } from '@/lib/httpStatus'
import { contactRowErrors, contactRowOf, contactsPayload, pendingRoleOptions, serverContactErrors, type ContactFieldErrors, type ContactRow } from '@/lib/inquiryContacts'
import { DETAIL_FIELDS, inquiryErrors, INQUIRY_MESSAGES, ndisDigits, serverInquiryErrors, type InquiryErrors, type InquiryField } from '@/lib/inquiryDetails'
import {
  DEFAULT_DURATION, FALLBACK_ZONE, FIELD_ORDER, bookingBody, bookingFormOf, cancelNotice, enquirySavedNotice, inviteEmail, invitee, isPastVisit, refusalOf, sendsInvite,
  serverBookingErrors, validateBooking, type BookingErrors, type BookingField, type BookingForm, type EnquiryNotice,
} from '@/lib/intakeBooking'
import { extractErrorMessage } from '@/lib/utils'
import { utcInstantToProviderLocal } from '@/pages/portal/shift/shiftTime'
import { BookingFields } from './inquiries/BookingFields'
import { closedNotice } from '@/lib/inquiryClose'
import { ClosedEnquiry } from './inquiries/ClosedEnquiry'
import { CloseInquiryDialog } from './inquiries/CloseInquiryDialog'
import { ConvertedDetailsCard } from './inquiries/ConvertedDetailsCard'
import { InquiryContactsCard } from './inquiries/InquiryContactsCard'
import { IntakeCancelDialog } from './inquiries/IntakeCancelDialog'
import { IntakeVisitCard, type VisitRefusal } from './inquiries/IntakeVisitCard'
import { MainContactCard } from './inquiries/MainContactCard'
import { ParticipantDetailsFold } from './inquiries/ParticipantDetailsFold'
import { useBookingStaff } from './inquiries/useBookingStaff'

/**
 * The form's own state: every field is text while it is being typed ('' for blank), and one box. The name is the PARTICIPANT's; the phone and email
 * are the MAIN CONTACT's, or the participant's own when `contactIsParticipant` (spec 2026-10-16 redesign).
 */
type FormState = {
  firstName: string; lastName: string; phone: string; email: string; source: InquirySource; provenance: string
  contactIsParticipant: boolean; contactFirstName: string; contactLastName: string; contactRelationship: string; contactRole: ContactRoleType | ''
  dateOfBirth: string; ndisNumber: string; addressStreet: string; addressSuburb: string; addressState: string; addressPostcode: string
  planType: PlanType | ''; planStartDate: string; planEndDate: string
}

const blank = (): FormState => ({
  firstName: '', lastName: '', phone: '', email: '', source: 'Phone', provenance: '',
  contactIsParticipant: false, contactFirstName: '', contactLastName: '', contactRelationship: '', contactRole: '',
  dateOfBirth: '', ndisNumber: '', addressStreet: '', addressSuburb: '', addressState: '', addressPostcode: '', planType: '', planStartDate: '', planEndDate: '',
})

const fromInquiry = (row: ParticipantInquiryDetailDto): FormState => ({
  // A real enquiry always has a source; only a direct intake (never edited here) has none.
  firstName: row.firstName, lastName: row.lastName, phone: row.phone ?? '', email: row.email ?? '', source: row.source || 'Phone', provenance: row.provenance ?? '',
  contactIsParticipant: !!row.contactIsParticipant, contactFirstName: row.contactFirstName ?? '', contactLastName: row.contactLastName ?? '',
  contactRelationship: row.contactRelationship ?? '', contactRole: row.contactRole ?? '',
  dateOfBirth: row.dateOfBirth ?? '', ndisNumber: row.ndisNumber ?? '', addressStreet: row.addressStreet ?? '', addressSuburb: row.addressSuburb ?? '',
  addressState: row.addressState ?? '', addressPostcode: row.addressPostcode ?? '', planType: row.planType ?? '', planStartDate: row.planStartDate ?? '', planEndDate: row.planEndDate ?? '',
})

const orNull = (value: string) => value.trim() || null

/**
 * What goes on the wire. A field left blank is sent as null, never "": the API rejects "" as a bad email address, and as a date. `contacts` only when
 * given. A converted enquiry sends its names, source and provenance only (D7): its contact and details are the participant's record now.
 * With "their own contact" ticked the contact's names, relationship and role go as null, though what was typed stays in the form.
 */
const toPayload = (form: FormState, contacts?: InquiryContactDto[], converted = false): CreateParticipantInquiryDto => {
  const own = { firstName: form.firstName.trim(), lastName: orNull(form.lastName), source: form.source, provenance: orNull(form.provenance) }
  if (converted) return own
  const self = form.contactIsParticipant
  return {
    ...own,
    phone: orNull(form.phone),
    email: orNull(form.email),
    contactIsParticipant: self,
    contactFirstName: self ? null : orNull(form.contactFirstName),
    contactLastName: self ? null : orNull(form.contactLastName),
    contactRelationship: self ? null : orNull(form.contactRelationship),
    contactRole: self ? null : form.contactRole || null,
    dateOfBirth: form.dateOfBirth || null,
    ndisNumber: orNull(ndisDigits(form.ndisNumber)),
    addressStreet: orNull(form.addressStreet),
    addressSuburb: orNull(form.addressSuburb),
    addressState: orNull(form.addressState),
    addressPostcode: orNull(form.addressPostcode),
    planType: form.planType || null,
    planStartDate: form.planStartDate || null,
    planEndDate: form.planEndDate || null,
    ...(contacts ? { contacts } : {}),
  }
}

const DISABLED_LOOK = 'aria-disabled:opacity-50 aria-disabled:cursor-not-allowed'
const FIELDS_REFUSED = 'Nothing was saved. Fix the marked fields, then save again.'

/**
 * Routed enquiry form. Lives at /participants/new-inquiry. With no ?id= it creates a new enquiry; with ?id=<enquiry-id> it loads that enquiry
 * (GET /inquiries/{id}, with its pending contacts and details) and submits an update. Either way it navigates back to /participants?tab=enquiries on save.
 * ?focus=address opens the details and focuses Street, ?focus=contact the main contact's First name: Start intake's reasons link here (G2).
 *
 * Editing waits for the stored enquiry, fetched fresh for this visit, before it shows a form: a form built from nothing, or from a cached copy, then
 * saves over what is stored (L2-08; the contacts are a full replace, plan check S2). After its own create the page moves to ?id= without remounting
 * (D1), so a refused booking's entries and its reason stay, and a retry is a PUT, never a second enquiry.
 */
export default function InquiryFormPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const editId = searchParams.get('id')
  const focus = searchParams.get('focus')
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
  // A closed enquiry opens read-only; Reopen turns it into the edit form in place (SHAPE.md section 11).
  const [reopenedHere, setReopenedHere] = useState(false)

  const header = (
    <div className="flex items-start gap-4">
      <BackButton to="/participants?tab=enquiries" label="enquiries" variant="icon" history={false} />
      <div className="flex-1">
        <PageHeader title={existing?.closedAt && !reopenedHere ? 'Closed enquiry' : editId ? 'Edit enquiry' : 'New enquiry'} />
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
        focus={focus}
        onCreated={id => { setCreatedHere(id); setSearchParams({ id }, { replace: true }) }}
        onCancel={() => navigate('/participants?tab=enquiries')}
        onReopened={() => setReopenedHere(true)}
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


function InquiryFormBody({ initial, focus, onCreated, onCancel, onReopened, onDone }: {
  initial: ParticipantInquiryDetailDto | null
  /** ?focus=: 'address' opens the details and focuses Street; 'contact' focuses the main contact's First name. */
  focus: string | null
  onCreated: (id: string) => void
  onCancel: () => void
  onReopened: () => void
  onDone: (notice: EnquiryNotice) => void
}) {
  // The stored copy (null until the first save), apart from what is being typed.
  const [row, setRow] = useState<ParticipantInquiryDto | null>(initial)
  const [form, setForm] = useState<FormState>(() => (initial ? fromInquiry(initial) : blank()))
  const [contacts, setContacts] = useState<ContactRow[]>(() => (initial?.contacts ?? []).map(contactRowOf))
  const [contactErrors, setContactErrors] = useState<ContactFieldErrors>({})
  const [listError, setListError] = useState<string | undefined>()
  const [errors, setErrors] = useState<InquiryErrors>({})
  // The details fold (lead decision D3): closed on a new enquiry, open on edit, and open whenever something inside it needs the coordinator.
  const [detailsOpen, setDetailsOpen] = useState(() => !!initial || focus === 'address')
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
  const [closing, setClosing] = useState(false)
  const [reopened, setReopened] = useState(false)
  // What the form held when it was loaded or last saved: Close warns that anything since will be discarded (check N2: reset on every save).
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(toPayload(initial ? fromInquiry(initial) : blank(), contactsPayload((initial?.contacts ?? []).map(contactRowOf)), !!initial?.participantId)))
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
  const reopenedRef = useRef<HTMLDivElement>(null)
  // Where focus goes once the next render is on screen: the errors and notices are not in the DOM yet when they are found, and the details fold
  // opens in the same render. A string starting with "#" is an element's id.
  const focusNext = useRef<'first-invalid' | 'error' | 'visit-refusal' | 'cancelled' | 'reopened' | BookingField | `#${string}` | null>(
    focus === 'address' ? '#inquiry-address-street' : focus === 'contact' ? '#inquiry-contact-first-name' : null)
  useEffect(() => {
    const target = focusNext.current
    if (!target) return
    focusNext.current = null
    if (target === 'error') errorRef.current?.focus()
    else if (target === 'visit-refusal') refusalRef.current?.focus()
    else if (target === 'cancelled') cancelledRef.current?.focus()
    else if (target === 'reopened') reopenedRef.current?.focus()
    else if (target === 'first-invalid') formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    else if (target.startsWith('#')) formRef.current?.querySelector<HTMLElement>(target)?.focus()
    else formRef.current?.querySelector<HTMLElement>(`[data-field="${target}"] :is(input, select, textarea, button)`)?.focus()
  })

  const converted = row?.participantId ? { participantId: row.participantId, firstName: row.firstName } : null
  // Before the first save the zone is only for checking: the booking is sent in the zone the save answered with (lead decision 6).
  // The provider's zone (ODIP-REVIEW-268): the stored row's, else the Enquiries list's (every row carries the server's own). Until one is known a new
  // enquiry's visit is not checked for "has passed" here: Sydney's clock would refuse a Perth visit that is still ahead. The server stays the authority.
  const listQuery = useParticipantInquiries()
  const knownZone = row?.timeZoneId || listQuery.data?.find(r => r.timeZoneId)?.timeZoneId || null
  const zone = knownZone || FALLBACK_ZONE
  const today = utcInstantToProviderLocal(new Date().toISOString(), zone).slice(0, 10)
  const booked = !!row?.intakeStartsAt
  const past = booked && isPastVisit(row!.intakeStartsAt!, row!.intakeDurationMinutes ?? DEFAULT_DURATION)
  const effective: BookingForm = { ...booking, staffUserId: booking.staffUserId || staff.defaultStaff }
  // What this Save does about the visit: book it (box ticked), change it (a field differs; notes alone email nobody), or nothing.
  const sends = booked ? sendsInvite(effective, savedBooking, true) : bookingOn
  const wantsVisit = booked ? sends || effective.notes.trim() !== savedBooking.notes.trim() : bookingOn
  // Send again (D2, SHAPE 3c): only when this save won't email anyway, and the invite went to another address or its last send failed, or (L7) the
  // visit was booked with no email and one has been typed since.
  // D: a converted enquiry's email is read-only, so one that can't take an invite counts as none (the card says why; no Send again).
  const emailUnusable = !!form.email.trim() && !inviteEmail({ email: form.email.trim(), participantId: row?.participantId })
  const typedEmail = emailUnusable ? '' : form.email.trim()
  const neverSent = booked && !row!.email && !row!.intakeInviteSentAt && !row!.intakeInviteError
  const offerResend = booked && !past && !sends && !!typedEmail
    && (neverSent || !!row!.intakeInviteError || (!!row!.intakeInviteSentAt && typedEmail !== (row!.email ?? '')))
  const dirty = wantsVisit || JSON.stringify(toPayload(form, contactsPayload(contacts), !!converted)) !== baseline
  // Who the visit's sentences name: what this Save will store, so a contact typed just now is named.
  const inviteeName = invitee({ firstName: form.firstName, contactIsParticipant: form.contactIsParticipant, contactFirstName: form.contactFirstName })
  const gate = { planType: form.planType || null, dateOfBirth: form.dateOfBirth || null }
  const hasAnyContact = [form.contactRelationship, form.phone, form.email].some(v => v.trim()) || !!form.contactRole
  const needsName = !form.contactIsParticipant && hasAnyContact && !form.contactFirstName.trim() && !form.contactLastName.trim()

  /** One field typed: its value, and its error cleared (SHAPE section 10: errors show at Save, never while typing). */
  function setField<F extends keyof FormState>(field: F, value: FormState[F]) {
    setForm(f => ({ ...f, [field]: value }))
    setErrors(e => (e[field as InquiryField] ? { ...e, [field]: undefined } : e))
  }

  function changeContacts(next: ContactRow[], changed?: { key: string; field: string }) {
    setContacts(next)
    if (changed) setContactErrors(e => (e[changed.key] ? { ...e, [changed.key]: { ...e[changed.key], [changed.field]: undefined } } : e))
  }

  const setBookingField = (field: BookingField, value: string) => {
    setBooking(b => ({ ...b, [field]: value }))
    setVisitErrors(e => ({ ...e, [field]: undefined }))
  }

  /** Field errors found: the details fold opens first when one is inside it, then focus goes to the first marked field. */
  function markFields(found: InquiryErrors) {
    setErrors(found)
    if (DETAIL_FIELDS.some(f => found[f])) setDetailsOpen(true)
    focusNext.current = 'first-invalid'
  }

  /** The enquiry was refused: nothing was saved. The reasons on their fields, else the Callout; every value kept. */
  function refuseEnquiry(err: unknown) {
    const mapped = serverContactErrors(err, contacts)
    const own = serverInquiryErrors(err)
    setContactErrors(mapped)
    setListError(fieldErrors(err).contacts)
    if (Object.keys(mapped).length > 0 || Object.keys(own).length > 0) {
      setError(FIELDS_REFUSED)
      markFields(own)
      return
    }
    setError(extractErrorMessage(err, row ? 'Could not update this enquiry. Check the details and try again.' : 'Could not capture this enquiry. Check the details and try again.'))
    focusNext.current = 'error'
  }

  /** The visit, or its resend, was refused after the enquiry saved (SHAPE section 4): the reason on its field, else the card's Callout. */
  function refuseVisit(kind: VisitRefusal['kind'], err: unknown) {
    const mapped = kind === 'resend' ? {} : serverBookingErrors(err)
    if (mapped.email) setErrors(e => ({ ...e, email: mapped.email }))   // the server's contactEmail belongs to the main contact's Email field here
    setVisitErrors({ ...mapped, email: undefined })
    setVisitRefusal({ kind, message: refusalOf(err, kind === 'resend' ? "The invite wasn't sent again. Try again." : "The visit wasn't saved. Try again.") })
    focusNext.current = mapped.email ? 'first-invalid' : FIELD_ORDER.find(f => mapped[f]) ?? 'visit-refusal'   // Who's going for staff busy
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (inFlight.current) return
    // 1. The whole form, here: nothing is sent while anything is wrong (SHAPE 10). A converted enquiry sends its names only, so only they are checked.
    const stored = row ? { phone: row.phone ?? '', email: row.email ?? '', contactIsParticipant: !!row.contactIsParticipant } : null
    const own = converted ? (form.firstName.trim() ? {} : { firstName: INQUIRY_MESSAGES.firstName }) : inquiryErrors(form, stored, today)
    const rowErrors = converted ? {} : contactRowErrors(contacts, gate)
    const timeChanged = !booked || booking.date !== savedBooking.date || booking.time !== savedBooking.time
    const found = wantsVisit ? validateBooking(effective, { askEmail: false, timeChanged: timeChanged && !!knownZone, zone, pastVisitChange: past && sends }) : {}
    setErrors({}); setContactErrors(rowErrors); setVisitErrors(found); setVisitRefusal(null); setError(null); setListError(undefined); setCancelled(null)
    if (Object.keys(own).length > 0 || Object.keys(rowErrors).length > 0 || Object.keys(found).length > 0) {
      markFields(own)
      return
    }
    inFlight.current = true
    try {
      // 2. The enquiry and its contacts in one request: saved together or not at all (D5). A converted enquiry's contacts are the participant's.
      setBusy('saving')
      let saved: ParticipantInquiryDto
      try {
        const body = toPayload(form, converted ? undefined : contactsPayload(contacts), !!converted)
        // The version this form holds goes back with the edit, so a save since then makes this one a 409 rather than overwrite it (deep review S2).
        saved = row ? await update.mutateAsync({ id: row.id, data: row.updatedAt ? { ...body, expectedUpdatedAt: row.updatedAt } : body }) : await create.mutateAsync(body)
      } catch (err) {
        refuseEnquiry(err)
        return
      }
      if (!row) onCreated(saved.id)   // D1: from here a retry is a PUT, never a second POST
      setRow(saved)
      setBaseline(JSON.stringify(toPayload(form, contactsPayload(contacts), !!saved.participantId)))
      // 3. The visit: a request of its own. Refused, the enquiry stays saved and the page stays, in edit mode, to retry (owner decision 3).
      let visit: ParticipantInquiryDto | null = null
      if (wantsVisit) {
        setBusy('booking')
        try {
          // Each step sends the version the step before it returned (ODIP-REVIEW-268): the enquiry PUT was checked, so its answer is this form's base.
          visit = await setVisit.mutateAsync({ id: saved.id, data: { ...bookingBody(effective, saved.timeZoneId || FALLBACK_ZONE, false), expectedUpdatedAt: saved.updatedAt } })
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
          resent = await resend.mutateAsync({ id: saved.id, expectedUpdatedAt: (visit ?? saved).updatedAt })
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
  if (row?.closedAt && initial) {
    // Only on load: a close made here navigates away. `initial` is the detail, with the main contact and the details the facts read.
    return (
      <ClosedEnquiry
        row={initial}
        onBack={onCancel}
        onReopened={answer => {
          setRow(answer); setReopened(true); onReopened()
          focusNext.current = 'reopened'
        }}
      />
    )
  }
  const resendHint = neverSent ? 'No invite went out when it was booked.'
    : row?.intakeInviteError ? "The last invite wasn't sent." : `The invite went to ${row?.email ?? ''}. Saving won't resend it unless you tick this.`

  return (
    <>
      {/* noValidate: the form's own checks give every message (SHAPE section 10). A native max, or type=email, would otherwise block Save with the
          browser's bubble before them; the date picker still honours max. */}
      <form ref={formRef} noValidate className="flex flex-col gap-[var(--section-gap)]" onSubmit={submit} aria-label={title}>
        {reopened && (
          <div ref={reopenedRef} tabIndex={-1} className="focus:outline-none">
            <Callout tone="success">Reopened. Add the other contacts again below.</Callout>
          </div>
        )}
        <Card title="Participant">
          <div className={formGrid}>
            {/* FormField, not TextField: a native required would let the browser's bubble block Save before the form's own check shows (SHAPE section 3). */}
            <FormField label="First name" required error={errors.firstName} className={span.medium}>
              <input id="inquiry-first-name" autoComplete="off" maxLength={100} value={form.firstName} onChange={e => setField('firstName', e.target.value)} />
            </FormField>
            <TextField
              id="inquiry-last-name"
              className={span.medium}
              label="Last name"
              autoComplete="off"
              maxLength={100}
              value={form.lastName}
              onChange={e => setField('lastName', e.target.value)}
            />
            <SelectField
              id="inquiry-source"
              className={span.short}
              label="Source"
              value={form.source}
              onChange={e => setField('source', e.target.value as InquirySource)}
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
              onChange={e => setField('provenance', e.target.value)}
            />
          </div>
        </Card>

        {converted ? (
          <ConvertedDetailsCard participantId={converted.participantId} firstName={converted.firstName} contact={{ ...form, contactRole: form.contactRole || null }} />
        ) : (
          <>
            <MainContactCard
              form={form}
              errors={errors}
              roleOptions={pendingRoleOptions(gate.planType, gate.dateOfBirth, form.contactRole || undefined)}
              needsName={needsName}
              onChange={(field, value) => setField(field, value as never)}
            />
            <ParticipantDetailsFold form={form} errors={errors} open={detailsOpen} today={today} onToggle={setDetailsOpen} onChange={(field, value) => setField(field, value as never)} />
            <InquiryContactsCard rows={contacts} errors={contactErrors} listError={listError} gate={gate} onChange={changeContacts} />
          </>
        )}

        <IntakeVisitCard
          row={row}
          booked={booked}
          past={past}
          zone={zone}
          bookingOn={bookingOn}
          onBookingOn={setBookingOn}
          email={typedEmail}
          emailUnusable={emailUnusable}
          invitee={inviteeName}
          sends={sends}
          fields={<BookingFields form={effective} errors={visitErrors} zone={zone} staff={staff} onChange={setBookingField} />}
          resend={offerResend ? { on: resendOn, onChange: setResendOn, hint: resendHint, again: !neverSent } : null}
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
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" aria-disabled={busy ? true : undefined} className={`${DISABLED_LOOK} w-full sm:w-auto`}>
            {busy === 'saving' ? 'Saving…' : busy === 'booking' ? 'Booking the visit…' : busy === 'resending' ? 'Sending the invite…' : row ? 'Save enquiry' : 'Capture enquiry'}
          </Button>
          <Button variant="secondary" className="w-full sm:w-auto" onClick={onCancel}>{!initial && row ? 'Back to enquiries' : 'Cancel'}</Button>
          {/* Only an enquiry that hasn't started intake can close; never a new one (SHAPE section 11). */}
          {row && !row.participantId && <Button variant="ghost-danger" className="w-full sm:ml-auto sm:w-auto" onClick={() => setClosing(true)}>Close enquiry</Button>}
        </div>
      </form>

      {closing && row && (
        <CloseInquiryDialog
          row={row}
          unsaved={dirty}
          onCancel={() => setClosing(false)}
          onDone={(closedRow, result) => onDone({ ...closedNotice(result), subject: closedRow.id })}
        />
      )}
      <IntakeCancelDialog
        // Sends this form's version, so adopting the cleared row's version below is safe (ODIP-REVIEW-268).
        row={cancelling ? row : null}
        onCancel={() => setCancelling(false)}
        onDone={(cancelledRow, email, cleared) => {
          // Back to the not-booked card, with every other entry on the form kept (SHAPE 3c).
          setCancelling(false)
          setRow(cleared)
          setBooking(bookingFormOf({}, '')); setSavedBooking(bookingFormOf({}, ''))
          setBookingOn(false); setVisitErrors({}); setVisitRefusal(null); setResendOn(false)
          setCancelled(cancelNotice(email, invitee(cancelledRow)))
          focusNext.current = 'cancelled'
        }}
      />
    </>
  )
}
