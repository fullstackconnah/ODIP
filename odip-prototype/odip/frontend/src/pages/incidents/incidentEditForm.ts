import type { CreateIncidentDto, IncidentDetailDto, UpdateIncidentDto } from '@/api/types/incidents'
import type { IncidentSeverity, IncidentStatus, IncidentType, QscReportingStatus, ReportableClass } from '@/api/types/enums'
import { toDatetimeLocalValue } from '@/lib/incidentPrefill'
import { parseEmergencyServices } from './emergencyServices'
import { defaultReportableClass } from './reportingDue'
import {
  STEP_BASICS_FIELDS, STEP_COMPLIANCE_FIELDS, STEP_DETAILS_FIELDS, STEP_RESTRICTIVE_PRACTICE_FIELDS, STEP_WITNESSES_FIELDS,
  type IncidentFormData,
} from './incidentFormSchema'

/** The five parts of an incident that are edited and saved on their own. */
export type GroupKey = 'details' | 'basics' | 'rp' | 'witnesses' | 'compliance'
/** A part's step component; the basics group can also render the details or rp step (stepsFor). */
export type StepKey = 'details' | 'basics' | 'rp' | 'witnesses' | 'compliance'

export const STEP_FIELDS: Record<StepKey, readonly (keyof IncidentFormData)[]> = {
  details: STEP_DETAILS_FIELDS,
  basics: STEP_BASICS_FIELDS,
  rp: STEP_RESTRICTIVE_PRACTICE_FIELDS,
  witnesses: STEP_WITNESSES_FIELDS,
  compliance: STEP_COMPLIANCE_FIELDS,
}

/** Lower-case name used in the saved announcement and the discard dialog. */
export const GROUP_LABELS: Record<GroupKey, string> = {
  details: 'incident details',
  basics: 'who and what',
  rp: 'restrictive practice',
  witnesses: 'witnesses',
  compliance: 'compliance',
}

const minute = (v: string | null | undefined) => (v ? v.slice(0, 16) : '')

/** The form values of an existing incident, seeded once per open (moved from the wizard's edit branch). */
export function buildEditValues(i: IncidentDetailDto): Partial<IncidentFormData> {
  return {
    serviceType: i.serviceType ?? 'None',
    tripInstanceId: i.tripInstanceId ?? '',
    incidentType: i.incidentType ?? 'Other',
    otherTypeSpecify: i.otherTypeSpecify ?? '',
    restrictivePracticeType: i.restrictivePracticeType ?? '',
    restrictivePracticeId: i.restrictivePracticeId ?? '',
    unapprovedRestrictivePracticeDetails: i.unapprovedRestrictivePracticeDetails ?? '',
    // Stored unauthorised with a practice linked: that is what "This use was not authorised" records.
    usedWithoutAuthorisation: !!i.restrictivePracticeId && i.isRestrictivePracticeAuthorised === false,
    // Edit never asks; it only carries the stored answer.
    rpUseVaried: i.restrictivePracticeUseVaried ?? null,
    severity: i.severity ?? 'Medium',
    title: i.title ?? '',
    description: i.description ?? '',
    reportedByStaffId: i.reportedByStaffId ?? '',
    incidentDateTime: minute(i.incidentDateTime),
    location: i.location ?? '',
    participantBookingId: i.participantBookingId ?? '',
    involvedParticipantId: i.involvedParticipantId ?? '',
    involvedStaffId: i.involvedStaffId ?? '',
    immediateActionsTaken: i.immediateActionsTaken ?? '',
    wereEmergencyServicesCalled: i.wereEmergencyServicesCalled ?? false,
    emergencyServicesDetails: i.emergencyServicesDetails ?? '',
    emergencyServices: parseEmergencyServices(i.emergencyServices),
    policeOfficerName: i.policeOfficerName ?? '',
    policeReference: i.policeReference ?? '',
    ambulanceOfficerName: i.ambulanceOfficerName ?? '',
    ambulanceReference: i.ambulanceReference ?? '',
    fireOfficerName: i.fireOfficerName ?? '',
    fireReference: i.fireReference ?? '',
    injuries: (i.injuries ?? []).map((inj) => ({ region: inj.region, injuryType: inj.injuryType, description: inj.description })),
    // existingId carries the persisted witness id so Update matches the row and keeps its status and statement (the form field is not named `id`: useFieldArray reserves it).
    witnesses: (i.witnesses ?? []).map((w) => ({ existingId: w.id, witnessUserId: w.witnessUserId, witnessName: w.witnessName })),
    status: i.status ?? 'Draft',
    qscReportingStatus: i.qscReportingStatus ?? 'NotRequired',
    qscReferenceNumber: i.qscReferenceNumber ?? '',
    qscReportedAt: minute(i.qscReportedAt),
    awareAt: i.awareAt ? toDatetimeLocalValue(i.awareAt, i.timeZoneId) : '',
    reportableClass: i.reportableClass ?? 'None',
    reportableClassReason: i.reportableClassReason ?? '',
    isRestrictivePracticeAuthorised: i.isRestrictivePracticeAuthorised ?? null,
    commissionDetailedReportedAt: minute(i.commissionDetailedReportedAt),
    commissionFinalReportRequested: i.commissionFinalReportRequested ?? false,
    commissionFinalReportedAt: minute(i.commissionFinalReportedAt),
    familyNotified: i.familyNotified ?? false,
    familyNotifiedAt: minute(i.familyNotifiedAt),
    supportCoordinatorNotified: i.supportCoordinatorNotified ?? false,
    supportCoordinatorNotifiedAt: minute(i.supportCoordinatorNotifiedAt),
  }
}

