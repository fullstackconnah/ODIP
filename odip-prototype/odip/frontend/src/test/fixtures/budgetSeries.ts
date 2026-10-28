import type { BudgetExpected, BudgetSeries, BudgetSeriesPoint, BudgetSeriesScope, BudgetSeriesSummary } from '@/api/types'

// Builders for the budget graph's tests. The default is the ledger fixture's plan, 1 Jul 2026 to 30 Jun 2027, with the provider's today on 4 Oct 2026: two pools (Core $10,000 and
// Increased Social and Community Participation $2,000) and the whole plan over both, an approved agreement covering the plan, and shifts booked ahead. The figures stand in for the
// server's (a test is the only place they are worked out); the screen never adds anything up. A member with no value is left out, as the server leaves it.

const DAY = 86_400_000
const dayOf = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY
const isoOf = (day: number) => new Date(day * DAY).toISOString().slice(0, 10)
const cents = (n: number) => Math.round(n * 100) / 100

export interface PointsOptions {
  planStart?: string
  planEnd?: string
  today?: string
  limit?: number
  usedPerWeek?: number
  /** 0 books nothing ahead. */
  bookedPerWeek?: number
  expectedPerWeek?: number
  /** The runs of days an approved agreement covers; none draws no expected line. */
  covered?: Array<[string, string]>
}

/** Weekly points by the server's rule: the plan-start $0 point, every week end from the plan start, the plan end, today (current plan), and the expected line's edge points. */
export function seriesPoints(options: PointsOptions = {}): BudgetSeriesPoint[] {
  const { planStart = '2026-07-01', planEnd = '2027-06-30', today = '2026-10-04', limit = 12000, usedPerWeek = 210, bookedPerWeek = 150, expectedPerWeek = 240, covered = [[planStart, planEnd]] } = options
  const start = dayOf(planStart)
  const end = dayOf(planEnd)
  const now = dayOf(today)
  const current = now >= start && now <= end
  const lastUsed = current ? now : end
  const days = end - start + 1
  const usedTo = (d: number) => cents((usedPerWeek * (Math.min(d, lastUsed) - start + 1)) / 7)
  const expectedTo = (d: number) => cents(covered.reduce((sum, [from, to]) => sum + Math.max(0, Math.min(d, dayOf(to)) - dayOf(from) + 1), 0) * expectedPerWeek / 7)
  const inRun = (d: number) => covered.some(([from, to]) => d >= dayOf(from) - 1 && d <= dayOf(to))

  const stops = new Set<number>([end])
  for (let d = start + 6; d <= end; d += 7) stops.add(d)
  if (current) stops.add(now)
  const edges = new Set<number>()
  for (const [from, to] of covered) {
    if (dayOf(from) > start && !stops.has(dayOf(from) - 1)) edges.add(dayOf(from) - 1)
    if (dayOf(to) < end && !stops.has(dayOf(to))) edges.add(dayOf(to))
  }

  const point = (d: number, isEdge: boolean): BudgetSeriesPoint => {
    const p: BudgetSeriesPoint = { date: isoOf(d), budget: cents((limit * (d - start + 1)) / days), isEdge }
    if (d <= lastUsed) p.used = usedTo(d)
    if (current && d >= now && bookedPerWeek > 0) p.usedAndBooked = cents(usedTo(now) + (bookedPerWeek * (d - now)) / 7)
    if (covered.length > 0 && inRun(d)) p.expected = expectedTo(d)
    return p
  }
  const opening: BudgetSeriesPoint = { date: planStart, budget: 0, used: 0, isEdge: false }
  if (covered.some(([from]) => dayOf(from) === start)) opening.expected = 0
  return [opening, ...[...new Set([...stops, ...edges])].sort((a, b) => a - b).map((d) => point(d, edges.has(d)))]
}

/** The summary a scope's points imply, as the server works it out. */
export function seriesSummary(points: BudgetSeriesPoint[], options: PointsOptions = {}): BudgetSeriesSummary {
  const { planStart = '2026-07-01', planEnd = '2027-06-30', today = '2026-10-04', limit = 12000 } = options
  const current = dayOf(today) <= dayOf(planEnd)
  const at = current ? points.filter((p) => p.date === today).at(-1)! : points.at(-1)!
  const used = at.used ?? 0
  const summary: BudgetSeriesSummary = { used, evenToDate: at.budget, aheadOfEven: cents(used - at.budget) }
  const elapsed = dayOf(today) - dayOf(planStart)
  const total = dayOf(planEnd) - dayOf(planStart) + 1
  if (current && elapsed >= total / 4) {
    summary.pace = cents((used * total) / elapsed)
    summary.paceGapAtEnd = cents(summary.pace - limit)
  }
  const last = points.at(-1)!
  if (current && last.usedAndBooked !== undefined && last.usedAndBooked !== used) summary.bookedEnd = last.usedAndBooked
  const lastExpected = points.filter((p) => p.expected !== undefined).at(-1)
  if (lastExpected && lastExpected.expected! > 0) {
    summary.expectedEnd = lastExpected.expected
    summary.expectedEndDate = lastExpected.date
  }
  if (!current) summary.leftAtEnd = cents(limit - used)
  return summary
}

export function seriesScope(overrides: Partial<BudgetSeriesScope> = {}, options: PointsOptions = {}): BudgetSeriesScope {
  const limit = overrides.limit ?? options.limit ?? 12000
  const points = overrides.points ?? seriesPoints({ ...options, limit })
  return { scopeKey: 'plan', name: 'The whole plan', limit, points, summary: seriesSummary(points, { ...options, limit }), unpricedShiftCount: 0, unpricedShiftReasons: [], ...overrides }
}

export function expectedOk(overrides: Partial<BudgetExpected> = {}): BudgetExpected {
  return { status: 'Ok', revisionChanges: [], unpricedLineCount: 0, ...overrides }
}

/** The default series: the whole plan and two pools, today inside the plan. */
export function budgetSeries(overrides: Partial<BudgetSeries> = {}, options: PointsOptions = {}): BudgetSeries {
  const o = { planStart: '2026-07-01', planEnd: '2027-06-30', today: '2026-10-04', ...options }
  const noAgreement = overrides.expected && overrides.expected.status !== 'Ok'
  const scoped = (share: number): PointsOptions => ({
    ...o, limit: (options.limit ?? 12000) * share, usedPerWeek: (o.usedPerWeek ?? 210) * share, bookedPerWeek: (o.bookedPerWeek ?? 150) * share,
    expectedPerWeek: (o.expectedPerWeek ?? 240) * share, covered: noAgreement ? [] : o.covered,
  })
  return {
    chart: 'Ok', planStart: o.planStart, planEnd: o.planEnd, today: o.today, planIsCurrent: dayOf(o.today) <= dayOf(o.planEnd), expected: expectedOk(),
    scopes: [
      seriesScope({}, scoped(1)),
      seriesScope({ scopeKey: 'pool-core', name: 'Core' }, scoped(10 / 12)),
      seriesScope({ scopeKey: 'pool-9', name: 'Increased Social and Community Participation' }, scoped(2 / 12)),
    ],
    ...overrides,
  }
}
