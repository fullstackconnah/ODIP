// The budget graph's payloads for the mock API (GET participants/{id}/funding/ledger/series). Worked out from the participant's own recorded plan (funding.js), by the server's point rule
// (BudgetSeries.Build): the plan-start $0 point, every week end from the plan start, the plan end, today for a current plan, and the expected line's edge points. The spend is a steady weekly
// rate per fixture, not the ledger's rows: the screens it feeds are the chart's states, and every figure is fictional.
//
// Each demo participant with a plan has a fixture (p-0002 current, two pools; p-0003 ended, no agreement; p-0004 no agreement; p-0005 a mid-plan revision after a three-week gap), and
// `?fixture=` picks another for the captures: noSpend (a pool with nothing used), fourPool, noPricing, slow (2.5 s) and failing (500).

const DAY = 86_400_000
const dayOf = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY
const isoOf = (day) => new Date(day * DAY).toISOString().slice(0, 10)
const cents = (n) => Math.round(n * 100) / 100

/** One scope's points: `rate` is the daily spend as a share of an even spread of the limit, `covered` the runs of days an approved agreement covers. */
function seriesPoints({ planStart, planEnd, today, current, limit, rate, bookedRate, expectedRate, covered }) {
  const start = dayOf(planStart)
  const end = dayOf(planEnd)
  const now = dayOf(today)
  const lastUsed = current ? now : end
  const days = end - start + 1
  const daily = (share) => (limit * share) / days
  const usedTo = (d) => cents(daily(rate) * (Math.min(d, lastUsed) - start + 1))
  const expectedTo = (d) => cents(covered.reduce((sum, [from, to]) => sum + Math.max(0, Math.min(d, dayOf(to)) - dayOf(from) + 1), 0) * daily(expectedRate))
  const inRun = (d) => covered.some(([from, to]) => d >= dayOf(from) - 1 && d <= dayOf(to))

  const stops = new Set([end])
  for (let d = start + 6; d <= end; d += 7) stops.add(d)
  if (current) stops.add(now)
  const edges = new Set()
  for (const [from, to] of covered) {
    if (dayOf(from) > start && !stops.has(dayOf(from) - 1)) edges.add(dayOf(from) - 1)
    if (dayOf(to) < end && !stops.has(dayOf(to))) edges.add(dayOf(to))
  }

  const point = (d, isEdge) => {
    const p = { date: isoOf(d), budget: d === end ? limit : cents((limit * (d - start + 1)) / days), isEdge }
    if (d <= lastUsed) p.used = usedTo(d)
    if (current && d >= now && bookedRate > 0) p.usedAndBooked = cents(usedTo(now) + daily(bookedRate) * (d - now))
    if (covered.length > 0 && inRun(d)) p.expected = expectedTo(d)
    return p
  }
  const opening = { date: planStart, budget: 0, used: 0, isEdge: false }
  if (covered.some(([from]) => dayOf(from) === start)) opening.expected = 0
  return [opening, ...[...new Set([...stops, ...edges])].sort((a, b) => a - b).map((d) => point(d, edges.has(d)))]
}

/** The summary the server works out from the same figures (BudgetSeries.Build). */
function seriesSummary(points, { planStart, planEnd, today, current, limit }) {
  const at = current ? points.filter((p) => p.date === today).at(-1) : points.at(-1)
  const used = at.used ?? 0
  const summary = { used, evenToDate: at.budget, aheadOfEven: cents(used - at.budget) }
  const elapsed = (current ? dayOf(today) : dayOf(planEnd)) - dayOf(planStart) + 1
  const total = dayOf(planEnd) - dayOf(planStart) + 1
  if (current && elapsed * 100 >= total * 25) {
    summary.pace = cents((used * total) / elapsed)
    summary.paceGapAtEnd = cents(summary.pace - limit)
  }
  const last = points.at(-1)
  if (current && last.usedAndBooked !== undefined && last.usedAndBooked !== used) summary.bookedEnd = last.usedAndBooked
  const lastExpected = points.filter((p) => p.expected !== undefined).at(-1)
  if (lastExpected && lastExpected.expected > 0) {
    summary.expectedEnd = lastExpected.expected
    summary.expectedEndDate = lastExpected.date
  }
  if (!current) summary.leftAtEnd = cents(limit - used)
  return summary
}

