// The budget warnings the mock serves (budget feature, phase 2b): the Budgets list (GET funding/budgets), the participant alerts the dashboard tile and the participant banners read
// (GET participants/alerts and participants/{id}/alerts, budget alerts only: the mock knows no other kind) and the agreement check (POST participants/{id}/funding/agreement-check).
// Pure, like mock-ledger.js, and they follow the same rules and the same words as the server (BudgetAlertRules, BudgetText, BudgetListService, AgreementCheckService), so the demo's sentences and
// figures are worked out from the ledger rather than typed. The demo: Sienna's Core is FORECAST OVER and her Improved Daily Living Skills APPROACHING, Dylan's Core is OVER, and Grace's Core is on
// track but the NDIA has refused one of her claims for want of funds (V27). Every name and figure here is fictional.

const { poolFor } = require('./mock-ledger.js')

const round2 = (n) => Math.round(n * 100) / 100
const WRITTEN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const say = (isoDate) => { const [y, m, d] = isoDate.split('-').map(Number); return `${d} ${WRITTEN[m - 1]} ${y}` }
const grouped = (whole) => String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** A sum of money as a sentence carries it: "$8,000" when it is whole dollars, else "$8,000.50". Never negative: a sentence says "over". */
function money(amount) {
  const cents = Math.round(Math.abs(amount) * 100)
  const whole = Math.trunc(cents / 100)
  return cents % 100 === 0 ? `$${grouped(whole)}` : `$${grouped(whole)}.${String(cents % 100).padStart(2, '0')}`
}

const MANAGEMENT = { SelfManaged: 'self managed', PlanManaged: 'plan managed', AgencyManaged: 'agency managed' }
const RISK = { Over: 0, ForecastOver: 1, Approaching: 2, OnTrack: 3 }
const SEVERITY = { Critical: 0, Warning: 1, Info: 2 }

/** What a pool is called in a sentence: the Core (flexible) pool under its default name is just "Core", and says how it is managed when a plan holds two of them. */
function poolLabel(pool, pools) {
  const name = pool.kind === 'CoreFlexible' && pool.name === 'Core (flexible)' ? 'Core' : pool.name
  const several = pools.filter((p) => p.kind === 'CoreFlexible').length > 1
  return pool.kind === 'CoreFlexible' && several ? `${name} (${MANAGEMENT[pool.managementType] || pool.managementType})` : name
}

/** What a status alert adds when the period's figures leave shifts out (the shift claim cannot price a sleepover, a passive night or a group shift yet): BudgetText.UnpricedShifts on the server. */
const withTheGap = (message, period) => {
  const n = period.unpricedShiftCount || 0
  if (n === 0) return message
  return n === 1 ? `${message}. 1 shift in this period is not priced yet, so this leaves it out` : `${message}. ${n} shifts in this period are not priced yet, so this leaves them out`
}

const nameOf = (person) => `${person.preferredName || person.firstName} ${person.lastName}`

// ── The participant alerts ───────────────────────────────────────────────────

const alert = (type, severity, message) => ({ type, severity, message, deepLinkTab: 'funding' })

/** One alert per pool for its worst status (never for a past or future period), and the NDIA's own word besides when it has refused a claim of the pool. None without a plan running now. */
function budgetAlertsOf(ledger) {
  if (!ledger.planId || !ledger.planIsCurrent) return []
  const alerts = []
  for (const pool of ledger.pools) {
    const period = pool.periods.find((p) => p.isCurrent)
    if (!period) continue
    const label = poolLabel(pool, ledger.pools)
    const end = say(period.periodEnd)
    if (period.status === 'Over') alerts.push(alert('budget-over', 'Critical', withTheGap(`${label} is ${money(period.used - period.available)} over this period's ${money(period.available)}`, period)))
    else if (period.status === 'ForecastOver') alerts.push(alert('budget-forecast-over', 'Warning', withTheGap(`Booked shifts would take ${label} ${money(period.forecast - period.available)} over by ${end}`, period)))
    else if (period.status === 'Approaching') alerts.push(alert('budget-approaching', 'Warning', withTheGap(`${label} is at ${Math.floor((period.used * 100) / period.available)}% of this period's ${money(period.available)} (to ${end})`, period)))
    if (pool.ndiaRejection) alerts.push(alert('budget-ndia-exhausted', 'Critical', `${label}: NDIA rejected a claim on ${say(pool.ndiaRejection.date)}: not enough funds (${pool.ndiaRejection.code})`))
  }
  return alerts
}

/** One participant's alerts, Critical first and then by type, with the counts that follow them. */
function alertsDto(person, ledger) {
  const alerts = budgetAlertsOf(ledger).sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity] || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0))
  return {
    participantId: person.id, participantName: nameOf(person), isActive: person.isActive, alerts,
    criticalCount: alerts.filter((a) => a.severity === 'Critical').length, warningCount: alerts.filter((a) => a.severity === 'Warning').length, infoCount: alerts.filter((a) => a.severity === 'Info').length,
  }
}

// ── The Budgets list ─────────────────────────────────────────────────────────

