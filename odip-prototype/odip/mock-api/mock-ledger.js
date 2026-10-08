// The budget ledger the mock serves (budget feature, phase 2a). Pure, like the real
// BudgetLedgerCalculator: a plan, today, the approaching percentage and the items go
// in, and the figures of every pool and period come out, so the mock's numbers are the
// server's rules rather than invented ones. The demo items are fixed below, and the
// two demo plans deliberately give one pool FORECAST OVER (its booked shifts would
// finish it over) and one APPROACHING, so both states can be seen without editing
// anything. Every name and figure here is fictional.

const round2 = (n) => Math.round(n * 100) / 100
const sum = (rows) => round2(rows.reduce((total, r) => total + r.amount, 0))
/** A plain total of counts (the rows of `sum` carry an amount; a count does not). */
const count = (numbers) => numbers.reduce((total, n) => total + n, 0)
/** Trips that have started and have no claim yet: the server counts such a booking once, however many categories its price is split across. */
const startedTrips = (rows) => new Set(rows.filter((r) => r.kind === 'TripBooking' && r.group === 'Pending').map((r) => r.id)).size

/** The worst status that applies, in the server's own words and arithmetic (decimals, no rounding deciding it). */
function statusOf(available, used, forecast, approachingPercent) {
  if (used > available) return 'Over'
  if (forecast > available) return 'ForecastOver'
  if (available > 0 && used * 100 >= approachingPercent * available) return 'Approaching'
  return 'OnTrack'
}

/** One period's figures from its parts, so available/used/forecast cannot disagree with them. */
function figures(limit, carried, claimed, pending, bookedAhead, approachingPercent, unpricedTripDayCount = 0) {
  const available = round2(limit + carried)
  const used = round2(claimed + pending)
  const forecast = round2(used + bookedAhead)
  return {
    limit: round2(limit), carried: round2(carried), available, claimed: round2(claimed), pending: round2(pending), used,
    bookedAhead: round2(bookedAhead), forecast, unpricedTripDayCount, remaining: round2(available - used), forecastRemaining: round2(available - forecast),
    status: statusOf(available, used, forecast, approachingPercent),
  }
}

/** The plan the figures are about: the one whose dates include today; with none, the latest that has started. */
function currentPlanOf(plans, today) {
  const started = plans.filter((p) => p.planStart <= today).sort((a, b) => (a.planStart < b.planStart ? 1 : -1))
  return started.find((p) => today <= p.planEnd) || started[0] || null
}

/** The pool an item of this category goes in: 01 to 04 in Core (flexible), anything else in the stated pool of that category, else none. */
function poolFor(plan, paceCategory, managementType) {
  const core = paceCategory >= 1 && paceCategory <= 4
  const candidates = plan.pools
    .filter((p) => (core ? p.kind === 'CoreFlexible' : p.kind === 'Stated' && p.paceCategory === paceCategory))
    .sort((a, b) => a.position - b.position)
  return candidates.find((p) => p.managementType === managementType) || candidates[0] || null
}

const byGroup = (rows, group) => rows.filter((r) => r.group === group)
const order = (rows) => [...rows].sort((a, b) => (
  a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.description).localeCompare(String(b.description))
))

