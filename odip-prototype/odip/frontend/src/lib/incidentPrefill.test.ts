import { describe, it, expect } from 'vitest'
import {
  isIncidentTriggerOutcome,
  isMarIncidentPrefillState,
  buildIncidentTitleSkeleton,
  suggestedIncidentSeverity,
  previewRpAuthorisation,
  isRpAuthorised,
  buildRpIncidentDescriptionSkeleton,
  buildMarIncidentPrefill,
  type MarIncidentPrefillState,
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

// The one "Authorised" rule (owner decision 2026-10-14), the frontend twin of the backend's RestrictivePracticeAuthorisation.IsAuthorised:
// active, with who authorised it and when.
describe('isRpAuthorised', () => {
  const entry = { isActive: true, authorisedBy: 'Dr Chen', authorisationDate: '2026-09-01' }

  it('is true for an active entry with who authorised it and when', () => {
    expect(isRpAuthorised(entry)).toBe(true)
  })

  it('is false for an inactive entry', () => {
    expect(isRpAuthorised({ ...entry, isActive: false })).toBe(false)
  })

  it.each([null, '', '   '])('is false when "Authorised by" is %j', (authorisedBy) => {
    expect(isRpAuthorised({ ...entry, authorisedBy })).toBe(false)
  })

  it('is false with no authorisation date', () => {
    expect(isRpAuthorised({ ...entry, authorisationDate: null })).toBe(false)
  })
})

// INC-04: mirrors IncidentsController.DetermineRestrictivePracticeAuthorisationAsync step for step, so the banner shows what the server will store.
describe('previewRpAuthorisation', () => {
  const authorised = { id: 'rp-a', type: 'Seclusion' as const, isActive: true, authorisedBy: 'Dr Chen', authorisationDate: '2026-09-01' }
  const notAuthorised = { id: 'rp-n', type: 'Seclusion' as const, isActive: true, authorisedBy: null, authorisationDate: null }
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
