import { describe, expect, it } from 'vitest'
import { DETAIL_KEYS, detailLabel, missingDetails, type DetailsForm } from './checklist'

/** The same case table as the server's ShiftDetailsRulesTests (C9, "not required", is server only). */
const answered: DetailsForm = {
  kilometres: 0, preMinutes: 20, preKm: 5, preNone: false, postMinutes: 20, postKm: 5, postNone: false,
  handoverText: 'Quiet day.', nothingToHandOver: false, nothingToNote: false, anythingToReport: false,
}
const ctx = { travelAsked: true, hasNote: true }
const nothing: DetailsForm = {
  kilometres: null, preMinutes: null, preKm: null, preNone: false, postMinutes: null, postKm: null, postNone: false,
  handoverText: '', nothingToHandOver: false, nothingToNote: false, anythingToReport: null,
}

describe('missingDetails', () => {
  it.each([
    ['C1 all answered', answered, ctx, []],
    ['C2 km null', { ...answered, kilometres: null }, ctx, ['kilometres']],
    ['C3 pre minutes only', { ...answered, preKm: null }, ctx, ['tripTo']],
    ['C4 post No trip, no values', { ...answered, postMinutes: null, postKm: null, postNone: true }, ctx, []],
    ['C5 travel not asked, legs null', { ...answered, preMinutes: null, preKm: null, postMinutes: null, postKm: null }, { ...ctx, travelAsked: false }, []],
    ['C6a no note, not confirmed', answered, { ...ctx, hasNote: false }, ['notes']],
    ['C6b no note, confirmed', { ...answered, nothingToNote: true }, { ...ctx, hasNote: false }, []],
    ['C7a handover blank', { ...answered, handoverText: '  ' }, ctx, ['handover']],
    ['C7b handover nothing ticked', { ...answered, handoverText: '', nothingToHandOver: true }, ctx, []],
    ['C8 report null', { ...answered, anythingToReport: null }, ctx, ['report']],
    ['C10 everything missing', nothing, { ...ctx, hasNote: false }, ['kilometres', 'tripTo', 'tripAfter', 'notes', 'handover', 'report']],
  ] as const)('%s', (_name, form, c, expected) => {
    expect(missingDetails(form, c)).toEqual(expected)
  })

  it('lists in DETAIL_KEYS order and words every key', () => {
    expect(missingDetails(nothing, { travelAsked: true, hasNote: false })).toEqual([...DETAIL_KEYS])
    expect(DETAIL_KEYS.map(k => detailLabel(k, 'Amy'))).toEqual(['kilometres', 'trip to Amy', 'trip after the shift', 'notes', 'handover', 'anything to report'])
  })
})
