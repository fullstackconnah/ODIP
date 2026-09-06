import { useNavigate, useParams, useLocation, Link } from 'react-router-dom'
import { flushSync } from 'react-dom'
import { useForm, useWatch } from 'react-hook-form'
import { useCreateIncident, useUpdateIncident, useIncident, useTrips, useStaff, useParticipants, useRestrictivePractices } from '@/api/hooks'
import { apiPost } from '@/api/client'
import { ArrowLeft, Info } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { Card } from '@/components/Card'
import type { CreateIncidentDto, UpdateIncidentDto, IncidentDetailDto } from '@/api/types/incidents'
import type { IncidentType, IncidentSeverity, IncidentStatus, QscReportingStatus } from '@/api/types/enums'
import { SERVICE_STREAMS, INCIDENT_TYPE_LABELS, INCIDENT_SEVERITY_LABELS, INCIDENT_STATUS_LABELS, QSC_REPORTING_STATUS_LABELS, BODY_REGION_LABELS, INJURY_TYPE_LABELS } from '@/api/types/enums'
import type { BodyRegion, InjuryType } from '@/api/types/enums'
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
} from '@/lib/incidentPrefill'
import { ADMIN_STATUS_LABELS } from '@/api/types/medications'
import { formatFlaggedCategoryList } from '@/lib/shiftNoteKeywords'
import {
  incidentResolver, type IncidentFormData,
  basicsSchema, restrictivePracticeSchema, detailsSchema, witnessesSchema, complianceSchema,
  STEP_BASICS_FIELDS, STEP_RESTRICTIVE_PRACTICE_FIELDS, STEP_DETAILS_FIELDS, STEP_WITNESSES_FIELDS, STEP_COMPLIANCE_FIELDS,
} from './incidents/incidentFormSchema'
import { BasicsStep } from './incidents/steps/BasicsStep'
import { RestrictivePracticeStep } from './incidents/steps/RestrictivePracticeStep'
import { IncidentDetailsStep } from './incidents/steps/IncidentDetailsStep'
import { WitnessesStep } from './incidents/steps/WitnessesStep'
import { ComplianceStep } from './incidents/steps/ComplianceStep'
import type { z } from 'zod'

// INC-01: the service-type dropdown offers the business streams plus "None" (untagged) —
// selecting "Trip" is what reveals the trip-select dropdown below.
const INCIDENT_SERVICE_TYPES = ['None', ...SERVICE_STREAMS] as const

const STEP_SCHEMAS_BY_KEY: Record<string, z.ZodTypeAny> = {
  basics: basicsSchema,
  restrictivePractice: restrictivePracticeSchema,
  details: detailsSchema,
  witnesses: witnessesSchema,
  compliance: complianceSchema,
}

// IN-1's central new capability: two of the five real steps are conditionally absent from the
// step array itself (not just hidden within a fixed step) — restrictivePractice only appears
// while incidentType === 'RestrictivePracticeUse', compliance only in edit mode. Must be wrapped
// in useMemo by the caller (see below) — a fresh array identity on every render trips useWizard's
// reshuffle-detection heuristic on every keystroke.
function computeSteps(incidentType: string | undefined, isEdit: boolean): WizardStepDef<IncidentFormData>[] {
  const steps: WizardStepDef<IncidentFormData>[] = [
    { key: 'basics', label: 'Basics', fields: STEP_BASICS_FIELDS },
  ]
  if (incidentType === 'RestrictivePracticeUse') {
    steps.push({ key: 'restrictivePractice', label: 'Restrictive Practice', fields: STEP_RESTRICTIVE_PRACTICE_FIELDS })
  }
  steps.push({ key: 'details', label: 'Incident Details', fields: STEP_DETAILS_FIELDS })
  steps.push({ key: 'witnesses', label: 'Witnesses', fields: STEP_WITNESSES_FIELDS })
  if (isEdit) {
    steps.push({ key: 'compliance', label: 'Review & Compliance', fields: STEP_COMPLIANCE_FIELDS })
  }
  return steps
}

