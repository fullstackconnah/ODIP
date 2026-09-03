import { z } from 'zod'
import type { Resolver, FieldErrors } from 'react-hook-form'

/**
 * IN-1/IN-3/IN-4/IN-6 — the incident wizard's form schema. Mirrors ParticipantCreatePage's
 * pattern exactly: one plain (unrefined) base object schema used both for full-object `.pick()`
 * per wizard step, and — via `.superRefine()` chained on top of it — the single combined schema
 * behind the final-submit resolver (defense in depth, same as every other step's Next-button
 * gate). Per-step schemas are built from THIS SAME base object, not a separate hand-copied shape,
 * so a step's Next validation and the final submit validation can never silently drift apart.
 */
export const incidentBaseSchema = z.object({
  // Step 0 — Basics (IN-3)
  involvedParticipantId: z.string().optional(),
  title: z.string().min(1, 'Title is required'),
  reportedByStaffId: z.string().min(1, 'Reporter is required'),
  involvedStaffId: z.string().optional(),
  serviceType: z.string().optional(),
  tripInstanceId: z.string().optional(),
  incidentType: z.string().min(1, 'Incident type is required'),
  otherTypeSpecify: z.string().optional(),
  severity: z.string().min(1, 'Severity is required'),

  // Step 1 — Restrictive Practice (IN-4), conditional (incidentType === 'RestrictivePracticeUse')
  restrictivePracticeType: z.string().optional(),
  restrictivePracticeId: z.string().optional(),
  /** IN-4: mutually exclusive with restrictivePracticeId — see incidentRpRefine. */
  unapprovedRestrictivePracticeDetails: z.string().optional(),

  // Step 2 — Incident Details (IN-6), plus IN-5's injuries (conditional on incidentType === 'Injury')
  incidentDateTime: z.string().min(1, 'Date/time is required'),
  location: z.string().optional(),
  description: z.string().min(1, 'Description is required'),
  immediateActionsTaken: z.string().optional(),
  wereEmergencyServicesCalled: z.boolean().optional(),
  emergencyServicesDetails: z.string().optional(),
  injuries: z.array(z.object({
    region: z.string().min(1, 'Region is required'),
    injuryType: z.string().min(1, 'Injury type is required'),
    description: z.string().min(1, 'Description is required'),
  })).optional().default([]),

  // Step 3 — Witnesses (IN-7). Replaces the old free-text witnessNames/witnessStatements pair —
  // one witnessUserId (staff, approvable) or witnessName-only (external, not approvable) row per
  // entry. `existingId` (deliberately NOT named `id` — useFieldArray injects its own `id` onto
  // every field object, which would silently shadow a schema field of the same name) is set only
  // when echoing back an already-persisted row on Update, so the backend can preserve that row's
  // approval state instead of resetting it to Pending — see WitnessesStep's own doc comment. None
  // of this is required — witnesses are optional, matching today's form.
  witnesses: z.array(z.object({
    existingId: z.string().optional(),
    witnessUserId: z.string().nullable(),
    witnessName: z.string().min(1, 'Name is required'),
  })).optional().default([]),

  participantBookingId: z.string().optional(),

  // Step 4 — Review & Compliance (edit-mode only). Every field here is optional today and stays
  // optional — see the "Edit-mode-only fields" cross-cutting section of SPEC-04.
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
})

export type IncidentFormData = z.infer<typeof incidentBaseSchema>

function pickShape<T extends readonly (keyof IncidentFormData)[]>(fields: T) {
  return Object.fromEntries(fields.map((f) => [f, true])) as { [K in T[number]]: true }
}

// ── Step field ownership — also what `useWizard` uses to route a field's error/focus back to
// the step that owns it (fieldToStepKey, built from these same arrays). ──────────────────────
export const STEP_BASICS_FIELDS = [
  'involvedParticipantId', 'title', 'reportedByStaffId', 'involvedStaffId',
  'serviceType', 'tripInstanceId', 'incidentType', 'otherTypeSpecify', 'severity',
] as const satisfies readonly (keyof IncidentFormData)[]

export const STEP_RESTRICTIVE_PRACTICE_FIELDS = [
  'restrictivePracticeType', 'restrictivePracticeId', 'unapprovedRestrictivePracticeDetails',
] as const satisfies readonly (keyof IncidentFormData)[]

export const STEP_DETAILS_FIELDS = [
  'incidentDateTime', 'location', 'description', 'immediateActionsTaken',
  'wereEmergencyServicesCalled', 'emergencyServicesDetails', 'injuries',
] as const satisfies readonly (keyof IncidentFormData)[]

export const STEP_WITNESSES_FIELDS = [
  'witnesses',
] as const satisfies readonly (keyof IncidentFormData)[]

export const STEP_COMPLIANCE_FIELDS = [
  'status', 'qscReportingStatus', 'qscReferenceNumber', 'qscReportedAt', 'reviewedByStaffId',
  'reviewNotes', 'correctiveActions', 'familyNotified', 'familyNotifiedAt',
  'supportCoordinatorNotified', 'supportCoordinatorNotifiedAt',
] as const satisfies readonly (keyof IncidentFormData)[]

// ── Cross-field refinements — each applied both to its own step's picked schema (Next-button
// gate) and chained onto the combined final-submit schema below, so the two can never drift. ──

function basicsRefine(data: Pick<IncidentFormData, 'serviceType' | 'tripInstanceId' | 'incidentType' | 'otherTypeSpecify'>, ctx: z.RefinementCtx) {
  if (data.serviceType === 'Trip' && !data.tripInstanceId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tripInstanceId'], message: 'A trip must be selected when the service type is Trip.' })
  }
  if (data.incidentType === 'Other' && !data.otherTypeSpecify?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['otherTypeSpecify'], message: 'Please specify the incident type.' })
  }
}

