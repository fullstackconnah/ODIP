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

/** PUT /inquiries/{id}/intake-booking. `startsAt` is the provider-local choice as an instant with Z; `contactEmail` only when the enquiry has none. */
export interface SetIntakeBookingDto {
  startsAt: string
  durationMinutes: number
  location: string
  staffUserId: string
  notes: string | null
  contactEmail?: string
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
