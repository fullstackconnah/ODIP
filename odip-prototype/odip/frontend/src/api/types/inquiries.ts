import type { ContactRoleType } from './enums'

export type InquirySource = 'Web' | 'Email' | 'Phone'

export interface ParticipantInquiryDto {
  id: string
  participantId?: string | null
  firstName: string
  lastName: string
  phone?: string | null
  email?: string | null
  /** Empty for a direct intake (see `isDirectIntake`): no enquiry was captured, so there is no source. */
  source: InquirySource | ''
  provenance?: string | null
  createdAt: string
  /** The enquiry's version: the edit form sends it back as `expectedUpdatedAt`. */
  updatedAt?: string
  /** Closed (spec addendum E1): all null or absent while open. The note is null for roles without lifecycle rights. */
  closedAt?: string | null
  closeOutcome?: InquiryCloseOutcome | null
  closeNote?: string | null
  /**
   * Where the participant this enquiry became has got to: all three are null (or absent) while the enquiry has no participant, so the
   * Enquiries tab can tell "New" (no participant), "Draft intake" (intake open) from an enquiry that has moved on (intake complete: the
   * Onboarding tab; finalised: Active participants).
   */
  participantIsDraft?: boolean | null
  participantIsActive?: boolean | null
  participantIntakeCompletedAt?: string | null
  /**
   * True for a row that is not an enquiry: a draft participant whose intake was started in the Intake wizard with no enquiry behind it. It
   * rides in this feed so the Enquiries tab shows every intake in progress. Its `id` is the participant's, so there is no enquiry to edit.
   */
  isDirectIntake?: boolean
  /** The booked intake visit, all null or absent when there is none. `intakeStartsAt` is an instant (UTC, Z): show it in `timeZoneId`, the provider's zone. */
  intakeStartsAt?: string | null
  intakeDurationMinutes?: number | null
  intakeLocation?: string | null
  intakeStaffUserId?: string | null
  intakeStaffFirstName?: string | null
  intakeStaffName?: string | null
  /** Internal: shown to the team and in the staff member's email, never in the contact's email or the .ics. */
  intakeNotes?: string | null
  intakeInviteSentAt?: string | null
  /** Why the latest invite did not go. Null after a send that worked. */
  intakeInviteError?: IntakeInviteError | null
  intakeConfirmedAt?: string | null
  timeZoneId?: string | null
}

export type IntakeInviteError = 'NotConfigured' | 'Failed'

export type InquiryCloseOutcome = 'DeclinedByUs' | 'NotGoingAhead' | 'Other'

/** POST /inquiries/{id}/close. */
export interface CloseInquiryDto {
  outcome: InquiryCloseOutcome
  note: string | null
  /** The version the screen loaded: a save since then makes the close a 409. */
  expectedUpdatedAt?: string
}

/** What a close did. NoVisit: there was no upcoming visit to cancel; the rest are a cancel's. */
export interface CloseInquiryResultDto {
  inquiry: ParticipantInquiryDto
  cancellationEmail: 'NoVisit' | 'NoInvite' | 'Sent' | IntakeInviteError
}

/** PUT /inquiries/{id}/intake-booking. `startsAt` is the provider-local choice as an instant with Z; `contactEmail` only when the enquiry has none. */
export interface SetIntakeBookingDto {
  startsAt: string
  durationMinutes: number
  location: string
  staffUserId: string
  notes: string | null
  contactEmail?: string
  /** The version the form holds (ODIP-REVIEW-268): a save since then makes the booking a 409. The slide-over sends none. */
  expectedUpdatedAt?: string
}

export interface CancelIntakeBookingResultDto {
  inquiry: ParticipantInquiryDto
  /** NoInvite: none had gone out, so nobody was emailed. */
  cancellationEmail: 'Sent' | 'NoInvite' | IntakeInviteError
}

/** One visit on My shifts or the Schedule page (GET /intake-visits). */
export interface IntakeVisitDto {
  inquiryId: string
  firstName: string
  lastName: string
  participantId: string | null
  participantIsDraft: boolean | null
  participantIntakeCompletedAt: string | null
  startsAt: string
  durationMinutes: number
  location: string
  staffUserId: string
  staffName: string
  confirmedAt: string | null
  timeZoneId: string
}

export interface CreateParticipantInquiryDto {
  firstName: string
  lastName: string
  /** A field left blank is sent as null, never "": the API rejects an empty string as a bad email address. */
  phone?: string | null
  email?: string | null
  source: InquirySource
  provenance?: string | null
  /** Pending contacts, saved in the enquiry's own save. On PUT a list replaces the stored ones; left out means unchanged. */
  contacts?: InquiryContactDto[]
}

/** PUT /inquiries/{id}: `expectedUpdatedAt` is the version the form loaded; another save since then makes this one a 409. */
export type UpdateParticipantInquiryDto = CreateParticipantInquiryDto & { expectedUpdatedAt?: string }

/** A contact noted on an enquiry before intake (spec 2026-10-16, D3). Start intake moves it onto the participant. */
export interface InquiryContactDto {
  role: ContactRoleType
  firstName: string
  lastName: string
  phone?: string | null
  email?: string | null
  relationship?: string | null
  notes?: string | null
}

/** GET /inquiries/{id}: the enquiry with its pending contacts, for the enquiry form. The list (GET /inquiries) never carries them. */
export interface ParticipantInquiryDetailDto extends ParticipantInquiryDto {
  contacts: InquiryContactDto[]
}

/** One onboarding checklist item. `key` names the item and its fix: profile (Edit profile), serviceNeeds (the agreement draft), agreement (Record it), funding (the Funding tab). */
export interface OnboardingChecklistItem {
  key: 'profile' | 'serviceNeeds' | 'agreement' | 'funding'
  label: string
  done: boolean
  /** One line saying what is missing; null when the item is done. */
  missing?: string | null
}

/** GET /inquiries/{participantId}/onboarding: the checklist, derived by the server (owner decision 2026-10-13). */
export interface ParticipantOnboardingDto {
  participantId: string
  /** Four items, three for a participant who is not NDIS-funded. */
  items: OnboardingChecklistItem[]
  isReady: boolean
  servicesStartedAt?: string | null
  /** The agreement record: a signed date (yyyy-MM-dd) or a reason there is no written agreement, at most one. */
  agreementSignedOn?: string | null
  noAgreementReason?: string | null
}

/** A row of GET /inquiries/onboarding-worklist (the Onboarding tab). */
export interface OnboardingWorklistRow {
  participantId: string
  fullName: string
  servicesStartedAt?: string | null
  completedSteps: number
  totalSteps: number
  /** The label of the first item still open; null when every item is done. */
  firstMissing?: string | null
}

/** POST /inquiries/{participantId}/onboarding/agreement-record: exactly one of the two. */
export interface RecordOnboardingAgreementDto {
  signedOn?: string | null
  noAgreementReason?: string | null
}
