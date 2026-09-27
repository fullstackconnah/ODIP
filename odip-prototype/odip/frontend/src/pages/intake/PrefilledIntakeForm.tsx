import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import type { ParticipantDetailDto, SaveParticipantIntakeDto, UpdateParticipantDto } from '@/api/types'
import { useDownloadParticipantIntakeSnapshotPdf, useParticipantIntakeSnapshots, useSaveParticipantIntake, useUpdateParticipant } from '@/api/hooks'
import { extractErrorMessage } from './intakeFormat'

type PrefilledIntakeFormProps = {
  participant: ParticipantDetailDto
}

type IntakeField = { key: keyof SaveParticipantIntakeDto; label: string; type?: string }

const identityAndContactFields: IntakeField[] = [
  { key: 'firstName', label: 'First name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'preferredName', label: 'Preferred name' },
  { key: 'dateOfBirth', label: 'Date of birth', type: 'date' },
  { key: 'gender', label: 'Gender' },
  { key: 'ndisNumber', label: 'NDIS number' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'email', label: 'Email', type: 'email' },
]

const addressAndLivingArrangementFields: IntakeField[] = [
  { key: 'addressStreet', label: 'Street address' },
  { key: 'addressSuburb', label: 'Suburb' },
  { key: 'addressState', label: 'State' },
  { key: 'addressPostcode', label: 'Postcode' },
]

function nullable(value: string | null | undefined) {
  return value?.trim() || null
}

function initialValues(participant: ParticipantDetailDto): SaveParticipantIntakeDto {
  return {
    firstName: participant.firstName ?? '',
    lastName: participant.lastName ?? '',
    preferredName: participant.preferredName ?? '',
    dateOfBirth: participant.dateOfBirth ? participant.dateOfBirth.split('T')[0] : '',
    gender: participant.gender ?? null, ndisNumber: participant.ndisNumber ?? '',
    phone: participant.phone ?? '', email: participant.email ?? '',
    addressStreet: participant.addressStreet ?? '', addressSuburb: participant.addressSuburb ?? '',
    addressState: participant.addressState ?? '', addressPostcode: participant.addressPostcode ?? '',
    primaryDiagnosis: participant.primaryDiagnosis ?? '', medicalSummary: participant.medicalSummary ?? '',
    mobilityNotes: participant.mobilityNotes ?? '', behaviourRiskSummary: participant.behaviourRiskSummary ?? '', notes: participant.notes ?? '',
    inquiryId: participant.inquiryId ?? null,
    inquirySource: participant.inquirySource === 'Web' || participant.inquirySource === 'Email' || participant.inquirySource === 'Phone' ? participant.inquirySource : null,
    inquiryProvenance: participant.inquiryProvenance ?? '',
  }
}

function intakePayload(values: SaveParticipantIntakeDto): SaveParticipantIntakeDto {
  return {
    ...values,
    preferredName: nullable(values.preferredName), dateOfBirth: nullable(values.dateOfBirth),
    gender: values.gender || null, ndisNumber: nullable(values.ndisNumber), phone: nullable(values.phone), email: nullable(values.email), addressStreet: nullable(values.addressStreet),
    addressSuburb: nullable(values.addressSuburb), addressState: nullable(values.addressState), addressPostcode: nullable(values.addressPostcode),
    primaryDiagnosis: nullable(values.primaryDiagnosis), medicalSummary: nullable(values.medicalSummary), mobilityNotes: nullable(values.mobilityNotes),
    behaviourRiskSummary: nullable(values.behaviourRiskSummary), notes: nullable(values.notes),
    inquiryProvenance: nullable(values.inquiryProvenance),
  }
}

function newCompletionRequestId() {
  return crypto.randomUUID()
}

/**
 * An inquiry-converted participant remains the same participant record. This deliberately uses the
 * narrow endpoint for incomplete work; completion is the existing full-record PUT contract, which
 * captures an immutable audit snapshot only when CompleteIntake is explicitly set.
 */
export function PrefilledIntakeForm({ participant }: PrefilledIntakeFormProps) {
  const saveIntake = useSaveParticipantIntake()
  const completeIntake = useUpdateParticipant()
  const snapshots = useParticipantIntakeSnapshots(participant.id)
  const downloadSnapshot = useDownloadParticipantIntakeSnapshotPdf()
  const { register, handleSubmit, reset, getValues, formState: { errors, isDirty } } = useForm<SaveParticipantIntakeDto>({ defaultValues: initialValues(participant) })
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [completionRequestId, setCompletionRequestId] = useState(newCompletionRequestId)

  useEffect(() => {
    reset(initialValues(participant))
    setCompletionRequestId(newCompletionRequestId())
  }, [participant, reset])

  const onSave = async (values: SaveParticipantIntakeDto) => {
    setError(null)
    setNotice(null)
    try {
      await saveIntake.mutateAsync({ id: participant.id, data: intakePayload(values) })
      reset(values)
      setNotice('Saved as incomplete intake. This participant remains a draft and is not active or bookable.')
    } catch (err) {
      setError(err instanceof Error ? err.message : extractErrorMessage(err, 'Could not save the intake. Your changes are still on this page; please try again.'))
    }
  }

  const onComplete = async (values: SaveParticipantIntakeDto) => {
    // A completed intake creates an immutable audit revision. Keep this deliberate rather than
    // allowing the irreversible action to be reached by an accidental primary-button click.
    if (!window.confirm('Complete intake? This records a dated immutable audit PDF.')) return
    setError(null)
    setNotice(null)
    // Completion is intentionally a separate, full record update. The current participant provides
    // required non-intake values; only the narrow form values are overlaid before completion.
    const data = {
      ...participant,
      ...intakePayload(values),
      isDraft: true,
      completeIntake: true,
      completionRequestId,
    } as unknown as UpdateParticipantDto
    try {
      await completeIntake.mutateAsync({ id: participant.id, data })
      reset(getValues())
      await snapshots.refetch()
      setNotice('Intake completed. A dated immutable audit PDF has been recorded; the participant remains a draft until profile completion.')
      // A deliberate later completion must create a new revision, so only rotate after success.
      setCompletionRequestId(newCompletionRequestId())
    } catch (err) {
      setError(err instanceof Error ? err.message : extractErrorMessage(err, 'Could not complete the intake. Please retry; the same completion request will be used to avoid duplicate audit records.'))
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold">Complete intake</h1>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">Review the inquiry details and add only intake information. Full profile editing is completed separately.</p>
      </div>
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-accent)]/40 p-4 text-sm">
        <p className="font-medium">Draft participant</p>
        <p className="mt-1 text-[var(--color-muted-foreground)]">Saving or completing intake does not activate the participant: they are not active or bookable.</p>
      </div>
      {snapshots.data && snapshots.data.length > 0 && (
        <section aria-label="Immutable intake PDFs" className="rounded-lg border border-[var(--color-border)] p-4 text-sm">
          <h2 className="font-medium">Immutable intake PDFs</h2>
          <ul className="mt-2 space-y-1">
            {snapshots.data.map((snapshot) => (
              <li key={snapshot.revision}>
                <button type="button" className="text-[var(--color-primary)] underline" onClick={() => downloadSnapshot.mutate({ id: participant.id, revision: snapshot.revision })}>
                  Download intake completion revision {snapshot.revision} ({new Date(snapshot.completedAtUtc).toLocaleDateString()})
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {notice && <div role="status" className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-800">{notice}</div>}
      {error && <div role="alert" className="rounded-lg bg-[var(--color-destructive)]/10 p-3 text-sm text-[var(--color-destructive)]">{error}</div>}
      <form onSubmit={handleSubmit(onSave)} noValidate className="space-y-6">
        <section aria-labelledby="identity-and-contact-heading" className="space-y-4">
          <h2 id="identity-and-contact-heading" className="text-base font-semibold">Identity and contact</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {identityAndContactFields.map(({ key, label, type = 'text' }) => <label key={key} className="grid gap-1 text-sm font-medium">
              {label}{(key === 'firstName' || key === 'lastName') && <span aria-hidden="true"> *</span>}
              <input type={type} className="rounded-md border bg-transparent px-3 py-2" {...register(key, { required: key === 'firstName' || key === 'lastName' ? `${label} is required` : false })} />
              {errors[key]?.message && <span role="alert" className="text-[var(--color-destructive)]">{errors[key]?.message}</span>}
            </label>)}
          </div>
        </section>
        <section aria-labelledby="address-heading" className="space-y-4">
          <h2 id="address-heading" className="text-base font-semibold">Address</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {addressAndLivingArrangementFields.map(({ key, label, type = 'text' }) => <label key={key} className="grid gap-1 text-sm font-medium">
              {label}
              <input type={type} className="rounded-md border bg-transparent px-3 py-2" {...register(key)} />
            </label>)}
          </div>
        </section>
        <section aria-labelledby="clinical-support-heading" className="space-y-4">
          <h2 id="clinical-support-heading" className="text-base font-semibold">Clinical/support notes</h2>
          <label className="grid gap-1 text-sm font-medium">Primary diagnosis<input type="text" className="rounded-md border bg-transparent px-3 py-2" {...register('primaryDiagnosis')} /></label>
          {([
            ['medicalSummary', 'Medical summary'], ['mobilityNotes', 'Mobility notes'], ['behaviourRiskSummary', 'Behaviour risk summary'],
          ] as const).map(([key, label]) => <label key={key} className="grid gap-1 text-sm font-medium">{label}<textarea rows={4} className="rounded-md border bg-transparent px-3 py-2" {...register(key)} /></label>)}
        </section>
        <section aria-labelledby="inquiry-provenance-heading" className="space-y-4">
          <h2 id="inquiry-provenance-heading" className="text-base font-semibold">Inquiry provenance and operational notes</h2>
          <label className="grid gap-1 text-sm font-medium">Inquiry source
            <select className="rounded-md border bg-transparent px-3 py-2" {...register('inquirySource')}>
              <option value="">Select source</option>
              <option value="Web">Web</option>
              <option value="Email">Email</option>
              <option value="Phone">Phone</option>
            </select>
          </label>
          {([
            ['inquiryProvenance', 'Inquiry provenance'], ['notes', 'Intake notes'],
          ] as const).map(([key, label]) => <label key={key} className="grid gap-1 text-sm font-medium">{label}<textarea rows={4} className="rounded-md border bg-transparent px-3 py-2" {...register(key)} /></label>)}
        </section>
        <div className="flex flex-wrap items-center gap-3" aria-label="Intake actions">
          <button type="submit" disabled={saveIntake.isPending || completeIntake.isPending || !isDirty} className="rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary-foreground)] disabled:opacity-60">
            {saveIntake.isPending ? 'Saving intake…' : 'Save incomplete intake'}
          </button>
          <button type="button" onClick={handleSubmit(onComplete)} disabled={saveIntake.isPending || completeIntake.isPending} className="rounded-md border border-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary)] disabled:opacity-60">
            {completeIntake.isPending ? 'Completing intake…' : 'Complete intake'}
          </button>
          <span className="text-xs text-[var(--color-muted-foreground)]">Save incomplete intake safely preserves this draft for later; it does not activate or make the participant bookable. Completing intake validates the required fields, then asks for confirmation before recording a dated immutable audit PDF. If it fails, retrying uses the same request key.</span>
        </div>
      </form>
    </div>
  )
}