/**
 * Builds react-hook-form's `defaultValues` directly from the persisted incident (edit mode) or
 * the create-mode static defaults — evaluated once, synchronously, at `useForm` construction.
 *
 * This matters beyond tidiness: `IncidentWizardForm` (below) is gated by the outer
 * `IncidentCreatePage` to not mount until `existingIncident` has loaded in edit mode (see that
 * component's doc comment for why) — so `incidentType` is already correct on this component's
 * very FIRST render. That, in turn, is what lets `computeSteps`/`useWizard`'s `initialVisited:
 * 'all'` correctly include a conditional step (e.g. Restrictive Practice) that only exists
 * because of the loaded data, instead of seeding "all steps visited" against the wrong
 * (default-'Other') step list and permanently locking that step's rail button.
 */
function buildDefaultValues(isEdit: boolean, existingIncident: IncidentDetailDto | undefined, currentUserId: string | null) {
  if (isEdit && existingIncident) {
    const i = existingIncident
    return {
      serviceType: i.serviceType ?? 'None',
      tripInstanceId: i.tripInstanceId ?? '',
      incidentType: i.incidentType ?? 'Other',
      otherTypeSpecify: i.otherTypeSpecify ?? '',
      restrictivePracticeType: i.restrictivePracticeType ?? '',
      restrictivePracticeId: i.restrictivePracticeId ?? '',
      unapprovedRestrictivePracticeDetails: i.unapprovedRestrictivePracticeDetails ?? '',
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
      injuries: (i.injuries ?? []).map((inj) => ({ region: inj.region, injuryType: inj.injuryType, description: inj.description })),
      // IN-7: existingId carries the persisted witness id forward so Update can match rows by id
      // and preserve an already-Approved/Declined row's status — see incidentFormSchema's doc
      // comment on why this is NOT named `id` (useFieldArray reserves that name).
      witnesses: (i.witnesses ?? []).map((w) => ({ existingId: w.id, witnessUserId: w.witnessUserId, witnessName: w.witnessName })),
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
    }
  }
  return {
    serviceType: 'None',
    severity: 'Medium',
    incidentType: 'Other',
    status: 'Draft',
    qscReportingStatus: 'NotRequired',
    wereEmergencyServicesCalled: false,
    familyNotified: false,
    supportCoordinatorNotified: false,
    injuries: [],
    witnesses: [],
    // IN-3: defaults to the signed-in user — a DEFAULT, not a lock. The reporter can still pick
    // someone else. Falls back to '' (today's untouched behaviour) when there's no resolvable
    // signed-in user id.
    reportedByStaffId: currentUserId ?? '',
  }
}

/**
 * Outer gate: `useIncident(id)` is a React Query hook, so `existingIncident` is `undefined` on
 * the first render(s) in real usage (not just in a test's synchronous mock) until the network
 * request resolves. `IncidentWizardForm` below must not mount until then in edit mode — see
 * `buildDefaultValues`'s doc comment for why. Create mode (`isEdit` false) has nothing to wait
 * for and mounts immediately, unchanged from before this gate existed.
 */
export default function IncidentCreatePage() {
  const { id } = useParams()
  const isEdit = !!id
  const { data: existingIncident } = useIncident(id)

  if (isEdit && !existingIncident) {
    return <div className="p-6 text-sm text-[var(--color-muted-foreground)]">Loading incident…</div>
  }

  return <IncidentWizardForm key={id ?? 'new'} id={id} existingIncident={existingIncident} />
}

