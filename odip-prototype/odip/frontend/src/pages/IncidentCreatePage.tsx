import { useNavigate, useParams, useLocation, Link } from 'react-router-dom'
import { flushSync } from 'react-dom'
import { useForm, useWatch, type Resolver, type FieldErrors } from 'react-hook-form'
import { z } from 'zod'
import { useCreateIncident, useUpdateIncident, useIncident, useTrips, useStaff, useParticipants, useRestrictivePractices } from '@/api/hooks'
import { ArrowLeft, Info, ShieldCheck, ShieldAlert } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { FormField } from '@/components/FormField'
import { Card } from '@/components/Card'
import { Dropdown } from '@/components/Dropdown'
import { SearchableSelect } from '@/components/SearchableSelect'
import type { TripListDto, StaffListDto, ParticipantListDto, CreateIncidentDto, UpdateIncidentDto } from '@/api/types'
import type { IncidentType, IncidentSeverity, IncidentStatus, QscReportingStatus } from '@/api/types/enums'
import { SERVICE_STREAMS } from '@/api/types/enums'
import { SERVICE_STREAM_LABELS } from '@/api/types/participants'
import { RESTRICTIVE_PRACTICE_TYPES, RESTRICTIVE_PRACTICE_TYPE_LABELS } from '@/api/types/restrictive-practices'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import {
  isMarIncidentPrefillState,
  buildIncidentDescriptionSkeleton,
  buildIncidentTitleSkeleton,
  buildIncidentDateTime,
  suggestedIncidentSeverity,
  previewRpAuthorisation,
  buildRpIncidentDescriptionSkeleton,
} from '@/lib/incidentPrefill'
import { ADMIN_STATUS_LABELS } from '@/api/types/medications'
import { formatDateAu } from '@/lib/utils'

// INC-01: the service-type dropdown offers the business streams plus "None" (untagged) —
// selecting "Trip" is what reveals the trip-select dropdown below.
const INCIDENT_SERVICE_TYPES = ['None', ...SERVICE_STREAMS] as const

const incidentSchema = z.object({
  serviceType: z.string().optional(),
  tripInstanceId: z.string().optional(),
  incidentType: z.string().min(1, 'Incident type is required'),
  otherTypeSpecify: z.string().optional(),
  // INC-04
  restrictivePracticeType: z.string().optional(),
  // INC-05
  restrictivePracticeId: z.string().optional(),
  severity: z.string().min(1, 'Severity is required'),
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  reportedByStaffId: z.string().min(1, 'Reporter is required'),
  incidentDateTime: z.string().min(1, 'Date/time is required'),
  location: z.string().optional(),
  participantBookingId: z.string().optional(),
  involvedParticipantId: z.string().optional(),
  involvedStaffId: z.string().optional(),
  immediateActionsTaken: z.string().optional(),
  wereEmergencyServicesCalled: z.boolean().optional(),
  emergencyServicesDetails: z.string().optional(),
  witnessNames: z.string().optional(),
  witnessStatements: z.string().optional(),
  // Edit-only fields
  status: z.string().optional(),
  qscReportingStatus: z.string().optional(),
  qscReferenceNumber: z.string().optional(),
  qscReportedAt: z.string().optional(),
  reviewedByStaffId: z.string().optional(),
  reviewNotes: z.string().optional(),
  correctiveActions: z.string().optional(),
  familyNotified: z.boolean().optional(),
  familyNotifiedAt: z.string().optional(),
  supportCoordinatorNotified: z.boolean().optional(),
  supportCoordinatorNotifiedAt: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.serviceType === 'Trip' && !data.tripInstanceId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tripInstanceId'], message: 'A trip must be selected when the service type is Trip.' })
  }
  if (data.incidentType === 'Other' && !data.otherTypeSpecify?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['otherTypeSpecify'], message: 'Please specify the incident type.' })
  }
  if (data.incidentType === 'RestrictivePracticeUse' && !data.restrictivePracticeType) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['restrictivePracticeType'], message: 'Please select the restrictive practice type.' })
  }
})

type IncidentFormData = z.infer<typeof incidentSchema>

