import { describe, it, expect } from 'vitest'
import {
  isIncidentTriggerOutcome,
  isMarIncidentPrefillState,
  buildIncidentTitleSkeleton,
  suggestedIncidentSeverity,
  previewRpAuthorisation,
  isRpAuthorisedOn,
  isRpAuthorised,
  editedRpAuthorisation,
  buildRpIncidentDescriptionSkeleton,
  buildMarIncidentPrefill,
  type MarIncidentPrefillState,
  isShiftIncidentPrefillState,
  buildShiftIncidentTitleSkeleton,
  buildShiftIncidentDescriptionSkeleton,
  incidentReturnPath,
  type ShiftIncidentPrefillState,
} from './incidentPrefill'
import type { AdministrationDto } from '@/api/types/medications'

// MED-03/INC-03 controller ruling: "wrong medication administered" IS an auto-incident trigger
// alongside refused/withheld/missed — Administered (a normal successful dose) is not.
describe('isIncidentTriggerOutcome', () => {
  it.each([
    ['Refused', true],
    ['Withheld', true],
    ['Missed', true],
    ['WrongMedication', true],
    ['Administered', false],
  ] as const)('%s -> %s', (outcome, expected) => {
    expect(isIncidentTriggerOutcome(outcome)).toBe(expected)
  })
})

describe('isMarIncidentPrefillState', () => {
  it('accepts a well-formed MAR prefill state', () => {
    const state: MarIncidentPrefillState = {
      source: 'mar-administration',
      outcome: 'Missed',
      participantId: 'p1',
      participantName: 'Sophie Brown',
      medicationName: 'Levetiracetam',
      medicationAdministrationId: 'admin-1',
    }
    expect(isMarIncidentPrefillState(state)).toBe(true)
  })

  it.each([
    [undefined],
    [null],
    ['a string'],
    [{}],
    [{ source: 'something-else' }],
  ])('rejects %j', (value) => {
    expect(isMarIncidentPrefillState(value)).toBe(false)
  })
})

describe('suggestedIncidentSeverity', () => {
  it('suggests High for a wrong medication, Medium for everything else', () => {
    expect(suggestedIncidentSeverity('WrongMedication')).toBe('High')
    expect(suggestedIncidentSeverity('Refused')).toBe('Medium')
    expect(suggestedIncidentSeverity('Withheld')).toBe('Medium')
    expect(suggestedIncidentSeverity('Missed')).toBe('Medium')
  })
})

describe('buildIncidentTitleSkeleton', () => {
  it('names the outcome, medication and participant', () => {
    const title = buildIncidentTitleSkeleton({
      source: 'mar-administration', outcome: 'Refused', participantId: 'p1',
      participantName: 'Sophie Brown', medicationName: 'Levetiracetam', medicationAdministrationId: 'admin-1',
    })
    expect(title).toBe('Refused — Levetiracetam (Sophie Brown)')
  })
})

// Connection map: buildMarIncidentPrefill is the ONE place an AdministrationDto becomes a
// MarIncidentPrefillState — RecordAdministrationModal, MarTab's scheduled rows and
// participant-detail/MedicationsTab's administration-history rows all call this instead of each
// hand-assembling the shape, so drift between the three "File incident" entry points can't happen.
describe('buildMarIncidentPrefill', () => {
  function administration(overrides: Partial<AdministrationDto> = {}): AdministrationDto {
    return {
      id: 'admin-7', participantMedicationId: 'med-1', participantId: 'participant-1', participantName: 'Sophie Brown',
      medicationName: 'Levetiracetam', doseDescription: '1 tablet', tripInstanceId: null,
      scheduledAt: '2026-09-01T22:00:00Z', administeredAt: '2026-09-01T22:10:00Z', administeredAtTimeZone: 'Australia/Brisbane',
      status: 'Missed', doseGiven: null, recordedByName: 'Alex Rivera', recordedByUserId: 'staff-1',
      witnessName: null, witnessStaffId: null, witnessStatus: 'NotRequired', witnessRequestedAt: null, witnessRespondedAt: null,
      reason: 'Participant was asleep at the scheduled time.', prnReason: null, prnOutcome: null, prnOutcomeAt: null,
      limitBreachAcknowledged: false, notes: null, createdAt: '2026-09-01T22:15:00Z', recordedWithoutCompetency: false, incidentId: null,
      ...overrides,
    }
  }

  it('carries the administration\'s own fields straight through, keyed by its id', () => {
    const prefill = buildMarIncidentPrefill(administration())

    expect(prefill).toEqual({
      source: 'mar-administration',
      outcome: 'Missed',
      participantId: 'participant-1',
      participantName: 'Sophie Brown',
      medicationName: 'Levetiracetam',
      strength: null,
      doseDescription: '1 tablet',
      scheduledAt: '2026-09-01T22:00:00Z',
      administeredAt: '2026-09-01T22:10:00Z',
      administeredAtTimeZone: 'Australia/Brisbane',
      recordedByName: 'Alex Rivera',
      recordedByUserId: 'staff-1',
      reason: 'Participant was asleep at the scheduled time.',
      notes: null,
      tripInstanceId: null,
      medicationAdministrationId: 'admin-7',
    })
  })

  it('threads extras.strength through when supplied (the one field the administration record itself does not carry)', () => {
    const prefill = buildMarIncidentPrefill(administration(), { strength: '500mg' })
    expect(prefill.strength).toBe('500mg')
  })

  it('carries notes through only for a WrongMedication outcome', () => {
    const wrongMed = buildMarIncidentPrefill(administration({ status: 'WrongMedication', notes: 'Gave Paracetamol 500mg instead' }))
    expect(wrongMed.notes).toBe('Gave Paracetamol 500mg instead')

    const refused = buildMarIncidentPrefill(administration({ status: 'Refused', notes: 'Unrelated free-text note' }))
    expect(refused.notes).toBeNull()
  })
})

