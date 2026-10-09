// Budget phase 3 in the mock API: the roster's budget check, the shifts that carry the over-budget markers, the Admin's review task, and the warnings a Generate, an approval preview and a confirmed booking
// return. Kept in its own module like funding.js. Its arithmetic is the server's rule in miniature (ShiftBudgetAssessor): the figures are the mock ledger's (mock-ledger.js), so the numbers shown are worked
// out, not typed, and a shift saved through the mock counts as booked ahead from then on, so a reopened shift quotes the same totals it was saved with. Every name and figure is fictional, and a shift is priced at
// a flat $60 an hour (the real server prices by the catalogue). The sentences are the server's, word for word (ShiftBudgetAssessor.Assess), with the no-break spaces round the en dash of a period.
//
// What it answers is chosen by switches, like MOCK_COMPETENCY. Each is an environment variable AND can be changed while the mock runs, with POST /api/v1/mock/budget (a test harness that cannot set the mock's
// environment, like the server screenshot run, changes the scene between states this way):
//   MOCK_BUDGET_MODE=warn|hard          the organisation's budget mode (default warn). Under hard, a one-off shift that raises the cost past the budget is Blocking for a Coordinator.
//   MOCK_BUDGET_CALLER=coordinator|admin who is saving (default coordinator). An Admin gets the same finding as a warning that needs a reason.
//   MOCK_BUDGET_WARNINGS=over           makes Generate, an approval preview and a confirmed booking each return a budget warning (Sienna's Core pool, which is forecast over this quarter).
// The body of POST /api/v1/mock/budget is any of { mode, caller, warnings, unpriced, review, reset }:
//   unpriced: N     says N shifts of the period could not be priced (the figures' own line); 0 says none
//   review: "Name"  completes the Admin's review of every emergency saved so far, as that person (the board reads Reviewed, the task reads Completed and owned)
//   reset: true     forgets every shift saved through the mock and every review task, and puts every switch back to its environment value
// It answers the settings now in force. The demo participant is p-0002 (Sienna Whitfield): her Core (flexible) pool is forecast over in the current quarter (funding.js, mock-ledger.js). Every other
// participant has no budget, so nothing is said.
//
// A shift the mock cannot price answers the informational line the real server gives a shift its estimator cannot price: a sleepover or a passive night. A shift with no length (it ends at or before its
// start, and does not end the next day) is refused, as the server refuses it.

const { ledgerFor } = require('./mock-ledger.js')

const RATE = 60
const BLOCKING = 'Blocking'
const NBSP = ' '
const EN_DASH = '–'
const WORD_JOINER = '⁠'
const WRITTEN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const NO_LENGTH_MESSAGE = "The shift must end after it starts. Tick 'Ends the next day' for an overnight shift."
const round2 = (n) => Math.round(n * 100) / 100
const money = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const dayMonth = (isoDate) => { const [, m, d] = isoDate.split('-').map(Number); return `${d} ${WRITTEN[m - 1]}` }
const dayMonthYear = (isoDate) => { const [y, m, d] = isoDate.split('-').map(Number); return `${d} ${WRITTEN[m - 1]} ${y}` }
// A no-break space on each side of the en dash and a word joiner after it, so a line never splits at the dash (the server's ShiftBudgetAssessor.Period: an en dash allows a break after it even in front of a no-break space).
const dash = `${NBSP}${EN_DASH}${WORD_JOINER}${NBSP}`
// Each date is one unit too (no-break spaces between its day, month and year), so "1 Oct" never splits.
const whole = (date) => date.replace(/ /g, NBSP)
const periodWords = (start, end) => (start.slice(0, 4) === end.slice(0, 4) ? `${whole(dayMonth(start))}${dash}${whole(dayMonthYear(end))}` : `${whole(dayMonthYear(start))}${dash}${whole(dayMonthYear(end))}`)

function minutesOf(t) {
  const [h, m] = String(t).split(':').map(Number)
  return h * 60 + (m || 0)
}

/** The length in minutes the server works out, which is zero or less for a shift that ends at or before its start (and does not end the next day). */
function lengthMinutes(start, end, endsNextDay) {
  return endsNextDay ? 24 * 60 - minutesOf(start) + minutesOf(end) : minutesOf(end) - minutesOf(start)
}

