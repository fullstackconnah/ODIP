import { describe, it, expect } from 'vitest'
import { OLD_KEY_TARGET, resolveTabKey, PARTICIPANT_TAB_KEYS, SUB_TABS, visibleSubTabs, sectionForHash, resolveSection, safeDecode, type SectionGate } from './participantTabs'

const all = PARTICIPANT_TAB_KEYS
const noFunding = all.filter(k => k !== 'funding')

describe('resolveTabKey', () => {
  it('maps all 11 old keys to the old-keys table', () => {
    expect(Object.keys(OLD_KEY_TARGET)).toHaveLength(11)
    const expected: Record<string, string> = {
      details: 'about#ndis-plan', contacts: 'people#contacts', bookings: 'people#trips', support: 'daily#support-needs',
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

const gatesOff: Record<SectionGate, boolean> = { rostering: false, planBudget: false, claims: false, history: false, communityStream: false, earlierChecklist: false }
const ids = (tab: Parameters<typeof visibleSubTabs>[0], g: Partial<Record<SectionGate, boolean>> = {}) => visibleSubTabs(tab, { ...gatesOff, ...g }).map(r => r.id)

describe('visibleSubTabs', () => {
  it('hides a row whose gate is off and keeps the table order', () => {
    expect(ids('people')).toEqual(['contacts', 'trips'])
    expect(ids('people', { rostering: true })).toEqual(['contacts', 'roster', 'week', 'trips'])
    expect(ids('records')).toEqual(['notes', 'consents'])
    expect(ids('records', { history: true })).toEqual(['notes', 'consents', 'history'])
    expect(ids('funding')).toEqual([])
    expect(ids('funding', { planBudget: true, claims: true })).toEqual(['plan-budget', 'claims'])
    expect(ids('daily')).not.toContain('typical-day')
    expect(ids('daily', { communityStream: true })).toContain('typical-day')
    expect(ids('health')).not.toContain('community-access-risk')
    expect(ids('health', { earlierChecklist: true }).at(-1)).toBe('community-access-risk')
  })

  it('every old-key hash is a row of its tab', () => {
    const all = { rostering: true, planBudget: true, claims: true, history: true, communityStream: true, earlierChecklist: true }
    for (const t of Object.values(OLD_KEY_TARGET)) {
      if (t.hash) expect(visibleSubTabs(t.tab as keyof typeof SUB_TABS, all).map(r => r.id)).toContain(t.hash)
    }
  })
})

describe('sectionForHash and resolveSection', () => {
  const health = visibleSubTabs('health', gatesOff)
  it('matches a row id, an element nested in a row, and nothing else', () => {
    expect(sectionForHash(health, 'medical')).toBe('medical')
    expect(sectionForHash(health, 'risks-summary')).toBe('risks')
    expect(sectionForHash(health, 'meals')).toBeNull()
    expect(sectionForHash(health, 'community-access-risk')).toBeNull()
  })

  it('prefers the hash, then a visible section=, then the first row', () => {
    expect(resolveSection(health, 'medical', 'risks')).toBe('medical')
    expect(resolveSection(health, '', 'risks')).toBe('risks')
    expect(resolveSection(health, '', 'meals')).toBe('emergency')
    expect(resolveSection(health, '', null)).toBe('emergency')
  })

  it('survives a malformed hash', () => {
    expect(safeDecode('%E0')).toBe('%E0')
    expect(resolveSection(health, safeDecode('%E0'), null)).toBe('emergency')
  })
})
