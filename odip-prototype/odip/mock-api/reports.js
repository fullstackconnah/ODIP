// Reports page for the mock API: hours by worker, shift fulfilment by week and leave taken, all synthetic. Mirrors ReportsController: a missing, reversed or over-366-day range is a 400.
//
// Captures switch state with POST /mock/reports/state: { mode: 'default' | 'empty' }, { fail: 'hours-by-worker' | 'shift-fulfilment' | 'leave-taken' | null } refuses that report with a 500.

const DAY = 86400000
const RANGE_MESSAGE = 'Pick a range of 366 days or less.'
const NAMES = [
  'Ava Nguyen', 'Sam Lee', 'Jo Carter', 'Mia Chen', 'Ravi Patel', 'Lena Novak', 'Tom Baker', 'Priya Singh', 'Noah Walker', 'Zoe Martin', 'Ben Hall',
  'Wolfeschlegelstein-Fotheringham Worker', // 38 characters, the longest name the page must hold
]
const day = (iso) => Date.parse(`${iso}T00:00:00Z`)
const iso = (ms) => new Date(ms).toISOString().slice(0, 10)
const mondayOf = (ms) => ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY

const LEAVE = [
  ['Ava Nguyen', 'Annual', '2026-09-28', '2026-10-02'], ['Sam Lee', 'Sick', '2026-10-05', '2026-10-06'], ['Jo Carter', 'Annual', '2026-10-12', '2026-10-23'],
  ['Mia Chen', 'Personal', '2026-10-14', '2026-10-14'], ['Ravi Patel', 'Annual', '2026-10-26', '2026-11-06'], ['Lena Novak', 'Sick', '2026-09-21', '2026-09-23'],
  ['Tom Baker', 'Annual', '2026-08-31', '2026-09-04'], ['Priya Singh', 'Personal', '2026-10-19', '2026-10-20'],
]

function create({ respond, failEnvelope }) {
  let mode = 'default'
  let failing = null
  const fail = (status, message) => respond(status, failEnvelope(null, [message]))

  /** Null when the range is acceptable, otherwise the 400 the server answers. */
  const refused = (params) => {
    const from = params.get('from'), to = params.get('to')
    if (!from || !to || day(to) < day(from) || (day(to) - day(from)) / DAY + 1 > 366) return fail(400, RANGE_MESSAGE)
    return null
  }
  const guard = (name, params, build) => {
    if (failing === name) return fail(500, 'Something went wrong.')
    return refused(params) ?? (mode === 'empty' ? [] : build(day(params.get('from')), day(params.get('to'))))
  }

  return {
    get: [
      ['reports/hours-by-worker', (params) => guard('hours-by-worker', params, (from, to) => {
        const days = (to - from) / DAY + 1
        return NAMES.map((workerName, i) => ({
          workerId: `w-${i}`, workerName, approvedShifts: Math.max(1, Math.round(days / 3) - i), approvedHours: Math.round(days * (3.4 - i * 0.2) * 100) / 100 + 0.25,
          awaitingApprovalHours: i % 3 === 0 ? 0 : i * 1.5,
        })).filter((r) => r.approvedHours > 0)
      })],
      ['reports/shift-fulfilment', (params) => guard('shift-fulfilment', params, (from, to) => {
        const rows = []
        for (let monday = mondayOf(from), n = 0; monday <= to; monday += 7 * DAY, n++) {
          const empty = n === 2
          const filled = empty ? 0 : 18 - n, unstaffed = empty ? 0 : 2 + (n % 3), cancelled = empty ? 0 : n % 2
          rows.push({
            weekStart: iso(monday), shifts: filled + unstaffed + cancelled, filled, unstaffed, cancelled,
            fillRatePercent: filled + unstaffed === 0 ? null : Math.round((filled / (filled + unstaffed)) * 100), partWeek: monday < from || monday + 6 * DAY > to,
          })
        }
        return rows
      })],
      ['reports/leave-taken', (params) => guard('leave-taken', params, (from, to) => LEAVE
        .filter(([, , f, t]) => day(f) <= to && day(t) >= from)
        .map(([workerName, type, f, t], i) => ({
          leaveId: `l-${i}`, workerId: `w-${NAMES.indexOf(workerName)}`, workerName, type, from: f, to: t,
          daysInRange: (Math.min(day(t), to) - Math.max(day(f), from)) / DAY + 1,
        })))],
    ],
    post: [
      ['mock/reports/state', (body) => {
        if (body.mode === 'default' || body.mode === 'empty') mode = body.mode
        if ('fail' in body) failing = body.fail
        return { mode, fail: failing }
      }],
    ],
  }
}

module.exports = { create }