function hoursOf(start, end, endsNextDay) {
  return Math.max(0, lengthMinutes(start, end, endsNextDay)) / 60
}

function create({ funding, respond, failEnvelope, rosterShifts, tasks, participants, today }) {
  // null means "what the environment says"; a harness changes these while the mock runs (POST mock/budget).
  const overrides = { mode: null, caller: null, warnings: null, unpriced: 0 }
  const setting = (key, envName, fallback) => (overrides[key] ?? process.env[envName] ?? fallback)
  const mode = () => (String(setting('mode', 'MOCK_BUDGET_MODE', 'warn')).toLowerCase() === 'hard' ? 'HardLimit' : 'Warn')
  const callerIsAdmin = () => String(setting('caller', 'MOCK_BUDGET_CALLER', 'coordinator')).toLowerCase() === 'admin'
  const showsWarnings = () => String(setting('warnings', 'MOCK_BUDGET_WARNINGS', '')).toLowerCase() === 'over'
  const approaching = () => funding.settings().approachingPercent

  /**
   * The Core (flexible) period holding a date, with its ledger figures, or null when the participant has no budget, no such pool or the date is outside every period. A shift saved through the mock (or made by an
   * approval) is booked ahead in its period from then on, so a shift reopened quotes the totals it was saved with and a second shift sees the first.
   */
  function periodFor(participantId, date) {
    const ledger = ledgerFor(funding.plansOf, participantId, today(), approaching())
    const pool = ledger.pools.find((p) => p.kind === 'CoreFlexible')
    const period = pool && pool.periods.find((p) => p.periodStart <= date && date <= p.periodEnd)
    if (!period) return null
    const saved = round2(rosterShifts
      .filter((s) => s.participantId === participantId && s.status !== 'Cancelled' && s.serviceDate >= period.periodStart && s.serviceDate <= period.periodEnd)
      .reduce((sum, s) => sum + (s.durationHours || 0) * RATE, 0))
    return { pool, period: { ...period, bookedAhead: round2(period.bookedAhead + saved), forecast: round2(period.forecast + saved) } }
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
    const forecastWithout = round2(forecast - cost)
    const overBy = round2(Math.max(0, forecast - available))
    const figures = {
      poolName: pool.name, periodStart: period.periodStart, periodEnd: period.periodEnd, available, used, remaining: round2(available - used), forecast, shiftCost: cost, overBy,
      bookedAhead: round2(period.bookedAhead - oldCost), unpricedShiftCount: overrides.unpriced,
    }
    const when = periodWords(period.periodStart, period.periodEnd)
    const findings = []
    if (forecast > available) {
      const hard = mode() === 'HardLimit' && oneOff && raises
      // The server's sentence: the lead-in the spec names, how far over, that the period was already over without this shift when it was, then the shift's own cost.
      const already = forecastWithout > available ? ` It was already ${money(round2(forecastWithout - available))} over without this shift.` : ''
      const costWords = cost > 0 ? ` This shift: about ${money(cost)}.` : ''
      findings.push({
        code: 'BUDGET_FORECAST_OVER', severity: hard && !callerIsAdmin() ? BLOCKING : 'Warning', requiresReason: hard && callerIsAdmin(),
        message: `Takes ${pool.name} to ${money(forecast)} of ${money(available)} for ${when}, ${money(overBy)} over.${already}${costWords}`, budget: figures,
      })
    }
    if (used > available) {
      findings.push({ code: 'BUDGET_OVER', severity: 'Warning', requiresReason: false, message: `${pool.name} is already over for ${when}: ${money(used)} used of ${money(available)}.`, budget: figures })
    } else if (available > 0 && used * 100 >= approaching() * available) {
      findings.push({ code: 'BUDGET_APPROACHING', severity: 'Warning', requiresReason: false, message: `${pool.name} is ${Math.floor((used * 100) / available)}% used for ${when}: ${money(used)} of ${money(available)}.`, budget: figures })
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

  /** An Admin completes the review of every emergency saved so far: the shift's review reads Reviewed, by that person, and the task is Completed and theirs. */
  function completeReviews(reviewer) {
    for (const shift of rosterShifts) {
      if (!shift.budgetReview || shift.budgetReview.state !== 'Pending') continue
      shift.budgetReview = { ...shift.budgetReview, state: 'Reviewed', reviewedOn: today(), reviewedBy: reviewer }
      const task = tasks.find((t) => t.id === `task-budget-${shift.id}`)
      if (task) Object.assign(task, { status: 'Completed', completedDate: today(), ownerName: reviewer })
    }
  }

  /** Forgets every shift saved through the mock and every review task, and puts every switch back to its environment value. */
  function reset() {
    rosterShifts.splice(0)
    for (let i = tasks.length - 1; i >= 0; i--) if (String(tasks[i].id).startsWith('task-budget-')) tasks.splice(i, 1)
    Object.assign(overrides, { mode: null, caller: null, warnings: null, unpriced: 0 })
  }

  const dtoOf = (shift, findings) => ({ ...shift, findings })

  const get = []
  const post = [
    // The scene, for a harness that cannot set the mock's environment (see the header). Answers the settings now in force.
    ['mock/budget', (body) => {
      const change = body || {}
      if (change.reset) reset()
      if (change.mode !== undefined) overrides.mode = change.mode
      if (change.caller !== undefined) overrides.caller = change.caller
      if (change.warnings !== undefined) overrides.warnings = change.warnings
      if (change.unpriced !== undefined) overrides.unpriced = Math.max(0, Number(change.unpriced) || 0)
      if (change.review) completeReviews(String(change.review))
      return { mode: mode(), caller: callerIsAdmin() ? 'admin' : 'coordinator', warnings: showsWarnings() ? 'over' : '', unpriced: overrides.unpriced, shifts: rosterShifts.length }
    }],
    // The shift panel's live dry run: the findings, and the informational line in the envelope's message when the shift could not be checked.
    ['rostering/shifts/check', (body) => {
      if (lengthMinutes(body.startTime, body.endTime, body.endsNextDay) <= 0) return respond(400, failEnvelope(null, [NO_LENGTH_MESSAGE]))
      const { findings, note } = assess(body)
      return note ? respond(200, { success: true, data: findings, message: note, errors: null }) : findings
    }],
    // Create: refuses what the server refuses, accepts an emergency (with the Admin's review task), and keeps the shift so the board shows it and its marker.
    ['rostering/shifts', (body) => {
      if (lengthMinutes(body.startTime, body.endTime, body.endsNextDay) <= 0) return respond(400, failEnvelope(null, [NO_LENGTH_MESSAGE]))
      const { findings } = assess(body)
      const forecastOver = findings.find((f) => f.code === 'BUDGET_FORECAST_OVER')
      const emergency = !!body.emergency && !!forecastOver
      if (body.emergency && forecastOver && (body.overrideReason || '').trim().length < 10) {
        return respond(400, failEnvelope(null, ['Describe the emergency or safety need in at least 10 characters.']))
      }
      if (body.emergency && (body.overrideReason || '').trim().length > 1900) {
        return respond(400, failEnvelope(null, ['Describe the emergency or safety need in at most 1,900 characters.']))
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
        overrideReason: emergency ? `Emergency or safety: ${body.overrideReason.trim()}` : adminOverride ? body.overrideReason.trim() : null, assigneeOnApprovedLeave: false, findings: [],
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
    const overBy = round2(forecast - period.available)
    const subject = count === 1 ? `This ${noun} takes` : `These ${count} ${noun}s take`
    return [{
      poolName: pool.name, periodStart: period.periodStart, periodEnd: period.periodEnd, available: period.available, used: period.used, forecast, added, overBy, count,
      message: `${subject} ${pool.name} to ${money(forecast)} of ${money(period.available)} for ${periodWords(period.periodStart, period.periodEnd)}, ${money(overBy)} over.`,
      // A booking's warning says whose pool it is (a trip's bookings confirmed together list one line each).
      ...(noun === 'booking' ? { participantName: 'Sienna Whitfield' } : {}),
    }]
  }

  return { get, post, put, assess, sampleWarnings, raiseTask }
}

module.exports = { create }
