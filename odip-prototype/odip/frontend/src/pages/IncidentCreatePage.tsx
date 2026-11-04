import { useNavigate, useLocation } from 'react-router-dom'
import { flushSync } from 'react-dom'
import type { AxiosError } from 'axios'
import { useForm, useWatch } from 'react-hook-form'
import { useCreateIncident, useTrips, useStaff, useParticipants, useRestrictivePractices } from '@/api/hooks'
import { apiPost } from '@/api/client'
import { Info } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { Card } from '@/components/Card'
import { PageHeader } from '@/components/PageHeader'
import { BackButton } from '@/components/BackButton'
import type { IncidentType, IncidentSeverity } from '@/api/types/enums'
import { INCIDENT_TYPE_LABELS, INCIDENT_SEVERITY_LABELS, BODY_REGION_LABELS, INJURY_TYPE_LABELS } from '@/api/types/enums'
import type { BodyRegion, InjuryType } from '@/api/types/enums'
import { emergencyServiceEntries } from './incidents/emergencyServices'
import { RESTRICTIVE_PRACTICE_TYPE_LABELS } from '@/api/types/restrictive-practices'
import { usePermissions } from '@/lib/permissions'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import {
  useWizard, WizardStepRail, WizardNavFooter, WizardReviewStep, REVIEW_STEP_KEY,
  type WizardStepDef, type WizardValidate, type ReviewGroup,
} from '@/components/wizard'
import {
  isMarIncidentPrefillState,
  buildIncidentDescriptionSkeleton,
  buildIncidentTitleSkeleton,
  buildIncidentDateTime,
  suggestedIncidentSeverity,
  isShiftNoteIncidentPrefillState,
  buildShiftNoteIncidentTitleSkeleton,
  buildShiftNoteIncidentDescriptionSkeleton,
  buildShiftNoteIncidentDateTime,
  suggestedIncidentTypeForShiftNote,
  previewRpAuthorisation,
  isRpAuthorisedOn,
  isShiftIncidentPrefillState,
  buildShiftIncidentTitleSkeleton,
  buildShiftIncidentDescriptionSkeleton,
  incidentReturnPath,
} from '@/lib/incidentPrefill'
import { RpAuthorisationBadge } from './incidents/RpAuthorisationBadge'
import { INCIDENT_SERVICE_TYPES, toIncidentBody } from './incidents/incidentEditForm'
import { ADMIN_STATUS_LABELS } from '@/api/types/medications'
import { formatFlaggedCategoryList } from '@/lib/shiftNoteKeywords'
import { extractErrorMessage } from '@/lib/utils'
import { formatServiceDate } from '@/lib/format'
import { unbroken } from '@/lib/intakeBooking'
import {
  incidentResolver, type IncidentFormData,
  basicsSchema, restrictivePracticeSchema, detailsSchema, witnessesSchema,
  STEP_BASICS_FIELDS, STEP_RESTRICTIVE_PRACTICE_FIELDS, STEP_DETAILS_FIELDS, STEP_WITNESSES_FIELDS,
} from './incidents/incidentFormSchema'
import { BasicsStep } from './incidents/steps/BasicsStep'
import { RestrictivePracticeStep } from './incidents/steps/RestrictivePracticeStep'
import { IncidentDetailsStep } from './incidents/steps/IncidentDetailsStep'
import { WitnessesStep } from './incidents/steps/WitnessesStep'
import type { z } from 'zod'
import { Callout } from '@/components/Callout'

const STEP_SCHEMAS_BY_KEY: Record<string, z.ZodTypeAny> = {
  basics: basicsSchema,
  restrictivePractice: restrictivePracticeSchema,
  details: detailsSchema,
  witnesses: witnessesSchema,
}