// The server decides "Authorised" (RestrictivePracticeAuthorisation.IsAuthorised: active, who and when, dated on or before the organisation's today)
// and sends it as `isAuthorised`. The browser reads it, so even a fully filled-in entry reads Not authorised when the server says so.
describe('isRpAuthorised', () => {
  it.each([true, false])('returns the server verdict %j, whatever the dates say', (isAuthorised) => {
    expect(isRpAuthorised({ isAuthorised })).toBe(isAuthorised)
  })

  it('does not recompute from the dates: a filled-in, future-dated entry the server calls Not authorised stays so', () => {
    const entry = { isActive: true, authorisedBy: 'Dr Chen', authorisationDate: '2099-01-01', isAuthorised: false }
    expect(isRpAuthorised(entry)).toBe(false)
  })
})

describe('isRpAuthorisedOn', () => {
  const entry = { isAuthorised: false, isActive: true, authorisedBy: 'Dr Chen', authorisationDate: '2026-09-01', authorisationEndDate: '2026-10-30' }

  it('is the server verdict when there is no incident date', () => {
    expect(isRpAuthorisedOn(entry)).toBe(false)
    expect(isRpAuthorisedOn({ ...entry, isAuthorised: true }, '')).toBe(true)
  })

  it.each([['2026-08-31', false], ['2026-09-01', true], ['2026-10-30', true], ['2026-10-31', false]])('judges %s on the incident date, the end date inclusive: %s', (date, expected) => {
    expect(isRpAuthorisedOn(entry, date)).toBe(expected)
  })

  it('needs who authorised it and an active entry', () => {
    expect(isRpAuthorisedOn({ ...entry, authorisedBy: ' ' }, '2026-10-01')).toBe(false)
    expect(isRpAuthorisedOn({ ...entry, isActive: false }, '2026-10-01')).toBe(false)
  })
})