/** A participant's ledger for the plan: every pool, every period, with the carry chained and the plan total. */
function computeLedger(plan, today, approachingPercent, items) {
  const held = new Map()
  const notInAPool = []
  const outsideThePlan = []
  for (const item of items) {
    if (item.date < plan.planStart || item.date > plan.planEnd) { outsideThePlan.push(item); continue }
    const pool = poolFor(plan, item.paceCategory, item.managementType)
    if (!pool) { notInAPool.push(item); continue }
    const period = pool.periods
      .filter((p) => p.periodStart <= item.date && item.date <= p.periodEnd)
      .sort((a, b) => (a.periodStart < b.periodStart ? -1 : 1))[0]
    if (!period) { outsideThePlan.push(item); continue }
    const key = `${pool.id}|${period.id}`
    if (!held.has(key)) held.set(key, [])
    held.get(key).push(item)
  }

  const pools = [...plan.pools].sort((a, b) => a.position - b.position).map((pool) => {
    const hasSetAside = pool.periods.length > 0 && pool.periods.every((p) => p.setAside !== undefined)
    let carried = 0
    const periods = [...pool.periods].sort((a, b) => (a.periodStart < b.periodStart ? -1 : 1)).map((period, position) => {
      const rows = order(held.get(`${pool.id}|${period.id}`) || [])
      const limit = hasSetAside ? period.setAside : period.planAmount
      const f = figures(limit, carried, sum(byGroup(rows, 'Claimed')), sum(byGroup(rows, 'Pending')), sum(byGroup(rows, 'BookedAhead')), approachingPercent,
        rows.reduce((total, r) => total + (r.unpricedTripDayCount || 0), 0))
      // What this period leaves unspent rolls into the next, and chains. Nothing carries between plans.
      carried = Math.max(0, round2(f.available - f.used))
      return {
        id: period.id, position, periodStart: period.periodStart, periodEnd: period.periodEnd,
        isCurrent: period.periodStart <= today && today <= period.periodEnd,
        pastUnresolvedCount: rows.filter((r) => r.kind === 'PastShift').length,
        startedUnclaimedTripCount: startedTrips(rows),
        rowCount: rows.length, rows: rows.slice(0, 200), ...f,
      }
    })
    const limit = sum(periods.map((p) => p.limit))
    const claimed = sum(periods.map((p) => p.claimed))
    const pending = sum(periods.map((p) => p.pending))
    const bookedAhead = sum(periods.map((p) => p.bookedAhead))
    return {
      id: pool.id, name: pool.name, kind: pool.kind, paceCategory: pool.paceCategory, managementType: pool.managementType, hasSetAside, periods,
      pastUnresolvedCount: count(periods.map((p) => p.pastUnresolvedCount)),
      startedUnclaimedTripCount: count(periods.map((p) => p.startedUnclaimedTripCount)),
      // The plan total is the same sums against the sum of the limits.
      planTotal: figures(limit, 0, claimed, pending, bookedAhead, approachingPercent, count(periods.map((p) => p.unpricedTripDayCount))),
    }
  })

  return {
    planId: plan.id, planStart: plan.planStart, planEnd: plan.planEnd,
    planIsCurrent: plan.planStart <= today && today <= plan.planEnd,
    asOf: today, timeBasis: 'Australia/Sydney', approachingPercent, pools,
    notInARecordedPool: bucket(notInAPool), outsideThePlanDates: bucket(outsideThePlan),
  }
}

function bucket(items) {
  const rows = order(items)
  return { count: rows.length, amount: sum(rows), rows: rows.slice(0, 200) }
}

/** A ledger row. The category and the way the money is managed are what the server works out from the record; the mock states them here. */
const row = (id, kind, group, date, description, amount, status, link, paceCategory, managementType, note) => ({
  id, kind, group, date, description, amount, status, link, paceCategory, managementType, ...(note ? { note } : {}),
})

// Community access (category 04, as the shift claim engine prices it only) in Core (flexible), the participant's plan type; Improved Daily Living Skills (15) in its stated pool; and
// two items in no recorded pool at all, so that bucket is never empty in the demo. Prices are the mock's own.
const AGENCY = 'AgencyManaged'
const PLANNED = 'PlanManaged'
const UNRESOLVED = 'Past shift not completed or cancelled'
const STARTED_TRIP = 'The trip has started and has no claim yet, so it is counted as pending.'

