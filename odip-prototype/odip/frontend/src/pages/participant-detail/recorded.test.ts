import { describe, it, expect } from 'vitest'
import { meansNothing } from './recorded'

describe('meansNothing', () => {
  it.each([
    'Nil', 'nil', 'none.', 'None', 'N/A', 'na', '-', '', null, '  ', 'NKA', 'nkda.', 'nil known', 'None known.',
    'No known allergies', 'No known drug allergies', 'no known food allergy', 'No known conditions', 'No known issues.',
  ])('treats %j as nothing', (v) => {
    expect(meansNothing(v)).toBe(true)
  })

  it.each([
    'Nil by mouth', 'Nil orally – PEG fed', 'No known allergies except penicillin', 'None of the above; chokes on bread',
    'No known swallowing risk', 'not applicable', 'Peanuts',
  ])('raises a flag for %j', (v) => {
    expect(meansNothing(v)).toBe(false)
  })
})
