// The participant budget endpoints of the mock API (budget phase 1): api/v1/participants/{id}/funding/* and api/v1/funding/*. Kept in its own module like planPricing.js. It holds the
// plans in memory, so a create, a replace and "apply the dates" show in the next GET, and it answers the way the real API does: 400 with every reason in errors, 409 with a `code` and `data`
// for a stale revision or an overlapping plan. Two demo participants hold plans: p-0002 a 3-monthly one with a Core (flexible) pool and a stated pool (whose profile plan dates
// differ, so the Funding tab offers to use the plan's), p-0004 a plan with no funding periods, and p-0003 a plan that has ENDED (the tab and the intake card say so, and the readiness
// reason says the budget has ended). Every other participant has none ("No budget recorded"). All names and figures are fictional.

const DAY = 86_400_000
const day = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY
const iso = (n) => new Date(n * DAY).toISOString().slice(0, 10)
const WRITTEN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const say = (isoDate) => { const [y, m, d] = isoDate.split('-').map(Number); return `${d} ${WRITTEN[m - 1]} ${y}` }

const PACE_CATEGORIES = [
  [1, 'Assistance with Daily Life', 'Core', true], [2, 'Transport', 'Core', true], [3, 'Consumables', 'Core', true],
  [4, 'Assistance with Social, Economic and Community Participation', 'Core', true], [5, 'Assistive Technology', 'Capital', false], [6, 'Home Modifications', 'Capital', false],
  [7, 'Support Coordination and Psychosocial Recovery Coaches', 'CapacityBuilding', false], [8, 'Improved Living Arrangements', 'CapacityBuilding', false],
  [9, 'Increased Social and Community Participation', 'CapacityBuilding', false], [10, 'Finding and Keeping a Job', 'CapacityBuilding', false],
  [11, 'Relationships', 'CapacityBuilding', false], [12, 'Health and Wellbeing', 'CapacityBuilding', false], [13, 'Lifelong Learning', 'CapacityBuilding', false],
  [14, 'Choice and Control', 'CapacityBuilding', false], [15, 'Improved Daily Living Skills', 'CapacityBuilding', false], [16, 'Home and Living', 'Core', false],
  [17, 'Specialist Disability Accommodation', 'Capital', false], [18, 'Recurring Transport', 'Recurring', true], [19, 'Assistive Technology Maintenance, Repair and Rental', 'Capital', false],
  [20, 'Behaviour Support', 'CapacityBuilding', false], [21, 'Young People in Residential Aged Care', 'Core', false],
].map(([number, name, budget, flexible]) => ({ number, name, budget, flexible, offeredAsStatedPool: !(number >= 1 && number <= 4) && number !== 18 }))

/** Splits whole cents over periods in proportion to their days, the last taking the remainder (the editor's own rule). */
function splitByDays(total, periods) {
  const cents = Math.round(total * 100)
  const days = periods.map((p) => day(p[1]) - day(p[0]) + 1)
  const all = days.reduce((a, b) => a + b, 0)
  const parts = days.slice(0, -1).map((d) => Math.round((cents * d) / all))
  parts.push(cents - parts.reduce((a, b) => a + b, 0))
  return parts.map((c) => c / 100)
}

const QUARTERS = [['2026-07-01', '2026-09-30'], ['2026-10-01', '2026-12-31'], ['2027-01-01', '2027-03-31'], ['2027-04-01', '2027-06-30']]

let counter = 0
const newId = (prefix) => `${prefix}-${String(++counter).padStart(4, '0')}`

function pool({ position, kind, paceCategory, managementType, name, notes, periods }) {
  const total = periods.reduce((sum, p) => sum + Math.round(p.planAmount * 100), 0) / 100
  const allAside = periods.length > 0 && periods.every((p) => p.setAside !== undefined)
  return {
    id: newId('pool'), position, kind, paceCategory, managementType, name, ...(notes ? { notes } : {}), planTotal: total,
    ...(allAside ? { setAsideTotal: periods.reduce((sum, p) => sum + Math.round(p.setAside * 100), 0) / 100 } : {}),
    periods: periods.map((p, i) => ({ id: newId('period'), position: i, ...p })),
  }
}

function periodsOf(ranges, total, setAside) {
  const amounts = splitByDays(total, ranges)
  const asides = setAside === undefined ? null : splitByDays(setAside, ranges)
  return ranges.map(([periodStart, periodEnd], i) => ({ periodStart, periodEnd, planAmount: amounts[i], ...(asides ? { setAside: asides[i] } : {}) }))
}