const demoItems = {
  // p-0002's plan: Core (flexible) is FORECAST OVER in the current quarter, Improved Daily Living Skills is APPROACHING.
  'fplan-0001': [
    // Q1 (Jul to Sep): claimed and pending, leaving $424 unspent that rolls into Q2.
    row('c1', 'ClaimLine', 'Claimed', '2026-08-04', 'TC-4301-20260804 · 04_Weekday_STD · 7.5 h', 517.5, 'Submitted', '/claims/claim-101', 4, AGENCY),
    row('c2', 'ClaimLine', 'Claimed', '2026-08-18', 'TC-4301-20260818 · 04_Weekday_STD · 6 h', 414, 'Paid', '/claims/claim-102', 4, AGENCY),
    row('c3', 'ClaimLine', 'Claimed', '2026-09-01', 'TC-4301-20260901 · 04_Weekday_Std_Aft · 4 h', 276, 'Submitted', '/claims/claim-103', 4, AGENCY),
    row('c4', 'ClaimLine', 'Claimed', '2026-09-22', 'TC-4301-20260922 · 04_Weekday_Weekend · 5 h', 402.5, 'PartiallyPaid', '/claims/claim-104', 4, AGENCY),
    row('s1', 'CompletedShift', 'Pending', '2026-09-28', 'Shift 09:00–17:00 · 8 h', 552, 'Completed', '/rostering?date=2026-09-28', 4, AGENCY),
    row('s2', 'PastShift', 'Pending', '2026-09-15', 'Shift 10:00–16:00 · 6 h', 414, 'Published', '/rostering?date=2026-09-15', 4, AGENCY, UNRESOLVED),
    row('d1', 'ClaimLine', 'Claimed', '2026-09-10', 'TC-4301-20260910 · 15_Weekday_STD · 5 h', 345, 'Submitted', '/claims/claim-105', 15, AGENCY),
    // Q2 (Oct to Dec, the current one): claimed and pending leave $1,354, and the booked shifts would finish it $1,512 over.
    row('c5', 'ClaimLine', 'Claimed', '2026-10-02', 'TC-4302-20261002 · 04_Weekday_STD · 8 h', 552, 'Submitted', '/claims/claim-110', 4, AGENCY),
    row('c6', 'ClaimLine', 'Claimed', '2026-10-09', 'TC-4302-20261009 · 04_Weekday_STD · 6 h', 414, 'Submitted', '/claims/claim-111', 4, AGENCY),
    row('d2', 'ClaimLine', 'Pending', '2026-10-06', 'TC-4302-20261006 · 04_Weekday_STD · 8 h', 552, 'Draft', '/claims/claim-112', 4, AGENCY),
    row('s3', 'CompletedShift', 'Pending', '2026-10-13', 'Shift 09:00–15:00 · 6 h', 414, 'Completed', '/rostering?date=2026-10-13', 4, AGENCY),
    row('f1', 'FutureShift', 'BookedAhead', '2026-11-03', 'Shift 09:00–17:00 · 8 h', 552, 'Published', '/rostering?date=2026-11-03', 4, AGENCY),
    row('f2', 'FutureShift', 'BookedAhead', '2026-11-17', 'Shift 13:00–21:00 · 8 h', 552, 'Draft', '/rostering?date=2026-11-17', 4, AGENCY),
    row('f3', 'FutureShift', 'BookedAhead', '2026-12-01', 'Shift 09:00–17:00 · 8 h', 552, 'InProgress', '/rostering?date=2026-12-01', 4, AGENCY),
    row('b1', 'TripBooking', 'BookedAhead', '2026-11-24', 'Oceanview retreat · 3 days', 1240, 'Confirmed', '/trips/trip-77', 4, AGENCY),
    // The stated pool in the current quarter: used is at the approaching line, with nothing booked after it.
    row('d3', 'ClaimLine', 'Claimed', '2026-10-05', 'TC-4302-20261005 · 15_Weekday_STD · 5 h', 345, 'Submitted', '/claims/claim-113', 15, AGENCY),
    row('d4', 'ClaimLine', 'Claimed', '2026-10-14', 'TC-4302-20261014 · 15_Weekday_STD · 7.5 h', 517.5, 'Submitted', '/claims/claim-114', 15, AGENCY),
    row('d5', 'ClaimLine', 'Claimed', '2026-10-20', 'TC-4302-20261020 · 15_Weekday_STD · 6 h', 414, 'Approved', '/claims/claim-115', 15, AGENCY),
    row('d6', 'CompletedShift', 'Pending', '2026-10-22', 'Shift 10:00–15:00 · 5 h', 345, 'Completed', '/rostering?date=2026-10-22', 15, AGENCY),
    row('d7', 'ClaimLine', 'Pending', '2026-10-27', 'TC-4302-20261027 · 15_Weekday_STD · 5 h', 345, 'Ready', '/claims/claim-116', 15, AGENCY),
    // In no recorded pool, and before the plan: shown, never dropped.
    row('x1', 'ClaimLine', 'Claimed', '2026-10-11', 'TC-4302-20261011 · 09_Weekday_STD · 3 h', 207, 'Submitted', '/claims/claim-117', 9, AGENCY),
    row('x2', 'ClaimLine', 'Claimed', '2026-06-20', 'TC-4301-20260620 · 04_Weekday_STD · 4 h', 276, 'Paid', '/claims/claim-090', 4, AGENCY),
  ],
  // p-0005's plan: Core (flexible) is OVER — claims and pending shifts have already passed what was
  // set aside for the quarter, and nothing is booked after them. The one genuinely-over pool in the demo.
  'fplan-0004': [
    // Q1 (Jul to Sep): $620 spent of $1,600, so $980 rolls into Q2.
    row('o1', 'ClaimLine', 'Claimed', '2026-08-06', 'TC-4309-20260806 · 04_Weekday_STD · 6 h', 414, 'Submitted', '/claims/claim-301', 4, PLANNED),
    row('o2', 'CompletedShift', 'Pending', '2026-09-17', 'Shift 09:00–12:00 · 3 h', 206, 'Completed', '/rostering?date=2026-09-17', 4, PLANNED),
    // Q2 (Oct to Dec, the current one): $1,780 used of the $1,600 set aside, so it is already over.
    row('o3', 'ClaimLine', 'Claimed', '2026-10-01', 'TC-4309-20261001 · 04_Weekday_STD · 8 h', 552, 'Submitted', '/claims/claim-302', 4, PLANNED),
    row('o4', 'ClaimLine', 'Claimed', '2026-10-15', 'TC-4309-20261015 · 04_Weekday_Weekend · 7.5 h', 517.5, 'Submitted', '/claims/claim-303', 4, PLANNED),
    row('o5', 'CompletedShift', 'Pending', '2026-10-21', 'Shift 13:00–18:00 · 5 h', 345, 'Completed', '/rostering?date=2026-10-21', 4, PLANNED),
    row('o6', 'ClaimLine', 'Pending', '2026-10-29', 'TC-4309-20261029 · 04_Weekday_STD · 8 h', 552, 'Draft', '/claims/claim-304', 4, PLANNED),
    // The stated pool in the current quarter is on track, so the participant has one pool of each risk.
    row('o7', 'ClaimLine', 'Claimed', '2026-10-08', 'TC-4309-20261008 · 15_Weekday_STD · 4 h', 276, 'Submitted', '/claims/claim-305', 15, PLANNED),
  ],
  // p-0004's plan: Core (flexible) is ON TRACK, and its single period carries $3,200 from nothing (a whole-year set-aside).
  'fplan-0002': [
    row('p1', 'ClaimLine', 'Claimed', '2026-08-12', 'TC-4303-20260812 · 04_Weekday_STD · 5 h', 345, 'Submitted', '/claims/claim-201', 4, PLANNED),
    row('p2', 'ClaimLine', 'Claimed', '2026-09-08', 'TC-4303-20260908 · 04_Weekday_STD · 4 h', 276, 'Submitted', '/claims/claim-202', 4, PLANNED),
    row('p3', 'FutureShift', 'BookedAhead', '2026-11-24', 'Shift 09:00–13:00 · 4 h', 276, 'Published', '/rostering?date=2026-11-24', 4, PLANNED),
    // A trip that has started and has no claim yet: pending, flagged, and a trip booking still (the server's rule: a booking is booked ahead only while its trip has not started).
    row('p4', 'TripBooking', 'Pending', '2026-10-02', 'Harbour weekend · 2 days', 480, 'Confirmed', '/trips/trip-76', 4, PLANNED, STARTED_TRIP),
  ],
}

/** What the ledger endpoint answers for this participant. No plan that has started: 200, with no plan and no pools. */
function ledgerFor(plansOf, participantId, today, approachingPercent) {
  const plan = currentPlanOf(plansOf(participantId), today)
  if (!plan) {
    return { planIsCurrent: false, asOf: today, timeBasis: 'Australia/Sydney', approachingPercent, pools: [], notInARecordedPool: bucket([]), outsideThePlanDates: bucket([]) }
  }
  return computeLedger(plan, today, approachingPercent, demoItems[plan.id] || [])
}

/** One more page of one period's rows, for "show more" once the first 200 are on screen. */
function rowsPage(ledger, poolId, periodId, skip, take) {
  const pool = ledger.pools.find((p) => p.id === poolId)
  if (!pool) return null
  const period = pool.periods.find((p) => p.id === periodId)
  if (!period) return null
  const from = Math.max(0, skip || 0)
  const count = Math.min(Math.max(1, take || 200), 500)
  return { total: period.rowCount, skip: from, rows: period.rows.slice(from, from + count) }
}

module.exports = { ledgerFor, rowsPage, computeLedger, statusOf, figures, currentPlanOf, poolFor }
