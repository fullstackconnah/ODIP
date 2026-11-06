import { describe, it, expect } from 'vitest'
import { INCIDENT_TYPES } from '@/api/types/enums'
import { COMMON_INCIDENTS, promptsText, applyCommonIncident, commonIncidentStatus } from './commonIncidents'
import type { CommonIncidentCurrent } from './commonIncidents'

const entry = (key: string) => COMMON_INCIDENTS.find((e) => e.key === key)!
const blank: CommonIncidentCurrent = { title: '', incidentType: '', description: '', pickedPrompts: '', injuriesCount: 0, rpData: false }
const none = { title: null, incidentType: null }
const fallText = 'Where they fell and what they were doing:\n\nWhere they were hurt:\n\nHow you helped them, and who you told:\n'

describe('COMMON_INCIDENTS', () => {
  it('lists 11 common incidents then Something else, unique keys, every type a real IncidentType', () => {
    expect(COMMON_INCIDENTS).toHaveLength(12)
    expect(COMMON_INCIDENTS.at(-1)!.key).toBe('something-else')
    expect(new Set(COMMON_INCIDENTS.map((e) => e.key)).size).toBe(12)
    for (const e of COMMON_INCIDENTS) {
      if (e.incidentType) expect(INCIDENT_TYPES).toContain(e.incidentType)
      expect(['Death', 'SexualAbuse', 'Abuse', 'Neglect', 'Other']).not.toContain(e.incidentType)
      if (e.key !== 'rp' && e.key !== 'something-else') {
        expect(e.prompts.length).toBeGreaterThanOrEqual(2)
        expect(e.prompts.length).toBeLessThanOrEqual(4)
        for (const p of e.prompts) expect(p.endsWith(':')).toBe(true)
      }
    }
  })

  it('promptsText joins prompts with a blank line to type on', () => {
    expect(promptsText(entry('fall'))).toBe(fallText)
    expect(promptsText(entry('rp'))).toBe('')
  })
})

describe('applyCommonIncident', () => {
  it('fills a blank form: title, type and prompts', () => {
    const r = applyCommonIncident(blank, none, entry('fall'))
    expect(r.set).toEqual({ title: 'Fell and was hurt', incidentType: 'Injury', description: fallText, pickedPrompts: fallText })
    expect(r.filled).toEqual(['title', 'type', 'prompts'])
    expect(r.kept).toEqual([])
    expect(r.applied).toEqual({ title: 'Fell and was hurt', incidentType: 'Injury' })
  })

  it('never sets severity', () => {
    for (const e of COMMON_INCIDENTS) expect(applyCommonIncident(blank, none, e).set).not.toHaveProperty('severity')
  })

  it('replaces the previous pick untouched text on a re-pick', () => {
    const first = applyCommonIncident(blank, none, entry('fall'))
    const cur = { ...blank, title: 'Fell and was hurt', incidentType: 'Injury', description: fallText, pickedPrompts: fallText }
    const r = applyCommonIncident(cur, first.applied, entry('unwell'))
    expect(r.set).toMatchObject({ title: 'Became unwell', incidentType: 'Illness', description: promptsText(entry('unwell')) })
    expect(r.filled).toEqual(['title', 'type', 'prompts'])
  })

  it('keeps a typed title and a title edited after a pick', () => {
    expect(applyCommonIncident({ ...blank, title: 'My own title' }, none, entry('fall'))).toMatchObject({ kept: ['title'], filled: ['type', 'prompts'] })
    const r = applyCommonIncident({ ...blank, title: 'Fell and was hurt badly' }, { title: 'Fell and was hurt', incidentType: null }, entry('unwell'))
    expect(r.kept).toEqual(['title'])
    expect(r.set).not.toHaveProperty('title')
  })

  it('keeps a description with text typed under the prompts and drops pickedPrompts', () => {
    const typed = `${fallText}\nOn the kitchen floor`
    const r = applyCommonIncident({ ...blank, description: typed, pickedPrompts: fallText }, none, entry('unwell'))
    expect(r.set).not.toHaveProperty('description')
    expect(r.set.pickedPrompts).toBe('')
    expect(r.kept).toEqual(['prompts'])
  })

  it('keeps a hand-chosen type', () => {
    const r = applyCommonIncident({ ...blank, incidentType: 'Illness' }, none, entry('fall'))
    expect(r.set).not.toHaveProperty('incidentType')
    expect(r.kept).toEqual(['type'])
  })

  it('keeps a picked type once an injury row or RP data exists', () => {
    const applied = { title: null, incidentType: 'Injury' }
    for (const extra of [{ injuriesCount: 1 }, { rpData: true }]) {
      const r = applyCommonIncident({ ...blank, incidentType: 'Injury', ...extra }, applied, entry('unwell'))
      expect(r.set).not.toHaveProperty('incidentType')
      expect(r.kept).toEqual(['type'])
    }
  })

  it('treats a MAR prefill as typed', () => {
    const cur = { ...blank, title: 'Medication incident', incidentType: 'MedicationError', description: 'Skeleton' }
    const r = applyCommonIncident(cur, none, entry('med-wrong'))
    expect(r.set).toEqual({ pickedPrompts: '' })
    expect(r.kept).toEqual(['title', 'type', 'prompts'])
    expect(r.filled).toEqual([])
  })

  it('fills only the type on a My-shifts prefill', () => {
    const r = applyCommonIncident({ ...blank, title: 'Shift 9am', description: 'Skeleton' }, none, entry('fall'))
    expect(r.set).toEqual({ incidentType: 'Injury', pickedPrompts: '' })
  })

  it('rp entry clears untouched prompts and sets no new ones', () => {
    const cur = { ...blank, title: 'Fell and was hurt', incidentType: 'Injury', description: fallText, pickedPrompts: fallText }
    const r = applyCommonIncident(cur, { title: 'Fell and was hurt', incidentType: 'Injury' }, entry('rp'))
    expect(r.set).toEqual({ title: 'Restrictive practice used', incidentType: 'RestrictivePracticeUse', description: '', pickedPrompts: '' })
    expect(r.filled).toEqual(['title', 'type'])
    expect(r.kept).toEqual([])
  })

  it('Something else changes nothing and keeps the applied record', () => {
    const applied = { title: 'Fell and was hurt', incidentType: 'Injury' }
    expect(applyCommonIncident(blank, applied, entry('something-else'))).toEqual({ set: {}, filled: [], kept: [], applied })
  })
})

describe('commonIncidentStatus', () => {
  it('words what was filled and kept', () => {
    expect(commonIncidentStatus('fall', ['title', 'type', 'prompts'], [])).toBe('Filled in the title, type and description prompts.')
    expect(commonIncidentStatus('fall', ['type', 'prompts'], ['title'])).toBe('Filled in the type and description prompts. Kept what was already there.')
    expect(commonIncidentStatus('fall', [], ['title', 'type', 'prompts'])).toBe('Nothing changed. Kept what was already there.')
    expect(commonIncidentStatus('rp', ['title', 'type'], [])).toBe('Filled in the title and type.')
    expect(commonIncidentStatus('something-else', [], [])).toBe('')
  })
})
