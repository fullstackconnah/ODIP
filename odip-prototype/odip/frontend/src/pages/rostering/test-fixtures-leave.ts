import type { LeaveBarDto, LeaveRequestDto, RecurringUnavailabilityDto } from '@/api/types'

export function makeLeaveBar(overrides: Partial<LeaveBarDto> = {}): LeaveBarDto {
  return {
    startDate: '2026-09-14',
    endDate: '2026-09-18',
    // The backend compat-fills AvailabilityType.Leave for both leave kinds and never sends the
    // leave type — this default mirrors the wire rather than 'Annual', which the backend never
    // actually produces.
    availabilityType: 'Leave',
    notes: null,
    kind: 'ApprovedLeave',
    startTime: null,
    endTime: null,
    ...overrides,
  }
}

export function makeLeaveRequest(overrides: Partial<LeaveRequestDto> = {}): LeaveRequestDto {
  return {
    id: 'leave-1',
    userId: 'staff-1',
    userFullName: 'Alex Rivera',
    leaveType: 'Annual',
    startDate: '2026-09-14',
    endDate: '2026-09-18',
    status: 'Pending',
    reason: null,
    requestedByUserId: 'staff-1',
    requestedAt: '2026-09-07T09:00:00Z',
    decidedByUserId: null,
    decidedAt: null,
    decisionNote: null,
    ...overrides,
  }
}

export function makeRecurringRule(overrides: Partial<RecurringUnavailabilityDto> = {}): RecurringUnavailabilityDto {
  return {
    id: 'rule-1',
    userId: 'staff-1',
    userFullName: 'Alex Rivera',
    dayOfWeek: 'Monday',
    startTime: '09:00:00',
    endTime: '12:00:00',
    effectiveFrom: '2026-09-07',
    effectiveTo: null,
    notes: null,
    status: 'Pending',
    requestedByUserId: 'staff-1',
    requestedAt: '2026-09-07T09:00:00Z',
    decidedByUserId: null,
    decidedAt: null,
    decisionNote: null,
    ...overrides,
  }
}
