import { describe, expect, it } from 'vitest'
import { NDIA_FUNDS_CODES, ndiaCodeMeaning, ndiaFundsNote } from './ndiaCodes'

// The NDIA's four "the funds ran out" codes and what they mean, in one place for the dialog that asks for one and the page that prints one.

describe('ndiaCodeMeaning', () => {
  it.each([
    ['V17', 'not enough in the plan'], ['V18', 'not enough in the plan'], ['V27', 'not enough in the funding period'], ['V28', 'not enough in the funding period'],
  ])('says %s means: %s', (code, meaning) => {
    expect(ndiaCodeMeaning(code)).toBe(meaning)
  })

  it('has no meaning for any other code, so none is made up', () => {
    expect(ndiaCodeMeaning('E104')).toBeNull()
    expect(ndiaCodeMeaning('v27')).toBeNull()   // the server stores the four in capitals
    expect(ndiaCodeMeaning('')).toBeNull()
  })

  it('lists exactly the four codes the server treats as the funds running out', () => {
    expect(NDIA_FUNDS_CODES.map(entry => entry.code)).toEqual(['V17', 'V18', 'V27', 'V28'])
  })
})

// The Funding tab's note and the alert say it in one sentence, with one colon: which of the two ran out (the plan or the funding period), then the code.
describe('ndiaFundsNote', () => {
  it.each([
    ['V17', 'not enough funds in the plan (V17)'], ['V18', 'not enough funds in the plan (V18)'],
    ['V27', 'not enough funds in the funding period (V27)'], ['V28', 'not enough funds in the funding period (V28)'],
  ])('says %s as: %s', (code, note) => {
    expect(ndiaFundsNote(code)).toBe(note)
  })

  it('says only that the funds ran out, with the code as it was, for a code it has no scope for', () => {
    expect(ndiaFundsNote('E104')).toBe('not enough funds (E104)')
  })
})
