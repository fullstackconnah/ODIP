// The plan builder's block model, pure and JSX-free: how a block is described in words, how long it is, where the prices change inside it, what it
// asks of the provider's registration groups, and what is wrong with it. The server's PlanBlock.Validate is the authority (it names every problem
// and the engine prices nothing from a block that breaks one); the checks here only tell the coordinator early, next to the field.
//
// Wire format: days are the engine's names ("Monday"), times are local "HH:mm:ss", and a block is never given a price or a catalogue code.
import type {
  PlanBlock, PlanDayName, PlanSupportIntensity, PlanSupportType, PlanSetting, PlanGroupOutingFamily, AgreementState, PlanPriceZone, DraftBlock,
} from '@/api/types'
import { plural } from './format'

export const PLAN_DAYS: readonly PlanDayName[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const DAY_SHORT: Record<PlanDayName, string> = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun' }

export const SUPPORT_TYPES: readonly PlanSupportType[] = ['CommunityAccess', 'GroupActivity', 'PersonalCare', 'StaSupport']
export const SUPPORT_LABEL: Record<PlanSupportType, string> = {
  PersonalCare: 'Personal care',
  CommunityAccess: 'Community access',
  GroupActivity: 'Group activity',
  StaSupport: 'Short-term accommodation',
}
export const SETTING_LABEL: Record<PlanSetting, string> = { Community: 'Community', Centre: 'Centre', AtHome: 'At home', Accommodation: 'Accommodation' }
export const INTENSITY_LABEL: Record<PlanSupportIntensity, string> = { Standard: 'Standard', HighIntensity: 'High intensity', Icbs: 'ICBS' }

const MINUTES_PER_DAY = 1440
/** Where the weekday prices change: 06:00 (night to day), 20:00 (day to evening) and midnight (evening to night). */
export const BAND_EDGES = [0, 360, 1200] as const
/** A sleepover needs this many elapsed hours across midnight. */
export const SLEEPOVER_MINUTES = 8 * 60
/** Past this length a block where the worker may sleep must say which part of it is the night. */
export const MAX_SLEEPOVER_MINUTES_WITHOUT_WINDOW = 12 * 60

// ── Times ─────────────────────────────────────────────────────────────────────

/** "09:30:00" or "09:30" as minutes past midnight (NaN for anything else). */
export function toMinutes(time: string): number {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time ?? '')
  if (!match) return Number.NaN
  const hours = Number(match[1]), minutes = Number(match[2])
  return hours > 23 || minutes > 59 ? Number.NaN : hours * 60 + minutes
}

/** Minutes past midnight (0 to 1439, wrapping) as the engine's "HH:mm:ss". */
export function toWireTime(minutes: number): string {
  const wrapped = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}:00`
}

/** "09:30:00" as "09:30": what a time input shows and what the block's readable line says. */
export function clock(time: string): string {
  const minutes = toMinutes(time)
  return Number.isNaN(minutes) ? '' : `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** A time input's value ("09:30") as the wire time ("09:30:00"); '' stays '' so an emptied field is not silently midnight. */
export function fromClock(value: string): string {
  const minutes = toMinutes(value)
  return Number.isNaN(minutes) ? '' : toWireTime(minutes)
}