const plansByParticipant = {
  'p-0002': [{
    id: 'fplan-0001', participantId: 'p-0002', planStart: '2026-07-01', planEnd: '2027-06-30', reassessmentDate: '2027-05-01', periodLengthMonths: 3, evidence: 'PlanCopy',
    confirmedOn: '2026-09-20', confirmedByName: 'Priya Nadarajah', notes: 'From the plan Sienna’s mother shared on 18 September.', revision: 2,
    createdAt: '2026-09-20T01:12:00Z', updatedAt: '2026-09-28T04:30:00Z',
    pools: [
      pool({ position: 0, kind: 'CoreFlexible', paceCategory: 0, managementType: 'AgencyManaged', name: 'Core (flexible)', periods: periodsOf(QUARTERS, 36000, 12000) }),
      pool({ position: 1, kind: 'Stated', paceCategory: 15, managementType: 'AgencyManaged', name: 'Improved Daily Living Skills', periods: periodsOf(QUARTERS, 4800) }),
    ],
  }, {
    id: 'fplan-0000', participantId: 'p-0002', planStart: '2025-07-01', planEnd: '2026-06-30', periodLengthMonths: 6, evidence: 'PlanManager', confirmedOn: '2025-08-02', confirmedByName: 'Callum Radford',
    revision: 1, createdAt: '2025-08-02T00:00:00Z', updatedAt: '2025-08-02T00:00:00Z',
    pools: [pool({ position: 0, kind: 'CoreFlexible', paceCategory: 0, managementType: 'AgencyManaged', name: 'Core (flexible)', periods: periodsOf([['2025-07-01', '2025-12-31'], ['2026-01-01', '2026-06-30']], 30000) })],
  }],
  'p-0003': [{
    id: 'fplan-0003', participantId: 'p-0003', planStart: '2025-07-01', planEnd: '2026-06-30', reassessmentDate: '2026-05-01', periodLengthMonths: 6, evidence: 'PlanManager', confirmedOn: '2025-08-04', confirmedByName: 'Callum Radford',
    revision: 1, createdAt: '2025-08-04T00:00:00Z', updatedAt: '2025-08-04T00:00:00Z',
    pools: [pool({ position: 0, kind: 'CoreFlexible', paceCategory: 0, managementType: 'PlanManaged', name: 'Core (flexible)', periods: periodsOf([['2025-07-01', '2025-12-31'], ['2026-01-01', '2026-06-30']], 24000, 9000) })],
  }],
  'p-0004': [{
    id: 'fplan-0002', participantId: 'p-0004', planStart: '2026-07-01', planEnd: '2027-06-30', reassessmentDate: '2027-04-15', evidence: 'PlanManager', confirmedOn: '2026-08-11', confirmedByName: 'Priya Nadarajah',
    revision: 1, createdAt: '2026-08-11T02:00:00Z', updatedAt: '2026-08-11T02:00:00Z',
    pools: [pool({ position: 0, kind: 'CoreFlexible', paceCategory: 0, managementType: 'PlanManaged', name: 'Core (flexible)', periods: [{ periodStart: '2026-07-01', periodEnd: '2027-06-30', planAmount: 52000, setAside: 40000 }] })],
  }],
}

/** What each participant's profile says the plan dates are (the Participant's own scalars): p-0002's differ from the recorded plan, p-0004's match. */
const profileDates = {
  'p-0002': { start: '2026-01-01', end: '2026-12-31' },
  'p-0003': { start: '2025-07-01', end: '2026-06-30' },
  'p-0004': { start: '2026-07-01', end: '2027-06-30' },
}

let settings = { mode: 'Warn', approachingPercent: 80, isDefault: true }
let billingSources = []

const fail = (errors, code, data) => {
  const body = { success: false, errors }
  if (code) body.code = code
  if (data) body.data = data
  return body
}

const plansOf = (participantId) => (plansByParticipant[participantId] ||= [])

