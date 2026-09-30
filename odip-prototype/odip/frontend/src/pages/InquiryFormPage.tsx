import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Callout } from '@/components/Callout'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { TextField } from '@/components/TextField'
import { SelectField } from '@/components/SelectField'
import { PageHeader } from '@/components/PageHeader'
import { useCreateParticipantInquiry, useParticipantInquiries, useUpdateParticipantInquiry } from '@/api/hooks'
import type { CreateParticipantInquiryDto, InquirySource } from '@/api/types/inquiries'
import { formGrid, span } from '@/lib/formGrid'

const blank = (): CreateParticipantInquiryDto => ({ firstName: '', lastName: '', phone: '', email: '', source: 'Phone', provenance: '' })

/**
 * Routed enquiry form. Lives at /participants/new-inquiry. With no ?id= it creates a new
 * enquiry; with ?id=<enquiry-id> it loads the existing row and submits an update. Either way
 * the page owns its own PageHeader + Card + Button stack and navigates back to
 * /participants?tab=enquiries on save so the enquiries tab re-renders the new/edited row.
 */
export default function InquiryFormPage() {
  const [searchParams] = useSearchParams()
  const editId = searchParams.get('id')
  const navigate = useNavigate()
  const { data: inquiries = [] } = useParticipantInquiries()
  const existing = editId ? inquiries.find(row => row.id === editId) : undefined

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <div className="flex items-start gap-4">
        <Button
          variant="ghost"
          iconOnly
          to="/participants?tab=enquiries"
          aria-label="Back to enquiries"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <PageHeader
            title={editId ? 'Edit enquiry' : 'New enquiry'}
            subtitle={editId ? 'Update the saved enquiry details.' : 'Capture a light enquiry when someone first contacts the service.'}
          />
        </div>
      </div>

      <Card title={editId ? 'Edit enquiry' : 'New enquiry'}>
        {/* Keying the form on `editId` resets the state when switching between create and
            edit, so we hydrate from `existing` via the lazy initializer instead of syncing
            inside a useEffect (which trips the set-state-in-effect lint rule). */}
        <InquiryFormBody
          key={editId ?? 'new'}
          initial={existing
            ? {
                firstName: existing.firstName,
                lastName: existing.lastName,
                phone: existing.phone ?? '',
                email: existing.email ?? '',
                source: existing.source,
                provenance: existing.provenance ?? '',
              }
            : blank()}
          editId={editId}
          onCancel={() => navigate('/participants?tab=enquiries')}
          onSaved={() => navigate('/participants?tab=enquiries')}
        />
      </Card>
    </div>
  )
}

function InquiryFormBody({
  initial,
  editId,
  onCancel,
  onSaved,
}: {
  initial: CreateParticipantInquiryDto
  editId: string | null
  onCancel: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<CreateParticipantInquiryDto>(initial)
  const [error, setError] = useState<string | null>(null)
  const create = useCreateParticipantInquiry()
  const update = useUpdateParticipantInquiry()
  const isSaving = create.isPending || update.isPending

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (editId) {
      update.mutate(
        { id: editId, data: form },
        {
          onSuccess: onSaved,
          onError: () => setError('Could not update this enquiry. Check the details and try again.'),
        },
      )
    } else {
      create.mutate(form, {
        onSuccess: onSaved,
        onError: () => setError('Could not capture this enquiry. Check the details and try again.'),
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