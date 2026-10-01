import type { IncidentType, IncidentSeverity, IncidentStatus, QscReportingStatus, ServiceStream, BodyRegion, InjuryType, WitnessStatus, MedicationAdministrationStatus } from './enums'
import type { RestrictivePracticeType } from './restrictive-practices'
import type { ShiftNoteFlagCategory } from '@/lib/shiftNoteKeywords'

/** IN-5: one persisted injury row, as returned by GET /incidents/{id}. */
export interface IncidentInjuryDto {
  id: string
  region: BodyRegion
  injuryType: InjuryType
  description: string
}

/** IN-5: one submitted injury row — see IncidentInjuryDto for the persisted shape. */
export interface CreateIncidentInjuryDto {
  region: BodyRegion
  injuryType: InjuryType
  description: string
}

/** IN-7: one persisted witness row, as returned by GET /incidents/{id}. */
export interface IncidentWitnessDto {
  id: string
  witnessUserId: string | null
  witnessName: string
  /** true when this is a staff witness (witnessUserId set) — drives the Staff/External type badge. */
  isStaffWitness: boolean
  witnessStatus: WitnessStatus
  witnessRequestedAt: string | null
  witnessRespondedAt: string | null
  /** Optional, supplied by the witness themself at approval/decline time. */
  statementText: string | null
}

/**
 * IN-7: one submitted witness row. `id` is omitted for a newly-added witness (create, or a row
 * added during an edit) and set to an existing IncidentWitnessDto.id when echoing back an
 * already-persisted row on Update — the backend preserves that row's approval state (rather than
 * resetting it to Pending) only when it recognises the id.
 */
export interface CreateIncidentWitnessDto {
  id?: string
  /** Set for a staff witness — must not equal the incident's own reportedByStaffId (self-witness
   * is rejected). Null for a free-text/external witness. */
  witnessUserId: string | null
  witnessName: string
}

/** INC-01: same value set as ServiceStream, plus "None" — the untagged default (backend ServiceStreams.None). */
export type IncidentServiceType = ServiceStream | 'None'

export interface IncidentListDto {
  id: string
  /** INC-01: business stream the incident occurred under. Selecting "Trip" is what makes tripInstanceId meaningful. */
  serviceType: IncidentServiceType
  tripInstanceId: string | null
  tripName: string | null
  incidentType: IncidentType
  /** INC-02: required (server-validated) when incidentType is "Other". */
  otherTypeSpecify: string | null
  severity: IncidentSeverity
  status: IncidentStatus
  title: string
  /** Provider-local WALL-CLOCK value, no zone: the digits are the answer. Read with lib/wallClock, never parseApiDate (DESIGN.md, "Time on the wire"). */
  incidentDateTime: string
  location: string | null
  reportedByName: string | null
  involvedParticipantId: string | null
  involvedParticipantName: string | null
  qscReportingStatus: QscReportingStatus
  isOverdue24h: boolean
  createdAt: string
  /** Connection map: set when this incident was filed from a MAR drop-into-draft hand-off
   * (RecordAdministrationModal's "Report as incident"). */
  medicationAdministrationId: string | null
  /** Connection map: set when this incident is linked to a specific shift. */
  shiftId: string | null
  /** Connection map: set when this incident was filed from a flagged shift note's "file an
   * incident report" hand-off (see NOTES-02/ShiftNoteIncidentPrefillState). */
  shiftNoteId: string | null
}

