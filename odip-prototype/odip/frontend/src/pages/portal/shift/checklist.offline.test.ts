import { describe, expect, it } from 'vitest'
import { offlineDueDoses } from './checklist'
import type { PortalDoseSlotDto, PortalShiftDetailDto } from '@/api/types'

const dose = (over: Partial<PortalDoseSlotDto>): PortalDoseSlotDto => ({
  medicationId: 'm1', medicationName: 'Panadol', strength: null, scheduledAt: '2026-10-28T13:00:00', scheduledTime: '13:00', state: 'Due', outcome: null, ...over,
} as PortalDoseSlotDto)
const shift = (slots: PortalDoseSlotDto[], blockers: unknown[] = []) =>
  ({ timeZoneId: 'Australia/Sydney', medicationsDue: slots, shiftRoutines: [], finishBlockers: blockers }) as unknown as PortalShiftDetailDto
// 17:00 Sydney (AEDT, UTC+11) on 28 Oct 2026
const at5pm = new Date('2026-10-28T06:00:00Z')

describe('offline Finish dose block (S4)', () => {
  it('blocks on a dose that came due after the detail was saved, though the saved blockers list none', () => {
    expect(offlineDueDoses(shift([dose({})]), at5pm)).toHaveLength(1)
  })
  it('lists a dose that is both a saved blocker and past due once', () => {
    const blockers = [{ code: 'DOSE_OUTCOME_MISSING', medicationId: 'm1', scheduledAt: '2026-10-28T13:00:00' }]
    expect(offlineDueDoses(shift([dose({})], blockers), at5pm)).toHaveLength(1)
  })
  it('never blocks on a dose with an outcome or one still in the future', () => {
    const done = dose({ outcome: { status: 'Administered' } as never })
    const later = dose({ medicationId: 'm2', scheduledAt: '2026-10-28T18:00:00', scheduledTime: '18:00' })
    expect(offlineDueDoses(shift([done, later]), at5pm)).toEqual([])
  })
})
