import { describe, it, expect } from 'vitest'
import { healthAdviceLine, telHref, POISONS_INFO_PHONE, EMERGENCY_PHONE, PACKAGING_CHECK_LABEL } from './missedMedicationGuidance'

describe('healthAdviceLine', () => {
  it('returns Nurse-on-Call (VIC) as primary, with the national line as fallback, for VIC', () => {
    const result = healthAdviceLine('VIC')
    expect(result.primary).toEqual({ label: 'Nurse-on-Call (VIC)', phone: '1300 60 60 24' })
    expect(result.fallback).toEqual({ label: 'National health advice line', phone: '1800 022 222' })
  })

  it('is case-insensitive and tolerates surrounding whitespace for VIC', () => {
    const result = healthAdviceLine('  vic  ')
    expect(result.primary.phone).toBe('1300 60 60 24')
  })

  it('returns only the national line for a non-VIC state, with no fallback', () => {
    const result = healthAdviceLine('NSW')
    expect(result.primary).toEqual({ label: 'National health advice line', phone: '1800 022 222' })
    expect(result.fallback).toBeUndefined()
  })

  it('returns only the national line when state is unset', () => {
    expect(healthAdviceLine(null).primary.phone).toBe('1800 022 222')
    expect(healthAdviceLine(undefined).primary.phone).toBe('1800 022 222')
    expect(healthAdviceLine('').primary.phone).toBe('1800 022 222')
  })

  it('never labels a non-VIC number as Nurse-on-Call', () => {
    const result = healthAdviceLine('QLD')
    expect(result.primary.label).not.toMatch(/nurse-on-call/i)
  })
})

describe('telHref', () => {
  it('strips spaces from a spaced phone number', () => {
    expect(telHref('1300 60 60 24')).toBe('tel:1300606024')
  })

  it('leaves an already-compact number unchanged', () => {
    expect(telHref('000')).toBe('tel:000')
  })
})

describe('constants', () => {
  it('exposes the verified Poisons Information Centre and emergency numbers', () => {
    expect(POISONS_INFO_PHONE).toBe('13 11 26')
    expect(EMERGENCY_PHONE).toBe('000')
  })

  it('provides a packaging-check label for every PackagingType', () => {
    expect(PACKAGING_CHECK_LABEL.WebsterPack).toMatch(/webster pack/i)
    expect(PACKAGING_CHECK_LABEL.DosetteBox).toMatch(/dosette box/i)
    expect(PACKAGING_CHECK_LABEL.OriginalPackaging).toMatch(/original packaging/i)
    expect(PACKAGING_CHECK_LABEL.Sachet).toMatch(/sachet/i)
    expect(PACKAGING_CHECK_LABEL.Other).toMatch(/packaging/i)
  })
})