export interface IncidentDetailDto extends IncidentListDto {
  participantBookingId: string | null
  involvedStaffId: string | null
  involvedStaffName: string | null
  reportedByStaffId: string
  /** INC-04: which of the register's 6 categories was used. Null unless incidentType is 'RestrictivePracticeUse'. */
  restrictivePracticeType: RestrictivePracticeType | null
  /** INC-05: the linked register entry, if the reporter picked one of the involved participant's authorised practices. */
  restrictivePracticeId: string | null
  restrictivePracticeDescription: string | null
  /** "YYYY-MM-DD" — the linked entry's review date, for display only. */
  restrictivePracticeReviewDate: string | null
  /**
   * IN-4: free-text description of the restrictive practice actually used, when it was NOT one
   * of the participant's approved/active register entries. Mutually exclusive with
   * restrictivePracticeId — the backend rejects (400) a request setting both. Recording this
   * NEVER creates or updates a RestrictivePractice register row.
   */
  unapprovedRestrictivePracticeDetails: string | null
  /**
   * INC-04: true = authorised (an active register entry of restrictivePracticeType existed for
   * the involved participant at creation), false = unauthorised (none did — reportable-incident
   * territory), null = not determinable (not an RP incident, or no participant was selected).
   * Frozen at creation — editing the incident afterwards never recomputes this.
   */
  isRestrictivePracticeAuthorised: boolean | null
  description: string
  immediateActionsTaken: string | null
  wereEmergencyServicesCalled: boolean
  emergencyServicesDetails: string | null
  witnessNames: string | null
  witnessStatements: string | null
  /** IN-5: recorded injuries, populated only when incidentType is 'Injury' (empty array otherwise). */
  injuries: IncidentInjuryDto[]
  /** IN-7: witnesses — staff (approvable) and free-text external witnesses in one list. */
  witnesses: IncidentWitnessDto[]
  /** Provider-local WALL-CLOCK value, no zone: the digits are the answer. Read with lib/wallClock, never parseApiDate (DESIGN.md, "Time on the wire"). */
  qscReportedAt: string | null
  qscReferenceNumber: string | null
  reviewedByStaffId: string | null
  reviewedByName: string | null
  reviewedAt: string | null
  reviewNotes: string | null
  correctiveActions: string | null
  resolvedAt: string | null
  familyNotified: boolean
  /** Provider-local WALL-CLOCK value, no zone: the digits are the answer. Read with lib/wallClock, never parseApiDate (DESIGN.md, "Time on the wire"). */
  familyNotifiedAt: string | null
  supportCoordinatorNotified: boolean
  /** Provider-local WALL-CLOCK value, no zone: the digits are the answer. Read with lib/wallClock, never parseApiDate (DESIGN.md, "Time on the wire"). */
  supportCoordinatorNotifiedAt: string | null
  updatedAt: string
  /** Connection map: resolved medication-administration context for the Context panel — present
   * only when medicationAdministrationId is set. Backend field: IncidentDetailDto.MedicationContext. */
  medicationContext: {
    medicationAdministrationId: string
    medicationName: string
    status: MedicationAdministrationStatus
    administeredAt: string | null
    recordedByName: string | null
  } | null
  /** Connection map: resolved shift context for the Context panel — present only when shiftId
   * is set. Plain display data only; there is no coordinator shift detail page to link to.
   * Backend field: IncidentDetailDto.ShiftContext. */
  shiftContext: {
    shiftId: string
    date: string
    startTime: string
    endTime: string
    participantName: string
    staffName: string | null
  } | null
  /** Connection map: resolved shift-note context for the Context panel — present only when
   * shiftNoteId is set. Backend field: IncidentDetailDto.ShiftNoteContext. `flaggedCategories`
   * is a real string[] — same ShiftNoteKeywordVocabulary.ToCategoryNames-produced shape as
   * ShiftNoteDto/FlaggedShiftNoteDto, not the raw [Flags] enum. */
  shiftNoteContext: {
    shiftNoteId: string
    excerpt: string
    flaggedCategories: ShiftNoteFlagCategory[]
    createdAt: string
  } | null
}

export interface CreateIncidentDto {
  serviceType: IncidentServiceType
  tripInstanceId?: string
  participantBookingId?: string
  involvedParticipantId?: string
  involvedStaffId?: string
  reportedByStaffId: string
  incidentType: IncidentType
  otherTypeSpecify?: string
  /** INC-04: required when incidentType is 'RestrictivePracticeUse'. */
  restrictivePracticeType?: RestrictivePracticeType
  /** INC-05: optional link to one of the involved participant's register entries. */
  restrictivePracticeId?: string
  /**
   * IN-4: free-text description of an unapproved restrictive practice — mutually exclusive with
   * restrictivePracticeId (enforced client-side by the wizard step's schema and server-side as a
   * 400). Never results in a RestrictivePractice register row being created.
   */
  unapprovedRestrictivePracticeDetails?: string
  severity: IncidentSeverity
  title: string
  description: string
  /** Provider-local WALL-CLOCK value, no zone: the digits are the answer. Read with lib/wallClock, never parseApiDate (DESIGN.md, "Time on the wire"). */
  incidentDateTime: string
  location?: string
  immediateActionsTaken?: string
  wereEmergencyServicesCalled: boolean
  emergencyServicesDetails?: string
  witnessNames?: string
  witnessStatements?: string
  /** IN-5: repeatable injury rows — only meaningful (server-validated as non-empty) when incidentType is 'Injury'. */
  injuries: CreateIncidentInjuryDto[]
  /** IN-7: repeatable witness rows — staff and free-text external witnesses coexist in one list. */
  witnesses: CreateIncidentWitnessDto[]
  /** Connection map: set when filing from a MAR drop-into-draft hand-off. */
  medicationAdministrationId?: string | null
  /** Connection map: set when this incident is linked to a specific shift. */
  shiftId?: string | null
  /** Connection map: set when filing from a flagged shift note's "file an incident report" hand-off. */
  shiftNoteId?: string | null
}

export interface UpdateIncidentDto extends CreateIncidentDto {
  status: IncidentStatus
  qscReportingStatus: QscReportingStatus
  /** Provider-local WALL-CLOCK value, no zone: the digits are the answer. Read with lib/wallClock, never parseApiDate (DESIGN.md, "Time on the wire"). */
  qscReportedAt?: string
  qscReferenceNumber?: string
  reviewedByStaffId?: string
  reviewNotes?: string
  correctiveActions?: string
  familyNotified: boolean
  /** Provider-local WALL-CLOCK value, no zone: the digits are the answer. Read with lib/wallClock, never parseApiDate (DESIGN.md, "Time on the wire"). */
  familyNotifiedAt?: string
  supportCoordinatorNotified: boolean
  /** Provider-local WALL-CLOCK value, no zone: the digits are the answer. Read with lib/wallClock, never parseApiDate (DESIGN.md, "Time on the wire"). */
  supportCoordinatorNotifiedAt?: string
}
