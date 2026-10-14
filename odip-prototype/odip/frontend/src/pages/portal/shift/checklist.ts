// The During and End checklists as plain data. Pure and JSX-free; the components only draw what these return.
import { formatWallClock, toDatetimeInputValue } from '@/lib/wallClock'
import type { PortalDoseSlotDto, PortalShiftRoutineDto } from '@/api/types'
import { SHIFT_PACKAGE_ERROR_CODES as C } from '@/api/types'
import { parseApiDate } from '@/lib/utils'
import { providerLocalToUtcInstant, utcInstantToProviderLocal } from './shiftTime'

/** "8:00 am" from a provider-local wall-clock value; the digits are printed as written. */
export function clockLabel(wallClock: string | null | undefined): string {
  if (!wallClock) return 'Anytime'
  return formatWallClock(wallClock, { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/\s?([AP])M$/i, (_, c: string) => ` ${c.toLowerCase()}m`)
}

export type ChecklistItem =
  | { kind: 'dose'; key: string; slot: PortalDoseSlotDto }
  | { kind: 'routine'; key: string; routine: PortalShiftRoutineDto }

export interface ChecklistGroup {
  id: string
  label: string
  /** Warning only for overdue doses. */
  tone: 'warning' | 'neutral'
  items: ChecklistItem[]
}

/**
 * Doses due and routines in the shift window: overdue doses first (their own group), then one group per time in order (an overnight
 * shift's after-midnight times sort after the evening), then "Anytime". "As needed" medicines are not here: they have no time.
 */
export function buildChecklist(shift: { medicationsDue: PortalDoseSlotDto[]; shiftRoutines: PortalShiftRoutineDto[] }): { groups: ChecklistGroup[] } {
  const overdue: ChecklistItem[] = []
  const timed = new Map<string, ChecklistItem[]>()
  const anytime: ChecklistItem[] = []

  const timeGroup = (wall: string) => {
    const id = toDatetimeInputValue(wall)
    if (!timed.has(id)) timed.set(id, [])
    return timed.get(id)!
  }

  for (const slot of shift.medicationsDue) {
    const item: ChecklistItem = { kind: 'dose', key: `dose-${slot.medicationId}-${slot.scheduledAt}`, slot }
    if (slot.state === 'Overdue') overdue.push(item)
    else timeGroup(slot.scheduledAt).push(item)
  }
  for (const routine of shift.shiftRoutines) {
    const item: ChecklistItem = { kind: 'routine', key: `routine-${routine.id}`, routine }
    if (routine.occursAt) timeGroup(routine.occursAt).push(item)
    else anytime.push(item)
  }

  const groups: ChecklistGroup[] = []
  if (overdue.length) groups.push({ id: 'overdue', label: 'Overdue', tone: 'warning', items: overdue })
  for (const [id, list] of [...timed.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    // Doses before routines at the same time.
    const items = [...list].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'dose' ? -1 : 1))
    groups.push({ id, label: clockLabel(`${id}:00`), tone: 'neutral', items })
  }
  if (anytime.length) groups.push({ id: 'anytime', label: 'Anytime', tone: 'neutral', items: anytime })
  return { groups }
}

/** Changes whenever a break is added, removed, ended or edited, so the finish flow can send the worker back to step 1 when the breaks change. */
export function breaksSignature(breaks: { id: string; startedAt: string; endedAt: string | null }[]): string {
  return breaks.map(b => `${b.id}|${b.startedAt}|${b.endedAt ?? ''}`).join(';')
}

// ── The five-step finish (My shifts redesign, SHAPE §4). The server stays the floor: these name a refusal on its step, they add none. ──

export type FinishStepKey = 'times' | 'doses' | 'report' | 'handover' | 'submit'

