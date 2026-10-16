import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Callout } from '@/components/Callout'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { BackButton } from '@/components/BackButton'
import { TextField } from '@/components/TextField'
import { TextAreaField } from '@/components/TextAreaField'
import { SelectField } from '@/components/SelectField'
import { PageHeader } from '@/components/PageHeader'
import { PageState } from '@/components/PageState'
import { useCreateParticipantInquiry, useParticipantInquiry, useUpdateParticipantInquiry } from '@/api/hooks'
import type { CreateParticipantInquiryDto, InquiryContactDto, InquirySource, ParticipantInquiryDetailDto, ParticipantInquiryDto } from '@/api/types/inquiries'
import { fieldErrors } from '@/lib/fieldErrors'
import { formGrid, span } from '@/lib/formGrid'
import { isNotFoundError } from '@/lib/httpStatus'
import { contactRowErrors, contactRowOf, contactsPayload, serverContactErrors, type ContactFieldErrors, type ContactRow } from '@/lib/inquiryContacts'
import { extractErrorMessage } from '@/lib/utils'
import { InquiryContactsCard } from './inquiries/InquiryContactsCard'

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
        onDone={() => navigate('/participants?tab=enquiries')}
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
  onDone: () => void
}) {
  // The stored copy (null until the first save), apart from what is being typed.
  const [row, setRow] = useState<ParticipantInquiryDto | null>(initial)
  const [form, setForm] = useState<FormState>(() => (initial ? fromInquiry(initial) : blank()))
  const [contacts, setContacts] = useState<ContactRow[]>(() => (initial?.contacts ?? []).map(contactRowOf))
  const [contactErrors, setContactErrors] = useState<ContactFieldErrors>({})
  const [listError, setListError] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'saving' | null>(null)
  const create = useCreateParticipantInquiry()
  const update = useUpdateParticipantInquiry()
  // The click guard: aria-disabled does not stop a click, and Enter or a second press before the re-render must never send a second POST.
  const inFlight = useRef(false)
  const formRef = useRef<HTMLFormElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  // Where focus goes once the next render is on screen: the errors are not in the DOM yet when they are found.
  const focusNext = useRef<'first-invalid' | 'error' | null>(null)
  useEffect(() => {
    const target = focusNext.current
    if (!target) return
    focusNext.current = null
    if (target === 'error') errorRef.current?.focus()
    else formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  })

  const converted = row?.participantId ? { participantId: row.participantId, firstName: row.firstName } : null

  function changeContacts(next: ContactRow[], changed?: { key: string; field: string }) {
    setContacts(next)
    if (changed) setContactErrors(e => (e[changed.key] ? { ...e, [changed.key]: { ...e[changed.key], [changed.field]: undefined } } : e))
  }

  /** The enquiry was refused: nothing was saved. The reason on its fields, else the Callout; every value kept. */
  function refuseEnquiry(err: unknown) {
    setError(extractErrorMessage(err, row ? 'Could not update this enquiry. Check the details and try again.' : 'Could not capture this enquiry. Check the details and try again.'))
    const mapped = serverContactErrors(err, contacts)
    setContactErrors(mapped)
    setListError(fieldErrors(err).contacts)
    focusNext.current = Object.keys(mapped).length > 0 ? 'first-invalid' : 'error'
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (inFlight.current) return
    const rowErrors = contactRowErrors(contacts)
    setContactErrors(rowErrors); setListError(undefined); setError(null)
    if (Object.keys(rowErrors).length > 0) {
      focusNext.current = 'first-invalid'
      return
    }
    inFlight.current = true
    setBusy('saving')
    try {
      // The enquiry and its contacts in one request: saved together or not at all (D5). A converted enquiry's contacts are the participant's.
      const body = toPayload(form, converted ? undefined : contactsPayload(contacts))
      let saved: ParticipantInquiryDto
      try {
        saved = row ? await update.mutateAsync({ id: row.id, data: body }) : await create.mutateAsync(body)
      } catch (err) {
        refuseEnquiry(err)
        return
      }
      if (!row) onCreated(saved.id)
      setRow(saved)
      onDone()
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }

  const title = row ? 'Edit enquiry' : 'New enquiry'

  return (
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
          <TextField
            id="inquiry-email"
            className={span.medium}
            label="Email"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={e => setForm({ ...form, email: e.target.value })}
          />
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

      {error && (
        <div ref={errorRef} tabIndex={-1} className="focus:outline-none">
          <Callout tone="error">{error}</Callout>
        </div>
      )}
      <div className="flex gap-2">
        <Button type="submit" aria-disabled={busy ? true : undefined} className={DISABLED_LOOK}>{busy ? 'Saving…' : row ? 'Save enquiry' : 'Capture enquiry'}</Button>
        <Button variant="secondary" onClick={onCancel}>{!initial && row ? 'Back to enquiries' : 'Cancel'}</Button>
      </div>
    </form>
  )
}