// INC-04: mirrors IncidentsController.DetermineRestrictivePracticeAuthorisationAsync step for step, so the banner shows what the server will store.
describe('previewRpAuthorisation', () => {
  const authorised = { id: 'rp-a', type: 'Seclusion' as const, isActive: true, isAuthorised: true }
  const notAuthorised = { id: 'rp-n', type: 'Seclusion' as const, isActive: true, isAuthorised: false }
  const otherType = { ...authorised, id: 'rp-o', type: 'PhysicalRestraint' as const }

  it('is "unknown" when no participant is selected', () => {
    expect(previewRpAuthorisation(undefined, 'Seclusion', [authorised])).toBe('unknown')
  })

  it('is "unknown" when no type is selected', () => {
    expect(previewRpAuthorisation('participant-1', undefined, [authorised])).toBe('unknown')
  })

  it('is "authorised" when nothing is chosen yet and an Authorised entry of the type is present', () => {
    expect(previewRpAuthorisation('participant-1', 'Seclusion', [authorised, otherType])).toBe('authorised')
  })

  it('is "unauthorised" when the only entry of the type is active but has no authorisation details', () => {
    expect(previewRpAuthorisation('participant-1', 'Seclusion', [notAuthorised])).toBe('unauthorised')
  })

  it('is "unauthorised" when no entry matches the type', () => {
    expect(previewRpAuthorisation('participant-1', 'Seclusion', [otherType])).toBe('unauthorised')
  })

  it('is "unauthorised" when the participant has no entries at all', () => {
    expect(previewRpAuthorisation('participant-1', 'Seclusion', [])).toBe('unauthorised')
  })

  it('follows the linked entry, not the rest of the type', () => {
    expect(previewRpAuthorisation('participant-1', 'Seclusion', [authorised, notAuthorised], { restrictivePracticeId: 'rp-n' })).toBe('unauthorised')
    expect(previewRpAuthorisation('participant-1', 'Seclusion', [authorised, notAuthorised], { restrictivePracticeId: 'rp-a' })).toBe('authorised')
  })

  it('is "unauthorised" for "None of these", whatever is on the register', () => {
    expect(previewRpAuthorisation('participant-1', 'Seclusion', [authorised], { unapproved: true })).toBe('unauthorised')
  })

  it('is "unauthorised" when the use was not authorised, even with an Authorised entry linked', () => {
    expect(previewRpAuthorisation('participant-1', 'Seclusion', [authorised], { restrictivePracticeId: 'rp-a', usedWithoutAuthorisation: true })).toBe('unauthorised')
  })
})

describe('buildRpIncidentDescriptionSkeleton', () => {
  it('includes the linked practice description and review date', () => {
    const skeleton = buildRpIncidentDescriptionSkeleton({ description: 'Locked room during acute crisis.', reviewDate: '2026-12-01' })
    expect(skeleton).toContain('Locked room during acute crisis.')
    expect(skeleton).toContain('01/12/2026')
  })

  it('omits the review date line when there is none on record', () => {
    const skeleton = buildRpIncidentDescriptionSkeleton({ description: 'Locked room during acute crisis.', reviewDate: null })
    expect(skeleton).not.toContain('review due')
    expect(skeleton).toContain('Locked room during acute crisis.')
  })
})

// Review N1/M1: what an edit will store, mirroring IncidentsController.Update: it only ever lowers the stored flag.
describe('editedRpAuthorisation', () => {
  it('keeps the stored value when nothing lowers it', () => {
    expect(editedRpAuthorisation(true, false, { restrictivePracticeId: 'rp-a' })).toBe(true)
    expect(editedRpAuthorisation(undefined, false, { restrictivePracticeId: 'rp-a' })).toBeNull()
  })

  it('lowers to false for a ticked "This use was not authorised" with a link', () => {
    expect(editedRpAuthorisation(true, false, { restrictivePracticeId: 'rp-a', usedWithoutAuthorisation: true })).toBe(false)
  })

  it('lowers to false on the switch to "None of these", but not for an incident that already described one', () => {
    expect(editedRpAuthorisation(true, false, { unapproved: true })).toBe(false)
    expect(editedRpAuthorisation(true, true, { unapproved: true })).toBe(true)
  })
})

describe('the shift prefill (My shifts: "Anything to report?")', () => {
  const p: ShiftIncidentPrefillState = {
    source: 'shift', shiftId: 'shift-9', participantId: 'participant-1', participantName: 'Sophie Brown',
    serviceDate: '2026-08-17', startTime: '09:00:00', endTime: '17:00:00', endsNextDay: false, reportedByUserId: 'staff-1',
    returnTo: '/portal/shifts/shift-9',
  }
  it('is told apart from the other prefills', () => {
    expect(isShiftIncidentPrefillState(p)).toBe(true)
    expect(isShiftIncidentPrefillState({ source: 'shift-note' })).toBe(false)
    expect(isShiftIncidentPrefillState(null)).toBe(false)
  })
  it('seeds a title and a description with the shift, for the worker to finish', () => {
    expect(buildShiftIncidentTitleSkeleton(p)).toBe('Incident during shift — Sophie Brown')
    expect(buildShiftIncidentDescriptionSkeleton(p)).toContain("During Sophie Brown's shift on Monday 17 August")
  })
  it('returns only to a portal shift, never to anywhere a state could name', () => {
    expect(incidentReturnPath(p)).toBe('/portal/shifts/shift-9')
    expect(incidentReturnPath({ ...p, returnTo: 'https://evil.example' })).toBe('/incidents')
    expect(incidentReturnPath({ source: 'mar-administration' })).toBe('/incidents')
    expect(incidentReturnPath(null)).toBe('/incidents')
  })
})
