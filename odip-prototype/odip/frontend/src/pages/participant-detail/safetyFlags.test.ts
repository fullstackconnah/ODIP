import { describe, it, expect } from 'vitest'
import { safetyFlags, unansweredSafetyFields } from './safetyFlags'

const none = { isAnaphylaxisRisk: null, allergiesDetail: null, chokingRiskMealDetail: null, fallsRiskRating: null, behaviourRiskRating: null, hasRestrictivePracticeFlag: false }
const all = { isAnaphylaxisRisk: true, allergiesDetail: 'Peanuts', chokingRiskMealDetail: 'Needs cut-up food', fallsRiskRating: 'High', behaviourRiskRating: 'Critical', hasRestrictivePracticeFlag: true } as const
const labels = (p: Parameters<typeof safetyFlags>[0]) => safetyFlags(p).map(f => f.label)

describe('safetyFlags', () => {
  it('gives exactly 5 chips in order when everything triggers (Allergies is replaced by Anaphylaxis)', () => {
    expect(labels(all)).toEqual(['Anaphylaxis risk', 'Choking risk', 'Falls risk: High', 'Behaviour risk: Critical', 'Restrictive practices'])
  })

  it('shows Allergies in slot 2 when there is no anaphylaxis flag', () => {
    expect(labels({ ...all, isAnaphylaxisRisk: false })).toEqual(['Allergies', 'Choking risk', 'Falls risk: High', 'Behaviour risk: Critical', 'Restrictive practices'])
  })

  it('shows the allergen on the Anaphylaxis flag, since Allergies is hidden then', () => {
    expect(safetyFlags(all)[0].detail).toBe('Peanuts')
    expect(safetyFlags({ ...all, allergiesDetail: '  Peanuts ' })[0].detail).toBe('Peanuts')
  })

  it('falls back to a plain line on the Anaphylaxis flag when allergies are blank or "Nil"', () => {
    expect(safetyFlags({ ...all, allergiesDetail: '' })[0].detail).toBe('Anaphylaxis risk recorded')
    expect(safetyFlags({ ...all, allergiesDetail: 'Nil' })[0].detail).toBe('Anaphylaxis risk recorded')
  })

  it('flags High as negative and Critical as danger, and never Low or Medium', () => {
    const tones = Object.fromEntries(safetyFlags(all).map(f => [f.key, f.tone]))
    expect(tones.falls).toBe('negative')
    expect(tones.behaviour).toBe('danger')
    expect(tones.anaphylaxis).toBe('danger')
    expect(labels({ ...none, fallsRiskRating: 'Low', behaviourRiskRating: 'Medium' })).toEqual([])
  })

  it('raises Choking for "Nil by mouth" and "No known swallowing risk", not for "None." or "Nil"', () => {
    expect(labels({ ...none, chokingRiskMealDetail: 'Nil by mouth' })).toEqual(['Choking risk'])
    expect(labels({ ...none, chokingRiskMealDetail: 'No known swallowing risk' })).toEqual(['Choking risk'])
    expect(labels({ ...none, chokingRiskMealDetail: 'None.' })).toEqual([])
    expect(labels({ ...none, chokingRiskMealDetail: 'Nil' })).toEqual([])
  })

  it('raises Allergies for "No known allergies except penicillin"', () => {
    expect(labels({ ...none, allergiesDetail: 'No known allergies except penicillin' })).toEqual(['Allergies'])
  })

  it('links each chip to its home section', () => {
    const links = Object.fromEntries(safetyFlags(all).map(f => [f.key, `${f.tab}#${f.hash}`]))
    expect(links).toEqual({
      anaphylaxis: 'health#medical', choking: 'daily#meals', falls: 'daily#mobility-and-personal-care',
      behaviour: 'health#behaviour-and-communication', restrictive: 'health#restrictive-practices',
    })
  })
})

describe('unansweredSafetyFields', () => {
  it('lists all five for an all-null participant', () => {
    expect(unansweredSafetyFields(none)).toEqual(['Anaphylaxis risk', 'Allergies', 'Choking risk', 'Falls risk', 'Behaviour risk'])
  })

  it('counts "Nil" as answered', () => {
    expect(unansweredSafetyFields({ ...none, allergiesDetail: 'Nil', chokingRiskMealDetail: 'None.' })).toEqual(['Anaphylaxis risk', 'Falls risk', 'Behaviour risk'])
  })
})
