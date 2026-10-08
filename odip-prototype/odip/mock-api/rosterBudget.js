// Budget phase 3 in the mock API: the roster's budget check, the shifts that carry the over-budget markers, the Admin's review task, and the warnings a Generate, an approval preview and a confirmed booking
// return. Kept in its own module like funding.js. Its arithmetic is the server's rule in miniature (ShiftBudgetAssessor): the figures are the mock ledger's (mock-ledger.js), so the numbers shown are worked
// out, not typed. Every name and figure is fictional, and a shift is priced at a flat $60 an hour (the real server prices by the catalogue).
//
// What it answers is chosen by two switches, like MOCK_COMPETENCY:
//   MOCK_BUDGET_MODE=warn|hard          the organisation's budget mode (default warn). Under hard, a one-off shift that raises the cost past the budget is Blocking for a Coordinator.
//   MOCK_BUDGET_CALLER=coordinator|admin who is saving (default coordinator). An Admin gets the same finding as a warning that needs a reason.
//   MOCK_BUDGET_WARNINGS=over           makes Generate, an approval preview and a confirmed booking each return a budget warning (Sienna's Core pool, which is forecast over this quarter).
// The demo participant is p-0002 (Sienna Whitfield): her Core (flexible) pool is forecast over in the current quarter (funding.js, mock-ledger.js). Every other participant has no budget, so nothing is said.
//
// A shift the mock cannot price answers the informational line the real server gives a shift its estimator cannot price: a sleepover or a passive night.

const { ledgerFor } = require('./mock-ledger.js')

const RATE = 60
const BLOCKING = 'Blocking'
const WRITTEN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const round2 = (n) => Math.round(n * 100) / 100
const money = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const dayMonth = (isoDate) => { const [, m, d] = isoDate.split('-').map(Number); return `${d} ${WRITTEN[m - 1]}` }
const dayMonthYear = (isoDate) => { const [y, m, d] = isoDate.split('-').map(Number); return `${d} ${WRITTEN[m - 1]} ${y}` }
const periodWords = (start, end) => (start.slice(0, 4) === end.slice(0, 4) ? `${dayMonth(start)}–${dayMonthYear(end)}` : `${dayMonthYear(start)}–${dayMonthYear(end)}`)

function hoursOf(start, end, endsNextDay) {
  const minutes = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0) }
  const span = endsNextDay ? 24 * 60 - minutes(start) + minutes(end) : minutes(end) - minutes(start)
  return Math.max(0, span) / 60
}

