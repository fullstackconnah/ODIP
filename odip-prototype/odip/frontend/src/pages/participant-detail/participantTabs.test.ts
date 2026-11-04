import { describe, it, expect } from 'vitest'
import { OLD_KEY_TARGET, resolveTabKey, PARTICIPANT_TAB_KEYS, SUB_TABS, visibleSubTabs, sectionForHash, resolveSection, nestedSectionTarget, safeDecode, type SectionGate } from './participantTabs'

const all = PARTICIPANT_TAB_KEYS
const noFunding = all.filter(k => k !== 'funding')
const noAgreements = all.filter(k => k !== 'agreements')

describe('resolveTabKey', () => {
  it('puts Agreements after Funding, and reads it as Overview for a role without it', () => {
    expect(all.indexOf('agreements')).toBe(all.indexOf('funding') + 1)
    expect(resolveTabKey('agreements', all)).toEqual({ tab: 'agreements' })
    expect(resolveTabKey('agreements', noAgreements)).toEqual({ tab: 'overview' })
  })

  it('maps all 12 old keys to the old-keys table', () => {
    expect(Object.keys(OLD_KEY_TARGET)).toHaveLength(12)
    const expected: Record<string, string> = {
      details: 'about#ndis-plan', contacts: 'people#contacts', bookings: 'people#trips', support: 'daily#support-needs',
      medications: 'health#medications', notes: 'records#notes', routines: 'daily#routines', 'restrictive-practices': 'health#restrictive-practices',
      claims: 'funding#claims', rostering: 'people#roster', roster: 'people#roster', history: 'records#history',
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

const gatesOff: Record<SectionGate, boolean> = { rostering: false, planBudget: false, claims: false, history: false }
const gatesOn: Record<SectionGate, boolean> = { rostering: true, planBudget: true, claims: true, history: true }
const ids = (tab: Parameters<typeof visibleSubTabs>[0], g: Partial<Record<SectionGate, boolean>> = {}) => visibleSubTabs(tab, { ...gatesOff, ...g }).map(r => r.id)
const GROUPED = PARTICIPANT_TAB_KEYS.filter(k => k !== 'overview' && k !== 'agreements')
const chipCount = (g: Record<SectionGate, boolean>) => GROUPED.reduce((sum, t) => sum + visibleSubTabs(t, g).length, 0)

describe('visibleSubTabs', () => {
  it('keeps list features as chips and merges short field cards, in the table order', () => {
    expect(ids('about')).toEqual(['identity', 'ndis-plan'])
    expect(ids('health')).toEqual(['emergency', 'medications', 'risks', 'behaviour-and-communication'])
    expect(ids('daily')).toEqual(['support-needs', 'routines'])
    expect(ids('people')).toEqual(['contacts', 'trips'])
    expect(ids('people', { rostering: true })).toEqual(['contacts', 'roster', 'trips'])
    expect(ids('records')).toEqual(['notes', 'consents'])
    expect(ids('records', { history: true })).toEqual(['notes', 'consents', 'history'])
    expect(ids('funding')).toEqual([])
    expect(ids('funding', { planBudget: true, claims: true })).toEqual(['plan-budget', 'claims'])
    expect(ids('agreements')).toEqual(['agreements'])
  })

  it('labels the merged chips', () => {
    const label = (tab: Parameters<typeof visibleSubTabs>[0], id: string) => visibleSubTabs(tab, gatesOn).find(r => r.id === id)!.label
    expect(label('about', 'identity')).toBe('Profile')
    expect(label('about', 'ndis-plan')).toBe('NDIS & services')
    expect(label('health', 'emergency')).toBe('Medical')
    expect(label('health', 'risks')).toBe('Risks & practices')
    expect(label('health', 'behaviour-and-communication')).toBe('Behaviour')
    expect(label('daily', 'support-needs')).toBe('Care & ADL')
    expect(label('daily', 'routines')).toBe('Routines & meals')
    expect(label('people', 'roster')).toBe('Roster & staff match')
  })

  it('counts 16 chips for an admin, 15 with no History, 12 with every gate off (Agreements has no strip)', () => {
    expect(chipCount(gatesOn)).toBe(16)
    expect(chipCount({ ...gatesOn, history: false })).toBe(15)
    expect(chipCount(gatesOff)).toBe(12)
  })

  it('every old-key hash lands on a chip of its tab', () => {
    for (const t of Object.values(OLD_KEY_TARGET)) {
      if (t.hash) expect(sectionForHash(visibleSubTabs(t.tab as keyof typeof SUB_TABS, gatesOn), t.hash)).not.toBeNull()
    }
  })
})

// Every section id of the 34 sub-tabs before the regroup, and the chip a hash or section= naming it must land on.
const OLD_SECTION_CHIP: Record<string, Record<string, string>> = {
  about: { identity: 'identity', 'home-and-living': 'identity', 'ndis-plan': 'ndis-plan', services: 'ndis-plan', 'key-identifiers': 'identity', 'culture-and-rights': 'identity', 'about-me': 'identity' },
  health: {
    emergency: 'emergency', medical: 'emergency', 'health-conditions': 'emergency', medications: 'medications', 'behaviour-and-communication': 'behaviour-and-communication',
    'behaviour-support': 'behaviour-and-communication', risks: 'risks', 'risks-summary': 'risks', 'restrictive-practices': 'risks', 'community-access-risk': 'risks',
  },
  daily: {
    'support-needs': 'support-needs', 'mobility-and-personal-care': 'support-needs', 'equipment-and-overnight': 'support-needs', 'daily-living': 'support-needs',
    'transport-and-travel': 'support-needs', routines: 'routines', meals: 'routines', 'typical-day': 'routines',
  },
  people: { contacts: 'contacts', roster: 'roster', week: 'roster', trips: 'trips' },
  funding: { 'plan-budget': 'plan-budget', claims: 'claims' },
  agreements: { agreements: 'agreements' },
  records: { notes: 'notes', consents: 'consents', history: 'history' },
}

describe('sectionForHash and resolveSection', () => {
  const health = visibleSubTabs('health', gatesOff)
  it('sends every section id of the old sub-tabs to its merged chip, and a foreign id nowhere', () => {
    for (const [tab, map] of Object.entries(OLD_SECTION_CHIP)) {
      const rows = visibleSubTabs(tab as keyof typeof SUB_TABS, gatesOn)
      for (const [old, chip] of Object.entries(map)) {
        expect(sectionForHash(rows, old), tab + '#' + old).toBe(chip)
        expect(resolveSection(rows, '', old), tab + '?section=' + old).toBe(chip)
      }
    }
    expect(sectionForHash(health, 'meals')).toBeNull()
  })

  it('does not reach a gated chip', () => {
    const people = visibleSubTabs('people', gatesOff)
    expect(sectionForHash(people, 'week')).toBeNull()
    expect(resolveSection(people, '', 'week')).toBe('contacts')
  })

  it('prefers the hash, then a visible section=, then the first row', () => {
    expect(resolveSection(health, 'medications', 'risks')).toBe('medications')
    expect(resolveSection(health, '', 'risks')).toBe('risks')
    expect(resolveSection(health, '', 'meals')).toBe('emergency')
    expect(resolveSection(health, '', null)).toBe('emergency')
  })

  it('survives a malformed hash', () => {
    expect(safeDecode('%E0')).toBe('%E0')
    expect(resolveSection(health, safeDecode('%E0'), null)).toBe('emergency')
  })
})

describe('nestedSectionTarget', () => {
  const people = visibleSubTabs('people', gatesOn)
  it('names the element a section= reaches inside a merged chip, and nothing for a row id or a hidden one', () => {
    expect(nestedSectionTarget(people, 'week')).toBe('week')
    expect(nestedSectionTarget(people, 'roster')).toBeNull()
    expect(nestedSectionTarget(people, 'contacts')).toBeNull()
    expect(nestedSectionTarget(people, 'meals')).toBeNull()
    expect(nestedSectionTarget(people, null)).toBeNull()
    expect(nestedSectionTarget(visibleSubTabs('people', gatesOff), 'week')).toBeNull()
  })
})
