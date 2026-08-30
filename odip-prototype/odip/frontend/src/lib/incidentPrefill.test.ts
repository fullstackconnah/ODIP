import { describe, it, expect } from 'vitest'
import {
  isIncidentTriggerOutcome,
  isMarIncidentPrefillState,
  buildIncidentTitleSkeleton,
  suggestedIncidentSeverity,
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
