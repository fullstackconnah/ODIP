import { describe, expect, it } from 'vitest'
import { toUpdateIncidentDto, type IncidentDetailDto } from './incidents'

// UpdateIncident is a full-replace PUT: the description is required, the injuries are deleted and re-inserted from the body, the witnesses are matched by id (to
// keep an Approved or Declined witness from going back to Pending) and the source links are set to whatever the body says. A list row has none of that.

const stored: IncidentDetailDto = {
  id: 'inc-1', serviceType: 'Trip', tripInstanceId: 'trip-1', tripName: 'Coastal weekend', incidentType: 'Injury', otherTypeSpecify: null, severity: 'High', status: 'Closed',
  title: 'Slip in kitchen', incidentDateTime: '2026-08-01T09:30:00', location: 'Kitchen', reportedByName: 'Alex Rivera', involvedParticipantId: 'p-1', involvedParticipantName: 'Sophie Brown',
  qscReportingStatus: 'Reported', isOverdue24h: false, createdAt: '2026-08-01T10:00:00Z', medicationAdministrationId: 'mar-1', shiftId: 'shift-1', shiftNoteId: null,
  participantBookingId: 'booking-1', involvedStaffId: null, involvedStaffName: null, reportedByStaffId: 'staff-1', restrictivePracticeType: null, restrictivePracticeId: null,
  restrictivePracticeDescription: null, restrictivePracticeReviewDate: null, unapprovedRestrictivePracticeDetails: null, isRestrictivePracticeAuthorised: null,
  description: 'Slipped on a wet floor and hit a knee on the bench.', immediateActionsTaken: 'Ice and rest', wereEmergencyServicesCalled: false, emergencyServicesDetails: null,
  witnessNames: null, witnessStatements: null,
  injuries: [{ id: 'inj-1', region: 'Knee', injuryType: 'Bruise', description: 'Bruised knee' }],
  witnesses: [{ id: 'w-1', witnessUserId: 'staff-2', witnessName: 'Pat Lee', isStaffWitness: true, witnessStatus: 'Approved', witnessRequestedAt: '2026-08-01T11:00:00Z', witnessRespondedAt: '2026-08-01T12:00:00Z', statementText: 'I saw it.' }],
  qscReportedAt: '2026-08-02T08:00:00', qscReferenceNumber: 'QSC-9', reviewedByStaffId: 'staff-3', reviewedByName: 'Sam Lee', reviewedAt: '2026-08-03T09:00:00Z', reviewNotes: 'Reviewed',
  correctiveActions: 'Wet-floor sign', resolvedAt: null, familyNotified: true, familyNotifiedAt: '2026-08-01T13:00:00', supportCoordinatorNotified: false, supportCoordinatorNotifiedAt: null,
  updatedAt: '2026-08-03T09:00:00Z', medicationContext: null, shiftContext: null, shiftNoteContext: null,
} as unknown as IncidentDetailDto

describe('toUpdateIncidentDto', () => {
  it('carries what the update replaces, so a status change keeps the description, injuries, witnesses, links and review', () => {
    expect(toUpdateIncidentDto(stored, { status: 'Draft' })).toEqual({
      serviceType: 'Trip', tripInstanceId: 'trip-1', participantBookingId: 'booking-1', involvedParticipantId: 'p-1', reportedByStaffId: 'staff-1', incidentType: 'Injury',
      severity: 'High', title: 'Slip in kitchen', description: 'Slipped on a wet floor and hit a knee on the bench.', incidentDateTime: '2026-08-01T09:30:00', location: 'Kitchen',
      immediateActionsTaken: 'Ice and rest', wereEmergencyServicesCalled: false,
      injuries: [{ region: 'Knee', injuryType: 'Bruise', description: 'Bruised knee' }],
      witnesses: [{ id: 'w-1', witnessUserId: 'staff-2', witnessName: 'Pat Lee' }],
      medicationAdministrationId: 'mar-1', shiftId: 'shift-1',
      status: 'Draft', qscReportingStatus: 'Reported', qscReportedAt: '2026-08-02T08:00:00', qscReferenceNumber: 'QSC-9', reviewedByStaffId: 'staff-3', reviewNotes: 'Reviewed',
      correctiveActions: 'Wet-floor sign', familyNotified: true, familyNotifiedAt: '2026-08-01T13:00:00', supportCoordinatorNotified: false,
    })
  })

  it('sends nothing for what is empty on the record, and none of the read-only fields', () => {
    const dto = toUpdateIncidentDto(stored)

    expect(dto.otherTypeSpecify).toBeUndefined()
    expect(dto.shiftNoteId).toBeUndefined()
    for (const readOnly of ['id', 'tripName', 'reportedByName', 'isOverdue24h', 'createdAt', 'updatedAt', 'resolvedAt', 'medicationContext']) expect(dto).not.toHaveProperty(readOnly)
  })
})
