/**
 * Realistic API JSON for screens the mock API has no data for (see the `fixture: true` shots).
 * Shapes follow the real response DTOs under frontend/src/api/types. Names, codes and dates are the mock's
 * fictional sample set (mock-api/server.js): participants p-0001..p-0006, staff s-0001..s-0005.
 */

// ---- Portal: My shifts (GET portal/my-shifts) + pending witness requests (GET portal/witness-requests) -------------
// Week Mon 7 - Sun 13 Sep 2026. shift-0001/0002/0003 are the mock's own portal shifts (same dates, times, participants);
// shift-0004 is an extra day shift so the week reads like a real roster. Statuses follow the shift-completion flow:
// Completed (finished and approved) -> Published (upcoming).
export const myShiftsWeek = {
  shifts: [
    {
      id: 'shift-0001', participantId: 'p-0001', participantName: 'Liam Okafor', serviceDate: '2026-09-08',
      startTime: '08:00:00', endTime: '17:00:00', endsNextDay: false, durationHours: 8,
      ratio: 'OneToOne', nightType: 'None', status: 'Completed', notes: null, returnCount: 0,
    },
    {
      id: 'shift-0002', participantId: 'p-0004', participantName: 'Grace Palmer-Hughes', serviceDate: '2026-09-10',
      startTime: '19:00:00', endTime: '07:00:00', endsNextDay: true, durationHours: 12,
      ratio: 'OneToOne', nightType: 'ActiveNight', status: 'Completed', notes: null, returnCount: 0,
    },
    {
      id: 'shift-0004', participantId: 'p-0006', participantName: 'Aisha Rahimi', serviceDate: '2026-09-11',
      startTime: '10:00:00', endTime: '15:00:00', endsNextDay: false, durationHours: 5,
      ratio: 'OneToOne', nightType: 'None', status: 'Published', notes: null, returnCount: 0,
    },
    {
      id: 'shift-0003', participantId: 'p-0002', participantName: 'Sienna Whitfield', serviceDate: '2026-09-13',
      startTime: '09:00:00', endTime: '15:00:00', endsNextDay: false, durationHours: 6,
      ratio: 'OneToOne', nightType: 'None', status: 'Published', notes: null, returnCount: 0,
    },
  ],
  tripAssignments: [],
  timeZoneId: 'Australia/Sydney',
}

export const pendingWitnessRequests = []

// ---- Roster board, By staff (GET rostering/board?groupBy=staff) --------------------------------------------------
// The mock always answers with the participant-grouped shape (and ignores groupBy), so the By staff view is fed this
// week instead: Mon 10 - Sun 16 Aug 2026. Staff, participants and Tom's leave (mock schedule: annual leave 10-21 Aug)
// come from the mock; hours are the sum of the shifts shown; the 38 h target is the backend default. Tom's first aid
// expiry (1 Jul 2026) is the mock's own staff record. One shift sits in the Unfilled lane.
const hh = (t) => Number(t.slice(0, 2)) + Number(t.slice(3, 5)) / 60

function shift(id, participantId, participantName, staffId, staffName, serviceDate, startTime, endTime, extra = {}) {
  const endsNextDay = endTime <= startTime
  const durationHours = endsNextDay ? 24 - hh(startTime) + hh(endTime) : hh(endTime) - hh(startTime)
  return {
    id, participantId, participantName, ...(staffId ? { staffId, staffName } : {}), serviceDate, startTime, endTime, endsNextDay, durationHours,
    ratio: 'OneToOne', nightType: 'None', status: 'Published', shiftPatternId: null, notes: null, overrideReason: null,
    findings: [], assigneeOnApprovedLeave: false, ...extra,
  }
}