function create({ funding, respond, failEnvelope, rosterShifts, tasks, participants, today }) {
  const mode = () => (process.env.MOCK_BUDGET_MODE || 'warn').toLowerCase() === 'hard' ? 'HardLimit' : 'Warn'
  const callerIsAdmin = () => (process.env.MOCK_BUDGET_CALLER || 'coordinator').toLowerCase() === 'admin'
  const showsWarnings = () => (process.env.MOCK_BUDGET_WARNINGS || '').toLowerCase() === 'over'
  const approaching = () => funding.settings().approachingPercent

  /** The Core (flexible) period holding a date, with its ledger figures, or null when the participant has no budget, no such pool or the date is outside every period. */
  function periodFor(participantId, date) {
    const ledger = ledgerFor(funding.plansOf, participantId, today(), approaching())
    const pool = ledger.pools.find((p) => p.kind === 'CoreFlexible')
    const period = pool && pool.periods.find((p) => p.periodStart <= date && date <= p.periodEnd)
    return period ? { pool, period } : null
  }

  /** The findings of one candidate shift, and the line to say when it could not be checked. */
  function assess(body) {
    if (body.status === 'Cancelled') return { findings: [], note: null }
    if (body.nightType === 'Sleepover' || body.nightType === 'PassiveNight') {
      return { findings: [], note: 'Budget not checked: sleepover and passive night shifts are not priced yet.' }
    }
    const found = periodFor(body.participantId, body.serviceDate)
    if (!found) return { findings: [], note: null }
    const { pool, period } = found

    const cost = round2(hoursOf(body.startTime, body.endTime, body.endsNextDay) * RATE)
    const saved = body.id ? rosterShifts.find((s) => s.id === body.id) : null
    const oldCost = saved && saved.serviceDate >= period.periodStart && saved.serviceDate <= period.periodEnd ? round2(saved.durationHours * RATE) : 0
    const oneOff = saved ? saved.shiftPatternId == null : true
    const raises = cost > oldCost
    const available = period.available
    const used = period.used
    const forecast = round2(period.forecast - oldCost + cost)
    const figures = { poolName: pool.name, periodStart: period.periodStart, periodEnd: period.periodEnd, available, used, remaining: round2(available - used), forecast, shiftCost: cost, overBy: round2(Math.max(0, forecast - available)) }
    const when = periodWords(period.periodStart, period.periodEnd)
    const costWords = cost > 0 ? ` This shift: about ${money(cost)}.` : ''
    const findings = []
    if (forecast > available) {
      const hard = mode() === 'HardLimit' && oneOff && raises
      findings.push({
        code: 'BUDGET_FORECAST_OVER', severity: hard && !callerIsAdmin() ? BLOCKING : 'Warning', requiresReason: hard && callerIsAdmin(),
        message: `Takes ${pool.name} to ${money(forecast)} of ${money(available)} for ${when}.${costWords}`, budget: figures,
      })
    }
    if (used > available) {
      findings.push({ code: 'BUDGET_OVER', severity: 'Warning', requiresReason: false, message: `${pool.name} is already over for ${when}: ${money(used)} used of ${money(available)}.${costWords}`, budget: figures })
    } else if (available > 0 && used * 100 >= approaching() * available) {
      findings.push({ code: 'BUDGET_APPROACHING', severity: 'Warning', requiresReason: false, message: `${pool.name} is ${Math.floor((used * 100) / available)}% used for ${when}: ${money(used)} of ${money(available)}.${costWords}`, budget: figures })
    }
    return { findings, note: null }
  }

  /** The Admin's review task of an emergency booking, in the mock's task list (what the Tasks page shows). */
  function raiseTask(shift, participantName) {
    const id = `task-budget-${shift.id}`
    if (tasks.some((t) => t.id === id)) return
    tasks.push({
      id, participantBookingId: null, accommodationReservationId: null, vehicleAssignmentId: null, staffAssignmentId: null, taskType: 'BudgetEmergencyReview',
      title: `Review emergency shift past budget: ${participantName} on ${dayMonthYear(shift.serviceDate)}`, ownerId: null, ownerName: null, priority: 'Medium',
      dueDate: new Date(Date.parse(`${today()}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10), status: 'NotStarted', completedDate: null,
      linkTo: `/rostering?date=${shift.serviceDate}&participant=${shift.participantId}`, sourceKey: `budget-emergency:${shift.id}`, shiftId: shift.id,
    })
  }

  const dtoOf = (shift, findings) => ({ ...shift, findings })

  const get = []
  const post = [
    // The shift panel's live dry run: the findings, and the informational line in the envelope's message when the shift could not be checked.
    ['rostering/shifts/check', (body) => {
      const { findings, note } = assess(body)
      return note ? respond(200, { success: true, data: findings, message: note, errors: null }) : findings
    }],
    // Create: refuses what the server refuses, accepts an emergency (with the Admin's review task), and keeps the shift so the board shows it and its marker.
    ['rostering/shifts', (body) => {
      const { findings } = assess(body)
      const forecastOver = findings.find((f) => f.code === 'BUDGET_FORECAST_OVER')
      const emergency = !!body.emergency && !!forecastOver
      if (body.emergency && forecastOver && (body.overrideReason || '').trim().length < 10) {
        return respond(400, failEnvelope(null, ['Describe the emergency or safety need in at least 10 characters.']))
      }
      const gate = emergency ? findings.filter((f) => f.code !== 'BUDGET_FORECAST_OVER') : findings
      if (gate.some((f) => f.severity === BLOCKING)) {
        return respond(422, failEnvelope(findings, findings.map((f) => f.message), 'One or more blocking findings prevent this shift from being saved.'))
      }
      if (gate.some((f) => f.requiresReason) && !(body.overrideReason || '').trim()) {
        return respond(422, failEnvelope(findings, findings.map((f) => f.message), 'This shift has warnings that must be acknowledged with an override reason before it can be saved.'))
      }
      const adminOverride = !emergency && !!forecastOver && forecastOver.requiresReason
      const id = `shift-mock-${rosterShifts.length + 1}-${Date.now()}`
      const who = participants.find((p) => p.id === body.participantId)
      const shift = {
        id, participantId: body.participantId, participantName: who ? who.fullName : 'Participant', staffId: body.staffId || undefined, staffName: undefined, serviceDate: body.serviceDate,
        startTime: `${String(body.startTime).slice(0, 5)}:00`, endTime: `${String(body.endTime).slice(0, 5)}:00`, endsNextDay: !!body.endsNextDay,
        durationHours: hoursOf(body.startTime, body.endTime, body.endsNextDay), ratio: body.ratio, nightType: body.nightType, status: 'Draft', shiftPatternId: null, notes: body.notes || null,
        overrideReason: emergency ? `Emergency or safety: ${body.overrideReason.trim()}` : adminOverride ? body.overrideReason.trim() : null, assigneeOnApprovedLeave: false,
        ...(emergency ? { acknowledgedFindingCodes: ['BUDGET_EMERGENCY'], budgetReview: { state: 'Pending', recordedAt: new Date().toISOString(), reviewTaskTitle: `Review emergency shift past budget: ${who ? who.fullName : 'Participant'} on ${dayMonthYear(body.serviceDate)}` } } : adminOverride ? { acknowledgedFindingCodes: ['BUDGET_FORECAST_OVER'] } : {}),
      }
      rosterShifts.push(shift)
      if (emergency) raiseTask(shift, who ? who.fullName : 'Participant')
      return dtoOf(shift, findings)
    }],
  ]
  const put = []

  /** A budget warning for Sienna's Core pool, for the screens that show one (see MOCK_BUDGET_WARNINGS). Null unless the switch is on. */
  function sampleWarnings(noun, count) {
    if (!showsWarnings()) return null
    const found = periodFor('p-0002', today())
    if (!found) return null
    const { pool, period } = found
    const added = round2(count * 4 * RATE)
    const forecast = round2(period.forecast + added)
    if (forecast <= period.available) return null
    const subject = count === 1 ? `This ${noun} takes` : `These ${count} ${noun}s take`
    return [{
      poolName: pool.name, periodStart: period.periodStart, periodEnd: period.periodEnd, available: period.available, used: period.used, forecast, added, overBy: round2(forecast - period.available), count,
      message: `${subject} ${pool.name} to ${money(forecast)} of ${money(period.available)} for ${periodWords(period.periodStart, period.periodEnd)}.`,
    }]
  }

  return { get, post, put, assess, sampleWarnings, raiseTask }
}

module.exports = { create }
