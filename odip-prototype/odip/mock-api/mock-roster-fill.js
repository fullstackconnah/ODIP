// GET rostering/fill for the mock API: how full the next 8 weeks are. Every figure is fictional.
// `?fixture=` picks a state for the captures (the screen never sends it): mixed (the default), empty, oneWeek, allFilled; the server file adds failing (500) and slow.
// mixed: week 2 has open shifts and drafts, week 6 has nothing rostered, and the last two weeks cross into the next year when run late in the year.

const DAY = 86_400_000
const dayOf = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY
const isoOf = (day) => new Date(day * DAY).toISOString().slice(0, 10)
const mondayOf = (iso) => { const d = dayOf(iso); return isoOf(d - ((d + 3) % 7)) }

// [shifts, open, draft] per week
const MIXED = [[22, 0, 0], [24, 6, 4], [18, 3, 0], [12, 7, 0], [9, 5, 9], [0, 0, 0], [3, 3, 3], [1, 1, 1]]
const ONE_WEEK = [[0, 0, 0], [0, 0, 0], [14, 2, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]
const ALL_FILLED = [[22, 0, 0], [24, 0, 0], [18, 0, 0], [12, 0, 0], [9, 0, 0], [8, 0, 0], [3, 0, 0], [1, 0, 0]]

const weekOf = (start, [shifts, open, draft]) => ({
  weekStart: start,
  shifts,
  filled: shifts - open,
  open,
  hoursFilled: (shifts - open) * 7.5,
  hoursOpen: open * 7.5,
  draft,
})

const FIXTURES = { mixed: MIXED, empty: Array(8).fill([0, 0, 0]), oneWeek: ONE_WEEK, allFilled: ALL_FILLED }

function byFixture(name, today) {
  const rows = FIXTURES[name] || MIXED
  const first = dayOf(mondayOf(today))
  return { today, weeks: rows.map((r, i) => weekOf(isoOf(first + i * 7), r)) }
}

module.exports = { byFixture, FIXTURES }