/**
 * IN-4's central rule, enforced client-side: restrictivePracticeType is required, and exactly one
 * of {restrictivePracticeId} or {unapprovedRestrictivePracticeDetails non-empty} must be set —
 * never both, never neither. Only applied when this step is actually in play (the caller only
 * invokes this refine when incidentType === 'RestrictivePracticeUse' — see restrictivePracticeSchema
 * and incidentSchema below), since a non-RP incident has nothing here to validate.
 */
function restrictivePracticeRefine(
  data: Pick<IncidentFormData, 'restrictivePracticeType' | 'restrictivePracticeId' | 'unapprovedRestrictivePracticeDetails'>,
  ctx: z.RefinementCtx,
) {
  if (!data.restrictivePracticeType) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['restrictivePracticeType'], message: 'Please select the restrictive practice type.' })
  }
  const hasLinked = !!data.restrictivePracticeId
  const hasUnapproved = !!data.unapprovedRestrictivePracticeDetails?.trim()
  if (hasLinked && hasUnapproved) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom, path: ['unapprovedRestrictivePracticeDetails'],
      message: 'Link an approved practice OR describe an unapproved one — not both.',
    })
  } else if (!hasLinked && !hasUnapproved) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom, path: ['unapprovedRestrictivePracticeDetails'],
      message: 'Link an approved practice, or describe the unapproved practice that was used.',
    })
  }
}

/** IN-5: an Injury incident must record at least one injury row — mirrors the backend's own
 * `ValidateServiceTypeAndIncidentType` check (defense in depth, same idiom as every other rule
 * shared between a wizard step's Next gate and the server). */
function detailsRefine(data: Pick<IncidentFormData, 'incidentType' | 'injuries'>, ctx: z.RefinementCtx) {
  if (data.incidentType === 'Injury' && (!data.injuries || data.injuries.length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['injuries'], message: 'Please record at least one injury.' })
  }
}

export const basicsSchema = incidentBaseSchema.pick(pickShape(STEP_BASICS_FIELDS)).superRefine(basicsRefine)

// incidentType is added to the pick shape (not to STEP_RESTRICTIVE_PRACTICE_FIELDS itself) purely
// so restrictivePracticeRefine could see it if it ever needed to — it doesn't today (this step
// schema is only ever invoked while the step is actually in the wizard's computed list, i.e.
// incidentType is already known to be 'RestrictivePracticeUse'), but keeping the shape consistent
// with detailsSchema's own equivalent addition below costs nothing.
export const restrictivePracticeSchema = incidentBaseSchema
  .pick({ ...pickShape(STEP_RESTRICTIVE_PRACTICE_FIELDS), incidentType: true })
  .superRefine(restrictivePracticeRefine)

export const detailsSchema = incidentBaseSchema
  .pick({ ...pickShape(STEP_DETAILS_FIELDS), incidentType: true })
  .superRefine(detailsRefine)

// IN-7: no cross-field refine needed — a witness row's own `witnessName` non-empty check is
// already enforced by the array item schema above, and the array itself is optional (zero
// witnesses is valid, matching today's form).
export const witnessesSchema = incidentBaseSchema.pick(pickShape(STEP_WITNESSES_FIELDS))

export const complianceSchema = incidentBaseSchema.pick(pickShape(STEP_COMPLIANCE_FIELDS))

/**
 * Combined schema for the final-submit resolver — same base object, same refinements as the
 * per-step schemas above, chained together. The restrictivePractice/injury refinements are
 * naturally no-ops here whenever their governing incidentType doesn't apply (same functions,
 * called against the full form values instead of a step-scoped pick).
 */
export const incidentSchema = incidentBaseSchema
  .superRefine(basicsRefine)
  .superRefine((data, ctx) => {
    if (data.incidentType === 'RestrictivePracticeUse') restrictivePracticeRefine(data, ctx)
  })
  .superRefine(detailsRefine)

// Sets a react-hook-form-shaped error at an arbitrary zod issue path (e.g. ['injuries', 0,
// 'description']) — mirrors ParticipantCreatePage's setPathError, needed here for the same
// reason: a useFieldArray-backed field (injuries) needs its row-level errors nested, not flattened.
function setPathError(errors: Record<string, unknown>, path: PropertyKey[], message: string, code: string) {
  let node: Record<PropertyKey, unknown> = errors
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]
    if (node[key] === undefined) node[key] = typeof path[i + 1] === 'number' ? [] : {}
    node = node[key] as Record<PropertyKey, unknown>
  }
  const last = path[path.length - 1]
  if (node[last] === undefined) node[last] = { type: code, message }
}

// @hookform/resolvers 3.x's zodResolver reads ZodError.errors (a getter zod v4 removed in favour
// of .issues), so it throws past react-hook-form instead of populating formState.errors on
// validation failure. Resolve directly against zod's safeParse/.issues API instead of routing
// through that resolver (same workaround as ParticipantCreatePage's participantResolver and this
// page's own pre-wizard incidentResolver — carried forward unchanged, per IN-1's Implementation
// note: do not attempt to reintroduce zodResolver as part of this rewrite).
export const incidentResolver: Resolver<IncidentFormData> = (values) => {
  const result = incidentSchema.safeParse(values)
  if (result.success) return { values: result.data, errors: {} }
  const errors: FieldErrors<IncidentFormData> = {}
  for (const issue of result.error.issues) {
    setPathError(errors as Record<string, unknown>, issue.path, issue.message, issue.code)
  }
  return { values: {}, errors }
}