/** Minutes past midnight as "HH:MM", with the end of the day (1440) as "24:00". */
export function formatMinute(minutes: number): string {
  if (minutes >= MINUTES_PER_DAY) return '24:00'
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(Math.round(minutes % 60)).padStart(2, '0')}`
}

/** The end is on the next day when it is not after the start; the same time twice is a 24 hour block. Derived, never typed. */
export function endsNextDay(block: Pick<PlanBlock, 'start' | 'end'>): boolean {
  const start = toMinutes(block.start), end = toMinutes(block.end)
  return !Number.isNaN(start) && !Number.isNaN(end) && end <= start
}

export function durationMinutes(block: Pick<PlanBlock, 'start' | 'end'>): number {
  const start = toMinutes(block.start), end = toMinutes(block.end)
  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  const minutes = end - start
  return minutes <= 0 ? minutes + MINUTES_PER_DAY : minutes
}

/** "8 h", "8 h 30 min", "45 min", "24 h". */
export function formatDuration(minutes: number): string {
  const whole = Math.floor(minutes / 60), rest = Math.round(minutes % 60)
  if (whole === 0) return `${rest} min`
  return rest === 0 ? `${whole} h` : `${whole} h ${rest} min`
}

/** Hours as a figure: "8", "4.5", "6.67". Never more than two decimals, never a trailing zero. */
export function formatHours(hours: number): string {
  return String(Math.round(hours * 100) / 100)
}

// ── Words ─────────────────────────────────────────────────────────────────────

/** "Mon, Wed", "Mon–Fri", "Sat–Sun", "Every day", "Tue, Thu–Sat": a run of three or more days is a range, a shorter one is listed. */
export function daysSummary(days: readonly PlanDayName[]): string {
  const picked = PLAN_DAYS.filter(day => days.includes(day))
  if (picked.length === 0) return 'No days'
  if (picked.length === 7) return 'Every day'
  const runs: PlanDayName[][] = []
  for (const day of picked) {
    const run = runs[runs.length - 1]
    if (run && PLAN_DAYS.indexOf(run[run.length - 1]) === PLAN_DAYS.indexOf(day) - 1) run.push(day)
    else runs.push([day])
  }
  return runs.map(run => run.length >= 3 ? `${DAY_SHORT[run[0]]}–${DAY_SHORT[run[run.length - 1]]}` : run.map(day => DAY_SHORT[day]).join(', ')).join(', ')
}

/** "1:1", "1:3", "2:1": workers to participants present. */
export function ratioLabel(block: Pick<PlanBlock, 'workers' | 'participantsPresent'>): string {
  return `${block.workers}:${block.participantsPresent}`
}

/** "09:00–13:00", or "22:00–06:00 next day". */
export function timesLabel(block: Pick<PlanBlock, 'start' | 'end'>): string {
  return `${clock(block.start)}–${clock(block.end)}${endsNextDay(block) ? ' next day' : ''}`
}

function kmLabel(km: number): string {
  return `${Math.round(km * 10) / 10} km`
}

/** What a block adds to its support: transport, provider travel, a sleepover, accommodation nights. */
export function extrasOf(block: PlanBlock): string[] {
  const extras: string[] = []
  const transport = block.transport
  if (transport && transport.km > 0) extras.push(`+${kmLabel(transport.km)} transport`)
  else if (transport && (transport.tolls > 0 || transport.parking > 0)) extras.push('+transport costs')
  if (block.travel?.claim && (block.travel.minutesEachWay > 0 || block.travel.kmEachWay > 0)) extras.push(`+provider travel ${block.travel.minutesEachWay} min each way`)
  if (block.workerMaySleep) extras.push('sleepover')
  if (block.accommodation && block.accommodation.nights > 0) extras.push(plural(block.accommodation.nights, 'night'))
  if (block.onPublicHoliday === 'Charge') extras.push('holidays charged')
  if (block.onPublicHoliday === 'Skip') extras.push('holidays skipped')
  return extras
}

/** The block as one readable line: "Mon, Wed · 09:00–13:00 · Community access 1:1 · +20 km transport". */
export function describeBlock(block: PlanBlock): string {
  return [daysSummary(block.days), timesLabel(block), `${SUPPORT_LABEL[block.supportType]} ${ratioLabel(block)}`, ...extrasOf(block)].join(' · ')
}

/** The hours of support the block asks for in an ordinary week, by arithmetic alone (the server's quote is what prices them). */
export function weeklyHours(block: Pick<PlanBlock, 'days' | 'start' | 'end'>): number {
  return (durationMinutes(block) * block.days.length) / 60
}

// ── Registration groups ───────────────────────────────────────────────────────

/** The registration group a block's support sits in (the engine's rule): high intensity is 0104 whatever the family, and a group outing is 0136 unless the provider bills them under 0125. */
export function registrationGroupFor(block: Pick<PlanBlock, 'supportType' | 'intensity'>, groupOutings: PlanGroupOutingFamily = 'GroupActivities'): string {
  if (block.supportType === 'StaSupport') return '0115'
  if (block.intensity === 'HighIntensity') return '0104'
  switch (block.supportType) {
    case 'PersonalCare': return '0107'
    case 'CommunityAccess': return '0125'
    default: return groupOutings === 'CommunityAccess' ? '0125' : '0136'
  }
}

export const REGISTRATION_GROUP_NAME: Record<string, string> = {
  '0107': 'Daily personal activities',
  '0104': 'High intensity daily personal activities',
  '0125': 'Participation in community, social and civic activities',
  '0136': 'Group and centre based activities',
  '0115': 'Daily tasks and shared living (short-term accommodation)',
  '0108': 'Travel and transport arrangements',
}

/** The support types the provider holds the registration group for (standard intensity), in the order the picker shows them. */
export function offeredSupportTypes(groupsHeld: readonly string[], groupOutings: PlanGroupOutingFamily = 'GroupActivities'): PlanSupportType[] {
  return SUPPORT_TYPES.filter(type => groupsHeld.includes(registrationGroupFor({ supportType: type, intensity: 'Standard' }, groupOutings)))
}

// ── Sleepovers ────────────────────────────────────────────────────────────────

/** Only personal care and short-term accommodation have a sleepover item (community and group blocks never do: the night is an unpriced line, not another family). */
export function sleepoverFamily(type: PlanSupportType): boolean {
  return type === 'PersonalCare' || type === 'StaSupport'
}

/** The choice appears only when the block could qualify: a family with a sleepover item, across midnight, 8 hours or more. */
export function canOfferSleepover(block: Pick<PlanBlock, 'supportType' | 'start' | 'end'>): boolean {
  return sleepoverFamily(block.supportType) && endsNextDay(block) && durationMinutes(block) >= SLEEPOVER_MINUTES
}

/** A block longer than 12 hours where the worker may sleep must give the window. */
export function needsSleepoverWindow(block: Pick<PlanBlock, 'start' | 'end' | 'workerMaySleep'>): boolean {
  return block.workerMaySleep && durationMinutes(block) > MAX_SLEEPOVER_MINUTES_WITHOUT_WINDOW
}

/** The length of the sleeping window in minutes (the whole block when it has none). */
export function sleepoverMinutes(block: Pick<PlanBlock, 'start' | 'end' | 'sleepoverWindow'>): number {
  if (!block.sleepoverWindow) return durationMinutes(block)
  const from = toMinutes(block.sleepoverWindow.from), to = toMinutes(block.sleepoverWindow.to)
  if (Number.isNaN(from) || Number.isNaN(to)) return 0
  const length = (to - from + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return length === 0 ? 0 : length
}

/** 22:00 to 06:00 when that night lies inside the block, else the block's first eight hours. */
export function defaultSleepoverWindow(block: Pick<PlanBlock, 'start' | 'end'>): { from: string; to: string } {
  const start = toMinutes(block.start)
  const offsetOf = (minute: number) => (((minute - start) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const fits = offsetOf(22 * 60) + 8 * 60 <= durationMinutes(block)
  return fits ? { from: '22:00:00', to: '06:00:00' } : { from: toWireTime(start), to: toWireTime(start + SLEEPOVER_MINUTES) }
}

// ── Where the prices change ───────────────────────────────────────────────────

export type WeekdayBand = 'night' | 'day' | 'evening'
export const WEEKDAY_BAND_LABEL: Record<WeekdayBand, string> = { night: 'Night', day: 'Daytime', evening: 'Evening' }
export const WEEKDAY_BAND_RANGE: Record<WeekdayBand, string> = { night: '00:00–06:00', day: '06:00–20:00', evening: '20:00–24:00' }

export interface BandPart {
  band: WeekdayBand
  /** Minutes past midnight of the day the block starts (the part after midnight continues past 1440). */
  from: number
  to: number
  minutes: number
}

function bandAt(minuteOfDay: number): WeekdayBand {
  return minuteOfDay < 360 ? 'night' : minuteOfDay < 1200 ? 'day' : 'evening'
}

/** The block cut at 06:00, 20:00 and midnight, as a weekday is priced: each part is the band it falls in and how long it lasts. */
export function weekdayBandParts(block: Pick<PlanBlock, 'start' | 'end'>): BandPart[] {
  const start = toMinutes(block.start)
  const length = durationMinutes(block)
  if (Number.isNaN(start) || length === 0) return []
  const parts: BandPart[] = []
  let at = start
  const end = start + length
  while (at < end) {
    const minuteOfDay = at % MINUTES_PER_DAY
    const edge = minuteOfDay < 360 ? 360 : minuteOfDay < 1200 ? 1200 : MINUTES_PER_DAY
    const to = Math.min(end, at - minuteOfDay + edge)
    parts.push({ band: bandAt(minuteOfDay), from: at, to, minutes: to - at })
    at = to
  }
  return parts
}

/** Saturday, Sunday and a public holiday are one price for the whole calendar day. */
export function hasWholeDayBands(days: readonly PlanDayName[]): boolean {
  return days.includes('Saturday') || days.includes('Sunday')
}

export interface DayBar {
  blockId: string
  day: PlanDayName
  /** Minutes past midnight on this day. */
  from: number
  to: number
  /** The part of a block that runs on into the next day. */
  continued: boolean
}

/** Every stretch of every block on the week, for the week strip: a block across midnight is a bar to the end of its day and another from the start of the next. */
export function dayBars(blocks: readonly PlanBlock[]): DayBar[] {
  const bars: DayBar[] = []
  for (const block of blocks) {
    const start = toMinutes(block.start)
    const length = durationMinutes(block)
    if (Number.isNaN(start) || length === 0) continue
    for (const day of PLAN_DAYS.filter(d => block.days.includes(d))) {
      const end = start + length
      bars.push({ blockId: block.id, day, from: start, to: Math.min(end, MINUTES_PER_DAY), continued: false })
      if (end > MINUTES_PER_DAY) {
        const next = PLAN_DAYS[(PLAN_DAYS.indexOf(day) + 1) % 7]
        bars.push({ blockId: block.id, day: next, from: 0, to: end - MINUTES_PER_DAY, continued: true })
      }
    }
  }
  return bars
}

// ── A new block ───────────────────────────────────────────────────────────────

export function emptyBlock(id: string, state: AgreementState, zone: PlanPriceZone = 'National'): PlanBlock {
  return {
    id, supportType: 'CommunityAccess', intensity: 'Standard', days: [], start: '09:00:00', end: '13:00:00', workers: 1, participantsPresent: 1,
    headcountChanges: [], setting: 'Community', location: { state, zone }, workerMaySleep: false, sleepoverActiveHours: 0, onPublicHoliday: 'Review',
  }
}

/** The next free block id ("b1", "b2"...): the engine's key for the block, at most 64 characters and unique in the plan. */
export function nextBlockId(blocks: readonly Pick<PlanBlock, 'id'>[]): string {
  const taken = new Set(blocks.map(block => block.id))
  let n = blocks.length + 1
  while (taken.has(`b${n}`)) n += 1
  return `b${n}`
}

/** The same block on another id, the way "duplicate" makes "same, but Thursday". */
export function duplicateBlock(entry: DraftBlock, id: string): DraftBlock {
  return JSON.parse(JSON.stringify({ ...entry, block: { ...entry.block, id } })) as DraftBlock
}

/**
 * A block as the server can read it. A number box that was cleared reports NaN, and JSON writes NaN as null, which the server refuses for a decimal with a 400. A box whose number matters
 * is a problem the person sees (blockProblems) and that block is never sent; this is for a number nobody can see any more (travel switched off, transport cleared, a sleepover turned
 * off behind an emptied "active hours" box): it goes as 0, or is left out where it is optional.
 */
export function forTheServer(block: PlanBlock): PlanBlock {
  const finite = (value: number) => (Number.isFinite(value) ? value : 0)
  const optional = (value: number | undefined) => (value === undefined || !Number.isFinite(value) ? undefined : value)
  const next: PlanBlock = { ...block, sleepoverActiveHours: finite(block.sleepoverActiveHours) }
  if (block.travel) next.travel = { ...block.travel, minutesEachWay: finite(block.travel.minutesEachWay), kmEachWay: finite(block.travel.kmEachWay), participantsSharing: optional(block.travel.participantsSharing) }
  if (block.transport) next.transport = { ...block.transport, km: finite(block.transport.km), tolls: finite(block.transport.tolls), parking: finite(block.transport.parking), participantsSharing: optional(block.transport.participantsSharing) }
  if (block.accommodation) next.accommodation = { ...block.accommodation, nights: finite(block.accommodation.nights) }
  return next
}

/** What a block looks like on the wire for a given agreement: the delivery location is the agreement's, whatever the block carried, and every number is one the server can read. */
export function stampLocation(block: PlanBlock, state: AgreementState, zone: PlanPriceZone): PlanBlock {
  return { ...forTheServer(block), location: { state, zone } }
}

// ── What is wrong with a block ────────────────────────────────────────────────

export type PlanStepKey = 'template' | 'times' | 'requirements' | 'travel' | 'review'
export const PLAN_STEPS: readonly { key: PlanStepKey; label: string }[] = [
  { key: 'template', label: 'Template' },
  { key: 'times', label: 'Days and times' },
  { key: 'requirements', label: 'Requirements' },
  { key: 'travel', label: 'Travel and transport' },
  { key: 'review', label: 'Review' },
]

export interface BlockProblem {
  /** The step whose field to fix. */
  step: PlanStepKey
  /** The field the message belongs next to. */
  field: string
  message: string
}

export interface BlockCheckContext {
  /** The registration groups the provider holds; unknown (settings not loaded) checks nothing about them. */
  groupsHeld?: readonly string[]
  groupOutings?: PlanGroupOutingFamily
  claimProviderTravel?: boolean
}

/** What the coordinator can see is wrong before the server is asked: the same rules PlanBlock.Validate enforces, in plain words and next to the field. */
export function blockProblems(block: PlanBlock, context: BlockCheckContext = {}): BlockProblem[] {
  const problems: BlockProblem[] = []
  const add = (step: PlanStepKey, field: string, message: string) => problems.push({ step, field, message })

  if (block.days.length === 0) add('times', 'days', 'Choose at least one day.')
  if (Number.isNaN(toMinutes(block.start))) add('times', 'start', 'Enter a start time.')
  if (Number.isNaN(toMinutes(block.end))) add('times', 'end', 'Enter an end time.')

  if (block.workerMaySleep) {
    if (needsSleepoverWindow(block) && !block.sleepoverWindow) add('times', 'sleepoverFrom', 'A block of more than 12 hours needs the part of it where the worker sleeps.')
    if (block.sleepoverWindow && sleepoverMinutes(block) === 0) add('times', 'sleepoverFrom', 'The sleeping window needs a start and an end.')
    if (block.sleepoverWindow && sleepoverMinutes(block) > 0 && !windowInsideBlock(block)) add('times', 'sleepoverFrom', 'The sleeping window must lie inside the block.')
    if (!(block.sleepoverActiveHours >= 0 && block.sleepoverActiveHours <= sleepoverMinutes(block) / 60)) add('times', 'sleepoverActiveHours', 'Active hours must be between 0 and the length of the sleepover.')
  }

  if (!Number.isInteger(block.workers) || block.workers < 1 || block.workers > 10) add('requirements', 'workers', 'Workers must be between 1 and 10.')
  if (!Number.isInteger(block.participantsPresent) || block.participantsPresent < 1 || block.participantsPresent > 40) add('requirements', 'participantsPresent', 'Participants present must be between 1 and 40.')

  if (context.groupsHeld) {
    const group = registrationGroupFor(block, context.groupOutings)
    if (!context.groupsHeld.includes(group)) {
      add('requirements', block.intensity === 'HighIntensity' ? 'intensity' : 'supportType', `${SUPPORT_LABEL[block.supportType]}${block.intensity === 'HighIntensity' ? ' at high intensity' : ''} needs registration group ${group}, which your organisation has not recorded as held.`)
    }
  }

  const travel = block.travel
  if (travel?.claim) {
    if (!(travel.minutesEachWay >= 0 && travel.minutesEachWay <= 480)) add('travel', 'travelMinutes', 'Travel minutes each way must be between 0 and 480.')
    if (!(travel.kmEachWay >= 0 && travel.kmEachWay <= 2000)) add('travel', 'travelKm', 'Travel kilometres each way must be between 0 and 2,000.')
    if (travel.participantsSharing !== undefined && !(travel.participantsSharing >= 1 && travel.participantsSharing <= block.participantsPresent)) add('travel', 'travelSharing', `Participants sharing the trip must be between 1 and ${block.participantsPresent}, the number present.`)
  }
  const transport = block.transport
  if (transport) {
    if (!(transport.km >= 0 && transport.km <= 2000)) add('travel', 'transportKm', 'Transport kilometres must be between 0 and 2,000.')
    if (!(transport.tolls >= 0 && transport.tolls <= 10000)) add('travel', 'tolls', 'Tolls must be between $0 and $10,000.')
    if (!(transport.parking >= 0 && transport.parking <= 10000)) add('travel', 'parking', 'Parking must be between $0 and $10,000.')
    if (transport.participantsSharing !== undefined && !(transport.participantsSharing >= 1 && transport.participantsSharing <= block.participantsPresent)) add('travel', 'transportSharing', `Participants sharing the vehicle must be between 1 and ${block.participantsPresent}, the number present.`)
  }
  if (block.accommodation && !(block.accommodation.nights >= 0 && block.accommodation.nights <= 14)) add('travel', 'nights', 'Accommodation nights must be between 0 and 14.')

  return problems
}

/** Activity-based transport goes with community access and group activities only. */
export function transportFamily(type: PlanSupportType): boolean {
  return type === 'CommunityAccess' || type === 'GroupActivity'
}

/**
 * The block after one of its fields changed, with everything that only made sense for the old value let go: a sleepover the new times no longer allow (or whose window no longer
 * lies inside the block), transport on a family that has none, accommodation on anything but short-term accommodation, and travel or transport shared by more participants than are
 * now present. Without this a field the screen has hidden would go on changing the price.
 */
export function normaliseBlock(block: PlanBlock): PlanBlock {
  let next = block
  if (!canOfferSleepover(next)) {
    if (next.workerMaySleep || next.sleepoverWindow || next.sleepoverActiveHours !== 0) next = { ...next, workerMaySleep: false, sleepoverWindow: undefined, sleepoverActiveHours: 0 }
  } else if (next.workerMaySleep) {
    if (needsSleepoverWindow(next) && (!next.sleepoverWindow || !sleepoverWindowFits(next))) next = { ...next, sleepoverWindow: defaultSleepoverWindow(next) }
    else if (next.sleepoverWindow && !sleepoverWindowFits(next)) next = { ...next, sleepoverWindow: undefined }
    const longest = sleepoverMinutes(next) / 60
    if (next.sleepoverActiveHours > longest) next = { ...next, sleepoverActiveHours: longest }
  }
  if (next.accommodation && next.supportType !== 'StaSupport') next = { ...next, accommodation: undefined }
  if (next.transport && !transportFamily(next.supportType)) next = { ...next, transport: undefined }
  if (next.travel?.participantsSharing !== undefined && next.travel.participantsSharing > next.participantsPresent) next = { ...next, travel: { ...next.travel, participantsSharing: undefined } }
  if (next.transport?.participantsSharing !== undefined && next.transport.participantsSharing > next.participantsPresent) next = { ...next, transport: { ...next.transport, participantsSharing: undefined } }
  return next
}

/** A window the person gave lies inside the block (a block with none is its own window). */
export function sleepoverWindowFits(block: Pick<PlanBlock, 'start' | 'end' | 'sleepoverWindow'>): boolean {
  return windowInsideBlock(block)
}

function windowInsideBlock(block: Pick<PlanBlock, 'start' | 'end' | 'sleepoverWindow'>): boolean {
  if (!block.sleepoverWindow) return true
  const start = toMinutes(block.start)
  const from = toMinutes(block.sleepoverWindow.from)
  const offset = (((from - start) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return offset < durationMinutes(block) && offset + sleepoverMinutes(block) <= durationMinutes(block)
}

/** The price is the NDIS maximum, times the workers and divided by the participants present, rounded down to the cent: said once, in plain words, under the two numbers. */
export function ratioSentence(workers: number, participants: number): string {
  if (!(workers >= 1) || !(participants >= 1)) return ''
  if (workers === 1 && participants === 1) return 'One worker for one participant: the full hourly price.'
  const times = workers > 1 ? ` times ${workers}` : ''
  const share = participants > 1 ? ` divided by ${participants}` : ''
  return `${workers}:${participants}. Each participant's hourly price is the NDIS maximum${times}${share}, rounded down to the cent.`
}

export type PlacedBar = DayBar & { lane: number; lanes: number }

/** Bars on one day side by side: each takes the first lane free at its start, and every bar of the day shares the day's lane count. */
export function layoutDay(bars: readonly DayBar[]): PlacedBar[] {
  const sorted = [...bars].sort((a, b) => a.from - b.from || a.to - b.to)
  const laneEnds: number[] = []
  const placed = sorted.map(bar => {
    let lane = laneEnds.findIndex(end => end <= bar.from)
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(bar.to) } else laneEnds[lane] = bar.to
    return { ...bar, lane }
  })
  const lanes = Math.max(1, laneEnds.length)
  return placed.map(bar => ({ ...bar, lanes }))
}
