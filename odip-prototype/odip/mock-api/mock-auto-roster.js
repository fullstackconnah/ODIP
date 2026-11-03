// POST rostering/weeks/:weekStart/auto-roster and .../auto-roster/apply for the mock API: the happy path only (the captures use page.route for a slow run, a 500, a 409 and a partial apply).
// `?fixture=full` on the request gives a draft with nothing uncovered (applying it fills the week); the screen never sends it. Every name and figure is fictional.

const DAY = 86_400_000
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)

const WORKERS = [
  ['w-ava', 'Ava Nguyen'], ['w-sam', 'Sam Lee'], ['w-jo', 'Jo Park'], ['w-pat', 'Pat Kim'], ['w-eli', 'Eli Brooks'],
  ['w-grace', 'Alexandria Montgomery-Ross'], ['w-mia', 'Mia Tran'], ['w-ben', 'Ben Alvarez'], ['w-zed', 'Zed Okafor'],
]
const PARTICIPANTS = [['p-1', 'Mia Chen'], ['p-2', 'Dan Osei'], ['p-3', 'Eli Ford'], ['p-4', 'Ruth Adams']]
const PICKS = ['Regular', 'Preferred', 'Preferred', 'Backup', 'Allowed', 'Emergency']
const SLOTS = [['07:00:00', '13:00:00'], ['09:00:00', '15:00:00'], ['13:00:00', '19:00:00'], ['19:00:00', '07:00:00']]

function draftFor(weekStart, name) {
  const full = name === 'full'
  const changes = Array.from({ length: 14 }, (_, i) => {
    const [staffId, staffName] = WORKERS[i === 5 ? 5 : i % 5]
    const [pid, participantName] = PARTICIPANTS[i % 4]
    const [startTime, endTime] = SLOTS[(i >> 2) % 4]
    const pick = PICKS[i % PICKS.length]
    const alternates = WORKERS.filter(([id]) => id !== staffId).slice(i % 3, (i % 3) + 3).map(([id, n], k) => ({ staffId: id, staffName: n, pick: PICKS[(i + k + 1) % PICKS.length], rank: null }))
    return {
      shiftId: `auto-shift-${i + 1}`, participantId: pid, participantName, serviceDate: addDays(weekStart, i % 4), startTime, endTime, staffId, staffName, pick,
      rank: pick === 'Preferred' ? i % 3 + 1 : null, underGoal: i % 4 === 1,
      regularAway: i === 3 ? 'Sam Lee is away: on approved leave' : null,
      warnings: i === 6 ? [{ code: 'PUBLIC_HOLIDAY', severity: 'Warning', message: 'Public holiday: penalty rates apply.', requiresReason: false }] : [],
      alternates,
    }
  })
  const hours = WORKERS.map(([staffId, staffName], i) => ({
    staffId, staffName, employmentType: ['FullTime', 'PartTime', 'Casual'][i % 3], goalHours: i === 8 ? 0 : i % 3 === 0 ? 38 : 20, goalIsDefault: i % 2 === 0,
    rosteredHours: [30, 16, 0, 12, 8, 24, 4, 20, 0][i], draftHours: 0,
  }))
  const uncovered = full ? [] : [
    { shiftId: 'auto-open-1', participantName: 'Eli Ford', serviceDate: addDays(weekStart, 2), startTime: '19:00:00', endTime: '07:00:00', reason: 'OnlyNoStaff',
      recommendations: [{ kind: 'Override', staffId: 'w-pat', text: 'Pat Kim can take it with a reason: Public holiday' }, { kind: 'Soft', staffId: 'w-sam', text: 'Sam Lee: leave request pending' }] },
    { shiftId: 'auto-open-2', participantName: 'Ruth Adams', serviceDate: addDays(weekStart, 3), startTime: '09:00:00', endTime: '15:00:00', reason: 'HoursCapReached',
      recommendations: [{ kind: 'OverGoal', staffId: 'w-ava', text: 'Ava Nguyen would be 4 h over their goal' }] },
    { shiftId: 'auto-open-3', participantName: 'Dan Osei', serviceDate: addDays(weekStart, 3), startTime: '16:00:00', endTime: '20:00:00', reason: 'NobodyFree', recommendations: [] },
  ]
  return { weekStart, generatedAt: new Date().toISOString(), changes, hours, uncovered }
}

const post = [
  ['rostering/weeks/:weekStart/auto-roster', (weekStart, _body, searchParams) => draftFor(weekStart, searchParams && searchParams.get('fixture'))],
  ['rostering/weeks/:weekStart/auto-roster/apply', (_weekStart, body) => ({ applied: ((body && body.rows) || []).map((r) => r.shiftId), skipped: [] })],
]

module.exports = { post, draftFor }
