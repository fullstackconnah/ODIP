import type { OverlapShiftDto } from '@/api/hooks'
import { joinList, plural } from '@/lib/format'
import { overlapRosterLink } from './groups/useLeaveGroup'
import type { GroupKey } from './quickGroupModel'

// The words of a decision tab's bulk bar, its confirm and its one result notice (SHAPE §4–§6). Only the tabs with a one-tap decision have them.

export type BulkKey = 'completions' | 'leave' | 'tasks'
export const isBulkKey = (key: GroupKey): key is BulkKey => key === 'completions' || key === 'leave' || key === 'tasks'

/** POST /rostering/completions/approve-batch takes 1 to 100 ids. */
export const BATCH_MAX = 100

/** What a run did, for its one notice. */
export interface BulkResult {
  /** The rows the run sent. */
  total: number
  decided: number
  /** Decided or removed by somebody else first (404, 409, a task already closed). */
  stale: number
  /** Refused: the row's reference (its action name after the verb) and the server's words. */
  failed: Array<{ ref: string; message: string }>
  /** Left out of a Complete all by the tab's rule (need review, your own request, can't be marked done here). */
  skipped: number
  /** Each leave or unavailability approval that overlaps the roster. */
  overlaps: Array<{ kind: 'leave' | 'unavailability'; shifts: OverlapShiftDto[]; trips: number }>
  /** Over the batch cap: the clean total this run was the first 100 of. */
  of?: number
  /** The batch request failed whole (one SaveChanges: nothing was approved). */
  wholeFailed?: boolean
}

const NOUN: Record<BulkKey, [string, string]> = { completions: ['shift completion', 'shift completions'], leave: ['leave request', 'leave requests'], tasks: ['task', 'tasks'] }
const noun = (key: BulkKey, n: number) => NOUN[key][n === 1 ? 0 : 1]
const s = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** The bar's one action: Complete all (n = every safe row in the tab) or the selection's (n = the ticked rows). */
export function actionLabel(key: BulkKey, mode: 'all' | 'selected', n: number): { label: string; name: string } {
  const done = key === 'tasks'
  if (mode === 'selected') {
    return done ? { label: `Mark ${n} done`, name: `Mark ${n} selected ${noun(key, n)} done` } : { label: `Approve ${n}`, name: `Approve ${n} selected ${noun(key, n)}` }
  }
  if (key === 'completions') {
    if (n > BATCH_MAX) return { label: `Approve ${BATCH_MAX} of ${n} clean`, name: `Approve the first ${BATCH_MAX} of ${n} clean shift completions` }
    return n === 1 ? { label: 'Approve 1 clean', name: 'Approve 1 clean shift completion' } : { label: `Approve all ${n} clean`, name: `Approve all ${n} clean shift completions` }
  }
  const all = n === 1 ? '' : 'all '
  return done ? { label: `Mark ${all}${n} done`, name: `Mark ${all}${n} ${noun(key, n)} done` } : { label: `Approve ${all}${n}`, name: `Approve ${all}${n} ${noun(key, n)}` }
}

/** The bar's button while a run goes: the row in flight of the total; the batch is one request. */
export function runningLabel(key: BulkKey, done: number, total: number): string {
  if (key === 'completions') return `Approving ${total}…`
  return key === 'tasks' ? `Marking ${done + 1} of ${total} done…` : `Approving ${done + 1} of ${total}…`
}

/** A row's box is named by its one-tap action, its verb swapped: "Approve leave: …" is "Select leave: …", "Done: …" is "Select: …". */
export const selectName = (actionName: string) => actionName.replace(/^[^\s:]+/, 'Select')

/** What a row is called in a notice: its action name after the verb ("Mei Zhang with Ava Chen, 10 Sep"). */
export const rowRef = (actionName: string) => actionName.slice(actionName.indexOf(': ') + 2)

const CONSEQUENCE: Record<BulkKey, string> = {
  completions: 'Each one moves to Completed, ready for billing.',
  leave: 'Each leave approval emails the staff member, and any that overlaps the roster gets its cover tasks, as one at a time would.',
  tasks: 'Each one is checked first, and one already closed is skipped.',
}

