import { format, parseISO } from 'date-fns'
import type { BudgetWarningDto, ShiftDto, StartWeekResultDto } from '@/api/types'
import { joinList, plural } from '@/lib/format'
import { formatShiftTimeRange } from './roster'
import { firstName } from './rosterDrag'

// The words of Start rostering, the Publish banner, the leave guard and the regular (2026-10-16 brief, sections 2-5). Every sentence with a count or a name lives here.

export const START_FAILED = 'Something went wrong starting this week. Please try again.'
export const ALREADY_STARTED = 'This week was already started'
export const LEAVE_TITLE = 'Leave without publishing?'

/** A Draft a rule that can't be overridden blocks: Publish week skips it (RosteringController's publish). */
export const isBlocked = (shift: ShiftDto) => shift.findings.some(f => f.severity === 'Blocking')

const either = (n: number, one: string, many: string) => (n === 1 ? one : many)

export const alreadyInWeekLine = (n: number) => `${plural(n, 'shift')} already in this week ${either(n, 'stays as it is', 'stay as they are')}.`

export const bannerTitle = (n: number) => `${plural(n, 'shift')} not visible to staff yet`

/** The banner's body: only when some drafts can't be published. All of them blocked opens "They" (or "It"). */
export function bannerBlockedLine(n: number, blocked: number): string | null {
  if (blocked === 0) return null
  const who = blocked === n ? either(n, 'It', 'They') : `${blocked} of them`
  return `${who} can't be published until the worker changes: a rule that can't be overridden blocks ${either(blocked, 'it', 'them')}.`
}

export const leaveMessage = (n: number, span: string) =>
  `${plural(n, 'shift')} in ${span} ${either(n, "isn't", "aren't")} visible to staff yet. ${either(n, 'It stays saved as a draft', 'They stay saved as drafts')} until you publish the week.`

export const startResultTitle = (span: string, r: StartWeekResultDto) => (r.created > 0 ? `Started ${span}: ${plural(r.created, 'shift')} added` : `Started ${span}`)

/** The Start result's body (the brief, 2.3): only the sentences that aren't zero. Nothing made and nobody skipped: why the week is empty. */
export function startResultBody(r: StartWeekResultDto): string | null {
  if (r.created === 0 && r.skipped.length === 0) return 'No approved agreement has a shift in this week.'
  const open = r.created - r.assignedToRegulars - r.regularAway
  const names = joinList(r.skipped.map(p => p.fullName).filter(Boolean))
  return [
    r.assignedToRegulars > 0 ? `${r.assignedToRegulars} ${either(r.assignedToRegulars, 'has its regular on it', 'have their regular on them')}.` : null,
    r.regularAway > 0 ? `${r.regularAway} ${either(r.regularAway, 'is', 'are')} open because the regular is away.` : null,
    open > 0 ? `${open} ${either(open, 'needs', 'need')} staff: no regular is set.` : null,
    r.skipped.length > 0 ? `Skipped ${plural(r.skipped.length, 'participant')} not ready for rostering${names ? `: ${names}` : ''}.` : null,
  ].filter(Boolean).join(' ') || null
}

/** Start answers budget warnings per participant; BudgetWarnings takes one flat list, naming each line's participant when there are several. */
export const startBudgetWarnings = (r: StartWeekResultDto): BudgetWarningDto[] =>
  (r.budgetWarnings ?? []).flatMap(p => (p.warnings ?? []).map(w => ({ ...w, participantName: p.fullName })))

const weekday = (shift: ShiftDto) => format(parseISO(shift.serviceDate), 'EEEE')

/** The Make or Stop confirm (the brief, 5.2). The regular is per weekday slot, so the copy names the day. `replacing` is the slot's regular a Make takes over from. */
export function regularConfirm(shift: ShiftDto, replacing?: string): { title: string; lines: string[]; confirmLabel: string } {
  const first = firstName(shift.staffName)
  const slot = `${shift.participantName}'s ${weekday(shift)} ${formatShiftTimeRange(shift.startTime, shift.endTime)} shift`
  if (shift.isRegular) {
    return {
      title: `Stop ${first} being the regular?`,
      lines: [`From the next week you start, ${slot} is made open, with nobody on it. Weeks already started keep ${first}.`,
        // The server leaves a renewal's own regular alone (SetRegular); the board does not carry the renewal, so this is conditional.
        'If this agreement has been renewed, the renewal keeps its own regular when someone set a different one.'],
      confirmLabel: 'Stop being the regular',
    }
  }
  return {
    title: `Make ${first} the regular?`,
    lines: [
      `${first} goes on ${slot} in every week you start from now on, unless they're away. Weeks already started don't change, this one included.`,
      ...(replacing ? [`${firstName(replacing)} stops being the regular.`] : []),
    ],
    confirmLabel: `Make ${first} the regular`,
  }
}

/** The notice after a Make or Stop. Called with the shift as the menu saw it, so isRegular is the old value. */
export const regularDone = (shift: ShiftDto) =>
  shift.isRegular
    ? `${shift.participantName}'s ${weekday(shift)} shift has no regular now.`
    : `${firstName(shift.staffName)} is now the regular for ${shift.participantName}'s ${weekday(shift)} shift.`
