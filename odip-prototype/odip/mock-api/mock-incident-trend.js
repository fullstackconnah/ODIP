// GET incidents/trend for the mock API: incidents and restrictive practice uses over the last 6 months. Every figure is fictional.
// `?fixture=` picks a state for the captures (the screen never sends it): mixed (the default), longest, empty, high; the server file adds failing (500) and slow.
// longest: the widest copy (a November start, a zero month, a year boundary, an up or down sentence) and needs today = 2026-04-15, so the fixture sets it.
// high: a 1,240-incident month, so the y labels need the wider left gutter.

// [incidents, restrictive practice uses] per month, oldest first; the last month is the current one
const MIXED = [[2, 0], [0, 0], [3, 1], [2, 0], [4, 1], [2, 2]]
const LONGEST = [[400, 300], [0, 0], [300, 180], [260, 120], [240, 100], [40, 0]]
const HIGH = [[310, 120], [260, 90], [1240, 600], [420, 200], [380, 150], [60, 20]]
const FIXTURES = { mixed: MIXED, longest: LONGEST, empty: Array(6).fill([0, 0]), high: HIGH }

/** "2026-04" minus n months */
function monthsBack(todayIso, n) {
  const [y, m] = todayIso.split('-').map(Number)
  const idx = y * 12 + (m - 1) - n
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

function byFixture(name, todayIso) {
  const rows = FIXTURES[name] || MIXED
  const today = name === 'longest' ? '2026-04-15' : todayIso
  return {
    today,
    months: rows.map(([incidents, rpUses], i) => ({ month: monthsBack(today, 5 - i), incidents, rpUses, otherIncidents: incidents - rpUses })),
  }
}

module.exports = { byFixture, FIXTURES }