/** Every active participant's pools for the funding period running now, by risk and then by name, with the NDIS-funded participants who have no budget in force kept apart. */
function budgetList(people, ledgerOf, today, approachingPercent) {
  const rows = []
  const noBudget = []
  for (const person of people.filter((p) => p.isActive && !p.isDraft && p.planType)) {
    const ledger = ledgerOf(person.id)
    if (!ledger.planId) { noBudget.push({ participantId: person.id, participantName: nameOf(person), reason: 'NotRecorded' }); continue }
    if (!ledger.planIsCurrent) { noBudget.push({ participantId: person.id, participantName: nameOf(person), reason: 'PlanEnded', planEnd: ledger.planEnd }); continue }
    ledger.pools.forEach((pool, position) => {
      const period = pool.periods.find((p) => p.isCurrent)
      if (!period) return
      rows.push({
        participantId: person.id, participantName: nameOf(person), poolId: pool.id, poolName: poolLabel(pool, ledger.pools), kind: pool.kind, managementType: pool.managementType,
        periodStart: period.periodStart, periodEnd: period.periodEnd, available: period.available, used: period.used, bookedAhead: period.bookedAhead, forecast: period.forecast, status: period.status, unpricedShiftCount: period.unpricedShiftCount || 0, position,
      })
    })
  }
  rows.sort((a, b) => RISK[a.status] - RISK[b.status] || a.participantName.localeCompare(b.participantName) || a.position - b.position)
  noBudget.sort((a, b) => a.participantName.localeCompare(b.participantName))
  return { asOf: today, approachingPercent, rows: rows.map(({ position, ...row }) => row), noBudget }
}

// ── The agreement check ──────────────────────────────────────────────────────

/**
 * What an agreement would cost against what each pool has left, per funding period. Every priced line goes where the ledger would put it: the period is the line's service date, the pool is the
 * line's PACE category and the way the participant's money is managed. A pool and period the agreement does not touch is not mentioned; what no recorded pool covers and what falls outside the plan's
 * dates are sums of their own. With no plan running now there is nothing to compare with, and the answer is only that.
 */
function agreementCheckOf(ledger, planType, lines, periodFrom, periodTo, today) {
  if (!ledger.planId || !ledger.planIsCurrent) return { hasBudget: false, asOf: today, periodFrom, periodTo, agreementCost: 0, pools: [], notInARecordedPool: 0, outsideThePlan: 0 }

  const plan = { pools: ledger.pools.map((pool, position) => ({ ...pool, position })) }
  const byPeriod = new Map()
  let total = 0
  let notInAPool = 0
  let outside = 0
  for (const line of lines.filter((l) => l.isPriced && l.total > 0)) {
    total += line.total
    if (line.serviceDate < ledger.planStart || line.serviceDate > ledger.planEnd) { outside += line.total; continue }
    const pool = poolFor(plan, line.paceCategory, planType)
    if (!pool) { notInAPool += line.total; continue }
    const period = pool.periods.find((p) => p.periodStart <= line.serviceDate && line.serviceDate <= p.periodEnd)
    if (!period) { outside += line.total; continue }
    byPeriod.set(period.id, (byPeriod.get(period.id) || 0) + line.total)
  }

  const pools = []
  for (const pool of ledger.pools) {
    if (!pool.periods.some((p) => byPeriod.has(p.id))) continue
    // Walk ALL the pool's periods in date order (AgreementCarry on the server): what the agreement spends in an earlier period is not there for a later one, and the periods it does not touch
    // still carry. carry out = max(0, limit + carry in - used - agreement cost); with no agreement in the earlier periods it is the ledger's own chain.
    const ordered = [...pool.periods].sort((a, b) => (a.periodStart < b.periodStart ? -1 : a.periodStart > b.periodStart ? 1 : 0))
    let carry = Math.max(0, ordered[0].carried || 0)
    const periods = []
    for (const p of ordered) {
      const cost = byPeriod.has(p.id) ? round2(byPeriod.get(p.id)) : 0
      const available = round2(p.limit + carry)
      const remaining = round2(available - p.used)
      if (byPeriod.has(p.id)) {
        periods.push({ periodId: p.id, periodStart: p.periodStart, periodEnd: p.periodEnd, isCurrent: p.isCurrent, agreementCost: cost, available, used: p.used, remaining, overBy: Math.max(0, round2(cost - remaining)) })
      }
      carry = Math.max(0, round2(remaining - cost))
    }
    pools.push({
      poolId: pool.id, poolName: poolLabel(pool, ledger.pools), kind: pool.kind, managementType: pool.managementType,
      agreementCost: round2(periods.reduce((sum, p) => sum + p.agreementCost, 0)), over: periods.some((p) => p.overBy > 0), periods,
    })
  }
  return {
    hasBudget: true, planId: ledger.planId, planStart: ledger.planStart, planEnd: ledger.planEnd, asOf: today, periodFrom, periodTo,
    agreementCost: round2(total), pools, notInARecordedPool: round2(notInAPool), outsideThePlan: round2(outside),
  }
}

module.exports = { alertsDto, budgetAlertsOf, budgetList, agreementCheckOf, poolLabel, money }