const LIAM = ['p-0001', 'Liam Okafor']
const SIENNA = ['p-0002', 'Sienna Whitfield']
const MARCUS = ['p-0003', 'Marcus Tran']
const GRACE = ['p-0004', 'Grace Palmer-Hughes']
const DYLAN = ['p-0005', 'Dylan Marchetti']
const CALLUM = ['s-0001', 'Callum Radford']
const PRIYA = ['s-0002', 'Priya Nadarajah']
const JACK = ['s-0003', "Jack O'Sullivan"]
const MEI = ['s-0004', 'Mei Zhang']
const TOM = ['s-0005', 'Tom Beattie']

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
    shift('rs-0016', ...SIENNA, ...PRIYA, '2026-08-14', '09:00:00', '15:00:00'),
  ],
  jack: [
    shift('rs-0007', ...LIAM, ...JACK, '2026-08-10', '08:00:00', '17:00:00'),
    shift('rs-0008', ...MARCUS, ...JACK, '2026-08-11', '09:00:00', '15:00:00'),
    shift('rs-0009', ...GRACE, ...JACK, '2026-08-12', '19:00:00', '07:00:00', night),
    shift('rs-0017', ...MARCUS, ...JACK, '2026-08-14', '10:00:00', '16:00:00'),
  ],
  mei: [
    shift('rs-0010', ...DYLAN, ...MEI, '2026-08-10', '10:00:00', '15:00:00'),
    shift('rs-0011', ...GRACE, ...MEI, '2026-08-11', '19:00:00', '07:00:00', { ...night, findings: [ratioShortfall] }),
    shift('rs-0012', ...DYLAN, ...MEI, '2026-08-13', '10:00:00', '15:00:00'),
  ],
  tom: [],
}

const totalHours = (shifts) => Math.round(shifts.reduce((n, s) => n + s.durationHours, 0) * 10) / 10

const staffRow = (staff, role, shifts, compliance = 'Ok', complianceNotes = [], leave = []) => ({
  staffId: staff[0], fullName: staff[1], role, compliance, complianceNotes,
  rosteredHours: totalHours(shifts), targetHours: 38, shifts, tripBars: [], leave,
})

export const rosterBoardStaffWeek = {
  groupBy: 'Staff',
  weekStart: '2026-08-10',
  days: ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16'],
  staffRows: [
    staffRow(CALLUM, 'Coordinator', staffShifts.callum),
    staffRow(PRIYA, 'TeamLeader', staffShifts.priya),
    staffRow(JACK, 'SupportWorker', staffShifts.jack),
    staffRow(MEI, 'SeniorSupportWorker', staffShifts.mei),
    staffRow(TOM, 'SupportWorker', staffShifts.tom, 'Warning', ['First aid expired 1 Jul'], [
      { startDate: '2026-08-10', endDate: '2026-08-21', availabilityType: 'Leave', notes: 'Annual leave', kind: 'Legacy', startTime: null, endTime: null },
    ]),
  ],
  unfilled: [shift('rs-0014', ...DYLAN, null, null, '2026-08-11', '09:00:00', '13:00:00')],
  exceptions: [{ shiftId: 'rs-0011', participantName: 'Grace Palmer-Hughes', serviceDate: '2026-08-11', finding: ratioShortfall }],
  weekStarted: true,
}

/** Serve the By staff board for groupBy=staff; every other board request falls through to the mock. */
export async function routeStaffBoard(page) {
  await page.route(/\/api\/v1\/rostering\/board(\?.*)?$/, (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('groupBy') !== 'staff') return route.fallback()
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: rosterBoardStaffWeek, message: null, errors: null }) })
  })
}

// ---- Participant claims: Generate from shifts, at its preview (POST participants/:id/claims/from-shifts/preview) ----------
// ShiftClaimPreviewResponseDto. The mock answers every preview with the same two lines whatever the range, the second carrying
// the night-rate note. This one is what the real endpoint returns for p-0001's approved weekday day shifts from 1 Sep to 16 Oct 2026
// (Tue 8 and Thu 10 Sep, 8 h at $40), with the one sleepover left out as before: no note, because no evening or night rate is involved.
export const claimPreviewDaytime = {
  totalAmount: 640,
  lineItems: [
    { shiftId: 'sh-mock-1', serviceDate: '2026-09-08', dayTypeLabel: 'Weekday', dayType: 'Weekday', supportItemCode: '01_002_0117_1_1', hours: 8, unitPrice: 40, totalAmount: 320 },
    { shiftId: 'sh-mock-3', serviceDate: '2026-09-10', dayTypeLabel: 'Weekday', dayType: 'Weekday', supportItemCode: '01_002_0117_1_1', hours: 8, unitPrice: 40, totalAmount: 320 },
  ],
  leftOut: [
    { shiftId: 'sh-mock-2', serviceDate: '2026-09-09', description: 'Shift 22:00–06:00 · 8 h', reason: 'It is a sleepover, which shift claims do not price yet.' },
  ],
}

/** Serve the daytime preview for POST claims/from-shifts/preview; every other request falls through to the mock. */
export async function routeClaimPreview(page) {
  await page.route(/\/api\/v1\/participants\/[^/]+\/claims\/from-shifts\/preview(\?.*)?$/, (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: claimPreviewDaytime, message: null, errors: null }) })
  })
}
