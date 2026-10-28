import { useNavigate, useParams } from 'react-router-dom'
import { flushSync } from 'react-dom'
import { useForm, useWatch, Controller } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useCreateStaff, useUpdateStaff, useStaffDetail, useEnsureStaffSignInAccount } from '@/api/hooks'
import { useRef, useState } from 'react'
import { FormField } from '@/components/FormField'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { Dropdown, type DropdownItem } from '@/components/Dropdown'
import { Card } from '@/components/Card'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button } from '@/components/Button'
import { PageHeader } from '@/components/PageHeader'
import { BackButton, BackActionButton } from '@/components/BackButton'
import { SignInEmailOutcome } from '@/components/SignInEmailOutcome'
import { useRefocusWhenLost } from '@/hooks/useRefocusWhenLost'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { addressConfirmationRequest } from '@/lib/addressConfirmation'
import { usePermissions } from '@/lib/permissions'
import { canSendSetPasswordEmail } from '@/lib/setPasswordEmail'
import { describeEmailOutcome, ensureAndSendSetPasswordEmail, type EmailOutcome } from '@/lib/signInEmail'
import { extractErrorMessage } from '@/lib/utils'
import { formGrid, span } from '@/lib/formGrid'
import { useFillOnce } from '@/hooks/useFillOnce'
import { Callout } from '@/components/Callout'
import { PageState } from '@/components/PageState'
import { isNotFoundError } from '@/lib/httpStatus'
import { retryingAfterError } from '@/lib/queryPhase'

const POSITION_ITEMS: DropdownItem[] = [
  { value: 'SupportWorker', label: 'Support Worker' },
  { value: 'SeniorSupportWorker', label: 'Senior Support Worker' },
  { value: 'Coordinator', label: 'Coordinator' },
  { value: 'TeamLeader', label: 'Team Leader' },
  { value: 'Other', label: 'Other' },
]

const staffSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  position: z.string().min(1, 'Position is required'),
  role: z.string().min(1, 'Account role is required'),
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  mobile: z.string().optional(),
  region: z.string().optional(),
  isDriverEligible: z.boolean().optional(),
  isFirstAidQualified: z.boolean().optional(),
  isMedicationCompetent: z.boolean().optional(),
  isManualHandlingCompetent: z.boolean().optional(),
  isOvernightEligible: z.boolean().optional(),
  firstAidExpiryDate: z.string().optional(),
  driverLicenceExpiryDate: z.string().optional(),
  manualHandlingExpiryDate: z.string().optional(),
  medicationCompetencyExpiryDate: z.string().optional(),
  workerScreeningNumber: z.string().optional(),
  workerScreeningExpiryDate: z.string().optional(),
  notes: z.string().optional(),
})

type StaffFormData = z.infer<typeof staffSchema>

// Every account-role value the backend can return on an existing record, even ones this form
// never offers as a selectable option (SuperAdmin, and Admin when the actor is a Coordinator) —
// used to label a locked/blocked role field with its real current value rather than showing a
// blank select.
const ROLE_LABELS: Record<string, string> = {
  SupportWorker: 'Support Worker',
  Coordinator: 'Coordinator',
  ReadOnly: 'Read Only',
  Admin: 'Admin',
  SuperAdmin: 'SuperAdmin',
}