/** The server's rules, in the server's words (a subset is enough for a mock: the editor validates the same things first). */
function validate(body) {
  const errors = []
  if (!body.planStart) errors.push('Give the day the plan starts.')
  if (!body.planEnd) errors.push('Give the day the plan ends.')
  if (body.planStart && body.planEnd && body.planEnd < body.planStart) errors.push('The plan ends before it starts.')
  if (body.periodLengthMonths != null && ![1, 3, 6, 12].includes(body.periodLengthMonths)) errors.push('Funding periods are 1, 3, 6 or 12 months long, or the plan has none.')
  if (!Array.isArray(body.pools) || body.pools.length === 0) errors.push('Add at least one pool from the plan.')
  const seen = new Set()
  for (const poolBody of body.pools || []) {
    const key = `${poolBody.paceCategory}|${poolBody.managementType}`
    if (seen.has(key)) errors.push('The plan lists a pool twice. A plan holds each category once for each way of managing it.')
    seen.add(key)
    if (poolBody.kind === 'Stated' && ((poolBody.paceCategory >= 1 && poolBody.paceCategory <= 4) || poolBody.paceCategory === 18)) errors.push('That category cannot be a stated pool.')
    if (!Array.isArray(poolBody.periods) || poolBody.periods.length === 0) errors.push('A pool needs at least one funding period.')
  }
  return errors
}

function overlapping(participantId, start, end, exceptId) {
  return plansOf(participantId).find((p) => p.id !== exceptId && p.planStart <= end && start <= p.planEnd)
}

function overlapFailure(body, clash) {
  return {
    status: 409,
    body: fail([`This plan (${say(body.planStart)} to ${say(body.planEnd)}) overlaps the plan that runs ${say(clash.planStart)} to ${say(clash.planEnd)}. Change the dates, or edit that plan.`], 'funding-plan-overlap',
      { conflictingPlanId: clash.id, conflictingPlanStart: clash.planStart, conflictingPlanEnd: clash.planEnd }),
  }
}

function build(body, participantId, existing) {
  const now = new Date().toISOString()
  const pools = body.pools.map((p, position) => {
    const periods = [...p.periods].sort((a, b) => (a.periodStart < b.periodStart ? -1 : 1))
    const stored = pool({
      position, kind: p.kind, paceCategory: p.paceCategory, managementType: p.managementType, notes: p.notes,
      name: (p.name && p.name.trim()) || (p.kind === 'CoreFlexible' ? 'Core (flexible)' : (PACE_CATEGORIES.find((c) => c.number === p.paceCategory) || {}).name || `Category ${p.paceCategory}`),
      periods: periods.map((x) => ({ periodStart: x.periodStart, periodEnd: x.periodEnd, planAmount: x.planAmount, ...(x.setAside !== undefined ? { setAside: x.setAside } : {}) })),
    })
    return stored
  })
  const clean = (text) => (typeof text === 'string' && text.trim() ? text.trim() : undefined)
  return {
    id: existing ? existing.id : newId('fplan'), participantId, planStart: body.planStart, planEnd: body.planEnd,
    ...(body.reassessmentDate ? { reassessmentDate: body.reassessmentDate } : {}), ...(body.periodLengthMonths != null ? { periodLengthMonths: body.periodLengthMonths } : {}),
    evidence: body.evidence, ...(body.confirmedOn ? { confirmedOn: body.confirmedOn } : {}), ...(clean(body.confirmedByName) ? { confirmedByName: clean(body.confirmedByName) } : {}),
    ...(clean(body.notes) ? { notes: clean(body.notes) } : {}), revision: existing ? existing.revision + 1 : 1, createdAt: existing ? existing.createdAt : now, updatedAt: now, pools,
  }
}

/**
 * Routes in the mock's own shape: [pattern, handler(...pathIds, body|searchParams)]. `respond` and `failEnvelope` come from server.js, so the dispatcher's status handling is reused.
 */
