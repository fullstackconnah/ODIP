import { describe, expect, it } from 'vitest'
import { NDIA_FUNDS_CODES, ndiaCodeMeaning } from './ndiaCodes'

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
