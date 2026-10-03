// A small stand-in for the plan builder's pricing engine (POST api/v1/plan-pricing/quote) and the draft revisions it feeds, so the builder screen runs on the mock.
// It follows the real engine's SHAPES exactly (a block in, a PlanQuote out; lines with a trace; issues, notices, holiday occurrences, owner questions, totals by category
// and block) and its main rules (weekday bands at 06:00, 20:00 and midnight, one price for a Saturday, a Sunday or a public holiday, group price = maximum x workers / participants
// floored to the cent, a sleepover as one Each item, travel and transport companions, Review on a public holiday nobody has ruled on, no weekday night item for community access).
// The PRICES are illustrative, except the ones the plan builder brief gives (community access weekday daytime 73.58, its public holiday rate 163.46 and the Saturday group
// maximum 103.54). The real engine reads the catalogue, the settings and the holidays on the server; this reads the tables below.

const CATALOGUE_VERSION = '2026-27'
const PRICE_BASIS_FROM = '2026-07-01'
// How the engine names a support family in its sentences (OccurrencePricer.IssueText): the message names the item and never a date, so one gap in fifty weeks is one issue with a count.
const FAMILY_WORDS = { PersonalCare: 'personal care', CommunityAccess: 'community access', GroupActivity: 'group activities', StaSupport: 'short-term accommodation support' }
const CATALOGUE_FROM = '2026-07-01'
const CATALOGUE_TO = '2027-06-30'

// The state calendar the mock knows (the same for every state), plus the part the real engine's overrides carry.
const HOLIDAYS = [
  ['2026-10-05', 'Labour Day'], ['2026-12-25', 'Christmas Day'], ['2026-12-28', 'Boxing Day (additional day)'], ['2027-01-01', "New Year's Day"], ['2027-01-26', 'Australia Day'],
  ['2027-03-26', 'Good Friday'], ['2027-03-27', 'Easter Saturday'], ['2027-03-29', 'Easter Monday'], ['2027-04-26', 'Anzac Day (additional day)'], ['2027-06-14', "King's Birthday"],
]
const OVERRIDES_THROUGH = '2027-04-25'

const FAMILY = {
  CommunityAccess: { day: ['04_104_0125_6_1', 73.58], evening: ['04_103_0125_6_1', 81.07], night: null, Saturday: ['04_105_0125_6_1', 103.54], Sunday: ['04_106_0125_6_1', 133.5], holiday: ['04_102_0125_6_1', 163.46], pace: 4, group: '0125' },
  GroupActivity: { day: ['04_102_0136_6_1', 70.23], evening: ['04_103_0136_6_1', 77.38], night: null, Saturday: ['04_104_0136_6_1', 103.54], Sunday: ['04_105_0136_6_1', 133.5], holiday: ['04_101_0136_6_1', 163.46], pace: 4, group: '0136' },
  PersonalCare: { day: ['01_011_0107_1_1', 70.23], evening: ['01_015_0107_1_1', 81.07], night: ['01_002_0107_1_1', 83.57], Saturday: ['01_013_0107_1_1', 98.83], Sunday: ['01_014_0107_1_1', 127.43], holiday: ['01_012_0107_1_1', 156.03], pace: 1, group: '0107' },
  StaSupport: { day: ['01_021_0115_1_1', 70.23], evening: ['01_022_0115_1_1', 81.07], night: ['01_023_0115_1_1', 83.57], Saturday: ['01_024_0115_1_1', 98.83], Sunday: ['01_025_0115_1_1', 127.43], holiday: ['01_026_0115_1_1', 156.03], pace: 16, group: '0115' },
}
const HIGH_INTENSITY_UPLIFT = 1.082
const SLEEPOVER = { code: '01_010_0107_1_1', price: 281.97, staCode: '01_206_0115_1_1' }
const TRAVEL_COSTS = ['04_799_0125_6_1', 1]
const TRANSPORT = ['04_590_0125_6_1', 1]
const NIGHT_ITEM = ['01_250_0115_1_1', 301.32]
const WORKER_NIGHT_ITEM = ['01_251_0115_1_1', 301.32]
const PACE_NAMES = { 1: 'Assistance with Daily Life', 2: 'Transport', 4: 'Assistance with Social, Economic and Community Participation', 16: 'Home and Living' }

