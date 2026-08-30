import type { IncidentType, IncidentSeverity, IncidentStatus, QscReportingStatus, ServiceStream } from './enums'

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
  serviceType: IncidentServiceType
  tripInstanceId?: string
  participantBookingId?: string
  involvedParticipantId?: string
  involvedStaffId?: string
  reportedByStaffId: string
  incidentType: IncidentType
  otherTypeSpecify?: string
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
