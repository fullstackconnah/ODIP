export type InquirySource = 'Web' | 'Email' | 'Phone'

export interface ParticipantInquiryDto {
  id: string
  participantId?: string | null
  firstName: string
  lastName: string
  phone?: string | null
  email?: string | null
  source: InquirySource
  provenance?: string | null
  createdAt: string
  /**
   * Where the participant this enquiry became has got to: all three are null (or absent) while the enquiry has no participant, so the
   * Enquiries tab can say "Draft intake", "Intake complete" or "Participant" instead of offering "Resume intake" for ever.
   */
  participantIsDraft?: boolean | null
  participantIsActive?: boolean | null
  participantIntakeCompletedAt?: string | null
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
