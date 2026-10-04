import type {
  ShiftDto,
  RosterFindingDto,
  RosterBoardDto,
  RosterParticipantRowDto,
  RosterStaffRowDto,
} from '@/api/types'

/** Shaped like the real ShiftDto the API returns — override only what a test cares about. */
export function makeShift(overrides: Partial<ShiftDto> = {}): ShiftDto {
  return {
    id: 'shift-1',
    participantId: 'participant-1',
    participantName: 'Mia Chen',
    staffId: 'staff-1',
    staffName: 'Alex Rivera',
    serviceDate: '2026-08-17',
    startTime: '09:00:00',
    endTime: '17:00:00',
    endsNextDay: false,
    durationHours: 8,
    ratio: 'OneToOne',
    nightType: 'None',
    status: 'Published',
    shiftPatternId: null,
    notes: null,
    overrideReason: null,
    findings: [],
    assigneeOnApprovedLeave: false,
    ...overrides,
  }
}

/**
 * An unfilled shift as the API really sends it. The server leaves a null member out of the JSON (WhenWritingNull), so an unfilled shift arrives with no `staffId` and no `staffName` at all: both are
 * `undefined` to the page, never `null`. `makeShift({ staffId: null })` is a shape the wire never carries, and a test built on it passed while the board hid every shift on real data.
 */
export function makeUnfilledShift(overrides: Partial<ShiftDto> = {}): ShiftDto {
  const shift = makeShift(overrides)
  delete shift.staffId
  delete shift.staffName
  return shift
}

export function makeFinding(overrides: Partial<RosterFindingDto> = {}): RosterFindingDto {
  return {
    code: 'DOUBLE_BOOKED',
    severity: 'Warning',
    message: 'Staff member is already rostered elsewhere at this time.',
    requiresReason: false,
    ...overrides,
  }
}

export function makeParticipantRow(overrides: Partial<RosterParticipantRowDto> = {}): RosterParticipantRowDto {
  return {
    participantId: 'participant-1',
    fullName: 'Mia Chen',
    supportRatio: 'OneToOne',
    overnightSupport: 'None',
    hasRestrictivePractice: false,
    shifts: [],
    tripBars: [],
    scheduledHours: 0,
    daysWithoutCover: 7,
    ...overrides,
  }
}

export function makeStaffRow(overrides: Partial<RosterStaffRowDto> = {}): RosterStaffRowDto {
  return {
    staffId: 'staff-1',
    fullName: 'Alex Rivera',
    role: 'SupportWorker',
    compliance: 'Ok',
    complianceNotes: [],
    rosteredHours: 0,
    targetHours: 38,
    shifts: [],
    tripBars: [],
    leave: [],
    ...overrides,
  }
}

export const WEEK_DAYS = [
  '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20',
  '2026-08-21', '2026-08-22', '2026-08-23',
]

export function makeParticipantBoard(overrides: Partial<Extract<RosterBoardDto, { groupBy: 'Participant' }>> = {}): RosterBoardDto {
  return {
    groupBy: 'Participant',
    weekStart: '2026-08-17',
    days: WEEK_DAYS,
    participantRows: [makeParticipantRow()],
    exceptions: [],
    ...overrides,
  }
}

export function makeStaffBoard(overrides: Partial<Extract<RosterBoardDto, { groupBy: 'Staff' }>> = {}): RosterBoardDto {
  return {
    groupBy: 'Staff',
    weekStart: '2026-08-17',
    days: WEEK_DAYS,
    staffRows: [makeStaffRow()],
    unfilled: [],
    exceptions: [],
    ...overrides,
  }
}
