// The agreement wizard's schedule model, pure and JSX-free. A coordinator thinks in shifts ("Mon 09:00 to 13:00 community access"); the pricing engine and the saved agreement think in blocks (one
// weekly routine on several days). The wizard keeps shifts and turns them into blocks only to price and to save, so nothing on the server changes: identical shifts group into one block, and an
// engine message about a block is mapped back to the shifts it came from.
import type { AgreementState, DraftBlock, PlanBlock, PlanBlockRequirements, PlanDayName, PlanPriceZone } from '@/api/types'
import { PLAN_DAYS, SUPPORT_LABEL, clock, daysSummary, durationMinutes, emptyBlock, endsNextDay, ratioLabel, toMinutes } from './planBlocks'

/** One support on one day of the week. `block` is the engine's block without the days and the id the engine keys it by. */
export interface Shift {
  id: string
  day: PlanDayName
  block: Omit<PlanBlock, 'id' | 'days'>
  requirements: PlanBlockRequirements
}

/** A block the shifts make, with the shifts it was made from. */
export interface ShiftGroup {
  entry: DraftBlock
  shiftIds: string[]
}

/** The engine's limits on one quote (200 blocks) and on one approval (100 weekly roster patterns, days times workers). */
export const MAX_ENGINE_BLOCKS = 200
export const MAX_ROSTER_PATTERNS = 100

const MINUTES_PER_WEEK = 7 * 1440

const stable = (value: unknown): string => JSON.stringify(value, (_key, v: unknown) => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
  : v))

/** Identical shifts (everything but the day and the id) share one block; two on the same day never do, so the engine still reports the overlap. Blocks are numbered in the order the shifts first appear. */
export function groupShifts(shifts: readonly Shift[]): ShiftGroup[] {
  const groups: (ShiftGroup & { key: string })[] = []
  for (const shift of shifts) {
    const key = stable({ block: shift.block, requirements: shift.requirements })
    const group = groups.find(g => g.key === key && !g.entry.block.days.includes(shift.day))
    if (group) { group.entry.block.days.push(shift.day); group.shiftIds.push(shift.id); continue }
    groups.push({ key, shiftIds: [shift.id], entry: { block: { ...structuredClone(shift.block), id: `b${groups.length + 1}`, days: [shift.day] }, requirements: structuredClone(shift.requirements) } })
  }
  const dayOf = new Map(shifts.map(shift => [shift.id, PLAN_DAYS.indexOf(shift.day)]))
  return groups.map(({ entry, shiftIds }) => {
    const ids = [...shiftIds].sort((x, y) => dayOf.get(x)! - dayOf.get(y)!)
    return { entry: { ...entry, block: { ...entry.block, days: ids.map(id => PLAN_DAYS[dayOf.get(id)!]) } }, shiftIds: ids }
  })
}

export const shiftsToBlocks = (shifts: readonly Shift[]): DraftBlock[] => groupShifts(shifts).map(group => group.entry)

/** One shift for each day of each block, block by block, Monday first. */
export function blocksToShifts(entries: readonly DraftBlock[]): Shift[] {
  const shifts: Shift[] = []
  for (const { block, requirements } of entries) {
    const { id: _id, days, ...rest } = block
    for (const day of PLAN_DAYS.filter(d => days.includes(d))) shifts.push({ id: `s${shifts.length + 1}`, day, block: structuredClone(rest), requirements: structuredClone(requirements) })
  }
  return shifts
}

/** A shift for `day`, starting from the last one in the list (the times and support the coordinator used last) or, for a first shift, from a usual morning of community access. */
export function newShift(day: PlanDayName, shifts: readonly Shift[], state: AgreementState, zone: PlanPriceZone = 'National'): Shift {
  const taken = new Set(shifts.map(shift => shift.id))
  let n = shifts.length + 1
  while (taken.has(`s${n}`)) n += 1
  const last = shifts[shifts.length - 1]
  if (last) return { id: `s${n}`, day, block: structuredClone(last.block), requirements: structuredClone(last.requirements) }
  const { id: _id, days: _days, ...rest } = emptyBlock('x', state, zone)
  return { id: `s${n}`, day, block: rest, requirements: { workerGender: 'NoPreference', driver: false, skills: [] } }
}

/** The shifts that run at the same time as another shift of the plan. A shift past midnight runs into the next day (Sunday night into Monday morning). */
export function overlappingShiftIds(shifts: readonly Shift[]): Set<string> {
  const spans = shifts.map(shift => ({ id: shift.id, from: PLAN_DAYS.indexOf(shift.day) * 1440 + toMinutes(shift.block.start), length: durationMinutes(shift.block) }))
  const clash = new Set<string>()
  spans.forEach((a, i) => {
    for (const b of spans.slice(i + 1)) {
      if ([0, MINUTES_PER_WEEK, -MINUTES_PER_WEEK].some(shift => a.from < b.from + shift + b.length && b.from + shift < a.from + a.length)) { clash.add(a.id); clash.add(b.id) }
    }
  })
  return clash
}

/** "09:00 to 13:00 · Community access · 1:1", and for a shift past midnight "22:00 to 06:00 (ends the next day) · ...". */
export function shiftLabel(shift: Pick<Shift, 'block'>): string {
  const { block } = shift
  return [`${clock(block.start)} to ${clock(block.end)}${endsNextDay(block) ? ' (ends the next day)' : ''}`, SUPPORT_LABEL[block.supportType], ratioLabel(block)].join(' · ')
}

/** "Mon–Fri 09:00 to 13:00": a block said as the shifts it is. */
export function groupLabel(block: Pick<PlanBlock, 'days' | 'start' | 'end'>): string {
  return `${daysSummary(block.days)} ${clock(block.start)} to ${clock(block.end)}`
}

const SHIFT = (word: string) => `${word[0] === 'B' ? 'S' : 's'}hift${/s$/i.test(word) ? 's' : ''}`

/** An engine message in the screen's words: the ids the engine knows blocks by become the shifts they are ("Mon–Fri 09:00 to 13:00"), and the word block becomes shift. */
export function shiftWords(message: string, groups: readonly ShiftGroup[]): string {
  const say = (id: string) => { const group = groups.find(g => g.entry.block.id === id); return group ? groupLabel(group.entry.block) : undefined }
  return message
    .replace(/Blocks '([^']+)' and '([^']+)'/g, (whole, a: string, b: string) => (say(a) && say(b) ? `${say(a)} and ${say(b)}` : whole))
    .replace(/Block '([^']+)'/g, (whole, id: string) => say(id) ?? whole)
    .replace(/\bblocks?\b/gi, SHIFT)
}

/** The hours of support the shifts ask for in an ordinary week, by arithmetic alone (the server's quote is what prices them). */
export const weeklyShiftHours = (shifts: readonly Shift[]): number => shifts.reduce((sum, shift) => sum + durationMinutes(shift.block), 0) / 60

export interface EngineLimits {
  blocks: number
  patterns: number
  /** Which limit the schedule is over, if any. */
  exceeded: 'blocks' | 'patterns' | null
}

/** Where the schedule stands against the engine's limits, so the editor and Check can say so early and not only when approval refuses. */
export function engineLimits(shifts: readonly Shift[]): EngineLimits {
  const groups = groupShifts(shifts)
  const patterns = groups.reduce((sum, group) => sum + group.entry.block.days.length * group.entry.block.workers, 0)
  return { blocks: groups.length, patterns, exceeded: groups.length > MAX_ENGINE_BLOCKS ? 'blocks' : patterns > MAX_ROSTER_PATTERNS ? 'patterns' : null }
}

