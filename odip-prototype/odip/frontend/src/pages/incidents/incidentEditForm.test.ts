import { describe, it, expect } from 'vitest'
import type { IncidentDetailDto } from '@/api/types/incidents'
import { buildEditValues, followDefaultClass, stepsFor, toUpdateBody } from './incidentEditForm'

function seed(overrides: Partial<IncidentDetailDto> = {}): IncidentDetailDto {
  return {
    id: 'inc-1', serviceType: 'None', tripInstanceId: null, tripName: null, incidentType: 'Other', otherTypeSpecify: null,
    severity: 'Low', status: 'Open', title: 'A fall', incidentDateTime: '2026-04-04T08:00:00', location: 'Home',
    reportedByName: 'Mei', involvedParticipantId: 'p-1', involvedParticipantName: 'Grace', qscReportingStatus: 'NotRequired', isOverdue24h: false,
    createdAt: '2026-04-04T09:00:00Z', medicationAdministrationId: 'med-1', shiftId: 'shift-1', shiftNoteId: 'note-1',
    participantBookingId: 'book-1', involvedStaffId: null, involvedStaffName: null, reportedByStaffId: 'staff-1',
    restrictivePracticeType: null, restrictivePracticeId: null, restrictivePracticeDescription: null, restrictivePracticeReviewDate: null,
    unapprovedRestrictivePracticeDetails: null, isRestrictivePracticeAuthorised: null,
    description: 'Slipped.', immediateActionsTaken: 'Ice.', wereEmergencyServicesCalled: false, emergencyServicesDetails: null, emergencyServices: 'None',
    policeOfficerName: null, policeReference: null, ambulanceOfficerName: null, ambulanceReference: null, fireOfficerName: null, fireReference: null,
    witnessNames: null, witnessStatements: null,
    injuries: [{ region: 'Head', injuryType: 'Bruise', description: 'Left side' }],
    witnesses: [
      { id: 'w-1', witnessUserId: 'staff-2', witnessName: 'Sam', isStaffWitness: true, witnessStatus: 'Approved', witnessRequestedAt: '2026-04-04T10:00:00Z', witnessRespondedAt: '2026-04-04T11:00:00Z', statementText: 'I saw it.' },
      { id: 'w-2', witnessUserId: null, witnessName: 'Pat', isStaffWitness: false, witnessStatus: 'NotRequired', witnessRequestedAt: null, witnessRespondedAt: null, statementText: null },
    ],
    qscReportedAt: null, qscReferenceNumber: null, awareAt: '2026-04-04T16:30:30Z', reportableClass: 'None', reportableClassReason: null,
    notifyDueAt: null, detailedReportDueAt: null, dueCountedWithoutHolidays: false,
    commissionDetailedReportedAt: '2026-04-06T09:15:00', commissionFinalReportRequested: false, commissionFinalReportedAt: null, timeZoneId: 'Australia/Sydney',
    reviewedByStaffId: null, reviewedByName: null, reviewedAt: null, reviewNotes: null, correctiveActions: null, resolvedAt: null,
    familyNotified: true, familyNotifiedAt: '2026-04-05T08:30:00', supportCoordinatorNotified: false, supportCoordinatorNotifiedAt: null,
    updatedAt: '2026-04-05T01:02:03.4567890Z', medicationContext: null, shiftContext: null, shiftNoteContext: null,
    ...overrides,
  } as IncidentDetailDto
}