/** The source links an incident is filed from: a create takes them from the router hand-off, an update echoes the stored ones (UpdateIncident sets all three from the body). */
export type IncidentLinks = Pick<CreateIncidentDto, 'medicationAdministrationId' | 'shiftId' | 'shiftNoteId'>

/** The one form-to-body mapper: the wizard calls it for a new report, the detail page for every section save. */
export function toIncidentBody(data: IncidentFormData, links: IncidentLinks, isCreate: boolean): CreateIncidentDto {
  const isRp = data.incidentType === 'RestrictivePracticeUse'
  return {
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
    // "This use was not authorised": only with a linked practice. The server also stores a Not authorised entry's use as unauthorised.
    usedWithoutAuthorisation: isRp && !data.unapprovedRestrictivePracticeDetails?.trim() && !!data.restrictivePracticeId && !!data.usedWithoutAuthorisation,
    // Asked on create only; the server ignores it on update and stores it only for an authorised use.
    restrictivePracticeUseVaried: !isCreate || !isRp ? undefined : (data.rpUseVaried ?? undefined),
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
    emergencyServices: data.wereEmergencyServicesCalled && data.emergencyServices?.length ? data.emergencyServices.join(', ') : 'None',
    // The server nulls a service's fields while it is unticked; a blank is simply not sent.
    policeOfficerName: data.policeOfficerName?.trim() || undefined,
    policeReference: data.policeReference?.trim() || undefined,
    ambulanceOfficerName: data.ambulanceOfficerName?.trim() || undefined,
    ambulanceReference: data.ambulanceReference?.trim() || undefined,
    fireOfficerName: data.fireOfficerName?.trim() || undefined,
    fireReference: data.fireReference?.trim() || undefined,
    injuries: data.incidentType === 'Injury' ? (data.injuries as CreateIncidentDto['injuries']) : [],
    // existingId (set only for a row echoed back from a persisted incident) becomes the wire `id` the backend matches on.
    witnesses: (data.witnesses ?? []).map((w) => ({ id: w.existingId, witnessUserId: w.witnessUserId, witnessName: w.witnessName })),
    ...links,
  }
}

/**
 * Re-derives the reporting class when the severity or type moved and the stored class was still the default for the stored severity and type;
 * otherwise undefined ("don't send it": the server keeps the stored class). A pure rule, so no state to reset when a group opens.
 */