// PP-85 — same error-extraction idiom as RecordAdministrationModal.tsx/MedicationFormPage.tsx,
// surfacing the backend's specific validation/conflict message (e.g. "A user with this email
// already exists.") instead of a generic banner.
export default function StaffCreatePage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const isEdit = !!id
  const createStaff = useCreateStaff()
  const updateStaff = useUpdateStaff()
  const ensureStaffAccount = useEnsureStaffSignInAccount()
  const pageQuery = useStaffDetail(isEdit ? id : undefined)
  const { data: existing, isError: isExistingError, error: existingError, refetch: refetchExisting } = pageQuery
  const mutation = isEdit ? updateStaff : createStaff
  const { isCoordinator } = usePermissions()
  // Staff added here get a user row and, until something makes one, no Firebase sign-in account. After a create the page makes sure there is
  // one and asks Firebase to email the link; with no Firebase (local dev auth) there is nothing to send and the page behaves as it always did.
  const emailLinkAvailable = canSendSetPasswordEmail()
  // After a create: what became of that email, kept ON SCREEN. Navigating away at once would take the answer with it.
  const [created, setCreated] = useState<{ id: string; name: string; email: string; outcome: EmailOutcome } | null>(null)
  const [retrying, setRetrying] = useState(false)
  // True from the click until the whole submit has finished, including the account step and the email that follow the create. The create
  // mutation settles before those do, so its isPending alone would let the button come back to life with the form still on screen, and a
  // second submit would post the same staff member again.
  const [submitting, setSubmitting] = useState(false)
  // The server wants the address checked (it is at neither the tenant's domain nor a common email provider): its sentence while the question is
  // up, null otherwise. "Use this address" submits the same form again with the confirmation (see submitWith), for that one submit only.
  const [confirmAddress, setConfirmAddress] = useState<string | null>(null)
  // The done view's first line takes focus when the form is swapped for it (the Create button that had it is gone), and again whenever a retry
  // removes the button that had it.
  const doneHeading = useRef<HTMLParagraphElement>(null)
  useRefocusWhenLost(doneHeading, created)

  // The account-role dropdown always hides SuperAdmin (never grantable from this form), and
  // additionally hides Admin when the person filling out the form is a Coordinator — a
  // Coordinator cannot promote anyone to Admin (enforced server-side too; see
  // StaffController's role guardrails).
  const ROLE_OPTIONS = [
    { value: 'SupportWorker', label: 'Support Worker' },
    { value: 'Coordinator', label: 'Coordinator' },
    { value: 'ReadOnly', label: 'Read Only' },
    ...(isCoordinator ? [] : [{ value: 'Admin', label: 'Admin' }]),
  ]
  const roleOptionValues = ROLE_OPTIONS.map(o => o.value)

  // The target's CURRENT role may not be one of the actor's assignable options — e.g. a
  // Coordinator editing an existing Admin (Admin isn't offered as a promotion target, but the
  // record itself already holds it), or anyone editing a SuperAdmin account. The backend only
  // blocks a role PROMOTION, not edits to a record's other fields, so the fix here must not block
  // the whole form just because the role select can't offer the current value — it must let
  // every other field (Mobile, Notes, qualifications, ...) still save.
  //
  // SuperAdmin is the one case that IS blocked wholesale server-side (StaffController's
  // guardrails: an Admin/Coordinator actor cannot edit an existing SuperAdmin account at all,
  // full stop) — a submitable form there would just 400, so it's blocked outright below with a
  // clear message instead. Settings → Users is the SuperAdmin-only account administration
  // surface for that case (see spec §2).
  const existingRole = existing?.role
  const isTargetSuperAdmin = isEdit && existingRole === 'SuperAdmin'
  const isRoleLocked = isEdit && !!existingRole && !isTargetSuperAdmin && !roleOptionValues.includes(existingRole)
  const roleSelectOptions = isRoleLocked && existingRole
    ? [...ROLE_OPTIONS, { value: existingRole, label: ROLE_LABELS[existingRole] ?? existingRole }]
    : ROLE_OPTIONS

  const { register, control, handleSubmit, reset, formState: { errors, isDirty } } = useForm<StaffFormData>({
    resolver: zodResolver(staffSchema),
    defaultValues: {
      position: 'SupportWorker',
      role: 'SupportWorker',
      isDriverEligible: false,
      isFirstAidQualified: false,
      isMedicationCompetent: false,
      isManualHandlingCompetent: false,
      isOvernightEligible: false,
    },
  })

  const typedEmail = useWatch({ control, name: 'email' })

  useFillOnce(existing, record => {
    reset({
      firstName: record.firstName ?? '',
      lastName: record.lastName ?? '',
      position: record.position ?? 'SupportWorker',
      role: record.role ?? 'SupportWorker',
      email: record.email ?? '',
      mobile: record.mobile ?? '',
      region: record.region ?? '',
      isDriverEligible: record.isDriverEligible ?? false,
      isFirstAidQualified: record.isFirstAidQualified ?? false,
      isMedicationCompetent: record.isMedicationCompetent ?? false,
      isManualHandlingCompetent: record.isManualHandlingCompetent ?? false,
      isOvernightEligible: record.isOvernightEligible ?? false,
      firstAidExpiryDate: record.firstAidExpiryDate ?? '',
      driverLicenceExpiryDate: record.driverLicenceExpiryDate ?? '',
      manualHandlingExpiryDate: record.manualHandlingExpiryDate ?? '',
      medicationCompetencyExpiryDate: record.medicationCompetencyExpiryDate ?? '',
      workerScreeningNumber: record.workerScreeningNumber ?? '',
      workerScreeningExpiryDate: record.workerScreeningExpiryDate ?? '',
      notes: record.notes ?? '',
    })
  }, !isDirty)

  const onSubmit = async (data: StaffFormData, addressConfirmed: boolean) => {
    const payload: any = { ...data }
    for (const key of Object.keys(payload)) {
      if (payload[key] === '' || payload[key] === undefined) payload[key] = null
    }
    if (addressConfirmed) payload.addressConfirmed = true
    setSubmitting(true)
    try {
      if (isEdit) {
        // The page has no Active control, so the flag is read at save: a deactivation made since this page loaded is not undone.
        // If the re-read fails, the flag cached at page load is sent (never worse than before).
        const { data: current } = await refetchExisting()
        const res = await updateStaff.mutateAsync({ id, data: { ...payload, isActive: current?.isActive ?? existing?.isActive ?? true } })
        if (res.success) {
          flushSync(() => reset(data))
          navigate('/staff', { replace: true })
        }
      } else {
        const res = await createStaff.mutateAsync(payload)
        if (res.success) {
          flushSync(() => reset(data))
          const person = res.data
          if (emailLinkAvailable && person?.id && person.isActive && person.email) {
            // The server stored the address lower-case; that is the one the email goes to.
            const outcome = await ensureAndSendSetPasswordEmail(person.email, () => ensureStaffAccount.mutateAsync(person.id))
            setCreated({ id: person.id, name: person.fullName, email: person.email, outcome })
          } else {
            navigate('/staff', { replace: true })
          }
        }
      }
    } catch (err) {
      const asking = addressConfirmationRequest(err)
      if (asking) {
        // Not a failure: the server wants the address checked first. Nothing was made, so clear the mutation's error (the red banner would show
        // the question as a failure) and ask.
        mutation.reset?.()
        setConfirmAddress(asking)
      }
      // Any other error is handled by the mutation's state.
    } finally {
      setSubmitting(false)
    }
  }

  // The form's submit, with or without the confirmation. The confirmation is an argument, not state or a ref, so it exists only for the one
  // submit that carries it and can never leak into a later attempt.
  const submitWith = (addressConfirmed: boolean) => handleSubmit(data => onSubmit(data, addressConfirmed))

  const { dialog: unsavedChangesDialog } = useUnsavedChangesWarning(isDirty)

  async function sendAgain() {
    if (!created || retrying) return
    setRetrying(true)
    const outcome = await ensureAndSendSetPasswordEmail(created.email, () => ensureStaffAccount.mutateAsync(created.id))
    setCreated({ ...created, outcome })
    setRetrying(false)
  }

  // An unknown id is a not-found, never a blank form that would PUT to it.
  if (isEdit && !existing) {
    if (!isExistingError && !retryingAfterError(pageQuery)) return <PageState kind="loading" noun="staff member" />
    return isNotFoundError(existingError)
      ? <PageState kind="not-found" noun="staff member" backTo="/staff" backLabel="staff" />
      : <PageState kind="error" noun="staff member" onRetry={() => refetchExisting()} />
  }

  // What the done view says, once: the visible Callout shows the sentence and the status region announces it.
  const announcement = created ? `${created.name} was created. ${describeEmailOutcome(created.outcome, 'use Send again').message}` : ''

  if (created) {
    return (
      <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in max-w-[1600px]">
        {/* There before anything is said, and first in the page in both views, so what is written into it later is announced. */}
        <AnnouncementRegion message={announcement} />
        <PageHeader title="Staff member created" subtitle={created.name} />
        <Card className="space-y-4">
          <p ref={doneHeading} tabIndex={-1} className="text-sm font-medium text-[var(--color-foreground)] focus:outline-none">{created.name} was created.</p>
          <SignInEmailOutcome outcome={created.outcome} retry="use Send again" onRetry={sendAgain} retrying={retrying} announce={false} />
          <div className="flex justify-end">
            <Button to="/staff">Done</Button>
          </div>
        </Card>
      </div>
    )
  }

  if (isTargetSuperAdmin) {
    return (
      <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in max-w-[1600px]">
        <div className="flex items-start gap-2">
          <BackButton to="/staff" label="staff" variant="icon" />
          <div className="flex-1 min-w-0"><PageHeader title="Edit staff member" /></div>
        </div>
        <Card className="space-y-2">
          <p role="alert" className="text-sm font-medium text-[var(--color-destructive)]">
            SuperAdmin accounts can't be edited here.
          </p>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            SuperAdmin accounts are managed in Settings › Users. Contact a SuperAdmin if this account's role or profile needs to change.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in max-w-[1600px]">
      <AnnouncementRegion message={announcement} />
      <div className="flex items-start gap-2">
        <BackButton to="/staff" label="staff" variant="icon" />
        <div className="flex-1 min-w-0"><PageHeader title={isEdit ? 'Edit staff member' : 'New staff member'} /></div>
      </div>

      {mutation.isError && (
        <Callout tone="error">
          {extractErrorMessage(mutation.error, `Failed to ${isEdit ? 'update' : 'create'} staff member. Please check your input and try again.`)}
        </Callout>
      )}

      <form onSubmit={submitWith(false)} className="flex flex-col gap-[var(--section-gap)]">
        {/* Personal Information */}
        <Card title="Personal information">
          <div className={formGrid}>
            <FormField label="First Name" required error={errors.firstName?.message} className={span.medium}>
              <input {...register('firstName')} placeholder="e.g. Sarah" autoFocus />
            </FormField>

            <FormField label="Last Name" required error={errors.lastName?.message} className={span.medium}>
              <input {...register('lastName')} placeholder="e.g. Mitchell" />
            </FormField>

            <FormField label="Position" required error={errors.position?.message} className={span.medium}>
              <Controller
                control={control}
                name="position"
                render={({ field }) => (
                  <Dropdown
                    variant="form"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    items={POSITION_ITEMS}
                  />
                )}
              />
            </FormField>

            <FormField label="Region" className={span.short}>
              <input {...register('region')} placeholder="e.g. South East QLD" />
            </FormField>
          </div>
        </Card>

        {/* Account */}
        <Card title="Account">
          <div className={formGrid}>
            {isEdit && existing?.username && (
              <FormField label="Username" hint="Generated automatically from the staff member's name and cannot be changed here." className={span.medium}>
                <input value={existing.username} disabled readOnly />
              </FormField>
            )}

            <FormField label="Email" required error={errors.email?.message} hint={
                !errors.email
                  ? (!isEdit && emailLinkAvailable
                      ? `We'll email ${typedEmail?.trim() || 'the new staff member'} a link to set their password.`
                      : 'Used to sign in to the app.')
                  : undefined
              } className={span.medium}>
              <input type="email" {...register('email')} placeholder="e.g. sarah@example.com.au" />
            </FormField>

            <FormField
              label="Account Role"
              required
              error={errors.role?.message}
              hint={
                isRoleLocked
                  ? 'Only an Admin can change this role.'
                  : (!errors.role ? 'Controls what this person can access and edit in the app.' : undefined)
              }
              className={span.medium}
            >
              <Controller
                control={control}
                name="role"
                render={({ field }) => (
                  <Dropdown
                    variant="form"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    items={roleSelectOptions}
                    disabled={isRoleLocked}
                  />
                )}
              />
            </FormField>
          </div>
        </Card>

        {/* Contact */}
        <Card title="Contact">
          <div className={formGrid}>
            <FormField label="Mobile" className={span.medium}>
              <input {...register('mobile')} placeholder="e.g. 0412 345 678" />
            </FormField>

            <FormField label="Notes" className={span.long}>
              <textarea {...register('notes')} rows={3} placeholder="Any additional notes..." />
            </FormField>
          </div>
        </Card>

        {/* Qualifications */}
        <Card title="Qualifications & eligibility">
          <div className={formGrid}>
            <div className={`${span.medium} space-y-1`}>
              <FormField label="First Aid Qualified" layout="checkbox">
                <input type="checkbox" {...register('isFirstAidQualified')} className="w-4 h-4 rounded border-[var(--color-border)]" />
              </FormField>
              <div className="ml-7">
                <FormField label="Expiry date">
                  <input type="date" {...register('firstAidExpiryDate')} />
                </FormField>
              </div>
            </div>

            <div className={`${span.medium} space-y-1`}>
              <FormField label="Driver Eligible" layout="checkbox">
                <input type="checkbox" {...register('isDriverEligible')} className="w-4 h-4 rounded border-[var(--color-border)]" />
              </FormField>
              <div className="ml-7">
                <FormField label="Licence expiry date">
                  <input type="date" {...register('driverLicenceExpiryDate')} />
                </FormField>
              </div>
            </div>

            <div className={`${span.medium} space-y-1`}>
              <FormField label="Manual Handling Competent" layout="checkbox">
                <input type="checkbox" {...register('isManualHandlingCompetent')} className="w-4 h-4 rounded border-[var(--color-border)]" />
              </FormField>
              <div className="ml-7">
                <FormField label="Expiry date">
                  <input type="date" {...register('manualHandlingExpiryDate')} />
                </FormField>
              </div>
            </div>

            <div className={`${span.medium} space-y-1`}>
              <FormField label="Medication Competent" layout="checkbox">
                <input type="checkbox" {...register('isMedicationCompetent')} className="w-4 h-4 rounded border-[var(--color-border)]" />
              </FormField>
              <div className="ml-7">
                <FormField label="Expiry date">
                  <input type="date" {...register('medicationCompetencyExpiryDate')} />
                </FormField>
              </div>
            </div>

            <FormField label="Overnight Eligible" layout="checkbox" className={span.short}>
              <input type="checkbox" {...register('isOvernightEligible')} className="w-4 h-4 rounded border-[var(--color-border)]" />
            </FormField>

            <div className={`${span.medium} space-y-1`}>
              <FormField label="Worker screening number">
                <input {...register('workerScreeningNumber')} placeholder="e.g. WWC1234567" />
              </FormField>
              <FormField label="Worker screening expiry">
                <input type="date" {...register('workerScreeningExpiryDate')} />
              </FormField>
            </div>
          </div>
        </Card>

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <BackActionButton to="/staff" />
          <Button type="submit" disabled={mutation.isPending || submitting}>
            {mutation.isPending || (isEdit && submitting)
              ? (isEdit ? 'Saving…' : 'Creating…')
              : submitting && !isEdit && emailLinkAvailable
                ? 'Sending link...'
                : (isEdit ? 'Save' : 'Create staff member')}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirmAddress !== null}
        title="Check this address"
        message={confirmAddress}
        confirmLabel="Use this address"
        cancelLabel="Go back"
        onCancel={() => setConfirmAddress(null)}
        onConfirm={() => {
          setConfirmAddress(null)
          void submitWith(true)()
        }}
      />
      {unsavedChangesDialog}
    </div>
  )
}
