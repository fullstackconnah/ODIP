import { describe, expect, it } from 'vitest'
import { agreementLabel, isPlainAgreement, KIND_LABEL, KIND_ORDER } from './agreementKind'

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
