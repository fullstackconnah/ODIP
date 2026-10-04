// Plan builder phase D in the mock: "Mark approved" for the newest revision of an agreement draft. Follows the real server's shapes and rules (BE: ServiceAgreementApprovalService,
// AgreementPatternMapper, RosterShiftGenerator), kept in memory so the patterns page and the roster board show what an approval made. Plain functions over the stores server.js owns.
//
//   preview(...)  GET  participants/:id/service-agreement-drafts/:id/approval-preview   what approving would do, nothing done
//   approve(...)  POST participants/:id/service-agreement-drafts/:id/approve            records it, makes the patterns, ends the old ones, generates unfilled shifts
//
// "Today" is the provider's calendar date (Sydney), never the UTC date. The horizon is 56 days.

const HORIZON_DAYS = 56
const MAX_PATTERNS = 100
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const ZONE_OF_STATE = { VIC: 'Australia/Sydney', NSW: 'Australia/Sydney', ACT: 'Australia/Sydney', TAS: 'Australia/Sydney', QLD: 'Australia/Brisbane', SA: 'Australia/Adelaide', WA: 'Australia/Perth', NT: 'Australia/Darwin' }
const PROVIDER_STATE = 'NSW'
const SUPERSEDED = 'A newer revision of this agreement draft exists. Approve the latest revision instead.'
const HAND_TYPED = "Rebuild it from blocks to approve it. This revision's lines were typed by hand, so there are no support blocks to make weekly patterns from."

// ── Dates (yyyy-mm-dd, calendar arithmetic only) ─────────────────────────────

const toDay = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000)
const fromDay = (day) => new Date(day * 86_400_000).toISOString().slice(0, 10)
const addDays = (iso, n) => fromDay(toDay(iso) + n)
const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay()
const earlier = (a, b) => (a < b ? a : b)
const later = (a, b) => (a > b ? a : b)

/** Whether the daily top-up is on, as the server reports it (RosterTopUp:Enabled). MOCK_TOP_UP=off switches it off, to see the screens that must not promise shifts "added each day". */
const topUpEnabled = () => process.env.MOCK_TOP_UP !== 'off'