function create({ respond, fundingSources }) {
  billingSources = fundingSources
  const answer = (result) => (result.status ? respond(result.status, result.body) : result)

  const get = [
    ['funding/pace-categories', () => PACE_CATEGORIES],
    ['funding/settings', () => settings],
    ['participants/:id/funding/plans', (id) => ({
      plans: [...plansOf(id)].sort((a, b) => (a.planStart < b.planStart ? 1 : -1)),
      profilePlanDates: profileDates[id] || {},
    })],
    ['participants/:id/funding/billing-sources-hint', (id) => {
      const rows = billingSources
        .filter((f) => f.participantId === id && f.isActive && ['AgencyManaged', 'PlanManaged', 'SelfManaged'].includes(f.routeType) && f.budget > 0)
        .map((f) => ({ id: f.id, routeType: f.routeType, ...(f.budgetCategory ? { budgetCategory: f.budgetCategory } : {}), budget: f.budget, ...(f.planStartDate ? { planStartDate: f.planStartDate } : {}), ...(f.planEndDate ? { planEndDate: f.planEndDate } : {}) }))
      if (rows.length === 0) return { total: 0, rows: [] }
      const starts = rows.map((r) => r.planStartDate).filter(Boolean)
      const ends = rows.map((r) => r.planEndDate).filter(Boolean)
      const biggest = rows.reduce((best, r) => (r.budget > best.budget ? r : best), rows[0])
      return {
        total: rows.reduce((sum, r) => sum + r.budget, 0), ...(starts.length ? { planStart: starts.sort()[0] } : {}), ...(ends.length ? { planEnd: ends.sort().at(-1) } : {}),
        managementType: biggest.routeType, rows,
      }
    }],
  ]

  const post = [
    ['participants/:id/funding/plans', (id, body) => {
      const errors = validate(body)
      if (errors.length > 0) return respond(400, fail(errors))
      const clash = overlapping(id, body.planStart, body.planEnd)
      if (clash) return answer(overlapFailure(body, clash))
      const plan = build(body, id)
      plansOf(id).push(plan)
      return respond(201, { success: true, data: plan })
    }],
    ['participants/:id/funding/plans/:id/apply-dates-to-profile', (id, planId) => {
      const plan = plansOf(id).find((p) => p.id === planId)
      if (!plan) return respond(404, fail(['Plan not found.']))
      const before = profileDates[id] || {}
      const changed = before.start !== plan.planStart || before.end !== plan.planEnd
      profileDates[id] = { start: plan.planStart, end: plan.planEnd }
      return { start: plan.planStart, end: plan.planEnd, changed }
    }],
  ]

  const put = [
    ['participants/:id/funding/plans/:id', (id, planId, body) => {
      const existing = plansOf(id).find((p) => p.id === planId)
      if (!existing) return respond(404, fail(['Plan not found.']))
      const errors = validate(body)
      if (body.revision == null) errors.push('Say which version of the plan this change was made from (revision), so a change made by someone else in the meantime is not lost.')
      if (errors.length > 0) return respond(400, fail(errors))
      if (body.revision !== existing.revision) {
        return respond(409, fail(['This plan was changed by someone else since you opened it. Load the latest version, then make your change again.'], 'funding-revision-conflict', { currentRevision: existing.revision }))
      }
      const clash = overlapping(id, body.planStart, body.planEnd, planId)
      if (clash) return answer(overlapFailure(body, clash))
      const plan = build(body, id, existing)
      plansByParticipant[id] = plansOf(id).map((p) => (p.id === planId ? plan : p))
      return plan
    }],
    ['funding/settings', (body) => {
      if (body.mode !== undefined && !['Warn', 'HardLimit'].includes(body.mode)) return respond(400, fail(['Unknown budget mode. Use Warn or HardLimit.']))
      if (body.approachingPercent !== undefined && !(Number.isInteger(body.approachingPercent) && body.approachingPercent >= 50 && body.approachingPercent <= 95 && body.approachingPercent % 5 === 0)) {
        return respond(400, fail(['Warn when used reaches must be from 50 to 95 percent, in steps of 5.']))
      }
      settings = { ...settings, ...(body.mode !== undefined ? { mode: body.mode } : {}), ...(body.approachingPercent !== undefined ? { approachingPercent: body.approachingPercent } : {}), isDefault: false }
      return settings
    }],
  ]

  const del = [
    ['participants/:id/funding/plans/:id', (id, planId) => {
      const before = plansOf(id).length
      plansByParticipant[id] = plansOf(id).filter((p) => p.id !== planId)
      return before === plansOf(id).length ? respond(404, fail(['Plan not found.'])) : { deleted: true }
    }],
  ]

  /**
   * What the onboarding checklist's "Funding recorded" gate says: recorded when a plan has not ended, else whether the plans there are have ended (the reason then says the budget has ended
   * rather than that nothing is recorded). Today is the machine's, as in the screens.
   */
  const budgetStatus = (participantId) => {
    const today = new Date().toISOString().slice(0, 10)
    const plans = plansOf(participantId)
    const recorded = plans.some((p) => p.planEnd >= today)
    return { recorded, ended: !recorded && plans.length > 0 }
  }

  return { get, post, put, delete: del, budgetStatus }
}

module.exports = { create, PACE_CATEGORIES }