describe('incidentEditForm', () => {
  it('a witnesses save echoes every other witness id, the injuries, the links, participantBookingId, status and the commission dates', () => {
    const s = seed({ incidentType: 'Injury' })
    const body = toUpdateBody(s, { ...buildEditValues(s), witnesses: [{ existingId: 'w-1', witnessUserId: 'staff-2', witnessName: 'Sam' }, { witnessUserId: null, witnessName: 'New' }] }, 'witnesses')
    expect(body.witnesses).toEqual([{ id: 'w-1', witnessUserId: 'staff-2', witnessName: 'Sam' }, { id: undefined, witnessUserId: null, witnessName: 'New' }])
    expect(body.injuries).toEqual(s.injuries)
    expect([body.medicationAdministrationId, body.shiftId, body.shiftNoteId, body.participantBookingId]).toEqual(['med-1', 'shift-1', 'note-1', 'book-1'])
    expect(body.status).toBe('Open')
    expect(body.commissionDetailedReportedAt).toBe('2026-04-06T09:15')
    expect(body.familyNotified).toBe(true)
    expect(body.familyNotifiedAt).toBe('2026-04-05T08:30')
  })

  it('a removed witness id is absent and the rest keep their ids', () => {
    const s = seed()
    const v = buildEditValues(s)
    const body = toUpdateBody(s, { ...v, witnesses: v.witnesses!.filter((w) => w.existingId !== 'w-1') }, 'witnesses')
    expect(body.witnesses!.map((w) => w.id)).toEqual(['w-2'])
  })

  it('only compliance sends awareAtLocal and the class', () => {
    const s = seed({ reportableClass: 'Within24h' })
    const v = buildEditValues(s)
    for (const g of ['basics', 'details', 'rp', 'witnesses'] as const) {
      const b = toUpdateBody(s, v, g)
      expect([g, b.awareAtLocal, b.reportableClass, b.reportableClassReason]).toEqual([g, undefined, undefined, undefined])
    }
    const c = toUpdateBody(s, v, 'compliance')
    expect([c.awareAtLocal, c.reportableClass]).toEqual(['2026-04-05T02:30', 'Within24h'])
  })

  it('basics moves an untouched default class and keeps an override', () => {
    const untouched = seed({ severity: 'Low', reportableClass: 'None' })
    const toHigh = { ...buildEditValues(untouched), severity: 'Critical' }
    expect(followDefaultClass(untouched, toHigh)).toBe('Within24h')
    expect(toUpdateBody(untouched, toHigh, 'basics').reportableClass).toBe('Within24h')
    const overridden = seed({ severity: 'Low', reportableClass: 'Within24h', reportableClassReason: 'Judgement' })
    expect(followDefaultClass(overridden, { ...buildEditValues(overridden), severity: 'Critical' })).toBeUndefined()
    expect(followDefaultClass(untouched, buildEditValues(untouched))).toBeUndefined()
  })

  it('expectedUpdatedAt is the GET string byte for byte', () => {
    const s = seed()
    expect(toUpdateBody(s, buildEditValues(s), 'details').expectedUpdatedAt).toBe('2026-04-05T01:02:03.4567890Z')
  })

  it('type away from Injury sends injuries [] and away from RP sends no RP fields', () => {
    const inj = seed({ incidentType: 'Injury' })
    expect(toUpdateBody(inj, { ...buildEditValues(inj), incidentType: 'Other' }, 'basics').injuries).toEqual([])
    const rp = seed({ incidentType: 'RestrictivePracticeUse', restrictivePracticeType: 'PhysicalRestraint', unapprovedRestrictivePracticeDetails: 'Held arm' })
    const b = toUpdateBody(rp, { ...buildEditValues(rp), incidentType: 'Other' }, 'basics')
    expect([b.restrictivePracticeType, b.restrictivePracticeId, b.unapprovedRestrictivePracticeDetails]).toEqual([undefined, undefined, undefined])
  })

  it('a stored unauthorised use with a link seeds usedWithoutAuthorisation true', () => {
    const s = seed({ incidentType: 'RestrictivePracticeUse', restrictivePracticeId: 'rp-1', isRestrictivePracticeAuthorised: false })
    expect(buildEditValues(s).usedWithoutAuthorisation).toBe(true)
    expect(buildEditValues(seed({ incidentType: 'RestrictivePracticeUse', restrictivePracticeId: 'rp-1', isRestrictivePracticeAuthorised: true })).usedWithoutAuthorisation).toBe(false)
  })

  it('seeding and mapping keeps the aware minute and the compliance dates', () => {
    const s = seed()
    const v = buildEditValues(s)
    expect(toUpdateBody(s, v, 'compliance').awareAtLocal).toBe('2026-04-05T02:30')
    expect(toUpdateBody(s, v, 'compliance').commissionDetailedReportedAt).toBe('2026-04-06T09:15')
    expect(toUpdateBody(s, v, 'witnesses').awareAtLocal).toBeUndefined()
  })

  it('stepsFor widens the basics group for a type that needs another group, and narrows back', () => {
    const s = seed()
    const v = buildEditValues(s)
    expect(stepsFor('basics', s, v)).toEqual(['basics'])
    expect(stepsFor('basics', s, { ...v, incidentType: 'Injury' })).toEqual(['details', 'basics'])
    expect(stepsFor('basics', s, { ...v, incidentType: 'RestrictivePracticeUse' })).toEqual(['basics', 'rp'])
    const rp = seed({ incidentType: 'RestrictivePracticeUse' })
    expect(stepsFor('basics', rp, { ...buildEditValues(rp), involvedParticipantId: 'p-2' })).toEqual(['basics', 'rp'])
    expect(stepsFor('basics', rp, buildEditValues(rp))).toEqual(['basics'])
    expect(stepsFor('details', s, v)).toEqual(['details'])
  })
})
