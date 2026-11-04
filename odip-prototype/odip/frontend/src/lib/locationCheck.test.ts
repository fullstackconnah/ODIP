import { describe, expect, it } from 'vitest'
import { formatDistanceMetres, locationCheckLine } from './locationCheck'

type Fields = Parameters<typeof locationCheckLine>[0]
const line = (locationCheck: Fields['locationCheck'], over: Partial<Fields> = {}) =>
  locationCheckLine({ locationCheck, locationDistanceMetres: null, locationAccuracyMetres: null, locationReason: null, ...over })

describe('formatDistanceMetres', () => {
  it.each([[0, '0 m'], [850, '850 m'], [999, '999 m'], [1000, '1 km'], [1200, '1.2 km'], [12_340, '12.3 km']])('%d is %s', (m, text) => {
    expect(formatDistanceMetres(m)).toBe(text)
  })
})

describe('locationCheckLine (plan 6.4 table)', () => {
  it('at location, with and without accuracy', () => {
    expect(line('AtLocation', { locationDistanceMetres: 40, locationAccuracyMetres: 15 })).toBe('At location (40 m, accuracy 15 m).')
    expect(line('AtLocation', { locationDistanceMetres: 40 })).toBe('At location (40 m).')
  })

  it('not at location, with and without a reason', () => {
    expect(line('NotAtLocation', { locationDistanceMetres: 850, locationReason: 'Parked round the corner' })).toBe('Not at location (850 m away): Parked round the corner')
    expect(line('NotAtLocation', { locationDistanceMetres: 850 })).toBe('Not at location (850 m away). No reason given.')
    expect(line('NotAtLocation', { locationDistanceMetres: 1200, locationReason: '  ' })).toBe('Not at location (1.2 km away). No reason given.')
  })

  it('unavailable, with and without a reason', () => {
    expect(line('Unavailable', { locationReason: 'Started offline' })).toBe('Location not available: Started offline')
    expect(line('Unavailable')).toBe('Location not available. No reason given.')
  })

  it('says nothing when no place was set or the check never ran', () => {
    expect(line('NoLocationSet')).toBeNull()
    expect(line(null)).toBeNull()
    expect(line(undefined)).toBeNull()
  })
})
