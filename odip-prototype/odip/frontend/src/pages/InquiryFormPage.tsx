import { useState } from 'react'
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
import { useCreateParticipantInquiry, useParticipantInquiries, useUpdateParticipantInquiry } from '@/api/hooks'
import type { CreateParticipantInquiryDto, InquirySource, ParticipantInquiryDto } from '@/api/types/inquiries'
import { formGrid, span } from '@/lib/formGrid'
import { extractErrorMessage } from '@/lib/utils'
import { queryPhase } from '@/lib/queryPhase'

/** The form's own state: every field is text while it is being typed. */
type FormState = { firstName: string; lastName: string; phone: string; email: string; source: InquirySource; provenance: string }

const blank = (): FormState => ({ firstName: '', lastName: '', phone: '', email: '', source: 'Phone', provenance: '' })

const fromInquiry = (row: ParticipantInquiryDto): FormState => ({
  firstName: row.firstName, lastName: row.lastName, phone: row.phone ?? '', email: row.email ?? '', source: row.source, provenance: row.provenance ?? '',
})

const orNull = (value: string) => value.trim() || null

/** What goes on the wire. A field left blank is sent as null, never "": the API rejects "" as a bad email address. */
const toPayload = (form: FormState): CreateParticipantInquiryDto => ({
  firstName: form.firstName.trim(),
  lastName: form.lastName.trim(),
  phone: orNull(form.phone),
  email: orNull(form.email),
  source: form.source,
  provenance: orNull(form.provenance),
})

/**
 * Routed enquiry form. Lives at /participants/new-inquiry. With no ?id= it creates a new
 * enquiry; with ?id=<enquiry-id> it loads the existing row and submits an update. Either way
 * the page owns its own PageHeader + Card + Button stack and navigates back to
 * /participants?tab=enquiries on save so the enquiries tab re-renders the new/edited row.
 *
 * Editing waits for the stored enquiry before it shows a form: opened cold (a reload, a bookmark, a new tab) the list has not arrived yet,
 * and a form built from nothing used to stay blank after the list landed, then save blanks over the email, source and provenance (L2-08).
 */
export default function InquiryFormPage() {
  const [searchParams] = useSearchParams()
  const editId = searchParams.get('id')
  const navigate = useNavigate()
  const inquiriesQuery = useParticipantInquiries()
  const inquiries = inquiriesQuery.data ?? []
  const existing = editId ? inquiries.find(row => row.id === editId) : undefined
  // A paused request (the browser is offline and the load has not run) is loading, not "not found" (review F-1).
  const phase = queryPhase(inquiriesQuery)

  const header = (
    <div className="flex items-start gap-4">
      <BackButton to="/participants?tab=enquiries" label="enquiries" variant="icon" history={false} />
      <div className="flex-1">
        <PageHeader
          title={editId ? 'Edit enquiry' : 'New enquiry'}
          subtitle={editId ? 'Update the saved enquiry details.' : 'Capture a light enquiry when someone first contacts the service.'}
        />
      </div>
    </div>
  )

  let content
  if (editId && !existing) {
    // Three different facts: still loading, the load failed, and there is no such enquiry.
    content = phase === 'loading'
      ? <PageState kind="loading" noun="enquiry" />
      : phase === 'error'
        ? <PageState kind="error" noun="enquiry" onRetry={() => inquiriesQuery.refetch()} />
        : <PageState kind="not-found" noun="enquiry" backTo="/participants?tab=enquiries" backLabel="enquiries" />
  } else {
    content = (
      <Card title={editId ? 'Edit enquiry' : 'New enquiry'}>
        {/* Keyed on the enquiry being edited, so switching between create and edit resets the state; the form is only ever mounted once
            `existing` has arrived, so the lazy initial value is the stored enquiry and never a blank. */}
        <InquiryFormBody
          key={existing?.id ?? 'new'}
          initial={existing ? fromInquiry(existing) : blank()}
          editId={editId}
          onCancel={() => navigate('/participants?tab=enquiries')}
          onSaved={() => navigate('/participants?tab=enquiries')}
        />
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in max-w-[1600px]">
      {header}
      {content}
    </div>
  )
}

function InquiryFormBody({
  initial,
  editId,
  onCancel,
  onSaved,
}: {
  initial: FormState
  editId: string | null
  onCancel: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<FormState>(initial)
  const [error, setError] = useState<string | null>(null)
  const create = useCreateParticipantInquiry()
  const update = useUpdateParticipantInquiry()
  const isSaving = create.isPending || update.isPending

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (editId) {
      update.mutate(
        { id: editId, data: toPayload(form) },
        {
          onSuccess: onSaved,
          onError: err => setError(extractErrorMessage(err, 'Could not update this enquiry. Check the details and try again.')),
        },
      )
    } else {
      create.mutate(toPayload(form), {
        onSuccess: onSaved,
        onError: err => setError(extractErrorMessage(err, 'Could not capture this enquiry. Check the details and try again.')),
      })
    }
  }

  const ctaLabel = editId ? 'Save enquiry' : 'Capture enquiry'

  return (
    <form className={formGrid} onSubmit={handleSubmit} aria-label={editId ? 'Edit enquiry' : 'New enquiry'}>
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
      {error && (
        <div className={span.long}>
          <Callout tone="error">{error}</Callout>
        </div>
      )}
      <div className={`flex gap-2 ${span.long}`}>
        <Button type="submit" disabled={isSaving}>{ctaLabel}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}