/** The provider's calendar date now. MOCK_TODAY pins it for a screenshot or a test. */
function providerToday() {
  if (process.env.MOCK_TODAY) return process.env.MOCK_TODAY
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE_OF_STATE[PROVIDER_STATE], year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

// ── Block -> patterns ───────────────────────────────────────────────────────

function ratioOf(workers, present) {
  if (workers === 1 && present === 1) return 'OneToOne'
  if (workers === 2 && present === 1) return 'TwoToOne'
  if (workers === 1 && present === 2) return 'OneToTwo'
  if (workers === 1 && present === 3) return 'OneToThree'
  if (workers === 1 && present === 4) return 'OneToFour'
  if (workers === 1 && present === 5) return 'OneToFive'
  if (workers === 1 && present > 5) return 'SharedSupport'
  return 'Other'
}

const endsNextDay = (block) => block.end <= block.start
const settingLabel = { Community: 'community', Centre: 'centre', AtHome: 'at home', Accommodation: 'accommodation' }
const supportLabel = { PersonalCare: 'Personal care', CommunityAccess: 'Community access', GroupActivity: 'Group activity', StaSupport: 'Short-term accommodation support' }
const mondayFirst = (day) => (DAYS.indexOf(day) + 6) % 7

function patternCount(blocks) {
  return blocks.reduce((sum, entry) => sum + (entry.block.days || []).length * Math.max(entry.block.workers || 1, 1), 0)
}

function patternsOf(draft, newId) {
  const made = []
  for (const entry of draft.blocks) {
    const block = entry.block
    const requirements = { workerGender: 'NoPreference', driver: false, skills: [], ...(entry.requirements || {}) }
    for (const day of [...block.days].sort((a, b) => mondayFirst(a) - mondayFirst(b))) {
      for (let slot = 1; slot <= Math.max(block.workers || 1, 1); slot++) {
        made.push({
          id: newId(), participantId: draft.participantId, participantName: '', defaultStaffId: null, defaultStaffName: null, dayOfWeek: day,
          startTime: block.start, endTime: block.end, endsNextDay: endsNextDay(block), ratio: ratioOf(block.workers || 1, block.participantsPresent || 1),
          nightType: block.workerMaySleep ? 'Sleepover' : endsNextDay(block) ? 'ActiveNight' : 'None', effectiveFrom: draft.agreementStartDate, effectiveTo: draft.agreementEndDate, isActive: true,
          notes: `From agreement v${draft.version}: ${supportLabel[block.supportType] || 'Support'}, ${settingLabel[block.setting] || 'community'}`,
          sourceDraftId: draft.id, sourceBlockKey: block.id, sourceDraftVersion: draft.version, workerSlot: slot, requirements,
        })
      }
    }
  }
  return made
}

// ── What stops it: the stored pricing ──────────────────────────────────────

const flagsText = (line) => String(line.flags || 'None')
const MERGED_PER_MESSAGE = new Set(['InvalidInput', 'BlocksOverlap'])

function pricingReasons(draft) {
  const pricing = draft.pricing
  const needsReview = !!pricing && ((pricing.issues || []).length > 0 || (pricing.totals && pricing.totals.reviewLines > 0))
  if (!needsReview) return []
  const reasons = []
  const groups = new Map()
  for (const issue of pricing.issues || []) {
    const key = `${issue.blockId}|${issue.reason}|${MERGED_PER_MESSAGE.has(issue.reason) ? issue.message : ''}`
    const seen = groups.get(key)
    if (!seen) groups.set(key, { ...issue })
    else { seen.count = Math.max(seen.count, issue.count); if (issue.firstDate && (!seen.firstDate || issue.firstDate < seen.firstDate)) seen.firstDate = issue.firstDate }
  }
  for (const issue of groups.values()) reasons.push({ code: issue.reason, message: issue.message, blockId: issue.blockId, count: issue.count, ...(issue.firstDate ? { firstDate: issue.firstDate } : {}) })
  const byBlock = new Map()
  for (const holiday of pricing.holidayOccurrences || []) if (holiday.decision === 'Review') byBlock.set(holiday.blockId, [...(byBlock.get(holiday.blockId) || []), holiday])
  for (const [blockId, holidays] of byBlock) {
    const first = [...holidays].sort((a, b) => (a.date < b.date ? -1 : 1))[0]
    const many = holidays.length > 1
    const what = many ? `${holidays.length} public holidays have no decision yet (the first is ${first.holidayName} on ${first.date})` : `a public holiday has no decision yet (${first.holidayName} on ${first.date})`
    reasons.push({ code: 'HolidayUndecided', message: `Block '${blockId}': ${what}. Choose Charge or Skip for ${many ? 'each' : 'it'}, then save a new revision.`, blockId, count: holidays.length, firstDate: first.date })
  }
  const reasoned = new Set(reasons.map((reason) => reason.blockId))
  for (const blockId of new Set((draft.lines || []).filter((line) => flagsText(line).includes('Review') && line.blockId).map((line) => line.blockId))) {
    if (!reasoned.has(blockId)) reasons.push({ code: 'ReviewFlag', message: `Block '${blockId}': some of its lines are flagged for review. Decide them in the block's Review step, then save a new revision.`, blockId })
  }
  if (reasons.length === 0) reasons.push({ code: 'ReviewFlag', message: "Some lines of this plan are flagged for review. Decide them in each block's Review step, then save a new revision." })
  return reasons
}

// ── Overlaps and the old version ────────────────────────────────────────────

const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
const weeklyWindow = (pattern) => [minutes(pattern.startTime), minutes(pattern.endTime) + (pattern.endsNextDay ? 1440 : 0)]

function overlaps(a, b) {
  if (a.dayOfWeek !== b.dayOfWeek) return false
  if (a.effectiveTo && a.effectiveTo < b.effectiveFrom) return false
  if (b.effectiveTo && b.effectiveTo < a.effectiveFrom) return false
  const [aStart, aEnd] = weeklyWindow(a)
  const [bStart, bEnd] = weeklyWindow(b)
  return aStart < bEnd && bStart < aEnd
}

function earlierApproved(store, draft) {
  return (store.drafts[draft.participantId] || []).filter((d) => d.approval && d.version < draft.version)
}

function oldShifts(store, draft) {
  const ids = new Set(store.patterns.filter((p) => earlierApproved(store, draft).some((d) => d.id === p.sourceDraftId)).map((p) => p.id))
  // What a coordinator can still tidy: drafts and published shifts, from the day the new revision starts or today, whichever is later.
  const today = providerToday()
  const from = draft.agreementStartDate > today ? draft.agreementStartDate : today
  const standing = store.shifts.filter((s) => ids.has(s.shiftPatternId) && s.serviceDate >= from && (s.status === 'Draft' || s.status === 'Published'))
  const versions = earlierApproved(store, draft).map((d) => d.version)
  return {
    open: standing.filter((s) => !s.staffId).length, assigned: standing.filter((s) => s.staffId).length,
    ...(standing.length > 0 ? { firstDate: standing.map((s) => s.serviceDate).sort()[0] } : {}), ...(versions.length > 0 ? { fromVersion: Math.max(...versions) } : {}),
  }
}

// ── The plan: what approving would do ───────────────────────────────────────

function plan(store, participant, draft) {
  const today = providerToday()
  const newest = Math.max(...(store.drafts[draft.participantId] || []).map((d) => d.version))
  const result = { reasons: [], newPatterns: [], toEnd: [], overlapping: [], shiftsToCreate: 0, shiftsNote: undefined, from: later(today, draft.agreementStartDate), horizonEnd: earlier(draft.agreementEndDate, addDays(today, HORIZON_DAYS)), ready: false }
  if (draft.approval) { result.reasons.push({ code: 'AlreadyApproved', message: `This revision was approved for rostering by ${draft.approval.approvedByName} on ${draft.approval.approvedAt.slice(0, 10)}.` }); return result }
  if (draft.version < newest) { result.superseded = newest; result.reasons.push({ code: 'Superseded', message: SUPERSEDED }); return result }
  if (!draft.blocks || draft.blocks.length === 0 || !draft.pricing) result.reasons.push({ code: 'HandTyped', message: HAND_TYPED })
  else result.reasons.push(...pricingReasons(draft))
  if (draft.agreementEndDate < today) result.reasons.push({ code: 'AgreementEnded', message: `This agreement ended on ${draft.agreementEndDate}, before today (${today}): there is nothing left to roster.` })
  const zone = ZONE_OF_STATE[draft.state] || 'Australia/Sydney'
  if (zone !== ZONE_OF_STATE[PROVIDER_STATE]) result.reasons.push({ code: 'TimeZoneMismatch', message: `This agreement is delivered in ${draft.state} (${zone}), but your organisation's roster runs on ${ZONE_OF_STATE[PROVIDER_STATE]} time. Block times are read on the delivery state's clock, so the weekly patterns would land at a different real time. Rostering across time zones is not supported yet.` })
  if (draft.blocks && draft.blocks.length > 0) {
    const count = patternCount(draft.blocks)
    if (count > MAX_PATTERNS) result.reasons.push({ code: 'TooManyPatterns', message: `Approving would make ${count} weekly patterns, and one approval makes at most ${MAX_PATTERNS}. Remove blocks or split the plan, then save a new revision.` })
    else result.newPatterns = patternsOf(draft, () => 'pending')
  }
  const endsOn = addDays(draft.agreementStartDate, -1)
  const previous = earlierApproved(store, draft)
  result.toEnd = store.patterns.filter((p) => previous.some((d) => d.id === p.sourceDraftId) && (!p.effectiveTo || p.effectiveTo > endsOn))
  result.endsFromVersion = result.toEnd.length > 0 ? Math.max(...result.toEnd.map((p) => p.sourceDraftVersion)) : undefined
  result.endsOn = endsOn
  result.overlapping = store.patterns.filter((p) => p.participantId === draft.participantId && !p.sourceDraftId && p.isActive && result.newPatterns.some((made) => overlaps(p, made)))
  result.oldShifts = oldShifts(store, draft)
  result.ready = !!participant && participant.isActive !== false && !participant.isDraft
  if (!result.ready) {
    const who = participant ? participant.firstName : 'the participant'
    // As the server says it: "created once active" is the daily top-up's work, so with it off the note promises nothing.
    result.shiftsNote = topUpEnabled()
      ? `Unfilled shifts are created once ${who} is active.`
      : `No shifts are made now, because ${who} is not active yet. The daily top-up is off, so make them with Generate on their shift patterns once they are.`
  }
  else if (result.from <= result.horizonEnd) result.shiftsToCreate = countShifts(draft, result.newPatterns, result.from, result.horizonEnd)
  return result
}

const skippedDays = (draft) => new Set(((draft.pricing && draft.pricing.holidayOccurrences) || []).filter((h) => h.skipped).map((h) => `${h.blockId}|${h.date}`))

function datesOf(pattern, from, to) {
  const start = later(from, pattern.effectiveFrom)
  const end = pattern.effectiveTo ? earlier(to, pattern.effectiveTo) : to
  const dates = []
  if (!pattern.isActive || start > end) return dates
  for (let day = toDay(start); day <= toDay(end); day++) if (weekday(fromDay(day)) === DAYS.indexOf(pattern.dayOfWeek)) dates.push(fromDay(day))
  return dates
}

function countShifts(draft, patterns, from, to) {
  const skipped = skippedDays(draft)
  return patterns.reduce((sum, pattern) => sum + datesOf(pattern, from, to).filter((date) => !skipped.has(`${pattern.sourceBlockKey}|${date}`)).length, 0)
}

// ── Preview ─────────────────────────────────────────────────────────────────

function previewOf(planned, draft) {
  const old = planned.oldShifts || { open: 0, assigned: 0 }
  return {
    canApprove: !draft.approval && !planned.superseded && planned.reasons.length === 0, alreadyApproved: !!draft.approval, reasons: planned.reasons,
    patternsToCreate: planned.newPatterns.length, patternsToEnd: planned.toEnd.length,
    ...(planned.toEnd.length > 0 ? { endsFromVersion: planned.endsFromVersion, endsOn: planned.endsOn } : {}),
    shiftsToCreate: planned.shiftsToCreate, ...(planned.shiftsNote ? { shiftsNote: planned.shiftsNote } : {}), oldShiftsRemaining: old,
    overlappingPatterns: planned.overlapping.map((p) => ({ id: p.id, dayOfWeek: p.dayOfWeek, startTime: p.startTime, endTime: p.endTime, endsNextDay: p.endsNextDay, effectiveFrom: p.effectiveFrom, ...(p.effectiveTo ? { effectiveTo: p.effectiveTo } : {}), ...(p.notes ? { notes: p.notes } : {}) })),
    horizonEnd: planned.horizonEnd, topUpEnabled: topUpEnabled(),
  }
}

// ── The two actions ─────────────────────────────────────────────────────────

/** Looks the revision up: { draft, participant } or null. */
function find(store, participantId, draftId) {
  const draft = (store.drafts[participantId] || []).find((d) => d.id === draftId)
  if (!draft) return null
  return { draft, participant: store.participants.find((p) => p.id === participantId) }
}

function preview(store, participantId, draftId) {
  const found = find(store, participantId, draftId)
  if (!found) return { status: 404, errors: ['Draft not found.'] }
  return { preview: previewOf(plan(store, found.participant, found.draft), found.draft) }
}

function approve(store, participantId, draftId, body, caller) {
  const found = find(store, participantId, draftId)
  if (!found) return { status: 404, errors: ['Draft not found.'] }
  const { draft, participant } = found
  if (draft.approval) return { draft, oldShiftsRemaining: oldShifts(store, draft) }
  const planned = plan(store, participant, draft)
  if (planned.superseded) return { status: 409, errors: [SUPERSEDED], currentVersion: planned.superseded }
  if (planned.reasons.length > 0) return { status: 400, errors: planned.reasons.map((reason) => reason.message) }
  if (planned.overlapping.length > 0 && !(body && body.acknowledgeOverlaps)) {
    return { status: 400, errors: [planned.overlapping.length === 1 ? 'A hand-made pattern of this participant overlaps one this approval makes. It is not changed or ended. Tick the box to confirm that, then approve.' : `${planned.overlapping.length} hand-made patterns of this participant overlap ones this approval makes. They are not changed or ended. Tick the box to confirm that, then approve.`] }
  }
  const made = patternsOf(draft, () => store.newId('pat'))
  for (const pattern of made) pattern.participantName = participant ? participant.fullName : ''
  for (const old of planned.toEnd) { old.effectiveTo = planned.endsOn; if (planned.endsOn < old.effectiveFrom) old.isActive = false }
  store.patterns.push(...made)
  const created = []
  if (planned.ready && planned.from <= planned.horizonEnd) {
    const skipped = skippedDays(draft)
    for (const pattern of made) {
      for (const date of datesOf(pattern, planned.from, planned.horizonEnd)) {
        if (skipped.has(`${pattern.sourceBlockKey}|${date}`)) continue
        // As the server sends it: a null member is left out of the JSON (WhenWritingNull), so an unfilled shift has NO staffId and no staffName (not nulls), and no notes or override reason either.
        // It says which agreement it came from (the pattern's version), so the shift panel needs no pattern read.
        created.push({
          id: store.newId('shift'), participantId, participantName: pattern.participantName, serviceDate: date, startTime: pattern.startTime, endTime: pattern.endTime,
          endsNextDay: pattern.endsNextDay, durationHours: durationOf(pattern), ratio: pattern.ratio, nightType: pattern.nightType, status: 'Draft', shiftPatternId: pattern.id,
          findings: [], assigneeOnApprovedLeave: false, requirements: pattern.requirements, fromAgreement: true, sourceDraftVersion: pattern.sourceDraftVersion,
        })
      }
    }
    store.shifts.push(...created)
  }
  draft.approval = {
    approvedAt: new Date().toISOString(), approvedByName: (caller && caller.name) || 'Demo Coordinator', patternsCreated: made.length, patternsEnded: planned.toEnd.length, shiftsCreated: created.length,
    ...(created.length > 0 ? { horizonEnd: planned.horizonEnd, firstShiftDate: created.map((s) => s.serviceDate).sort()[0] } : {}),
    topUpEnabled: topUpEnabled(),
  }
  return { draft, oldShiftsRemaining: planned.oldShifts || { open: 0, assigned: 0 } }
}

function durationOf(pattern) {
  const [start, end] = weeklyWindow(pattern)
  return Math.round(((end - start) / 60) * 100) / 100
}

module.exports = { preview, approve, providerToday, addDays, weekday, durationOf, DAYS, HORIZON_DAYS }