// IN-1's central new capability: two of the five real steps are conditionally absent from the
// step array itself (not just hidden within a fixed step) — restrictivePractice only appears
// while incidentType === 'RestrictivePracticeUse'. Must be wrapped
// in useMemo by the caller (see below) — a fresh array identity on every render trips useWizard's
// reshuffle-detection heuristic on every keystroke.
function computeSteps(incidentType: string | undefined): WizardStepDef<IncidentFormData>[] {
  const steps: WizardStepDef<IncidentFormData>[] = [
    { key: 'basics', label: 'Basics', fields: STEP_BASICS_FIELDS },
  ]
  if (incidentType === 'RestrictivePracticeUse') {
    steps.push({ key: 'restrictivePractice', label: 'Restrictive practice', fields: STEP_RESTRICTIVE_PRACTICE_FIELDS })
  }
  steps.push({ key: 'details', label: 'Incident details', fields: STEP_DETAILS_FIELDS })
  steps.push({ key: 'witnesses', label: 'Witnesses', fields: STEP_WITNESSES_FIELDS })
  return steps
}

/** The static defaults of a new report; the signed-in user is the default reporter (IN-3), a DEFAULT, not a lock. */
function buildDefaultValues(currentUserId: string | null) {
  return {
    serviceType: 'None',
    severity: '',
    incidentType: '',
    status: 'Draft',
    qscReportingStatus: 'NotRequired',
    wereEmergencyServicesCalled: false,
    emergencyServices: [],
    familyNotified: false,
    supportCoordinatorNotified: false,
    injuries: [],
    witnesses: [],
    reportedByStaffId: currentUserId ?? '',
  }
}

/**
 * ReadOnly/SupportWorker can reach this form and have the server reject the write with a 403 —
 * see lib/permissions.ts's canWrite/canCreateIncidents doc comments. Surface that distinctly from
 * a validation failure, and otherwise fall back to the server's own message when present.
 */
function extractIncidentErrorMessage(err: unknown): string {
  const axiosErr = err as AxiosError<{ message?: string; errors?: string[] }>
  if (axiosErr?.response?.status === 403) {
    return "You don't have permission to file incident reports."
  }
  return extractErrorMessage(err, 'Failed to create incident report. Please check your input and try again.')
}

export default function IncidentCreatePage() {
  return <IncidentWizardForm />
}