function IncidentWizardForm({ id, existingIncident }: { id?: string; existingIncident: IncidentDetailDto | undefined }) {
  // Recomputed here (not accepted as a separate prop) so TypeScript's aliased-condition control
  // flow analysis can narrow `id` to `string` wherever this exact `isEdit` check guards it below
  // (e.g. the Update mutation call) — a boolean prop independent of `id` wouldn't correlate.
  const isEdit = !!id
  const navigate = useNavigate()
  const location = useLocation()
  const createIncident = useCreateIncident()
  const updateIncident = useUpdateIncident()
  const mutation = isEdit ? updateIncident : createIncident
  const { data: trips = [] } = useTrips()
  const { data: staff = [] } = useStaff()
  const { data: participants = [] } = useParticipants()
  const { id: currentUserId } = usePermissions()

  // INC-03: router-state prefill dropped in by RecordAdministrationModal after a
  // refused/withheld/missed/wrong-medication outcome is recorded. Purely informational client
  // state — nothing was persisted to make this incident exist, and nothing is until this form
  // is submitted like any other.
  const marPrefill = !isEdit && isMarIncidentPrefillState(location.state) ? location.state : null
  const appliedMarPrefillRef = useRef(false)

  // NOTES-02: same router-state prefill idiom, produced by the portal's ShiftNotesSection "file
  // an incident report" banner action instead of the MAR flow. Mutually exclusive with marPrefill
  // — only one producer ever sets location.state per navigation.
  const shiftNotePrefill = !isEdit && isShiftNoteIncidentPrefillState(location.state) ? location.state : null
  const appliedShiftNotePrefillRef = useRef(false)

  // Evaluated once, synchronously, from the (already-loaded, in edit mode) existingIncident —
  // see buildDefaultValues' own doc comment for why this must be correct on the very first
  // render rather than arriving later via reset().
  const { register, handleSubmit, reset, control, setValue, getValues, setError, clearErrors, formState: { errors, isDirty } } = useForm<IncidentFormData>({
    resolver: incidentResolver,
    defaultValues: buildDefaultValues(isEdit, existingIncident, currentUserId),
  })

  const serviceType = useWatch({ control, name: 'serviceType' })
  const incidentType = useWatch({ control, name: 'incidentType' })
  const severity = useWatch({ control, name: 'severity' })
  const tripInstanceId = useWatch({ control, name: 'tripInstanceId' })
  const wereEmergencyCalled = useWatch({ control, name: 'wereEmergencyServicesCalled' })
  const familyNotified = useWatch({ control, name: 'familyNotified' })
  const supportCoordinatorNotified = useWatch({ control, name: 'supportCoordinatorNotified' })
  const involvedParticipantId = useWatch({ control, name: 'involvedParticipantId' })
  // I-3: fetch every practice (active + inactive) for the currently-selected participant so the
  // Review step can resolve a linked practice regardless of whether it's since gone inactive —
  // RestrictivePracticeStep fetches its own copy for the picker, scoped to its own concerns.
  const { data: allRestrictivePractices = [] } = useRestrictivePractices(involvedParticipantId || undefined, true)
  const restrictivePracticeType = useWatch({ control, name: 'restrictivePracticeType' })
  const restrictivePracticeId = useWatch({ control, name: 'restrictivePracticeId' })
  const unapprovedRestrictivePracticeDetails = useWatch({ control, name: 'unapprovedRestrictivePracticeDetails' })
  const witnesses = useWatch({ control, name: 'witnesses' })
  // UX-01: reportedByStaffId/involvedStaffId/reviewedByStaffId are SearchableSelect, which isn't
  // a native input register() can bind to, so it's tracked the same way: watched here, written
  // back via setValue on change.
  const reportedByStaffId = useWatch({ control, name: 'reportedByStaffId' })
  const involvedStaffId = useWatch({ control, name: 'involvedStaffId' })
  const reviewedByStaffId = useWatch({ control, name: 'reviewedByStaffId' })
  const status = useWatch({ control, name: 'status' })
  const qscReportingStatus = useWatch({ control, name: 'qscReportingStatus' })

  // IN-4/IN-5: switching incidentType away from the type that owns a conditional step's fields
  // clears them, so a later switch back starts clean (rather than resurrecting stale data from a
  // step that's no longer even in the wizard's step list) — see RestrictivePracticeStep/
  // IncidentDetailsStep's own acceptance notes.
  useEffect(() => {
    if (incidentType !== 'RestrictivePracticeUse') {
      setValue('restrictivePracticeType', '')
      setValue('restrictivePracticeId', '')
      setValue('unapprovedRestrictivePracticeDetails', '')
    }
  }, [incidentType, setValue])

  useEffect(() => {
    if (incidentType !== 'Injury') {
      setValue('injuries', [])
    }
  }, [incidentType, setValue])

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
        unapprovedRestrictivePracticeDetails: i.unapprovedRestrictivePracticeDetails ?? '',
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
        injuries: (i.injuries ?? []).map((inj) => ({ region: inj.region, injuryType: inj.injuryType, description: inj.description })),
        witnesses: (i.witnesses ?? []).map((w) => ({ existingId: w.id, witnessUserId: w.witnessUserId, witnessName: w.witnessName })),
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
      reportedByStaffId: marPrefill.recordedByUserId ?? '',
      incidentDateTime: buildIncidentDateTime(marPrefill),
      status: 'Draft',
      qscReportingStatus: 'NotRequired',
      wereEmergencyServicesCalled: false,
      familyNotified: false,
      supportCoordinatorNotified: false,
      injuries: [],
      witnesses: [],
    })
  }, [marPrefill, reset])

  // NOTES-02: same "apply once, on mount" guard as the MAR effect above — reportedByStaffId is
  // deliberately left blank (unlike the MAR hand-off, the portal doesn't know which staff account
  // is filing the eventual incident report; the worker/coordinator picks it on this form).
  useEffect(() => {
    if (!shiftNotePrefill || appliedShiftNotePrefillRef.current) return
    appliedShiftNotePrefillRef.current = true
    reset({
      serviceType: 'None',
      incidentType: suggestedIncidentTypeForShiftNote(shiftNotePrefill),
      severity: 'Medium',
      title: buildShiftNoteIncidentTitleSkeleton(shiftNotePrefill),
      description: buildShiftNoteIncidentDescriptionSkeleton(shiftNotePrefill),
      involvedParticipantId: shiftNotePrefill.participantId,
      reportedByStaffId: shiftNotePrefill.reportedByUserId ?? '',
      incidentDateTime: buildShiftNoteIncidentDateTime(shiftNotePrefill),
      status: 'Draft',
      qscReportingStatus: 'NotRequired',
      wereEmergencyServicesCalled: false,
      familyNotified: false,
      supportCoordinatorNotified: false,
      injuries: [],
      witnesses: [],
    })
  }, [shiftNotePrefill, reset])

  // IN-1: the computed, not fixed, step list — wrapped in useMemo so its identity is stable
  // across renders that don't actually change incidentType/isEdit (useWizard's reshuffle
  // detection compares the `steps` array by identity, not deep-equality).
  const steps = useMemo(() => computeSteps(incidentType, isEdit), [incidentType, isEdit])
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
    initialVisited: isEdit ? 'all' : 'linear',
    validate: validateStep,
    getValues,
    setError: (path, err) => setError(path as keyof IncidentFormData, err),
    clearErrors: (paths) => clearErrors(paths as (keyof IncidentFormData)[]),
  })
  const { currentStep, isReviewStep } = wizard

  const onSubmit = async (data: IncidentFormData) => {
    const isRp = data.incidentType === 'RestrictivePracticeUse'
    const base: CreateIncidentDto = {
      serviceType: (data.serviceType || 'None') as CreateIncidentDto['serviceType'],
      tripInstanceId: data.serviceType === 'Trip' ? data.tripInstanceId || undefined : undefined,
      reportedByStaffId: data.reportedByStaffId,
      incidentType: data.incidentType as IncidentType,
      otherTypeSpecify: data.incidentType === 'Other' ? data.otherTypeSpecify || undefined : undefined,
      restrictivePracticeType: isRp
        ? (data.restrictivePracticeType || undefined) as CreateIncidentDto['restrictivePracticeType']
        : undefined,
      // IN-4: mutually exclusive — restrictivePracticeId only when linked; the free-text
      // unapproved-practice field only when nothing was linked. Never both at once.
      restrictivePracticeId: isRp && !data.unapprovedRestrictivePracticeDetails?.trim() ? data.restrictivePracticeId || undefined : undefined,
      unapprovedRestrictivePracticeDetails: isRp ? data.unapprovedRestrictivePracticeDetails?.trim() || undefined : undefined,
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
      injuries: data.incidentType === 'Injury' ? (data.injuries as CreateIncidentDto['injuries']) : [],
      // IN-7: existingId (set only for a row echoed back from a persisted incident) becomes the
      // wire-format `id` the backend matches on to preserve an already-Approved/Declined row —
      // see incidentFormSchema's doc comment for why the form field isn't itself named `id`.
      witnesses: (data.witnesses ?? []).map((w) => ({
        id: w.existingId,
        witnessUserId: w.witnessUserId,
        witnessName: w.witnessName,
      })),
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
          // NOTES-02: closing the loop on a shift-note-sourced filing — fire-and-forget, error
          // tolerant (the incident is already filed by this point).
          if (shiftNotePrefill) {
            apiPost(`/portal/notes/${shiftNotePrefill.shiftNoteId}/acknowledge-flags`).catch(() => {
              console.error('Failed to acknowledge shift note flags after filing an incident report.')
            })
          }
          flushSync(() => reset(data))
          navigate('/incidents')
        }
      }
    } catch {
      // error handled by mutation state
    }
  }

  const { dialog: unsavedChangesDialog } = useUnsavedChangesWarning(isDirty)

  const staffName = (staffId: string | null | undefined) => staff.find((s) => s.id === staffId)?.fullName ?? '—'
  const tripName = (tripId: string | null | undefined) => trips.find((t) => t.id === tripId)?.tripName ?? '—'
  const participantName = (participantId: string | null | undefined) => participants.find((p) => p.id === participantId)?.fullName ?? '—'
  const practiceLabel = (practiceId: string | null | undefined) => allRestrictivePractices.find((p) => p.id === practiceId)?.description ?? '—'

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
      ],
    }] : []),
    {
      stepKey: 'details',
      rows: [
        { label: 'Date & Time', value: getValues('incidentDateTime') || '—' },
        { label: 'Location', value: getValues('location') || '—' },
        { label: 'Description', value: getValues('description') || '—' },
        { label: 'Immediate Actions Taken', value: getValues('immediateActionsTaken') || '—' },
        { label: 'Emergency Services Called', value: wereEmergencyCalled ? 'Yes' : 'No' },
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
    ...(isEdit ? [{
      stepKey: 'compliance',
      rows: [
        { label: 'Status', value: status ? (INCIDENT_STATUS_LABELS[status as IncidentStatus] ?? status) : '—' },
        { label: 'QSC Reporting Status', value: qscReportingStatus ? (QSC_REPORTING_STATUS_LABELS[qscReportingStatus as QscReportingStatus] ?? qscReportingStatus) : '—' },
        { label: 'Reviewed By', value: reviewedByStaffId ? staffName(reviewedByStaffId) : 'Not reviewed' },
        { label: 'Family Notified', value: familyNotified ? 'Yes' : 'No' },
        { label: 'Support Coordinator Notified', value: supportCoordinatorNotified ? 'Yes' : 'No' },
      ],
    }] : []),
  ]

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

      {mutation.isError && (
        <div className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
          Failed to {isEdit ? 'update' : 'create'} incident report. Please check your input and try again.
        </div>
      )}

      <WizardStepRail
        steps={stepsForRail}
        visitedSteps={wizard.visitedSteps}
        currentKey={isReviewStep ? REVIEW_STEP_KEY : currentStep.key}
        onSelect={wizard.goToStep}
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
            isEdit={isEdit}
            existingIncident={existingIncident}
          />
        )}

        {!isReviewStep && currentStep.key === 'details' && (
          <IncidentDetailsStep
            register={register}
            control={control}
            errors={errors}
            incidentType={incidentType}
            wereEmergencyServicesCalled={wereEmergencyCalled}
          />
        )}

        {!isReviewStep && currentStep.key === 'witnesses' && (
          <WitnessesStep
            control={control}
            errors={errors}
            reportedByStaffId={reportedByStaffId}
            staff={staff}
            existingWitnesses={existingIncident?.witnesses ?? []}
            isEdit={isEdit}
          />
        )}

        {!isReviewStep && currentStep.key === 'compliance' && (
          <ComplianceStep
            register={register}
            setValue={setValue}
            status={status}
            qscReportingStatus={qscReportingStatus}
            reviewedByStaffId={reviewedByStaffId}
            familyNotified={familyNotified}
            supportCoordinatorNotified={supportCoordinatorNotified}
            staff={staff}
          />
        )}

        {isReviewStep && (
          <WizardReviewStep
            groups={reviewGroups}
            steps={steps}
            onEdit={wizard.goToStep}
          />
        )}

        <WizardNavFooter
          showBack={wizard.stepIndex > 0}
          onBack={wizard.handleBack}
          onNext={wizard.handleNext}
          isReviewStep={isReviewStep}
          secondaryActions={[]}
          cancelTo="/incidents"
          submitLabel={mutation.isPending ? (isEdit ? 'Saving...' : 'Submitting...') : (isEdit ? 'Save Changes' : 'Submit Incident Report')}
          isSubmitting={mutation.isPending}
        />
      </form>
    </div>
  )
}