// @hookform/resolvers 3.x's zodResolver reads ZodError.errors (a getter zod v4 removed in favour
// of .issues), so it throws past react-hook-form instead of populating formState.errors on
// validation failure. Resolve directly against zod's safeParse/.issues API instead of routing
// through that resolver (same workaround as ParticipantCreatePage's participantResolver).
const incidentResolver: Resolver<IncidentFormData> = (values) => {
  const result = incidentSchema.safeParse(values)
  if (result.success) return { values: result.data, errors: {} }
  const errors: FieldErrors<IncidentFormData> = {}
  for (const issue of result.error.issues) {
    const field = String(issue.path[0]) as keyof IncidentFormData
    if (!errors[field]) errors[field] = { type: issue.code, message: issue.message }
  }
  return { values: {}, errors }
}

export default function IncidentCreatePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { id } = useParams()
  const isEdit = !!id
  const createIncident = useCreateIncident()
  const updateIncident = useUpdateIncident()
  const mutation = isEdit ? updateIncident : createIncident
  const { data: trips = [] } = useTrips()
  const { data: staff = [] } = useStaff()
  const { data: participants = [] } = useParticipants()
  const { data: existingIncident } = useIncident(id)

  // INC-03: router-state prefill dropped in by RecordAdministrationModal after a
  // refused/withheld/missed/wrong-medication outcome is recorded. Purely informational client
  // state — nothing was persisted to make this incident exist, and nothing is until this form
  // is submitted like any other.
  const marPrefill = !isEdit && isMarIncidentPrefillState(location.state) ? location.state : null
  const appliedMarPrefillRef = useRef(false)

  const { register, handleSubmit, reset, control, setValue, getValues, formState: { errors, isDirty } } = useForm<IncidentFormData>({
    resolver: incidentResolver,
    defaultValues: {
      serviceType: 'None',
      severity: 'Medium',
      incidentType: 'Other',
      status: 'Draft',
      qscReportingStatus: 'NotRequired',
      wereEmergencyServicesCalled: false,
      familyNotified: false,
      supportCoordinatorNotified: false,
    },
  })

  const serviceType = useWatch({ control, name: 'serviceType' })
  const incidentType = useWatch({ control, name: 'incidentType' })
  const wereEmergencyCalled = useWatch({ control, name: 'wereEmergencyServicesCalled' })
  const familyNotified = useWatch({ control, name: 'familyNotified' })
  const supportCoordinatorNotified = useWatch({ control, name: 'supportCoordinatorNotified' })
  const involvedParticipantId = useWatch({ control, name: 'involvedParticipantId' })
  const restrictivePracticeType = useWatch({ control, name: 'restrictivePracticeType' })
  const restrictivePracticeId = useWatch({ control, name: 'restrictivePracticeId' })
  // UX-01: reportedByStaffId/involvedStaffId/reviewedByStaffId are SearchableSelect (below), which
  // — like the RP type/RP id pickers above — isn't a native input `register()` can bind to, so
  // it's tracked the same way: watched here, written back via setValue on change.
  const reportedByStaffId = useWatch({ control, name: 'reportedByStaffId' })
  const involvedStaffId = useWatch({ control, name: 'involvedStaffId' })
  const reviewedByStaffId = useWatch({ control, name: 'reviewedByStaffId' })
  const isRpIncident = incidentType === 'RestrictivePracticeUse'

  // INC-04/INC-05: the involved participant's ACTIVE register entries — useRestrictivePractices
  // defaults to active-only, which is exactly the set both the determination and the linked-entry
  // picker need. Disabled (participantId undefined) unless this is an RP incident with a
  // participant chosen, so switching incident type away from RestrictivePracticeUse doesn't keep
  // an unnecessary query alive.
  const { data: participantPractices = [] } = useRestrictivePractices(isRpIncident ? (involvedParticipantId || undefined) : undefined)
  const matchingPractices = useMemo(
    () => participantPractices.filter(p => p.type === restrictivePracticeType),
    [participantPractices, restrictivePracticeType],
  )

  // INC-04: live preview of the authorised/unauthorised finding while composing a new incident —
  // updates as the participant/type selections change, pre-submit. The backend computes and
  // freezes the real value at Create; on Edit this preview is not used at all — see the banner
  // below, which reads the frozen `existingIncident.isRestrictivePracticeAuthorised` instead.
  const rpAuthorisationPreview = previewRpAuthorisation(involvedParticipantId, restrictivePracticeType, matchingPractices)

  function handleSelectLinkedPractice(value: string) {
    setValue('restrictivePracticeId', value, { shouldDirty: true })
    if (!value) return
    const practice = matchingPractices.find(p => p.id === value)
    // Only prepopulate Description when it's still empty — never clobber what the reporter has
    // already typed, same "skeleton, don't overwrite" rule INC-03's MAR prefill follows.
    if (practice && !getValues('description')?.trim()) {
      setValue('description', buildRpIncidentDescriptionSkeleton(practice), { shouldDirty: true })
    }
  }

  useEffect(() => {
    if (isEdit && existingIncident) {
      const i = existingIncident
      reset({
        serviceType: i.serviceType ?? 'None',
        tripInstanceId: i.tripInstanceId ?? '',
        incidentType: i.incidentType ?? 'Other',
        otherTypeSpecify: i.otherTypeSpecify ?? '',
        restrictivePracticeType: i.restrictivePracticeType ?? '',
        restrictivePracticeId: i.restrictivePracticeId ?? '',
        severity: i.severity ?? 'Medium',
        title: i.title ?? '',
        description: i.description ?? '',
        reportedByStaffId: i.reportedByStaffId ?? '',
        incidentDateTime: i.incidentDateTime ? i.incidentDateTime.slice(0, 16) : '',
        location: i.location ?? '',
        participantBookingId: i.participantBookingId ?? '',
        involvedParticipantId: i.involvedParticipantId ?? '',
        involvedStaffId: i.involvedStaffId ?? '',
        immediateActionsTaken: i.immediateActionsTaken ?? '',
        wereEmergencyServicesCalled: i.wereEmergencyServicesCalled ?? false,
        emergencyServicesDetails: i.emergencyServicesDetails ?? '',
        witnessNames: i.witnessNames ?? '',
        witnessStatements: i.witnessStatements ?? '',
        status: i.status ?? 'Draft',
        qscReportingStatus: i.qscReportingStatus ?? 'NotRequired',
        qscReferenceNumber: i.qscReferenceNumber ?? '',
        qscReportedAt: i.qscReportedAt ? i.qscReportedAt.slice(0, 16) : '',
        reviewedByStaffId: i.reviewedByStaffId ?? '',
        reviewNotes: i.reviewNotes ?? '',
        correctiveActions: i.correctiveActions ?? '',
        familyNotified: i.familyNotified ?? false,
        familyNotifiedAt: i.familyNotifiedAt ? i.familyNotifiedAt.slice(0, 16) : '',
        supportCoordinatorNotified: i.supportCoordinatorNotified ?? false,
        supportCoordinatorNotifiedAt: i.supportCoordinatorNotifiedAt ? i.supportCoordinatorNotifiedAt.slice(0, 16) : '',
      })
    }
  }, [id, isEdit, existingIncident, reset])

  // INC-03: apply the MAR drop-into-draft prefill once, on mount — a `useRef` "applied once"
  // guard means a coordinator who's already started editing the pre-filled form never has their
  // in-progress edits silently overwritten by a later run of this effect.
  //
  // reportedByStaffId uses marPrefill.recordedByUserId directly. Staff/User unification (PR #39)
  // and MED-04 (PR #40) are both merged into this branch's base — staff records ARE user
  // accounts, so `staff[].id` and `recordedByUserId` are the same id space, and the incident
  // API's `reportedByStaffId` wire field validates against `_db.Users` server-side. No id-match
  // against the loaded `staff` list is needed (the native <select> shows the right option once
  // `staff` finishes loading, purely via value equality, regardless of load timing) — and
  // critically, no name-based fallback: `fullName` has no uniqueness constraint, so matching by
  // name risked silently attributing "Reported By" to a different same-named staff member,
  // which is an audit-trail integrity defect on an NDIS incident report. If recordedByUserId
  // doesn't correspond to any current staff member (e.g. a deactivated account), the field is
  // simply left showing that raw id with no matching option — never a name-guessed wrong person.
  useEffect(() => {
    if (!marPrefill || appliedMarPrefillRef.current) return
    appliedMarPrefillRef.current = true
    reset({
      serviceType: marPrefill.tripInstanceId ? 'Trip' : 'None',
      tripInstanceId: marPrefill.tripInstanceId ?? '',
      incidentType: 'MedicationError',
      severity: suggestedIncidentSeverity(marPrefill.outcome),
      title: buildIncidentTitleSkeleton(marPrefill),
      description: buildIncidentDescriptionSkeleton(marPrefill),
      involvedParticipantId: marPrefill.participantId,
      reportedByStaffId: marPrefill.recordedByUserId ?? '',
      incidentDateTime: buildIncidentDateTime(marPrefill),
      status: 'Draft',
      qscReportingStatus: 'NotRequired',
      wereEmergencyServicesCalled: false,
      familyNotified: false,
      supportCoordinatorNotified: false,
    })
  }, [marPrefill, reset])

  const onSubmit = async (data: IncidentFormData) => {
    const base: CreateIncidentDto = {
      serviceType: (data.serviceType || 'None') as CreateIncidentDto['serviceType'],
      tripInstanceId: data.serviceType === 'Trip' ? data.tripInstanceId || undefined : undefined,
      reportedByStaffId: data.reportedByStaffId,
      incidentType: data.incidentType as IncidentType,
      otherTypeSpecify: data.incidentType === 'Other' ? data.otherTypeSpecify || undefined : undefined,
      restrictivePracticeType: data.incidentType === 'RestrictivePracticeUse'
        ? (data.restrictivePracticeType || undefined) as CreateIncidentDto['restrictivePracticeType']
        : undefined,
      restrictivePracticeId: data.incidentType === 'RestrictivePracticeUse' ? data.restrictivePracticeId || undefined : undefined,
      severity: data.severity as IncidentSeverity,
      title: data.title,
      description: data.description,
      incidentDateTime: data.incidentDateTime,
      participantBookingId: data.participantBookingId || undefined,
      involvedParticipantId: data.involvedParticipantId || undefined,
      involvedStaffId: data.involvedStaffId || undefined,
      location: data.location || undefined,
      immediateActionsTaken: data.immediateActionsTaken || undefined,
      wereEmergencyServicesCalled: data.wereEmergencyServicesCalled ?? false,
      emergencyServicesDetails: data.emergencyServicesDetails || undefined,
      witnessNames: data.witnessNames || undefined,
      witnessStatements: data.witnessStatements || undefined,
    }

    try {
      if (isEdit) {
        const updateData: UpdateIncidentDto = {
          ...base,
          status: (data.status || 'Draft') as IncidentStatus,
          qscReportingStatus: (data.qscReportingStatus || 'NotRequired') as QscReportingStatus,
          qscReportedAt: data.qscReportedAt || undefined,
          qscReferenceNumber: data.qscReferenceNumber || undefined,
          reviewedByStaffId: data.reviewedByStaffId || undefined,
          reviewNotes: data.reviewNotes || undefined,
          correctiveActions: data.correctiveActions || undefined,
          familyNotified: data.familyNotified ?? false,
          familyNotifiedAt: data.familyNotifiedAt || undefined,
          supportCoordinatorNotified: data.supportCoordinatorNotified ?? false,
          supportCoordinatorNotifiedAt: data.supportCoordinatorNotifiedAt || undefined,
        }
        const res = await updateIncident.mutateAsync({ id, data: updateData })
        if (res.success) {
          flushSync(() => reset(data))
          navigate('/incidents')
        }
      } else {
        const res = await createIncident.mutateAsync(base)
        if (res.success) {
          flushSync(() => reset(data))
          navigate('/incidents')
        }
      }
    } catch {
      // error handled by mutation state
    }
  }

  const { dialog: unsavedChangesDialog } = useUnsavedChangesWarning(isDirty)

  return (
    <div className="space-y-6 animate-fade-in">
      {unsavedChangesDialog}
      <div className="flex items-center gap-4">
        <Link to="/incidents" className="p-2 rounded-lg hover:bg-[var(--color-accent)] transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl md:text-2xl font-bold">{isEdit ? 'Edit Incident Report' : 'Report New Incident'}</h1>
      </div>

      {marPrefill && (
        <Card className="bg-[var(--color-secondary-container)]/40 border-[var(--color-secondary-container)]">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-[var(--color-secondary)] shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-sm text-[var(--color-foreground)]">
              <strong className="font-medium">Pre-filled from the medication record:</strong> {ADMIN_STATUS_LABELS[marPrefill.outcome]} — {marPrefill.medicationName} for {marPrefill.participantName}. Review and complete the details below — nothing is filed until you submit this report.
            </p>
          </div>
        </Card>
      )}

      {mutation.isError && (
        <div className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
          Failed to {isEdit ? 'update' : 'create'} incident report. Please check your input and try again.
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="grid md:grid-cols-2 gap-6">
        {/* Incident Details */}
        <Card title="Incident Details" className="space-y-4">
          <FormField label="Title" required error={errors.title?.message}>
            <input {...register('title')} placeholder="Brief incident summary" autoFocus />
          </FormField>

          <FormField label="Service Type" required>
            <select {...register('serviceType')}>
              {INCIDENT_SERVICE_TYPES.map((s) => (
                <option key={s} value={s}>{s === 'None' ? 'None / not applicable' : SERVICE_STREAM_LABELS[s]}</option>
              ))}
            </select>
          </FormField>

          {serviceType === 'Trip' && (
            <FormField label="Trip" required error={errors.tripInstanceId?.message}>
              <select {...register('tripInstanceId')}>
                <option value="">Select a trip...</option>
                {trips.map((t: TripListDto) => (
                  <option key={t.id} value={t.id}>{t.tripName}</option>
                ))}
              </select>
            </FormField>
          )}

          <FormField label="Incident Type" required>
            <select {...register('incidentType')}>
              <option value="Injury">Injury</option>
              <option value="Illness">Illness</option>
              <option value="MedicationError">Medication Error</option>
              <option value="BehaviourOfConcern">Behaviour of Concern</option>
              <option value="RestrictivePracticeUse">Restrictive Practice Use</option>
              <option value="PropertyDamage">Property Damage</option>
              <option value="MissingPerson">Missing Person</option>
              <option value="Abuse">Abuse</option>
              <option value="Neglect">Neglect</option>
              <option value="Death">Death</option>
              <option value="Other">Other</option>
            </select>
          </FormField>

          {incidentType === 'Other' && (
            <FormField label="Specify Incident Type" required error={errors.otherTypeSpecify?.message}>
              <input {...register('otherTypeSpecify')} placeholder="Describe the incident type" />
            </FormField>
          )}

          <FormField label="Severity" required>
            <select {...register('severity')}>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
              <option value="Critical">Critical</option>
            </select>
          </FormField>

          <FormField label="Date & Time" required error={errors.incidentDateTime?.message}>
            <input type="datetime-local" {...register('incidentDateTime')} />
          </FormField>

          <FormField label="Location">
            <input {...register('location')} placeholder="Where the incident occurred" />
          </FormField>
        </Card>

        {/* People Involved */}
        {/* UX-01: participant/staff-scale pickers — SearchableSelect, not a bounded Dropdown/select
            (see components/README.md "Picking a picker"). The RP linked-practice picker below
            stays a Dropdown — register entries per participant are a small, bounded set. */}
        <Card title="People Involved" className="space-y-4">
          <FormField label="Reported By" required error={errors.reportedByStaffId?.message}>
            <SearchableSelect
              value={reportedByStaffId ?? ''}
              onChange={v => setValue('reportedByStaffId', v, { shouldDirty: true, shouldValidate: true })}
              placeholder="Select staff member..."
              items={staff.map((s: StaffListDto) => ({ value: s.id, label: s.fullName }))}
            />
          </FormField>

          <FormField label="Involved Participant">
            <SearchableSelect
              value={involvedParticipantId ?? ''}
              onChange={v => setValue('involvedParticipantId', v, { shouldDirty: true })}
              items={[
                { value: '', label: 'None' },
                ...participants.map((p: ParticipantListDto) => ({ value: p.id, label: p.fullName || `${p.firstName} ${p.lastName}` })),
              ]}
            />
          </FormField>

          <FormField label="Involved Staff Member">
            <SearchableSelect
              value={involvedStaffId ?? ''}
              onChange={v => setValue('involvedStaffId', v, { shouldDirty: true })}
              items={[
                { value: '', label: 'None' },
                ...staff.map((s: StaffListDto) => ({ value: s.id, label: s.fullName })),
              ]}
            />
          </FormField>
        </Card>

        {/* Restrictive Practice Details (INC-04/INC-05) */}
        {isRpIncident && (
          <Card title="Restrictive Practice Details" className="md:col-span-2 space-y-4">
            <FormField label="Restrictive Practice Type" required error={errors.restrictivePracticeType?.message}>
              <Dropdown
                variant="form"
                value={restrictivePracticeType ?? ''}
                onChange={v => setValue('restrictivePracticeType', v, { shouldDirty: true, shouldValidate: true })}
                label="Select restrictive practice type..."
                items={RESTRICTIVE_PRACTICE_TYPES.map(t => ({ value: t, label: RESTRICTIVE_PRACTICE_TYPE_LABELS[t] }))}
              />
            </FormField>

            {!involvedParticipantId ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">
                Select the involved participant above to see their authorised restrictive practices.
              </p>
            ) : restrictivePracticeType && (
              <FormField
                label="Link to an authorised practice"
                hint={matchingPractices.length === 0
                  ? 'No active authorised practices of this type are on file for this participant.'
                  : "Choosing one prefills the description below and links this incident to the participant's register entry."}
              >
                <Dropdown
                  variant="form"
                  value={restrictivePracticeId ?? ''}
                  onChange={handleSelectLinkedPractice}
                  label="Not linked"
                  items={[
                    { value: '', label: 'Not linked' },
                    ...matchingPractices.map(p => ({
                      value: p.id,
                      label: p.description.length > 80 ? `${p.description.slice(0, 80)}…` : p.description,
                      description: p.reviewDate ? `Review due ${formatDateAu(p.reviewDate)}` : 'No review date on file',
                    })),
                  ]}
                />
              </FormField>
            )}

            {/* INC-04: the authorised/unauthorised determination. On create this is a live preview
                that updates as the participant/type change; on edit it shows the value frozen at
                creation (see IncidentReport.IsRestrictivePracticeAuthorised) and never recomputes,
                even if the fields above are changed in this edit session. */}
            {isEdit ? (
              existingIncident && existingIncident.isRestrictivePracticeAuthorised !== null ? (
                <div
                  role="status"
                  className={`flex items-start gap-3 p-3 rounded-lg text-sm border ${
                    existingIncident.isRestrictivePracticeAuthorised
                      ? 'bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/20'
                      : 'bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] border-[var(--color-destructive)]/20'
                  }`}
                >
                  {existingIncident.isRestrictivePracticeAuthorised
                    ? <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
                    : <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />}
                  <p>
                    <strong className="font-medium">
                      {existingIncident.isRestrictivePracticeAuthorised
                        ? 'Authorised at the time this was reported.'
                        : 'No matching authorised practice — this may be a reportable incident.'}
                    </strong>{' '}
                    Determined when this incident was created and fixed from then on — changing the participant or
                    type above won't re-check it against today's register.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  No authorisation determination on record for this incident.
                </p>
              )
            ) : (
              <div
                role="status"
                aria-live="polite"
                className={`flex items-start gap-3 p-3 rounded-lg text-sm border ${
                  rpAuthorisationPreview === 'authorised'
                    ? 'bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/20'
                    : rpAuthorisationPreview === 'unauthorised'
                    ? 'bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] border-[var(--color-destructive)]/20'
                    : 'bg-[var(--color-secondary-container)]/40 text-[var(--color-foreground)] border-[var(--color-secondary-container)]'
                }`}
              >
                {rpAuthorisationPreview === 'authorised' && <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />}
                {rpAuthorisationPreview === 'unauthorised' && <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />}
                {rpAuthorisationPreview === 'unknown' && <Info className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />}
                <p>
                  {rpAuthorisationPreview === 'authorised' && (
                    <strong className="font-medium">Authorised — matches an active practice on this participant's register.</strong>
                  )}
                  {rpAuthorisationPreview === 'unauthorised' && (
                    <strong className="font-medium">No matching authorised practice — this may be a reportable incident.</strong>
                  )}
                  {rpAuthorisationPreview === 'unknown' && (
                    <>Select the involved participant and restrictive practice type to check this against their authorised practices.</>
                  )}
                </p>
              </div>
            )}
          </Card>
        )}

        {/* What Happened */}
        <Card title="What Happened" className="md:col-span-2 space-y-4">
          <FormField label="Description" required error={errors.description?.message}>
            <textarea {...register('description')} rows={5} placeholder="Detailed description of the incident..." />
          </FormField>

          <FormField label="Immediate Actions Taken">
            <textarea {...register('immediateActionsTaken')} rows={3} placeholder="What was done immediately in response..." />
          </FormField>

          <FormField label="Were Emergency Services Called?" layout="checkbox">
            <input type="checkbox" {...register('wereEmergencyServicesCalled')} className="w-4 h-4 rounded border-[var(--color-border)]" />
          </FormField>

          {wereEmergencyCalled && (
            <FormField label="Emergency Services Details">
              <textarea {...register('emergencyServicesDetails')} rows={2} placeholder="Which services, response details..." />
            </FormField>
          )}
        </Card>

        {/* Witnesses */}
        <Card title="Witnesses" className="md:col-span-2 space-y-4">
          <FormField label="Witness Names">
            <input {...register('witnessNames')} placeholder="Names of witnesses (comma-separated)" />
          </FormField>

          <FormField label="Witness Statements">
            <textarea {...register('witnessStatements')} rows={3} placeholder="Summary of witness accounts..." />
          </FormField>
        </Card>

        {/* Review & Compliance (edit only) */}
        {isEdit && (
          <Card title="Review & Compliance" className="md:col-span-2 space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <FormField label="Status">
                <select {...register('status')}>
                  <option value="Draft">Draft</option>
                  <option value="Submitted">Submitted</option>
                  <option value="UnderReview">Under Review</option>
                  <option value="Escalated">Escalated</option>
                  <option value="Resolved">Resolved</option>
                  <option value="Closed">Closed</option>
                </select>
              </FormField>

              <FormField label="QSC Reporting Status">
                <select {...register('qscReportingStatus')}>
                  <option value="NotRequired">Not Required</option>
                  <option value="Required">Required</option>
                  <option value="ReportedWithin24h">Reported Within 24h</option>
                  <option value="ReportedLate">Reported Late</option>
                  <option value="Pending">Pending</option>
                </select>
              </FormField>

              <FormField label="QSC Reference Number">
                <input {...register('qscReferenceNumber')} placeholder="QSC reference #" />
              </FormField>

              <FormField label="QSC Reported At">
                <input type="datetime-local" {...register('qscReportedAt')} />
              </FormField>

              <FormField label="Reviewed By">
                <SearchableSelect
                  value={reviewedByStaffId ?? ''}
                  onChange={v => setValue('reviewedByStaffId', v, { shouldDirty: true })}
                  items={[
                    { value: '', label: 'Not reviewed' },
                    ...staff.map((s: StaffListDto) => ({ value: s.id, label: s.fullName })),
                  ]}
                />
              </FormField>
            </div>

            <FormField label="Review Notes">
              <textarea {...register('reviewNotes')} rows={3} placeholder="Notes from the reviewer..." />
            </FormField>

            <FormField label="Corrective Actions">
              <textarea {...register('correctiveActions')} rows={3} placeholder="Actions to prevent recurrence..." />
            </FormField>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <FormField label="Family Notified" layout="checkbox">
                  <input type="checkbox" {...register('familyNotified')} className="w-4 h-4 rounded border-[var(--color-border)]" />
                </FormField>
                {familyNotified && (
                  <FormField label="Family Notified At">
                    <input type="datetime-local" {...register('familyNotifiedAt')} />
                  </FormField>
                )}
              </div>

              <div className="space-y-3">
                <FormField label="Support Coordinator Notified" layout="checkbox">
                  <input type="checkbox" {...register('supportCoordinatorNotified')} className="w-4 h-4 rounded border-[var(--color-border)]" />
                </FormField>
                {supportCoordinatorNotified && (
                  <FormField label="Support Coordinator Notified At">
                    <input type="datetime-local" {...register('supportCoordinatorNotifiedAt')} />
                  </FormField>
                )}
              </div>
            </div>
          </Card>
        )}

        {/* Submit */}
        <div className="md:col-span-2 flex justify-end gap-3">
          <Link to="/incidents" className="px-6 py-2.5 rounded-lg border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-colors">
            Cancel
          </Link>
          <button type="submit" disabled={mutation.isPending}
            className="px-6 py-2.5 rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary)]/90 disabled:opacity-50 transition-all shadow-md shadow-[var(--color-primary)]/20">
            {mutation.isPending ? (isEdit ? 'Saving...' : 'Submitting...') : (isEdit ? 'Save Changes' : 'Submit Incident Report')}
          </button>
        </div>
      </form>
    </div>
  )
}
