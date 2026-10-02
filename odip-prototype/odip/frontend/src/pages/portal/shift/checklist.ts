// The During and End checklists as plain data. Pure and JSX-free; the components only draw what these return.
import { formatWallClock, toDatetimeInputValue } from '@/lib/wallClock'
import type { PortalDoseSlotDto, PortalShiftRoutineDto, PortalFinishBlockerDto } from '@/api/types'

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

export interface EndItem {
  id: 'doses' | 'breaks' | 'note' | 'handover'
  label: string
  done: boolean
}

/** What must clear before Finish. Doses and breaks come from the server's `finishBlockers` (its rule is the rule). */
export function endChecklist(input: {
  blockers: PortalFinishBlockerDto[]
  noteCount: number
  nothingToNote: boolean
  handoverText: string
  nothingToHandOver: boolean
}): EndItem[] {
  const doseBlockers = input.blockers.filter(b => b.code === 'DOSE_OUTCOME_MISSING').length
  const breakRunning = input.blockers.some(b => b.code === 'BREAK_RUNNING')
  const noteDone = input.noteCount > 0 || input.nothingToNote
  const handoverDone = !!input.handoverText.trim() || input.nothingToHandOver
  return [
    { id: 'doses', label: doseBlockers ? `${doseBlockers} dose${doseBlockers === 1 ? '' : 's'} need an outcome` : 'Every due dose has an outcome', done: doseBlockers === 0 },
    { id: 'breaks', label: breakRunning ? 'A break is still running' : 'Breaks confirmed', done: !breakRunning },
    { id: 'note', label: noteDone ? 'Shift note done' : 'Add a note, or say nothing to note', done: noteDone },
    { id: 'handover', label: handoverDone ? 'Handover done' : 'Write a handover, or say nothing to hand over', done: handoverDone },
  ]
}
