import { describe, it, expect } from 'vitest'
import type { CompatibilityLevel } from '@/api/types'
import { compareCompatibility, compatibilityTier } from './compatibilityOrder'

type Row = { name: string; level?: CompatibilityLevel; rank?: number }
const sorted = (rows: Row[]) => [...rows].sort(compareCompatibility).map(r => r.name)

// Mirrors backend Odip.Tests/Rostering/CompatibilityOrderTests.
describe('compatibilityOrder', () => {
  it('runs Preferred, Backup, Emergency, unlisted, then No last, not by the level name', () => {
    const order = sorted([
      { name: 'excluded', level: 'Excluded' },
      { name: 'allowed', level: 'Allowed' },
      { name: 'norow' },
      { name: 'emergency', level: 'Emergency', rank: 1 },
      { name: 'backup', level: 'Backup', rank: 1 },
      { name: 'preferred', level: 'Preferred', rank: 1 },
    ])
    expect(order.slice(0, 3)).toEqual(['preferred', 'backup', 'emergency'])
    expect(order.slice(3, 5)).toEqual(['allowed', 'norow'])
    expect(order[5]).toBe('excluded')
  })

  it('inside a tier the rank decides, then the name', () => {
    expect(sorted([
      { name: 'Zed', level: 'Backup', rank: 1 },
      { name: 'Amy', level: 'Backup', rank: 2 },
      { name: 'Bea', level: 'Backup', rank: 2 },
    ])).toEqual(['Zed', 'Amy', 'Bea'])
  })

  it('a rank of 0 or less (never ranked) goes last in its tier', () => {
    expect(sorted([
      { name: 'Unranked', level: 'Preferred', rank: 0 },
      { name: 'Negative', level: 'Preferred', rank: -1 },
      { name: 'Second', level: 'Preferred', rank: 2 },
      { name: 'First', level: 'Preferred', rank: 1 },
      { name: 'Backup', level: 'Backup', rank: 1 },
    ])).toEqual(['First', 'Second', 'Negative', 'Unranked', 'Backup'])
  })

  it('numbers the tiers', () => {
    const levels: CompatibilityLevel[] = ['Preferred', 'Backup', 'Emergency', 'Allowed', 'Excluded']
    expect(levels.map(compatibilityTier)).toEqual([0, 1, 2, 3, 4])
    expect(compatibilityTier(undefined)).toBe(3)
  })
})