/** The fixtures: a rate per pool (spend as a share of an even spread, 1 = even), what is booked ahead and what the agreement expects. */
const FIXTURES = {
  currentNormal: { rates: [1.12, 0.86], bookedRate: 0.9, expectedRate: 0.95 },
  ended: { rates: [0.93], bookedRate: 0, agreement: 'none' },
  noAgreement: { rates: [0.78], bookedRate: 0.7, agreement: 'none' },
  revision: { rates: [1.3, 0.6], bookedRate: 0.55, expectedRate: 1, agreement: 'revision' },
  noSpend: { rates: [1.05, 0], bookedRate: 0.9, expectedRate: 0.95 },
  fourPool: { rates: [1.12, 0.86, 0.5, 0.2], bookedRate: 0.9, expectedRate: 0.95, extraPools: ['Improved Living Arrangements', 'Assistive Technology'] },
}
const BY_PARTICIPANT = { 'p-0002': 'currentNormal', 'p-0003': 'ended', 'p-0004': 'noAgreement', 'p-0005': 'revision' }

/** The series for a participant's current (or last, ended) plan, or null to fall back to the chart's None. */
function seriesFor(plan, today, name) {
  const fixture = FIXTURES[name]
  if (!plan || !fixture) return null
  const { planStart, planEnd } = plan
  const current = planStart <= today && today <= planEnd
  const asOf = current ? today : planEnd
  const pools = plan.pools.map((p) => ({ scopeKey: p.id, name: p.name, limit: p.planTotal }))
  for (const extra of fixture.extraPools || []) pools.push({ scopeKey: `pool-${extra.length}`, name: extra, limit: 3000 })

  // The revision fixture: an agreement from ten days in, then a three-week gap before a revised one takes over, so the line starts late, breaks and carries a revision tick.
  const plus = (iso, n) => isoOf(dayOf(iso) + n)
  const startsOn = plus(planStart, 10)
  const changes = plus(planStart, 91)
  const covered = fixture.agreement === 'none' ? [] : fixture.agreement === 'revision' ? [[startsOn, plus(changes, -22)], [changes, planEnd]] : [[planStart, planEnd]]

  const scope = (pool, rate) => {
    const options = { planStart, planEnd, today: asOf, current, limit: pool.limit, rate, bookedRate: current && rate > 0 ? fixture.bookedRate : 0, expectedRate: fixture.expectedRate, covered }
    const points = seriesPoints(options)
    return { ...pool, points, summary: seriesSummary(points, options), unpricedShiftCount: 0, unpricedShiftReasons: [] }
  }
  const poolScopes = pools.map((pool, i) => scope(pool, fixture.rates[i] ?? 1))
  // The whole plan is the sum of its pools, point for point, as the server's is.
  const sum = (key) => (_, j) => poolScopes.some((s) => s.points[j][key] !== undefined) ? cents(poolScopes.reduce((t, s) => t + (s.points[j][key] ?? 0), 0)) : undefined
  const planPoints = poolScopes[0].points.map((p, j) => Object.fromEntries(Object.entries({
    date: p.date, budget: sum('budget')(p, j), used: sum('used')(p, j), usedAndBooked: sum('usedAndBooked')(p, j), expected: sum('expected')(p, j), isEdge: p.isEdge,
  }).filter(([, v]) => v !== undefined)))
  const limit = cents(pools.reduce((t, p) => t + p.limit, 0))
  const whole = { scopeKey: 'plan', name: 'The whole plan', limit, points: planPoints, summary: seriesSummary(planPoints, { planStart, planEnd, today: asOf, current, limit }), unpricedShiftCount: 0, unpricedShiftReasons: [] }

  const expected = fixture.agreement === 'none'
    ? { status: 'NoAgreement', revisionChanges: [], unpricedLineCount: 0 }
    : { status: 'Ok', ...(fixture.agreement === 'revision' ? { startsOn } : {}), revisionChanges: fixture.agreement === 'revision' ? [changes] : [], unpricedLineCount: 0 }
  return { chart: 'Ok', planStart, planEnd, today, planIsCurrent: current, expected, scopes: [whole, ...poolScopes] }
}

const noPricing = (plan, today) => ({
  chart: 'NoPricing', planStart: plan.planStart, planEnd: plan.planEnd, today, planIsCurrent: plan.planStart <= today && today <= plan.planEnd,
  expected: { status: 'Unavailable', revisionChanges: [], unpricedLineCount: 0 }, scopes: [],
})
const none = (today) => ({ chart: 'None', today, planIsCurrent: false, expected: { status: 'NoAgreement', revisionChanges: [], unpricedLineCount: 0 }, scopes: [] })

module.exports = { seriesFor, noPricing, none, FIXTURES, BY_PARTICIPANT }
