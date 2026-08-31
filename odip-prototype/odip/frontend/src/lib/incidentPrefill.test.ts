import { describe, it, expect } from 'vitest'
import {
  isIncidentTriggerOutcome,
  isMarIncidentPrefillState,
  buildIncidentTitleSkeleton,
  suggestedIncidentSeverity,
  previewRpAuthorisation,
  buildRpIncidentDescriptionSkeleton,
  type MarIncidentPrefillState,
} from './incidentPrefill'

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
      participantName: 'Sophie Brown', medicationName: 'Levetiracetam',
    })
    expect(title).toBe('Refused — Levetiracetam (Sophie Brown)')
  })
})

// INC-04: mirrors IncidentsController.DetermineRestrictivePracticeAuthorisationAsync — the list
// passed in is assumed to already be the participant's ACTIVE practices (that's what
// useRestrictivePractices returns by default), so this only needs to filter by type.
describe('previewRpAuthorisation', () => {
  it('is "unknown" when no participant is selected', () => {
    expect(previewRpAuthorisation(undefined, 'Seclusion', [{ type: 'Seclusion' }])).toBe('unknown')
  })

  it('is "unknown" when no type is selected', () => {
    expect(previewRpAuthorisation('participant-1', undefined, [{ type: 'Seclusion' }])).toBe('unknown')
  })

  it('is "authorised" when an active practice of the matching type is present', () => {
    expect(previewRpAuthorisation('participant-1', 'Seclusion', [{ type: 'Seclusion' }, { type: 'PhysicalRestraint' }])).toBe('authorised')
  })

  it('is "unauthorised" when no active practice matches the type', () => {
    expect(previewRpAuthorisation('participant-1', 'Seclusion', [{ type: 'PhysicalRestraint' }])).toBe('unauthorised')
  })

  it('is "unauthorised" when the participant has no active practices at all', () => {
    expect(previewRpAuthorisation('participant-1', 'Seclusion', [])).toBe('unauthorised')
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
