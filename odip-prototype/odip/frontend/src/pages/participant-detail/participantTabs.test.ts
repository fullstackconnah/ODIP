import { describe, it, expect } from 'vitest'
import { OLD_KEY_TARGET, resolveTabKey, PARTICIPANT_TAB_KEYS } from './participantTabs'

const all = PARTICIPANT_TAB_KEYS
const noFunding = all.filter(k => k !== 'funding')

describe('resolveTabKey', () => {
  it('maps all 11 old keys to the old-keys table', () => {
    expect(Object.keys(OLD_KEY_TARGET)).toHaveLength(11)
    const expected: Record<string, string> = {
      details: 'about#ndis-plan', contacts: 'people#contacts', bookings: 'people#trips', support: 'daily#support-profile',
      medications: 'health#medications', notes: 'records#notes', routines: 'daily#routines', 'restrictive-practices': 'health#restrictive-practices',
      claims: 'funding#claims', rostering: 'people#roster', history: 'records#history',
    }
    for (const [k, v] of Object.entries(expected)) {
      const t = resolveTabKey(k, all)!
      expect(`${t.tab}#${t.hash}`).toBe(v)
    }
  })

  it('returns null for an unknown key', () => {
    expect(resolveTabKey('nonsense', all)).toBeNull()
  })

  it('returns a new key with no hash', () => {
    expect(resolveTabKey('health', all)).toEqual({ tab: 'health' })
    expect(resolveTabKey('funding', all)).toEqual({ tab: 'funding' })
  })

  it('sends a hidden tab to Overview with no hash', () => {
    expect(resolveTabKey('funding', noFunding)).toEqual({ tab: 'overview' })
    expect(resolveTabKey('claims', noFunding)).toEqual({ tab: 'overview' })
  })
})
