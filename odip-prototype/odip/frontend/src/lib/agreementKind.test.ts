import { describe, expect, it } from 'vitest'
import { agreementLabel, isPlainAgreement, KIND_LABEL, KIND_ORDER, splitAgreementFieldErrors } from './agreementKind'

describe('agreementKind', () => {
  it('labels a kind neutrally, never "Core"', () => {
    expect(KIND_LABEL.Core).toBe('Everyday support')
    expect(KIND_ORDER[KIND_ORDER.length - 1]).toBe('Other')
  })

  it('prefers the trimmed name over the kind label', () => {
    expect(agreementLabel({ agreementKind: 'Trip', agreementName: '  Trip to Cairns ' })).toBe('Trip to Cairns')
    expect(agreementLabel({ agreementKind: 'Trip', agreementName: '   ' })).toBe('Trip')
    expect(agreementLabel({ agreementKind: 'NightSupport' })).toBe('Night support')
  })

  it('treats only an unnamed Core agreement as plain', () => {
    expect(isPlainAgreement({ agreementKind: 'Core', agreementName: null })).toBe(true)
    expect(isPlainAgreement({ agreementKind: 'Core', agreementName: 'Main' })).toBe(false)
    expect(isPlainAgreement({ agreementKind: 'Trip' })).toBe(false)
  })
})

describe('splitAgreementFieldErrors', () => {
  it('moves the type and name refusals to their fields and leaves the rest', () => {
    const out = splitAgreementFieldErrors(['Choose the agreement type.', 'Keep the agreement name to 80 characters.', 'A block is wrong.'])
    expect(out).toEqual({ kind: 'Choose the agreement type.', name: 'Keep the agreement name to 80 characters.', rest: ['A block is wrong.'] })
    expect(splitAgreementFieldErrors(['Choose an agreement type from the list.']).kind).toBe('Choose an agreement type from the list.')
    expect(splitAgreementFieldErrors(['The agreement name has a control character.']).name).toMatch(/agreement name/)
  })
})