export function followDefaultClass(seed: IncidentDetailDto, values: Partial<IncidentFormData>): ReportableClass | undefined {
  const def = (severity: string | undefined, type: string | undefined) => defaultReportableClass(severity, type, seed.isRestrictivePracticeAuthorised, seed.restrictivePracticeUseVaried)
  if (seed.reportableClass !== def(seed.severity, seed.incidentType)) return undefined
  if (values.severity === seed.severity && values.incidentType === seed.incidentType) return undefined
  return def(values.severity, values.incidentType)
}

/**
 * The step components a group renders. Basics widens to the details step (a type moved to Injury needs an injury, and a server 400 forbids saving the
 * type first) or the rp step (a type moved to restrictive practice, or the participant changed on one, which can break the practice link).
 * Returned in page order.
 */
export function stepsFor(group: GroupKey, seed: IncidentDetailDto, values: Partial<IncidentFormData>): StepKey[] {
  if (group !== 'basics') return [group]
  const steps: StepKey[] = ['basics']
  if (values.incidentType === 'Injury' && seed.incidentType !== 'Injury') steps.unshift('details')
  const toRp = values.incidentType === 'RestrictivePracticeUse'
  if (toRp && (seed.incidentType !== 'RestrictivePracticeUse' || (values.involvedParticipantId ?? '') !== (seed.involvedParticipantId ?? ''))) steps.push('rp')
  return steps
}

/**
 * The full PUT body for saving one group: the whole incident as the form holds it (seeded from the same GET), with the loaded `updatedAt` as the stale-form token.
 * Only the compliance group sends the aware time and the class, so an unrelated save stays off the Commission clock; basics also sends a re-derived default class.
 */
export function toUpdateBody(seed: IncidentDetailDto, data: Partial<IncidentFormData>, group: GroupKey): UpdateIncidentDto {
  const v = data as IncidentFormData
  const compliance = group === 'compliance'
  const followed = group === 'basics' ? followDefaultClass(seed, v) : undefined
  return {
    ...toIncidentBody(v, {
      medicationAdministrationId: seed.medicationAdministrationId ?? undefined,
      shiftId: seed.shiftId ?? undefined,
      shiftNoteId: seed.shiftNoteId ?? undefined,
    }, false),
    expectedUpdatedAt: seed.updatedAt,
    status: (v.status || 'Draft') as IncidentStatus,
    qscReportingStatus: (v.qscReportingStatus || 'NotRequired') as QscReportingStatus,
    qscReportedAt: v.qscReportedAt || undefined,
    awareAtLocal: compliance ? v.awareAt || undefined : undefined,
    reportableClass: compliance ? (v.reportableClass || undefined) as ReportableClass | undefined : followed,
    reportableClassReason: compliance ? v.reportableClassReason?.trim() || undefined : undefined,
    commissionDetailedReportedAt: v.commissionDetailedReportedAt || undefined,
    commissionFinalReportRequested: v.commissionFinalReportRequested ?? false,
    commissionFinalReportedAt: v.commissionFinalReportedAt || undefined,
    qscReferenceNumber: v.qscReferenceNumber || undefined,
    familyNotified: v.familyNotified ?? false,
    familyNotifiedAt: v.familyNotifiedAt || undefined,
    supportCoordinatorNotified: v.supportCoordinatorNotified ?? false,
    supportCoordinatorNotifiedAt: v.supportCoordinatorNotifiedAt || undefined,
  }
}

/** The muted line under the type field when the type moved, or null. The "away from" lines say what the save removes; the "to" lines point at the extra fields. */
export function typeChangeNote(seed: IncidentDetailDto, values: Partial<IncidentFormData>): string | null {
  const from = seed.incidentType
  const to = values.incidentType
  if (!to || to === from) return null
  if (from === 'Injury') return 'Changing the type from Injury removes the recorded injuries when you save.'
  if (from === 'RestrictivePracticeUse') return 'Changing the type from restrictive practice removes the practice details when you save.'
  if (to === 'Injury') return 'An injury report needs at least one injury. Add it above, then save.'
  if (to === 'RestrictivePracticeUse') return 'Check the restrictive practice details below before you save.'
  return null
}
