/**
 * Crew (rostering / credentials) fixtures for capture.mjs. See fixtures.mjs for the ground rules.
 */

// ---- Roster board, By staff (GET rostering/board?groupBy=staff) --------------------------------------------------
// The mock always answers with the participant-grouped shape (and ignores groupBy), so the By staff view is fed this
// week instead: Mon 10 - Sun 16 Aug 2026, the week Sunshine Coast Beach Escape (SCB-2608, 14-17 Aug) starts. Staff,
// participants, the trip bars (Priya, Jack as driver, Mei) and Tom's leave (mock schedule: annual leave 10-21 Aug,
// overseas) come from the mock; hours are the sum of the shifts shown; the 38 h target is the backend default.
// Tom's first aid expiry (1 Jul 2026) is the mock's own staff record. His rostered shifts are the ones that sit
// unfilled, so the Unfilled lane tells the story of what leave leaves open.
const hh = (t) => Number(t.slice(0, 2)) + Number(t.slice(3, 5)) / 60

export function shift(id, participantId, participantName, staffId, staffName, serviceDate, startTime, endTime, extra = {}) {
  const endsNextDay = endTime <= startTime
  const durationHours = endsNextDay ? 24 - hh(startTime) + hh(endTime) : hh(endTime) - hh(startTime)
  return {
    id, participantId, participantName, staffId, staffName, serviceDate, startTime, endTime, endsNextDay, durationHours,
    ratio: 'OneToOne', nightType: 'None', status: 'Published', shiftPatternId: null, notes: null, overrideReason: null,
    findings: [], assigneeOnApprovedLeave: false, ...extra,
  }
}

export const LIAM = ['p-0001', 'Liam Okafor']
export const SIENNA = ['p-0002', 'Sienna Whitfield']
export const MARCUS = ['p-0003', 'Marcus Tran']
export const GRACE = ['p-0004', 'Grace Palmer-Hughes']
export const DYLAN = ['p-0005', 'Dylan Marchetti']
export const CALLUM = ['s-0001', 'Callum Radford']
export const PRIYA = ['s-0002', 'Priya Nadarajah']
export const JACK = ['s-0003', "Jack O'Sullivan"]
export const MEI = ['s-0004', 'Mei Zhang']
export const TOM = ['s-0005', 'Tom Beattie']

const scbBar = (isDriver) => ({
  tripInstanceId: 't-0001', tripCode: 'SCB-2608', tripName: 'Sunshine Coast Beach Escape',
  startDate: '2026-08-14', endDate: '2026-08-17', isDriver,
})

// Wording follows RosterConflictService (backend).
const ratioShortfall = {
  code: 'RATIO_SHORTFALL', severity: 'Warning', requiresReason: false,
  message: "Grace Palmer-Hughes's 2:1 shift on 11 Aug 2026 has only 1 of 2 support workers rostered.",
}
const night = { ratio: 'TwoToOne', nightType: 'ActiveNight' }

const staffShifts = {
  callum: [
    shift('rs-0001', ...LIAM, ...CALLUM, '2026-08-10', '09:00:00', '15:00:00'),
    shift('rs-0002', ...MARCUS, ...CALLUM, '2026-08-12', '10:00:00', '14:00:00'),
    shift('rs-0003', ...LIAM, ...CALLUM, '2026-08-13', '09:00:00', '15:00:00'),
  ],
  priya: [
    shift('rs-0004', ...SIENNA, ...PRIYA, '2026-08-10', '09:00:00', '17:00:00'),
    shift('rs-0005', ...SIENNA, ...PRIYA, '2026-08-11', '09:00:00', '17:00:00'),
    shift('rs-0006', ...GRACE, ...PRIYA, '2026-08-12', '19:00:00', '07:00:00', night),
  ],
  jack: [
    shift('rs-0007', ...LIAM, ...JACK, '2026-08-10', '08:00:00', '17:00:00'),
    shift('rs-0008', ...MARCUS, ...JACK, '2026-08-11', '09:00:00', '15:00:00'),
    shift('rs-0009', ...GRACE, ...JACK, '2026-08-12', '19:00:00', '07:00:00', night),
  ],
  mei: [
    shift('rs-0010', ...DYLAN, ...MEI, '2026-08-10', '10:00:00', '15:00:00'),
    shift('rs-0011', ...GRACE, ...MEI, '2026-08-11', '19:00:00', '07:00:00', { ...night, findings: [ratioShortfall] }),
  ],
  tom: [],
}

const totalHours = (shifts) => Math.round(shifts.reduce((n, s) => n + s.durationHours, 0) * 10) / 10

const staffRow = (staff, role, shifts, tripBars = [], compliance = 'Ok', complianceNotes = [], leave = []) => ({
  staffId: staff[0], fullName: staff[1], role, compliance, complianceNotes,
  rosteredHours: totalHours(shifts), targetHours: 38, shifts, tripBars, leave,
})

export const rosterBoardStaffWeek = {
  groupBy: 'Staff',
  weekStart: '2026-08-10',
  days: ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16'],
  staffRows: [
    staffRow(CALLUM, 'Coordinator', staffShifts.callum),
    staffRow(PRIYA, 'TeamLeader', staffShifts.priya, [scbBar(false)]),
    staffRow(JACK, 'SupportWorker', staffShifts.jack, [scbBar(true)]),
    staffRow(MEI, 'SeniorSupportWorker', staffShifts.mei, [scbBar(false)]),
    staffRow(TOM, 'SupportWorker', staffShifts.tom, [], 'Warning', ['First aid expired 1 Jul'], [
      { startDate: '2026-08-10', endDate: '2026-08-21', availabilityType: 'Leave', notes: 'Annual leave — overseas.', kind: 'Legacy', startTime: null, endTime: null },
    ]),
  ],
  unfilled: [
    shift('rs-0014', ...DYLAN, null, null, '2026-08-11', '09:00:00', '13:00:00'),
    shift('rs-0019', ...DYLAN, null, null, '2026-08-12', '10:00:00', '14:00:00'),
    shift('rs-0015', ...GRACE, null, null, '2026-08-13', '19:00:00', '07:00:00', night),
    shift('rs-0018', ...DYLAN, null, null, '2026-08-15', '09:00:00', '15:00:00'),
  ],
  exceptions: [{ shiftId: 'rs-0011', participantName: 'Grace Palmer-Hughes', serviceDate: '2026-08-11', finding: ratioShortfall }],
}