/** The finish flow's steps in order: the rail's short label and the step's heading. */
export const FINISH_STEPS: readonly { key: FinishStepKey; label: string; heading: string }[] = [
  { key: 'times', label: 'Times', heading: 'Your times' },
  { key: 'doses', label: 'Doses', heading: 'Doses & routines' },
  { key: 'report', label: 'Report', heading: 'Anything to report?' },
  { key: 'handover', label: 'Handover', heading: 'Note & handover' },
  { key: 'submit', label: 'Submit', heading: 'Check and submit' },
]

/** Mirrors PortalController.MaxTimeAdjustmentMinutes. */
export const MAX_ADJUST_MINUTES = 15
/** Mirrors PortalController.MaxTimeAdjustmentReasonLength. */
export const REASON_MAX = 500

const MINUTE = 60_000
const toLocal = (ms: number, tz: string) => utcInstantToProviderLocal(new Date(ms).toISOString(), tz)
const toMs = (local: string, tz: string) => {
  const iso = providerLocalToUtcInstant(local, tz)
  return iso ? Date.parse(iso) : NaN
}

/**
 * What each Change control offers, as provider-local "yyyy-MM-ddTHH:mm" (a datetime-local's digits). The server compares with its stamps
 * truncated to the minute, so these are too: the start's stamp ±15, and the end from 15 minutes before this minute up to this minute.
 */
// shortcut: on the DST fall-back night the bounds are wall-clock strings, so in the repeated hour min can read later than max and a move
// may be refused; the server stays the floor and no wrong time is stored. Upgrade to instant bounds if overnight workers hit it.
export function timeBounds(stampedStart: string, tz: string, now: Date) {
  const start = Math.floor(parseApiDate(stampedStart).getTime() / MINUTE) * MINUTE
  const end = Math.floor(now.getTime() / MINUTE) * MINUTE
  const span = MAX_ADJUST_MINUTES * MINUTE
  return {
    start: { stamp: toLocal(start, tz), min: toLocal(start - span, tz), max: toLocal(start + span, tz) },
    end: { now: toLocal(end, tz), min: toLocal(end - span, tz), max: toLocal(end, tz) },
  }
}

export interface TimesInput {
  tz: string
  /** completion.actualStart: the server's stamp, an instant. */
  stampedStart: string
  /** The worker's start or finish, provider-local, or null to keep the recorded time. */
  startOverride: string | null
  endOverride: string | null
  reason: string
  kilometres: string
  breaks: { id: string; startedAt: string; endedAt: string | null; isRunning: boolean }[]
  now: Date
}

/** The overrides that really move a time, as instants for the API (the server's own rule): a start off its stamp's minute, an end before this minute. */
export function movedTimes(i: TimesInput): { start: string | null; end: string | null } {
  const b = timeBounds(i.stampedStart, i.tz, i.now)
  return {
    start: i.startOverride && i.startOverride !== b.start.stamp ? providerLocalToUtcInstant(i.startOverride, i.tz) : null,
    end: i.endOverride && toMs(i.endOverride, i.tz) < toMs(b.end.max, i.tz) ? providerLocalToUtcInstant(i.endOverride, i.tz) : null,
  }
}

export type TimesField = 'start' | 'end' | 'reason' | 'kilometres' | 'break'