/** The house ConfirmDialog's words: the count in the title is the count the run sends. `skipped`: the rows the tab's rule leaves out (Complete all only). */
export function confirmCopy(key: BulkKey, mode: 'all' | 'selected', n: number, skipped: number): { title: string; message: string; confirm: string } {
  const sent = Math.min(n, key === 'completions' ? BATCH_MAX : n)
  const confirm = key === 'tasks' ? `Mark ${sent} done` : `Approve ${sent}`
  if (mode === 'selected') {
    const title = key === 'tasks' ? `Mark ${n} selected ${noun(key, n)} done?` : `Approve ${n} selected ${key === 'completions' ? s(n, 'completion', 'completions') : noun(key, n)}?`
    return { title, message: CONSEQUENCE[key], confirm }
  }
  const title = key === 'completions'
    ? (n > BATCH_MAX ? `Approve the first ${BATCH_MAX} of ${n} clean completions?` : `Approve ${plural(n, 'clean completion')}?`)
    : key === 'tasks' ? `Mark ${plural(n, 'task')} done?` : `Approve ${plural(n, 'leave request')}?`
  const stays = !skipped ? ''
    : key === 'completions' ? ` The ${skipped} that ${s(skipped, 'needs review stays', 'need review stay')} here.`
    : key === 'leave' ? " Your own request isn't included: someone else decides it."
    : ` ${skipped} ${s(skipped, "stays for you to open: it can't", "stay for you to open: they can't")} be marked done here.`
  return { title, message: CONSEQUENCE[key] + stays, confirm }
}

/** The run's ONE notice (SHAPE §6): a headline, then each clause that is not zero. Success when anything was decided; danger only when nothing was. */
export function resultNotice(key: BulkKey, r: BulkResult): { tone: 'success' | 'danger'; title: string; message: string; link?: { label: string; to: string } } {
  const failTitle = key === 'tasks' ? `Couldn't mark ${plural(r.total, 'task')} done` : `Couldn't approve ${plural(r.total, key === 'leave' ? 'leave request' : 'completion')}`
  if (r.wholeFailed) return { tone: 'danger', title: failTitle, message: 'Nothing was approved.' }
  const title = r.decided === 0 ? failTitle
    : key === 'completions' ? (r.of ? `Approved ${r.decided} of ${r.of}` : `Approved ${plural(r.decided, 'completion')}`)
    : key === 'leave' ? `Approved ${plural(r.decided, 'leave request')}` : `Marked ${plural(r.decided, 'task')} done`

  const parts: string[] = []
  if (r.skipped) {
    parts.push(key === 'completions' ? `${r.skipped} ${s(r.skipped, 'needs review and stays', 'need review and stay')} here.`
      : key === 'leave' ? (r.skipped === 1 ? 'Your own request stays for someone else.' : `Your own ${r.skipped} requests stay for someone else.`)
      : `${r.skipped} can't be marked done here and ${s(r.skipped, 'stays', 'stay')}.`)
  }
  if (r.stale) {
    const was = `${r.stale} ${s(r.stale, 'was', 'were')} already`
    parts.push(key === 'completions' ? `${was} reviewed.` : key === 'leave' ? `${was} decided by someone else.` : `${was} closed.`)
  }
  if (r.failed.length) {
    const named = r.failed.slice(0, 3).map((f) => `${f.ref}: ${f.message.replace(/\.$/, '')}`)
    const more = r.failed.length - named.length
    parts.push(`${r.failed.length} couldn't be ${key === 'tasks' ? 'marked done' : 'approved'}: ${named.join('; ')}${more ? `; and ${more} more` : ''}.`)
  }
  let link: { label: string; to: string } | undefined
  if (r.overlaps.length) {
    const sum = (kind: 'leave' | 'unavailability') => r.overlaps.filter((o) => o.kind === kind).reduce((n, o) => n + o.shifts.length, 0)
    const cover = sum('leave')
    const other = sum('unavailability')
    const trips = r.overlaps.reduce((n, o) => n + o.trips, 0)
    const what = [
      cover && `${plural(cover, 'shift')} now ${s(cover, 'has a cover task', 'have cover tasks')}`,
      other && `${plural(other, 'shift')} ${s(other, 'overlaps', 'overlap')} regular unavailability`,
      trips && `${plural(trips, 'trip')} ${s(trips, 'overlaps', 'overlap')}`,
    ].filter((part): part is string => !!part)
    const n = r.overlaps.length
    parts.push(`${n} ${s(n, 'overlaps', 'overlap')} the roster${what.length ? `: ${joinList(what)}` : ''}.`)
    link = { label: 'Open roster', to: overlapRosterLink(r.overlaps.flatMap((o) => o.shifts)) }
  }
  if (r.of) parts.push('Run it again for the rest.')
  return { tone: r.decided > 0 ? 'success' : 'danger', title, message: parts.join(' '), ...(link && { link }) }
}
