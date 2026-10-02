import { describe, it, expect } from 'vitest'
import { buildChecklist, clockLabel, endChecklist } from './checklist'
import type { PortalDoseSlotDto, PortalShiftRoutineDto } from '@/api/types'

const dose = (over: Partial<PortalDoseSlotDto>): PortalDoseSlotDto => ({
  medicationId: 'm1', medicationName: 'Panadol', strength: null, doseDescription: '1 tablet', form: 'Tablet', route: 'Oral', directions: null,
  supportLevel: 'Administer', isHighRisk: false, scheduledAt: '2026-10-05T08:00:00', scheduledTime: '08:00', state: 'Due', isOverdue: false,
  outcome: null, witness: { required: false, status: null, witnessName: null, requestedAt: null, respondedAt: null }, ...over,
} as PortalDoseSlotDto)

const routine = (over: Partial<PortalShiftRoutineDto>): PortalShiftRoutineDto => ({
  id: 'r1', title: 'Shower', description: '', category: 'PersonalCare', isCritical: false, startTime: null, endTime: null,
  occursAt: '2026-10-05T08:00:00', afterMidnight: false, isChecked: false, checkedAt: null, checkedByName: null, fromTickSnapshot: false, ...over,
} as PortalShiftRoutineDto)

describe('clockLabel', () => {
  it('prints wall-clock digits, never shifted', () => {
    expect(clockLabel('2026-10-05T08:00:00')).toBe('8:00 am')
    expect(clockLabel('2026-10-05T13:30:00')).toBe('1:30 pm')
  })
})

describe('buildChecklist', () => {
  it('puts overdue doses in a warning group at the top, then time groups, with routines at their time', () => {
    const { groups } = buildChecklist({
      medicationsDue: [
        dose({ medicationId: 'a', scheduledAt: '2026-10-05T12:00:00', scheduledTime: '12:00' }),
        dose({ medicationId: 'b', scheduledAt: '2026-10-05T08:00:00', state: 'Overdue', isOverdue: true }),
      ],
      shiftRoutines: [routine({ id: 'r', occursAt: '2026-10-05T12:00:00' }), routine({ id: 'any', occursAt: null })],
    })
    expect(groups.map(g => g.id)).toEqual(['overdue', '2026-10-05T12:00', 'anytime'])
    expect(groups[0].tone).toBe('warning')
    expect(groups[1].items.map(i => i.kind)).toEqual(['dose', 'routine'])
    expect(groups[2].label).toBe('Anytime')
  })
  it('sorts after-midnight occurrences after the evening', () => {
    const { groups } = buildChecklist({
      medicationsDue: [],
      shiftRoutines: [routine({ id: 'late', occursAt: '2026-10-06T01:00:00', afterMidnight: true }), routine({ id: 'eve', occursAt: '2026-10-05T22:00:00' })],
    })
    expect(groups.map(g => g.items[0].key)).toEqual(['routine-eve', 'routine-late'])
  })
  it('is empty when there is nothing due', () => {
    expect(buildChecklist({ medicationsDue: [], shiftRoutines: [] }).groups).toEqual([])
  })
})

describe('endChecklist', () => {
  const base = { blockers: [], noteCount: 1, nothingToNote: false, handoverText: '', nothingToHandOver: false }
  it('needs a note or Nothing to note', () => {
    expect(endChecklist({ ...base, noteCount: 0 }).find(i => i.id === 'note')?.done).toBe(false)
    expect(endChecklist({ ...base, noteCount: 0, nothingToNote: true }).find(i => i.id === 'note')?.done).toBe(true)
  })
  it('needs handover text or Nothing to hand over', () => {
    expect(endChecklist(base).find(i => i.id === 'handover')?.done).toBe(false)
    expect(endChecklist({ ...base, handoverText: 'ok' }).find(i => i.id === 'handover')?.done).toBe(true)
    expect(endChecklist({ ...base, nothingToHandOver: true }).find(i => i.id === 'handover')?.done).toBe(true)
  })
  it('is blocked by missing doses and a running break', () => {
    const items = endChecklist({
      ...base,
      blockers: [
        { code: 'DOSE_OUTCOME_MISSING', message: 'x', medicationId: 'm', medicationName: 'P', scheduledAt: '2026-10-05T08:00:00' },
        { code: 'BREAK_RUNNING', message: 'y', medicationId: null, medicationName: null, scheduledAt: null },
      ],
    })
    expect(items.find(i => i.id === 'doses')?.done).toBe(false)
    expect(items.find(i => i.id === 'breaks')?.done).toBe(false)
  })
})
