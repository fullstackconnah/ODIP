// GET claim-hub/pipeline for the mock API: dollars sent to the NDIA and paid in each of the last 12 weeks (Monday start). Every figure is fictional.
// `?fixture=` picks a state for the captures (the screen never sends it): mixed (the default), empty, owed, high, undated; the server file adds failing (500) and slow.
// empty: no dollars in any week and nothing owed. owed: no weeks, but $4,800.00 waits on the NDIA. high: a $128,400.50 week, so the y labels need the wider gutter.
// full: every week has both a sent and a paid bar (24 bars). undated: mixed plus $1,234.50 paid before payments were dated.

// [sent, paid, rejected, rejectedLines] per week, oldest first; the last week is the current one
const MIXED = [[0, 0, 0, 0], [0, 0, 0, 0], [1850, 0, 0, 0], [3200.5, 1850, 0, 0], [0, 3200.5, 0, 0], [2400, 0, 320, 1], [0, 2080, 0, 0], [5120, 0, 0, 0], [1960, 5120, 480.25, 2], [0, 1960, 0, 0], [2750, 0, 0, 0], [640, 0, 0, 0]]
const FULL = [[1850, 920, 0, 0], [2210, 1850, 310, 1], [3200.5, 2210, 0, 0], [2400, 3200.5, 0, 0], [980, 2400, 0, 0], [5120, 980, 640, 2], [1960, 5120, 0, 0], [2750, 1960, 0, 0], [640, 2750, 120.5, 1], [4100, 640, 0, 0], [3300, 4100, 0, 0], [1500, 3300, 0, 0]]
const HIGH = MIXED.map(([s, p, r, n], i) => (i === 7 ? [128400.5, p, r, n] : [s, p, r, n]))
const FIXTURES = {
  mixed: { rows: MIXED, withNdia: 5230.25, undatedPaid: 0 },
  empty: { rows: Array(12).fill([0, 0, 0, 0]), withNdia: 0, undatedPaid: 0 },
  owed: { rows: Array(12).fill([0, 0, 0, 0]), withNdia: 4800, undatedPaid: 0 },
  full: { rows: FULL, withNdia: 5230.25, undatedPaid: 0 },
  high: { rows: HIGH, withNdia: 5230.25, undatedPaid: 0 },
  undated: { rows: MIXED, withNdia: 5230.25, undatedPaid: 1234.5 },
}

const DAY = 86400000
const iso = (ms) => new Date(ms).toISOString().slice(0, 10)

/** The Monday of the week holding `todayIso`, as epoch ms at UTC midnight */
function mondayMs(todayIso) {
  const d = new Date(`${todayIso}T00:00:00Z`)
  return d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY
}

function byFixture(name, todayIso) {
  const f = FIXTURES[name] || FIXTURES.mixed
  const last = mondayMs(todayIso)
  return {
    today: todayIso,
    weeks: f.rows.map(([sent, paid, rejected, rejectedLines], i) => ({ weekStart: iso(last - (11 - i) * 7 * DAY), sent, paid, rejected, rejectedLines })),
    withNdia: f.withNdia,
    acceptedUnpaid: 0,
    undatedPaid: f.undatedPaid,
  }
}

module.exports = { byFixture, FIXTURES }
