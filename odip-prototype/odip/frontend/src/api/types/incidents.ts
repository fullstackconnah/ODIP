import type { IncidentType, IncidentSeverity, IncidentStatus, QscReportingStatus } from './enums'

export interface IncidentListDto {
  id: string
  tripInstanceId: string
  tripName: string | null
  incidentType: IncidentType
  severity: IncidentSeverity
  status: IncidentStatus
  title: string
  incidentDateTime: string
  location: string | null
  reportedByName: string | null
  involvedParticipantName: string | null
  qscReportingStatus: QscReportingStatus
  isOverdue24h: boolean
  createdAt: string
}

export interface IncidentDetailDto extends IncidentListDto {
  participantBookingId: string | null
  involvedParticipantId: string | null
  involvedStaffId: string | null
  involvedStaffName: string | null
  reportedByStaffId: string
  description: string
  immediateActionsTaken: string | null
  wereEmergencyServicesCalled: boolean
  emergencyServicesDetails: string | null
  witnessNames: string | null
  witnessStatements: string | null
  qscReportedAt: string | null
  qscReferenceNumber: string | null
  reviewedByStaffId: string | null
  reviewedByName: string | null
  reviewedAt: string | null
  reviewNotes: string | null
  correctiveActions: string | null
  resolvedAt: string | null
  familyNotified: boolean
  familyNotifiedAt: string | null
  supportCoordinatorNotified: boolean
  supportCoordinatorNotifiedAt: string | null
  updatedAt: string
}

export interface CreateIncidentDto {
  tripInstanceId: string
  participantBookingId?: string
  involvedParticipantId?: string
  involvedStaffId?: string
  reportedByStaffId: string
  incidentType: IncidentType
  severity: IncidentSeverity
  title: string
  description: string
  incidentDateTime: string
  location?: string
  immediateActionsTaken?: string
  wereEmergencyServicesCalled: boolean
  emergencyServicesDetails?: string
  witnessNames?: string
  witnessStatements?: string
}

export interface UpdateIncidentDto extends CreateIncidentDto {
  status: IncidentStatus
  qscReportingStatus: QscReportingStatus
  qscReportedAt?: string
  qscReferenceNumber?: string
  reviewedByStaffId?: string
  reviewNotes?: string
  correctiveActions?: string
  familyNotified: boolean
  familyNotifiedAt?: string
  supportCoordinatorNotified: boolean
  supportCoordinatorNotifiedAt?: string
}