function IncidentWizardForm() {
  const navigate = useNavigate()
  const location = useLocation()
  const createIncident = useCreateIncident()
  const mutation = createIncident
  const { data: trips = [] } = useTrips()
  const { data: staff = [] } = useStaff()
  const { data: participants = [] } = useParticipants()
  const { id: currentUserId, fullName, isSupportWorker } = usePermissions()
  // The server files a support worker's incident under their own name, so the form shows that instead of a picker a prefill could seed with a colleague.
  const lockedReporterId = isSupportWorker ? currentUserId : null

  // INC-03: router-state prefill dropped in by RecordAdministrationModal after a
  // refused/withheld/missed/wrong-medication outcome is recorded. Purely informational client
  // state — nothing was persisted to make this incident exist, and nothing is until this form
  // is submitted like any other.
  const marPrefill = isMarIncidentPrefillState(location.state) ? location.state : null
  const appliedMarPrefillRef = useRef(false)

  // NOTES-02: same router-state prefill idiom, produced by the portal's ShiftNotesSection "file
  // an incident report" banner action instead of the MAR flow. Mutually exclusive with marPrefill
  // — only one producer ever sets location.state per navigation.
  const shiftNotePrefill = isShiftNoteIncidentPrefillState(location.state) ? location.state : null
  const appliedShiftNotePrefillRef = useRef(false)
  // My shifts: "Anything to report?" on the finish flow. A shift with no note behind it; the worker picks the type.
  const shiftPrefill = isShiftIncidentPrefillState(location.state) ? location.state : null
  const appliedShiftPrefillRef = useRef(false)

  const { register, handleSubmit, reset, control, setValue, getValues, setError, clearErrors, formState: { errors, isDirty } } = useForm<IncidentFormData>({
    resolver: incidentResolver,
    defaultValues: buildDefaultValues(currentUserId),
  })

  const serviceType = useWatch({ control, name: 'serviceType' })
  const incidentType = useWatch({ control, name: 'incidentType' })
  const severity = useWatch({ control, name: 'severity' })
  const tripInstanceId = useWatch({ control, name: 'tripInstanceId' })
  const wereEmergencyCalled = useWatch({ control, name: 'wereEmergencyServicesCalled' })
  const emergencyServices = useWatch({ control, name: 'emergencyServices' })
  const involvedParticipantId = useWatch({ control, name: 'involvedParticipantId' })
  // I-3: fetch every practice (active + inactive) for the currently-selected participant so the
  // Review step can resolve a linked practice regardless of whether it's since gone inactive —
  // RestrictivePracticeStep fetches its own copy for the picker, scoped to its own concerns.
  const { data: allRestrictivePractices = [] } = useRestrictivePractices(involvedParticipantId || undefined, true)
  const restrictivePracticeType = useWatch({ control, name: 'restrictivePracticeType' })
  const restrictivePracticeId = useWatch({ control, name: 'restrictivePracticeId' })
  const unapprovedRestrictivePracticeDetails = useWatch({ control, name: 'unapprovedRestrictivePracticeDetails' })
  const usedWithoutAuthorisation = useWatch({ control, name: 'usedWithoutAuthorisation' })
  const rpUseVaried = useWatch({ control, name: 'rpUseVaried' })
  const incidentDateTime = useWatch({ control, name: 'incidentDateTime' })
  const description = useWatch({ control, name: 'description' })
  const witnesses = useWatch({ control, name: 'witnesses' })
  // UX-01: reportedByStaffId/involvedStaffId are SearchableSelect, which isn't
  // a native input register() can bind to, so it's tracked the same way: watched here, written
  // back via setValue on change.
  const reportedByStaffId = useWatch({ control, name: 'reportedByStaffId' })
  const involvedStaffId = useWatch({ control, name: 'involvedStaffId' })

  // IN-4/IN-5: switching incidentType away from the type that owns a conditional step's fields
  // clears them, so a later switch back starts clean (rather than resurrecting stale data from a
  // step that's no longer even in the wizard's step list) — see RestrictivePracticeStep/
  // IncidentDetailsStep's own acceptance notes.
  useEffect(() => {
    if (incidentType !== 'RestrictivePracticeUse') {
      setValue('restrictivePracticeType', '')
      setValue('restrictivePracticeId', '')
      setValue('unapprovedRestrictivePracticeDetails', '')
      setValue('usedWithoutAuthorisation', false)
      setValue('rpUseVaried', undefined)
    }
  }, [incidentType, setValue])

  // The date is typed after the entry is picked, so the locked "not authorised" tick follows the entry judged on that date.
  const rpLockedRef = useRef(false)
  const tickBeforeLockRef = useRef(false) // a hand tick made before the lock began survives the unlock
  const lockEntryRef = useRef<string | undefined>('')
  useEffect(() => {
    const entry = allRestrictivePractices.find((p) => p.id === restrictivePracticeId)
    const locked = !!entry && !isRpAuthorisedOn(entry, incidentDateTime?.slice(0, 10))
    if (locked !== rpLockedRef.current) {
      // A lock from picking the entry already set the tick itself (the pick handler), so only a lock from the date moving counts as a hand tick.
      if (locked) tickBeforeLockRef.current = lockEntryRef.current === restrictivePracticeId && !!getValues('usedWithoutAuthorisation')
      if (locked || !tickBeforeLockRef.current) setValue('usedWithoutAuthorisation', locked, { shouldDirty: true })
    }
    rpLockedRef.current = locked
    lockEntryRef.current = restrictivePracticeId
  }, [allRestrictivePractices, restrictivePracticeId, incidentDateTime, setValue, getValues])

  useEffect(() => {
    if (incidentType !== 'Injury') {
      setValue('injuries', [])
    }
  }, [incidentType, setValue])

  // INC-03: apply the MAR drop-into-draft prefill once, on mount — a useRef "applied once" guard
  // means a coordinator who's already started editing the pre-filled form never has their
  // in-progress edits silently overwritten by a later run of this effect. Every prefilled field
  // lands on step 0 (basics) or step 2 (details) — see IN-8's design note — so both exist
  // unconditionally regardless of the wizard's computed step list.
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
      reportedByStaffId: lockedReporterId ?? marPrefill.recordedByUserId ?? '',
      incidentDateTime: buildIncidentDateTime(marPrefill),
      status: 'Draft',
      qscReportingStatus: 'NotRequired',
      wereEmergencyServicesCalled: false,
      familyNotified: false,
      supportCoordinatorNotified: false,
      injuries: [],
      witnesses: [],
    })
  }, [marPrefill, reset, lockedReporterId])

  // NOTES-02: same "apply once, on mount" guard as the MAR effect above — reportedByStaffId is
  // deliberately left blank (unlike the MAR hand-off, the portal doesn't know which staff account
  // is filing the eventual incident report; the worker/coordinator picks it on this form).
  useEffect(() => {
    if (!shiftNotePrefill || appliedShiftNotePrefillRef.current) return
    appliedShiftNotePrefillRef.current = true
    reset({
      serviceType: 'None',
      incidentType: suggestedIncidentTypeForShiftNote(shiftNotePrefill),
      title: buildShiftNoteIncidentTitleSkeleton(shiftNotePrefill),
      description: buildShiftNoteIncidentDescriptionSkeleton(shiftNotePrefill),
      involvedParticipantId: shiftNotePrefill.participantId,
      reportedByStaffId: lockedReporterId ?? shiftNotePrefill.reportedByUserId ?? '',
      severity: '',
      incidentDateTime: buildShiftNoteIncidentDateTime(shiftNotePrefill),
      status: 'Draft',
      qscReportingStatus: 'NotRequired',
      wereEmergencyServicesCalled: false,
      familyNotified: false,
      supportCoordinatorNotified: false,
      injuries: [],
      witnesses: [],
    })
  }, [shiftNotePrefill, reset, lockedReporterId])

  useEffect(() => {
    if (!shiftPrefill || appliedShiftPrefillRef.current) return
    appliedShiftPrefillRef.current = true
    reset({
      ...buildDefaultValues(currentUserId),
      title: buildShiftIncidentTitleSkeleton(shiftPrefill),
      description: buildShiftIncidentDescriptionSkeleton(shiftPrefill),
      involvedParticipantId: shiftPrefill.participantId,
      reportedByStaffId: lockedReporterId ?? shiftPrefill.reportedByUserId ?? currentUserId ?? '',
      incidentDateTime: shiftPrefill.incidentAt ?? `${shiftPrefill.serviceDate}T${shiftPrefill.startTime.slice(0, 5)}`,
    })
  }, [shiftPrefill, reset, currentUserId, lockedReporterId])

  // IN-1: the computed, not fixed, step list — wrapped in useMemo so its identity is stable
  // across renders that don't actually change incidentType (useWizard's reshuffle
  // detection compares the `steps` array by identity, not deep-equality).
  const steps = useMemo(() => computeSteps(incidentType), [incidentType])
  const stepsForRail = useMemo(
    () => [...steps, { key: REVIEW_STEP_KEY, label: 'Review', fields: [] as const }],
    [steps],
  )

  const validateStep: WizardValidate<IncidentFormData> = (step, values) => {
    const schema = STEP_SCHEMAS_BY_KEY[step.key]
    if (!schema) return null
    const result = schema.safeParse(values)
    if (result.success) return null
    return result.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
      code: issue.code,
    }))
  }

  const wizard = useWizard<IncidentFormData>({
    steps,
    initialVisited: 'linear',
    validate: validateStep,
    getValues,
    setError: (path, err) => setError(path as keyof IncidentFormData, err),
    clearErrors: (paths) => clearErrors(paths as (keyof IncidentFormData)[]),
  })
  const { currentStep, isReviewStep } = wizard

  const onSubmit = async (data: IncidentFormData) => {
    // Connection map: a submission takes the source links from the router-state hand-off it started from.
    const base = toIncidentBody(data, {
      medicationAdministrationId: marPrefill?.medicationAdministrationId,
      shiftId: shiftNotePrefill?.shiftId ?? shiftPrefill?.shiftId,
      shiftNoteId: shiftNotePrefill?.shiftNoteId,
    }, true)

    try {
      const res = await createIncident.mutateAsync(base)
      if (res.success) {
        // NOTES-02: closing the loop on a shift-note-sourced filing — fire-and-forget, error
        // tolerant (the incident is already filed by this point).
        if (shiftNotePrefill) {
          apiPost(`/portal/notes/${shiftNotePrefill.shiftNoteId}/acknowledge-flags`).catch(() => {
            console.error('Failed to acknowledge shift note flags after filing an incident report.')
          })
        }
        flushSync(() => reset(data))
        navigate(incidentReturnPath(location.state), { replace: true })
      }
    } catch {
      // error handled by mutation state
    }
  }

  const { dialog: unsavedChangesDialog } = useUnsavedChangesWarning(isDirty)

  // A support worker's own name comes from the sign-in profile, so it is right before /staff returns.
  const staffName = (staffId: string | null | undefined) =>
    (staffId && staffId === lockedReporterId ? fullName : null) ?? staff.find((s) => s.id === staffId)?.fullName ?? '—'
  const tripName = (tripId: string | null | undefined) => trips.find((t) => t.id === tripId)?.tripName ?? '—'
  const participantName = (participantId: string | null | undefined) => participants.find((p) => p.id === participantId)?.fullName ?? '—'
  const practiceLabel = (practiceId: string | null | undefined) => allRestrictivePractices.find((p) => p.id === practiceId)?.description ?? '—'

  // The live preview of the authorisation this report will be filed with.
  const rpAuthorisation = { authorised: 'Authorised', unauthorised: 'Not authorised', unknown: '—' }[previewRpAuthorisation(involvedParticipantId, restrictivePracticeType, allRestrictivePractices, {
    restrictivePracticeId, unapproved: !!unapprovedRestrictivePracticeDetails?.trim(), usedWithoutAuthorisation: !!restrictivePracticeId && !!usedWithoutAuthorisation,
  }, incidentDateTime?.slice(0, 10))]

  const reviewGroups: ReviewGroup[] = [
    {
      stepKey: 'basics',
      rows: [
        { label: 'Involved Participant', value: involvedParticipantId ? participantName(involvedParticipantId) : 'None' },
        { label: 'Title', value: getValues('title') || '—' },
        { label: 'Reported By', value: staffName(reportedByStaffId) },
        { label: 'Involved Staff Member', value: involvedStaffId ? staffName(involvedStaffId) : 'None' },
        { label: 'Service Type', value: serviceType ?? 'None' },
        ...(serviceType === 'Trip' ? [{ label: 'Trip', value: tripName(tripInstanceId) }] : []),
        { label: 'Incident Type', value: incidentType ? (INCIDENT_TYPE_LABELS[incidentType as IncidentType] ?? incidentType) : '—' },
        { label: 'Severity', value: severity ? (INCIDENT_SEVERITY_LABELS[severity as IncidentSeverity] ?? severity) : '—' },
      ],
    },
    ...(incidentType === 'RestrictivePracticeUse' ? [{
      stepKey: 'restrictivePractice',
      rows: [
        { label: 'Restrictive Practice Type', value: restrictivePracticeType ? (RESTRICTIVE_PRACTICE_TYPE_LABELS[restrictivePracticeType as keyof typeof RESTRICTIVE_PRACTICE_TYPE_LABELS] ?? restrictivePracticeType) : '—' },
        { label: 'Linked Practice', value: restrictivePracticeId ? practiceLabel(restrictivePracticeId) : 'Not linked' },
        { label: 'Unapproved Practice Details', value: unapprovedRestrictivePracticeDetails || '—' },
        { label: 'Authorisation', value: rpAuthorisation },
      ],
    }] : []),
    {
      stepKey: 'details',
      rows: [
        { label: 'Date & Time', value: getValues('incidentDateTime') || '—' },
        { label: 'Location', value: getValues('location') || '—' },
        { label: 'Description', value: getValues('description') || '—' },
        { label: 'Immediate Actions Taken', value: getValues('immediateActionsTaken') || '—' },
        { label: 'Emergency Services Called', value: wereEmergencyCalled && emergencyServices?.length ? `Yes: ${emergencyServices.join(', ')}` : wereEmergencyCalled ? 'Yes' : 'No' },
        ...(wereEmergencyCalled ? emergencyServiceEntries(emergencyServices ?? [], {
          policeOfficerName: getValues('policeOfficerName'), policeReference: getValues('policeReference'),
          ambulanceOfficerName: getValues('ambulanceOfficerName'), ambulanceReference: getValues('ambulanceReference'),
          fireOfficerName: getValues('fireOfficerName'), fireReference: getValues('fireReference'),
        }).filter((e) => e.name || e.ref).map((e) => ({ label: e.service, value: [e.name, e.ref && `ref ${e.ref}`].filter(Boolean).join(', ') })) : []),
        ...(incidentType === 'Injury' ? [{
          label: 'Injuries',
          value: (getValues('injuries') ?? []).map((inj) => `${BODY_REGION_LABELS[inj.region as BodyRegion] ?? inj.region} (${INJURY_TYPE_LABELS[inj.injuryType as InjuryType] ?? inj.injuryType})`).join('; ') || 'None recorded',
        }] : []),
      ],
    },
    {
      stepKey: 'witnesses',
      rows: [
        {
          label: 'Witnesses',
          value: (witnesses ?? []).length === 0
            ? 'None recorded'
            : (witnesses ?? []).map((w) => `${w.witnessName}${w.witnessUserId ? ' (Staff)' : ' (External)'}`).join('; '),
        },
      ],
    },
  ]

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in max-w-[1600px]">
      {unsavedChangesDialog}
      <div className="flex items-start gap-2">
        {/* A box the height of the title's first line (26px, 30px from md), so the icon's centre is the title's. */}
        <div className="flex h-[26px] items-center md:h-[30px]">
          <BackButton to="/incidents" label="incidents" variant="icon" />
        </div>
        <div className="flex-1 min-w-0"><PageHeader title="Report incident" /></div>
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

      {shiftNotePrefill && (
        <Card className="bg-[var(--color-secondary-container)]/40 border-[var(--color-secondary-container)]">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-[var(--color-secondary)] shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-sm text-[var(--color-foreground)]">
              <strong className="font-medium">Pre-filled from a flagged shift note:</strong> {shiftNotePrefill.participantName}'s shift note mentioned {formatFlaggedCategoryList(shiftNotePrefill.categories)}. Review and complete the details below — nothing is filed until you submit this report.
            </p>
          </div>
        </Card>
      )}

      {shiftPrefill && (
        <Card className="bg-[var(--color-secondary-container)]/40 border-[var(--color-secondary-container)]">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-[var(--color-secondary)] shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-sm text-[var(--color-foreground)]">
              <strong className="font-medium">Pre-filled from your shift:</strong> {shiftPrefill.participantName}, {unbroken(formatServiceDate(shiftPrefill.serviceDate))}. Review and complete the details below — nothing is filed until you submit this report.
            </p>
          </div>
        </Card>
      )}

      {/* Connection map: a compact, always-visible reminder of what this incident is linked to —
          the banners above explain the hand-off once; this line stays visible as the reporter
          works through the wizard's later steps. No new inputs — this is purely informational. */}
      {marPrefill && (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Linked to: Medication administration · {marPrefill.medicationName} · {ADMIN_STATUS_LABELS[marPrefill.outcome]}
        </p>
      )}
      {shiftNotePrefill && (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Linked to: Shift note from {unbroken(formatServiceDate(shiftNotePrefill.serviceDate))}
        </p>
      )}
      {shiftPrefill && (
        <p className="text-sm text-[var(--color-muted-foreground)]">Linked to: Shift on {unbroken(formatServiceDate(shiftPrefill.serviceDate))}</p>
      )}

      {mutation.isError && (
        <Callout tone="error">{extractIncidentErrorMessage(mutation.error)}</Callout>
      )}

      <WizardStepRail
        steps={stepsForRail}
        visitedSteps={wizard.visitedSteps}
        currentKey={isReviewStep ? REVIEW_STEP_KEY : currentStep.key}
        onSelect={wizard.goToStep}
        // One row at every width: the rail sits in the page flow above the form, where the vertical list cost about 200px (V2-E).
        orientation="horizontal"
        // A pill row now, so the current step takes the solid fill (unfilled, its marker was white at 20% on the cream ground).
        filled
        ariaLabel="Incident report steps"
      />

      <form onSubmit={handleSubmit(onSubmit, wizard.handleInvalidSubmit)} noValidate>
        {!isReviewStep && currentStep.key === 'basics' && (
          <BasicsStep
            register={register}
            errors={errors}
            setValue={setValue}
            serviceType={serviceType}
            incidentType={incidentType}
            severity={severity}
            tripInstanceId={tripInstanceId}
            involvedParticipantId={involvedParticipantId}
            reportedByStaffId={reportedByStaffId}
            reporterName={lockedReporterId ? staffName(currentUserId) : undefined}
            involvedStaffId={involvedStaffId}
            trips={trips}
            staff={staff}
            incidentServiceTypes={INCIDENT_SERVICE_TYPES}
          />
        )}

        {!isReviewStep && currentStep.key === 'restrictivePractice' && (
          <RestrictivePracticeStep
            getValues={getValues}
            setValue={setValue}
            errors={errors}
            involvedParticipantId={involvedParticipantId}
            restrictivePracticeType={restrictivePracticeType}
            restrictivePracticeId={restrictivePracticeId}
            unapprovedRestrictivePracticeDetails={unapprovedRestrictivePracticeDetails}
            usedWithoutAuthorisation={usedWithoutAuthorisation}
            rpUseVaried={rpUseVaried}
            description={description}
            incidentDateTime={incidentDateTime}
            isEdit={false}
            existingIncident={undefined}
          />
        )}

        {!isReviewStep && currentStep.key === 'details' && (
          <IncidentDetailsStep
            register={register}
            control={control}
            setValue={setValue}
            errors={errors}
            incidentType={incidentType}
            wereEmergencyServicesCalled={wereEmergencyCalled}
            emergencyServices={emergencyServices}
          />
        )}

        {!isReviewStep && currentStep.key === 'witnesses' && (
          <WitnessesStep
            control={control}
            errors={errors}
            reportedByStaffId={reportedByStaffId}
            staff={staff}
            existingWitnesses={[]}
            isEdit={false}
          />
        )}

        {isReviewStep && (
          <WizardReviewStep
            groups={reviewGroups}
            steps={steps}
            onEdit={wizard.goToStep}
            renderRow={(row) => (
              <div key={row.label} className="flex justify-between gap-4">
                <dt className="text-[var(--color-muted-foreground)]">{row.label}</dt>
                <dd className="font-medium text-right min-w-0 break-words">
                  {row.label === 'Authorisation' && row.value !== '—' ? <RpAuthorisationBadge authorised={row.value === 'Authorised'} /> : row.value}
                </dd>
              </div>
            )}
          />
        )}

        <WizardNavFooter
          showBack={wizard.stepIndex > 0}
          onBack={wizard.handleBack}
          onNext={wizard.handleNext}
          isReviewStep={isReviewStep}
          secondaryActions={[]}
          cancelTo="/incidents"
          submitReserve="Submit incident report"
          submitLabel={mutation.isPending ? 'Submitting…' : 'Submit incident report'}
          isSubmitting={mutation.isPending}
        />
      </form>
    </div>
  )
}