/** Step 1's gate: the server's rules for the times, the breaks and the kilometres, so a refusal is named on step 1 (SHAPE §4). Null lets it go on. */
export function timesError(i: TimesInput): { field: TimesField; message: string; breakId?: string } | null {
  const running = i.breaks.find(x => x.isRunning)
  if (running) return { field: 'break', breakId: running.id, message: 'End your break first.' }
  const b = timeBounds(i.stampedStart, i.tz, i.now)
  if (i.startOverride !== null) {
    const ms = toMs(i.startOverride, i.tz)
    if (!(ms >= toMs(b.start.min, i.tz) && ms <= toMs(b.start.max, i.tz))) {
      return { field: 'start', message: `Choose a time between ${clockLabel(`${b.start.min}:00`)} and ${clockLabel(`${b.start.max}:00`)}.` }
    }
  }
  if (i.endOverride !== null) {
    const ms = toMs(i.endOverride, i.tz)
    if (ms > i.now.getTime()) return { field: 'end', message: "Your finish time can't be in the future." }
    if (!(ms >= toMs(b.end.min, i.tz))) return { field: 'end', message: 'Choose a time no more than 15 minutes before now.' }
  }
  const moved = movedTimes(i)
  if (moved.start || moved.end) {
    const start = moved.start ? Date.parse(moved.start) : parseApiDate(i.stampedStart).getTime()
    const end = moved.end ? Date.parse(moved.end) : i.now.getTime()
    if (start >= end) return { field: moved.start ? 'start' : 'end', message: 'Your start must be before your finish.' }
    if (!i.reason.trim()) return { field: 'reason', message: 'Say why your times changed.' }
    const outside = i.breaks.find(x => parseApiDate(x.startedAt).getTime() < start || (x.endedAt ? parseApiDate(x.endedAt).getTime() : end) > end)
    if (outside) return { field: 'break', breakId: outside.id, message: 'Your times must include your breaks. Change the break first, or your times.' }
  }
  if (parseKilometres(i.kilometres) === 'invalid') return { field: 'kilometres', message: 'Enter kilometres from 0 to 2,000.' }
  return null
}

/** The kilometre field (SHAPE §4): blank is null; a number from 0 to 2,000 with at most one decimal place; anything else is 'invalid'. */
export function parseKilometres(raw: string): number | null | 'invalid' {
  const t = raw.trim()
  if (!t) return null
  if (!/^\d{0,4}(\.\d)?$/.test(t)) return 'invalid'
  const n = Number(t)
  return n <= 2000 ? n : 'invalid'
}

/** Step 4's forward button names what the tap confirms (SHAPE §4), so the step is never blocked and never silent. */
export function handoverForward(noteCount: number, nothingToNote: boolean, handoverText: string, nothingToHandOver: boolean): string {
  const noNote = noteCount === 0 && !nothingToNote
  const noHandover = !handoverText.trim() && !nothingToHandOver
  if (noNote && noHandover) return 'Nothing to note or hand over'
  if (noHandover) return 'Nothing to hand over'
  if (noNote) return 'Nothing to note'
  return 'Next'
}

const TIMES_CODES: readonly string[] = [
  'BREAK_RUNNING', C.timeAdjustmentTooLarge, C.timeAdjustmentReasonRequired, C.timeAdjustmentReasonTooLong,
  C.actualEndInFuture, C.startNotBeforeEnd, C.breakOutsideTimes, C.kilometresOutOfRange,
]

/** Where a refused submit sends the worker (SHAPE §4, step 5): times, breaks and kilometres to step 1, a dose to step 2, the note to step 4. */
export function stepForCode(code: string | null | undefined): FinishStepKey | null {
  if (!code) return null
  if (TIMES_CODES.includes(code)) return 'times'
  if (code === 'DOSE_OUTCOME_MISSING') return 'doses'
  if (code === C.noteRequired) return 'handover'
  return null
}

const OUTCOME_COUNTS: readonly [string, string][] = [['Administered', 'given'], ['Refused', 'refused'], ['Withheld', 'withheld'], ['Missed', 'not given']]

/** "3 given, 1 refused · 4 of 5 routines ticked" (SHAPE step 2): only what there is to count. */
export function dosesSummary(doses: PortalDoseSlotDto[], routines: PortalShiftRoutineDto[]): string {
  const given = OUTCOME_COUNTS
    .map(([status, word]) => [doses.filter(d => d.outcome?.status === status).length, word] as const)
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}`)
  const parts = given.length ? [given.join(', ')] : []
  if (routines.length) parts.push(`${routines.filter(r => r.isChecked).length} of ${routines.length} routines ticked`)
  return parts.join(' · ')
}
