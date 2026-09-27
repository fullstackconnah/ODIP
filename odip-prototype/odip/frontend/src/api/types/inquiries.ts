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
}

export interface CreateParticipantInquiryDto {
  firstName: string
  lastName: string
  phone?: string
  email?: string
  source: InquirySource
  provenance?: string
}
