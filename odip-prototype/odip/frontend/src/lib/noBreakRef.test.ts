import { describe, expect, it } from 'vitest'
import { noBreakRefs } from './noBreakRef'

describe('noBreakRefs', () => {
  it('makes the hyphens of claim and invoice references non-breaking, and leaves other text alone', () => {
    expect(noBreakRefs('Void INV-0042 first, then delete TC-20261022-0003. Re-check it.')).toBe('Void INV\u20110042 first, then delete TC\u201120261022\u20110003. Re-check it.')
  })
})
