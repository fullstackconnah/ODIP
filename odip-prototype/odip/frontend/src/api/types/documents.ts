import type { DocumentType } from './enums'

export interface TripDocumentDto {
  id: string
  tripInstanceId: string
  participantBookingId: string | null
  documentType: DocumentType
  fileName: string
  filePath: string | null
  fileSize: number | null
  documentDate: string | null
  notes: string | null
  uploadedAt: string
}