const OWNER_QUESTIONS = {
  1: 'Which registration groups does the provider hold (0107, 0104, 0125, 0136, 0115, 0108)? The builder assumes all six until somebody confirms.',
  5: 'Group divisor edge cases (NDIA, in writing): the sleepover and worker accommodation lines, two workers for several participants, and a headcount that changes during a support.',
  6: 'Provider travel time caps and the per-kilometre rates for 2026-27 are not published: the 2025-26 values are used and marked provisional.',
  8: 'Part-day and regional public holidays, and Boxing Day and Anzac Day falling on a weekend: the override table is maintained by the owner.',
  13: 'Overnight supports on the nights the clocks change: the builder counts elapsed hours for the 8 hour sleepover test.',
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MAX_BLOCKS = 200
const MAX_LINES = 60000

const defaultSettings = () => ({
  registrationGroupsHeld: ['0107', '0104', '0125', '0136', '0115', '0108'], registrationGroupsConfirmed: false, crossingPolicy: 'Split', claimProviderTravel: true,
  travelKmRateStandard: 0.99, travelKmRateAccessible: 2.76, travelRatesProvisional: true, groupOutings: 'GroupActivities', staUsesHourlyAndAccommodation: true,
  approverRoles: ['Admin', 'Coordinator'], isDefault: true,
})

// ── Dates and times ──────────────────────────────────────────────────────────

const toDay = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000
const fromDay = (day) => new Date(day * 86400000).toISOString().slice(0, 10)
const weekdayOf = (iso) => DAYS[new Date(toDay(iso) * 86400000).getUTCDay()]
const minutesOf = (time) => { const [h, m] = String(time).split(':').map(Number); return h * 60 + (m || 0) }
const clockOf = (minutes) => `${String(Math.floor((minutes % 1440) / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00`
const floorCents = (value) => Math.floor(Math.round(value * 1e6) / 1e4) / 100
const round2 = (value) => Math.round(value * 100) / 100
const holidayOn = (iso) => HOLIDAYS.find(([date]) => date === iso)

function durationOf(block) {
  const start = minutesOf(block.start), end = minutesOf(block.end)
  const length = end - start
  return length <= 0 ? length + 1440 : length
}

/** The block's days that fall in the period, oldest first. */
function dates(block, from, to) {
  const out = []
  for (let day = toDay(from); day <= toDay(to); day += 1) {
    const iso = fromDay(day)
    if ((block.days || []).includes(weekdayOf(iso))) out.push(iso)
  }
  return out
}

// ── Validation (the messages the real PlanBlock.Validate gives, for the cases a screen can reach) ──

function validate(block, index) {
  const who = block.id ? `Block '${String(block.id).slice(0, 64)}'` : `Block ${index + 1}`
  const problems = []
  if (!block.id) problems.push('A block needs an id.')
  if (!Array.isArray(block.days) || block.days.length === 0) problems.push(`${who}: choose at least one day.`)
  if (!(block.workers >= 1 && block.workers <= 10)) problems.push(`${who}: workers must be between 1 and 10.`)
  if (!(block.participantsPresent >= 1 && block.participantsPresent <= 40)) problems.push(`${who}: participants present must be between 1 and 40.`)
  if (!block.location || !['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'].includes(block.location.state)) problems.push(`${who}: the delivery state must be one of ACT, NSW, NT, QLD, SA, TAS, VIC or WA.`)
  if (!FAMILY[block.supportType]) problems.push(`${who}: the support type is not one of the known types.`)
  return problems
}

function groupOf(block, settings) {
  if (block.supportType === 'StaSupport') return '0115'
  if (block.intensity === 'HighIntensity') return '0104'
  if (block.supportType === 'GroupActivity') return settings.groupOutings === 'CommunityAccess' ? '0125' : '0136'
  return FAMILY[block.supportType].group
}

// ── The quote ────────────────────────────────────────────────────────────────

function spans(block, iso, ignoreHolidays) {
  // The block's occurrence cut at 06:00, 20:00 and midnight (a weekday), or whole calendar days (Saturday, Sunday, a holiday).
  const start = minutesOf(block.start)
  const end = start + durationOf(block)
  const out = []
  let at = start
  while (at < end) {
    const dayOffset = Math.floor(at / 1440)
    const dateIso = fromDay(toDay(iso) + dayOffset)
    const minuteOfDay = at % 1440
    const weekday = weekdayOf(dateIso)
    const isHoliday = !ignoreHolidays && !!holidayOn(dateIso)
    let edge, band
    if (isHoliday) { band = 'Public Holiday'; edge = 1440 }
    else if (weekday === 'Saturday') { band = 'Saturday'; edge = 1440 }
    else if (weekday === 'Sunday') { band = 'Sunday'; edge = 1440 }
    else if (minuteOfDay < 360) { band = 'Weekday Night'; edge = 360 }
    else if (minuteOfDay < 1200) { band = 'Weekday Daytime'; edge = 1200 }
    else { band = 'Weekday Evening'; edge = 1440 }
    const to = Math.min(end, dayOffset * 1440 + edge)
    out.push({ date: dateIso, band, minutes: to - at, from: at, to, holiday: isHoliday ? holidayOn(dateIso)[1] : null })
    at = to
  }
  return out
}

const itemFor = (family, band, intensity) => {
  const table = FAMILY[family]
  const entry = band === 'Weekday Daytime' ? table.day : band === 'Weekday Evening' ? table.evening : band === 'Weekday Night' ? table.night : band === 'Saturday' ? table.Saturday : band === 'Sunday' ? table.Sunday : table.holiday
  if (!entry) return null
  return [entry[0], intensity === 'HighIntensity' ? floorCents(entry[1] * HIGH_INTENSITY_UPLIFT) : entry[1]]
}

function traceOf(block, rules, why, maximum, questions, holidayName, crossing) {
  return {
    rules, why, catalogueVersion: CATALOGUE_VERSION, priceBasisFrom: PRICE_BASIS_FROM, zone: (block.location && block.location.zone) || 'National', maximumUnitPrice: maximum,
    workers: block.workers, participantsPresent: block.participantsPresent, ...(crossing ? { policy: 'A' } : {}), ...(holidayName ? { holidayName } : {}), openQuestions: questions,
  }
}

const bandRule = (band) => 'bands:' + band.toLowerCase().replace(/ /g, '-')
const describeTime = (m) => clockOf(m).slice(0, 5)

function lineBase(block, iso, patch) {
  return { blockId: block.id, kind: 'Support', unit: 'H', qty: 0, unitPrice: 0, total: 0, serviceDate: iso, band: '', flags: 'None', shortNoticeCancellationAllowed: true, isPriced: true, review: false, holidayExposure: false, provisional: false, ...patch }
}

function finish(line) {
  const names = []
  if (line.review) names.push('Review')
  if (line.holidayExposure) names.push('HolidayExposure')
  if (line.provisional) names.push('Provisional')
  return { ...line, flags: names.length ? names.join(', ') : 'None' }
}

function quote(request, settings) {
  const blocks = request.blocks || []
  const issues = []
  const addIssue = (blockId, reason, message, date) => {
    const found = issues.find((issue) => issue.blockId === blockId && issue.reason === reason && issue.message === message)
    if (found) found.count += 1
    else issues.push({ blockId, reason, message, count: 1, ...(date ? { firstDate: date } : {}) })
  }
  const lines = []
  const holidayOccurrences = []
  const blockTotals = []
  const notices = []
  const questions = new Set()

  if (!settings.registrationGroupsConfirmed) {
    notices.push({ code: 'registration-groups-not-confirmed', message: 'The registration groups the provider holds have not been confirmed: the builder assumes all six (0107, 0104, 0125, 0136, 0115, 0108). Confirm them in the provider settings.', openQuestion: 1 })
    questions.add(1)
  }

  const seen = new Set()
  blocks.forEach((block, index) => {
    const problems = validate(block, index)
    if (seen.has(block.id)) problems.push(`Block '${block.id}': the id is used by another block.`)
    seen.add(block.id)
    if (problems.length > 0) { problems.forEach((message) => addIssue(block.id || '', 'InvalidInput', message)); blockTotals.push({ blockId: block.id, amount: 0, supportHours: 0, occurrences: 0, skippedOccurrences: 0 }); return }
    const group = groupOf(block, settings)
    if (!settings.registrationGroupsHeld.includes(group)) {
      addIssue(block.id, 'RegistrationGroupNotHeld', `Block '${block.id}': ${block.supportType} needs registration group ${group}, which the provider does not hold.`)
      blockTotals.push({ blockId: block.id, amount: 0, supportHours: 0, occurrences: 0, skippedOccurrences: 0 }); return
    }

    let amount = 0, hours = 0, occurrences = 0, skipped = 0
    for (const iso of dates(block, request.periodFrom, request.periodTo)) {
      const parts = spans(block, iso, false)
      const holidayPart = parts.find((part) => part.holiday)
      if (holidayPart && block.onPublicHoliday === 'Skip') {
        skipped += 1
        holidayOccurrences.push({ blockId: block.id, date: holidayPart.date, holidayName: holidayPart.holiday, state: block.location.state, decision: 'Skip', skipped: true })
        continue
      }
      occurrences += 1
      const crossing = parts.length > 1
      const sleeper = block.workerMaySleep && durationOf(block) >= 480 && block.supportType !== 'CommunityAccess' && block.supportType !== 'GroupActivity'
      const occurrenceLines = []
      if (iso < CATALOGUE_FROM || iso > CATALOGUE_TO) {
        addIssue(block.id, 'CatalogueNotFound', `No catalogue row for ${FAMILY_WORDS[block.supportType] || block.supportType} is valid for part of the period. Import the catalogue for that period.`, iso)
        occurrenceLines.push(finish(lineBase(block, iso, { itemCode: undefined, unpriced: 'CatalogueNotFound', band: 'Weekday Daytime', review: true, isPriced: false, trace: traceOf(block, ['unpriced:catalogue-not-found'], 'No catalogue row is valid on this date.', undefined, []) })))
      } else if (sleeper) {
        const sta = block.supportType === 'StaSupport'
        const price = floorCents(SLEEPOVER.price * block.workers / block.participantsPresent)
        const divided = block.workers !== 1 || block.participantsPresent !== 1
        if (divided) questions.add(5)
        occurrenceLines.push(finish(lineBase(block, iso, { kind: 'Sleepover', itemCode: sta ? SLEEPOVER.staCode : SLEEPOVER.code, unit: 'E', qty: 1, unitPrice: price, total: price, band: 'Sleepover', paceCategory: sta ? 16 : 1, provisional: divided,
          trace: traceOf(block, ['sleepover:each-item', 'price:catalogue-by-service-date'], `Sleepover from ${describeTime(minutesOf(block.start))}, one Each item whatever the day; the price is from catalogue ${CATALOGUE_VERSION}.`, SLEEPOVER.price, divided ? [5] : []) })))
        const active = Math.max(0, (block.sleepoverActiveHours || 0) - 2)
        if (active > 0) {
          const rate = FAMILY[block.supportType].Saturday[1]
          const unit = floorCents(rate * block.workers / block.participantsPresent)
          occurrenceLines.push(finish(lineBase(block, iso, { kind: 'SleepoverActiveHours', itemCode: FAMILY[block.supportType].Saturday[0], qty: active, unitPrice: unit, total: floorCents(unit * active), band: 'Saturday', paceCategory: FAMILY[block.supportType].pace,
            trace: traceOf(block, ['sleepover:active-hours-beyond-2', 'price:catalogue-by-service-date'], `${active} active hours beyond the first two, priced hourly.`, rate, []) })))
        }
      } else {
        for (const part of parts) {
          const item = itemFor(block.supportType, part.band, block.intensity)
          if (!item) {
            addIssue(block.id, 'NoItem', `The catalogue has no item for ${FAMILY_WORDS[block.supportType] || block.supportType} standard ${part.band} (registration group ${group}). A weekday night support has no item in this family, and it is not mapped to another family: a person must decide how it is claimed.`, part.date)
            occurrenceLines.push(finish(lineBase(block, part.date, { itemCode: undefined, unpriced: 'NoItem', qty: part.minutes / 60, band: part.band, review: true, isPriced: false, startTime: clockOf(part.from), endDate: part.date, endTime: clockOf(part.to), trace: traceOf(block, ['unpriced:no-item'], 'No catalogue item exists for this band.', undefined, []) })))
            continue
          }
          const holiday = !!part.holiday
          const unit = floorCents(item[1] * block.workers / block.participantsPresent)
          const total = floorCents(unit * part.minutes / 60)
          const questionsHere = []
          if (block.workers > 1 && block.participantsPresent > 1) { questionsHere.push(5); questions.add(5) }
          const rules = [bandRule(part.band), 'price:catalogue-by-service-date']
          if (block.workers !== 1 || block.participantsPresent !== 1) rules.push('group:floor(price*workers/participants)')
          if (crossing) rules.push('crossing:A')
          if (holiday) rules.push('holiday:state-calendar')
          occurrenceLines.push(finish(lineBase(block, part.date, {
            itemCode: item[0], qty: Math.round(part.minutes / 60 * 10000) / 10000, unitPrice: unit, total, band: part.band, paceCategory: FAMILY[block.supportType].pace,
            startTime: clockOf(part.from), endDate: part.date, endTime: clockOf(part.to), holidayExposure: holiday, review: holiday && block.onPublicHoliday === 'Review', provisional: false,
            trace: traceOf(block, rules, `${part.band} on ${part.date}, ${describeTime(part.from)} to ${describeTime(part.to)}; ${block.workers === 1 && block.participantsPresent === 1 ? '1 worker for 1 participant' : `${block.workers} worker(s) for ${block.participantsPresent} participant(s)`}; price from catalogue ${CATALOGUE_VERSION} (row from ${PRICE_BASIS_FROM}).`, item[1], questionsHere, part.holiday, crossing),
          })))
        }
      }

      const supportLine = occurrenceLines.find((line) => line.isPriced && line.kind === 'Support')
      const travel = block.travel
      if (travel && travel.claim && settings.claimProviderTravel && supportLine) {
        const legs = travel.returnToBase ? 2 : 1
        const sharing = travel.participantsSharing || block.participantsPresent
        const capped = Math.min(travel.minutesEachWay, 30)
        const claimable = capped * legs * block.workers
        if (claimable > 0) {
          const qty = claimable / sharing
          occurrenceLines.push(finish(lineBase(block, iso, { kind: 'ProviderTravelTime', itemCode: supportLine.itemCode, qty: Math.round(qty / 60 * 10000) / 10000, unitPrice: supportLine.unitPrice, total: floorCents(supportLine.unitPrice * qty / 60), band: 'Provider travel', paceCategory: supportLine.paceCategory, provisional: settings.travelRatesProvisional, holidayExposure: supportLine.holidayExposure, review: supportLine.review,
            trace: traceOf(block, [`travel:time-cap-30`, 'travel:same-item-as-support', 'price:catalogue-by-service-date'], `Provider travel on ${supportLine.itemCode}: ${travel.minutesEachWay} minutes each way (capped at 30), ${claimable} minutes in all.`, supportLine.unitPrice, settings.travelRatesProvisional ? [6] : []) })))
          if (settings.travelRatesProvisional) questions.add(6)
        }
        if (travel.kmEachWay > 0) {
          const dollars = floorCents(travel.kmEachWay * legs * settings.travelKmRateStandard / sharing)
          if (dollars > 0) {
            occurrenceLines.push(finish(lineBase(block, iso, { kind: 'ProviderTravelCosts', itemCode: TRAVEL_COSTS[0], unit: 'E', qty: dollars, unitPrice: TRAVEL_COSTS[1], total: dollars, band: 'Provider travel costs', paceCategory: supportLine.paceCategory, provisional: settings.travelRatesProvisional,
              trace: traceOf(block, ['travel:km', 'price:catalogue-by-service-date'], `Provider travel kilometres: ${travel.kmEachWay} km at $${settings.travelKmRateStandard} a kilometre, claimed in dollars on the non-labour item.`, TRAVEL_COSTS[1], settings.travelRatesProvisional ? [6] : []) })))
          }
        }
      }
      const transport = block.transport
      if (transport && (transport.km > 0 || transport.tolls > 0 || transport.parking > 0)) {
        if (block.supportType !== 'CommunityAccess' && block.supportType !== 'GroupActivity') addIssue(block.id, 'TransportNotAvailable', `Block '${block.id}': activity-based transport only goes with community access and group activities.`)
        else {
          const rate = transport.vehicle === 'Accessible' ? settings.travelKmRateAccessible : settings.travelKmRateStandard
          const sharing = transport.participantsSharing || block.participantsPresent
          const dollars = floorCents(((transport.km || 0) * rate + (transport.tolls || 0) + (transport.parking || 0)) / sharing)
          const provisional = transport.km > 0 && settings.travelRatesProvisional
          if (dollars > 0) occurrenceLines.push(finish(lineBase(block, iso, { kind: 'ActivityTransport', itemCode: TRANSPORT[0], unit: 'E', qty: dollars, unitPrice: TRANSPORT[1], total: dollars, band: 'Activity-based transport', paceCategory: 4, provisional,
            trace: traceOf(block, ['abt:vehicle-costs', 'price:catalogue-by-service-date'], `Activity-based transport: ${transport.km} km at $${rate} a kilometre plus tolls and parking at cost.`, TRANSPORT[1], provisional ? [6] : []) })))
          if (provisional) questions.add(6)
        }
      }
      if (block.setting === 'Centre' && supportLine && ['CommunityAccess', 'GroupActivity'].includes(block.supportType)) {
        const minutes = parts.reduce((sum, part) => sum + part.minutes, 0)
        occurrenceLines.push(finish(lineBase(block, iso, { kind: 'CentreCapital', itemCode: '04_400_0136_6_1', qty: minutes / 60, unitPrice: 1.5, total: floorCents(1.5 * minutes / 60), band: 'Centre capital', paceCategory: 4, trace: traceOf(block, ['centre-capital:per-participant-hour', 'price:catalogue-by-service-date'], 'Centre capital cost: per participant per hour of support.', 1.5, []) })))
      }
      if (block.accommodation && block.accommodation.nights > 0 && block.supportType === 'StaSupport') {
        occurrenceLines.push(finish(lineBase(block, iso, { kind: 'ParticipantAccommodation', itemCode: NIGHT_ITEM[0], unit: 'D', qty: block.accommodation.nights, unitPrice: NIGHT_ITEM[1], total: floorCents(NIGHT_ITEM[1] * block.accommodation.nights), band: 'Accommodation (participant)', paceCategory: 16,
          trace: traceOf(block, ['sta:accommodation-night', 'price:catalogue-by-service-date'], `${block.accommodation.nights} night(s) of standard accommodation per participant.`, NIGHT_ITEM[1], []) })))
        if (block.accommodation.workerOnSite) occurrenceLines.push(finish(lineBase(block, iso, { kind: 'WorkerAccommodation', itemCode: WORKER_NIGHT_ITEM[0], unit: 'D', qty: block.accommodation.nights, unitPrice: WORKER_NIGHT_ITEM[1], total: floorCents(WORKER_NIGHT_ITEM[1] * block.accommodation.nights), band: 'Accommodation (support worker)', paceCategory: 16,
          trace: traceOf(block, ['sta:accommodation-night', 'price:catalogue-by-service-date'], 'Support worker accommodation.', WORKER_NIGHT_ITEM[1], []) })))
      }

      if (holidayPart) {
        questions.add(8)
        const holidayLines = occurrenceLines.filter((line) => line.holidayExposure && line.kind === 'Support')
        const atHoliday = round2(holidayLines.reduce((sum, line) => sum + line.total, 0))
        // The same occurrence on an ordinary day: cut at 06:00, 20:00 and midnight as a weekday (or whole days) as if no holiday fell on it.
        const ordinary = round2(spans(block, iso, true).reduce((sum, part) => {
          const item = itemFor(block.supportType, part.band, block.intensity)
          return sum + (item ? floorCents(floorCents(item[1] * block.workers / block.participantsPresent) * part.minutes / 60) : 0)
        }, 0))
        holidayOccurrences.push({ blockId: block.id, date: holidayPart.date, holidayName: holidayPart.holiday, state: block.location.state, decision: block.onPublicHoliday, skipped: false, atHolidayRates: atHoliday, atOrdinaryRates: ordinary, uplift: round2(atHoliday - ordinary) })
      }
      for (const line of occurrenceLines) {
        lines.push(line)
        if (line.isPriced) { amount += line.total; if (line.kind === 'Support' || line.kind === 'SleepoverActiveHours') hours += line.qty }
        for (const number of line.trace.openQuestions) questions.add(number)
      }
    }
    blockTotals.push({ blockId: block.id, amount: round2(amount), supportHours: round2(hours), occurrences, skippedOccurrences: skipped })
  })

  // Two blocks on at the same time on the same date.
  for (let i = 0; i < blocks.length; i += 1) {
    for (let j = i + 1; j < blocks.length; j += 1) {
      const a = blocks[i], b = blocks[j]
      if (validate(a, i).length || validate(b, j).length) continue
      for (const iso of dates(a, request.periodFrom, request.periodTo)) {
        const startA = toDay(iso) * 1440 + minutesOf(a.start), endA = startA + durationOf(a)
        const other = dates(b, fromDay(toDay(iso) - 1), fromDay(toDay(iso) + 1)).find((date) => { const startB = toDay(date) * 1440 + minutesOf(b.start); return startB < endA && startB + durationOf(b) > startA })
        if (other) { addIssue(a.id, 'BlocksOverlap', `Block '${a.id}' and Block '${b.id}' are on at the same time on ${iso}: the same hour would be priced twice. Two workers at once are one block with 2 workers.`, iso); break }
      }
    }
  }

  if (request.periodTo > OVERRIDES_THROUGH) notices.push({ code: 'holiday-overrides-end', message: `The public holiday overrides (the gaps in the synced calendar and the part-day holidays) run to ${OVERRIDES_THROUGH} and this period runs to ${request.periodTo}: a part-day holiday, or Boxing Day or Anzac Day on a weekend, after that date may be missing and is priced as an ordinary day.`, openQuestion: 8 })

  const priced = lines.filter((line) => line.isPriced)
  const byCategory = []
  for (const line of priced) {
    const pace = line.paceCategory || 4
    let entry = byCategory.find((category) => category.paceCategory === pace)
    if (!entry) { entry = { paceCategory: pace, name: PACE_NAMES[pace] || `Category ${pace}`, amount: 0, hours: 0 }; byCategory.push(entry) }
    entry.amount = round2(entry.amount + line.total)
    if (line.kind === 'Support' || line.kind === 'SleepoverActiveHours') entry.hours = round2(entry.hours + line.qty)
  }
  byCategory.sort((a, b) => a.paceCategory - b.paceCategory)
  const totals = {
    amount: round2(priced.reduce((sum, line) => sum + line.total, 0)), supportHours: round2(blockTotals.reduce((sum, total) => sum + total.supportHours, 0)), lineCount: lines.length,
    unpricedLines: lines.filter((line) => !line.isPriced).length, reviewLines: lines.filter((line) => line.review).length, provisionalLines: lines.filter((line) => line.provisional).length,
    holidayOccurrences: holidayOccurrences.length, holidayUplift: round2(holidayOccurrences.reduce((sum, occurrence) => sum + (occurrence.uplift || 0), 0)), byCategory, byBlock: blockTotals,
  }
  const result = {
    periodFrom: request.periodFrom, periodTo: request.periodTo, lines: request.includeLines === false ? [] : lines, issues, notices, holidayOccurrences,
    openQuestions: [...questions].sort((a, b) => a - b).map((number) => ({ number, text: OWNER_QUESTIONS[number] || `Open question ${number}` })), totals, timeBasis: 'tz-database', needsReview: false,
  }
  result.needsReview = issues.length > 0 || totals.reviewLines > 0
  result._lines = lines
  return result
}

/** The agreement's lines from the per-occurrence lines (one per block, item, band, price and flags), as the server stores them. */
function groupLines(lines, blocks) {
  const groups = new Map()
  for (const line of lines.filter((l) => l.isPriced)) {
    const key = [line.blockId, line.kind, line.itemCode, line.band, line.unit, line.unitPrice, line.flags].join('|')
    const group = groups.get(key) || { blockId: line.blockId, kind: line.kind, itemCode: line.itemCode, band: line.band, unit: line.unit, unitPrice: line.unitPrice, flags: line.flags, qty: 0, total: 0, occurrences: 0, first: line.serviceDate }
    group.qty += line.qty; group.total = round2(group.total + line.total); group.occurrences += 1
    groups.set(key, group)
  }
  const label = { PersonalCare: 'Personal care', CommunityAccess: 'Community access', GroupActivity: 'Group activity', StaSupport: 'Short-term accommodation support' }
  return [...groups.values()].sort((a, b) => blocks.findIndex((x) => x.id === a.blockId) - blocks.findIndex((x) => x.id === b.blockId) || a.first.localeCompare(b.first)).map((group) => ({
    serviceType: label[(blocks.find((b) => b.id === group.blockId) || {}).supportType] || 'Support', hours: round2(group.qty), itemCode: group.itemCode, unitPrice: group.unitPrice, catalogueVersion: CATALOGUE_VERSION,
    catalogueEffectiveFrom: PRICE_BASIS_FROM, blockId: group.blockId, band: group.band, unit: group.unit, total: group.total, occurrences: group.occurrences, flags: group.flags,
  }))
}

module.exports = { quote, groupLines, defaultSettings, validate, MAX_BLOCKS, MAX_LINES, FAMILY }
