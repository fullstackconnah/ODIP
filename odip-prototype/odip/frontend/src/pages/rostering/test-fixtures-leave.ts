import type { LeaveBarDto } from '@/api/types'

export function makeLeaveBar(overrides: Partial<LeaveBarDto> = {}): LeaveBarDto {
  return {
    startDate: '2026-09-14',
    endDate: '2026-09-18',
    availabilityType: 'Annual',
    notes: null,
    kind: 'ApprovedLeave',
    startTime: null,
    endTime: null,
    ...overrides,
  }
}
