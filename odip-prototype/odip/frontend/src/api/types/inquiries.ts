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
