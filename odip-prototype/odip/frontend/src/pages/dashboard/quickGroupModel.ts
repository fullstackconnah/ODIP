import type { ApproveBatchResultDto, OverlapShiftDto } from '@/api/hooks'
import { awaitsData, retryingAfterError, type QueryPhase } from '@/lib/queryPhase'
import type { Tone } from '@/lib/tone'

// The dashboard's decision groups (SHAPE §4, §5): one model per kind, drawn by QuickGroup. A group hook (pages/dashboard/groups) maps its queries and the
// REAL mutation hooks to this; QuickGroup only draws it and keeps each row's in-flight and error state.

/** The groups; their tab order is useDecisionGroups'. PR C adds 'unfilled' and 'agreements'. */
export type GroupKey = 'completions' | 'leave' | 'incidents' | 'tasks' | 'compliance'

/** What a decision did besides leaving the list. */
export interface ActionOutcome {
  /** The sentence the page's AnnouncementRegion says for a plain success. */
  announce?: string
  /** A consequence the server returned: a visible notice under the group's rows, with its next step. It announces itself, so `announce` is left out. */
  notice?: { title: string; message: string; link: { label: string; to: string } }
  /** The row still needs somebody (a credential saved with a date still inside the window): it stays, and the refetch redraws it. */
  keep?: boolean
  /** Somebody else got there first (a task already closed): the row leaves, and a bulk run counts it as stale, not decided. */
  stale?: boolean
  /** A leave or unavailability approval that overlaps the roster: a bulk run rolls these into its one notice (DECISIONS 3). */
  overlap?: { kind: 'leave' | 'unavailability'; shifts: OverlapShiftDto[]; trips: number }
}

export interface QuickForm {
  field: 'textarea' | 'date'
  label: string
  hint?: string
  /** The message for a blank value. Absent: the field is optional. */
  required?: string
  /** The server's cap on the trimmed value. Draws a counter. */
  maxLength?: number
  initial?: string
  submitLabel: string
  busyLabel: string
  /** Return and Decline submit in the danger variant; everything else is primary. */
  danger?: boolean
  failText: string
  /** Gets the value as typed: the group trims it exactly as its full page does. */
  submit: (value: string) => Promise<ActionOutcome>
}

export type RowAction =
  | { kind: 'link'; label: string; name: string; to: string }
  | { kind: 'tap'; label: string; busyLabel: string; name: string; failText: string; run: () => Promise<ActionOutcome> }
  | { kind: 'form'; label: string; name: string; form: QuickForm }

/** One fact column of a group's table (SHAPE §4): after the subject column, before the actions. */
export interface FactColumn {
  header: string
  /** Free text (a participant, a note, a trip): cut in the table with its full text in the tooltip, wrapped on a card. Every other fact stays on one line. */
  long?: boolean
  /** On a card only from lg (a task's trip): one tap away, and the longest wrap on a phone. The table always has it. */
  fromLg?: boolean
}

export interface QuickRow {
  id: string
  /** Who or what the decision is about. */
  subject: string
  /** One plain value per column of the group's `columns`, in order. An empty one is a dash in the table and left out of the card. */
  facts: Array<string | null | undefined | false>
  /** Only the true ones; the first two are drawn. Colour always comes with its word. */
  flags: Array<{ label: string; tone: Tone }>
  /** At most two, secondary first: a `tap` action (the one-tap decision, primary) is always last, at the right edge. */
  actions: RowAction[]
}

export interface GroupModel {
  key: GroupKey
  /** The tab's name: "Leave". */
  title: string
  /** The subject column's header: "Staff". */
  subjectHeader: string
  columns: FactColumn[]
  /** How the All clear row and the loading and failed lines name it: "leave requests". */
  noun: string
  phase: QueryPhase
  refetch: () => void
  /** A bulk tab's fresh read, for a run that got no answer for `sent`: the ids of the rows still pending. Rejects when the read, or the check of a sent row missing from it, fails. */
  reread?: (sent: string[]) => Promise<string[]>
  /** When the group was last read in full (the oldest of its queries' dataUpdatedAt): a row held since an earlier read is released when it passes it. */
  readAt?: number
  /** The server's total. */
  count: number
  /** Every row the group fetched, in its order. QuickGroup shows the first SHOWN_ROWS still undecided. */
  rows: QuickRow[]
  /** The full page: "Open Leave" when every row is shown, "See all" when rows are cut. Never a number (call 13). */
  link: { to: string; openLabel: string }
  /** Completions only: approve these clean rows in ONE request (the existing approve-batch). Leave and Tasks run each row's own tap, one at a time. */
  approveBatch?: (ids: string[]) => Promise<ApproveBatchResultDto[]>
}

export const SHOWN_ROWS = 5

export const rowKey = (group: GroupKey, rowId: string) => `${group}:${rowId}`

type QueryLike = { data?: unknown; isError?: boolean; isPending?: boolean; fetchStatus?: string; isFetching?: boolean; errorUpdateCount?: number }

/** One phase for a group's requests: waiting while any has no answer yet (paused offline too: awaitsData), failed when any failed with nothing held. Rows already held win over a failed background refetch. */
export function groupPhase(...queries: QueryLike[]): QueryPhase {
  // A retry of a failed request is still a failure (retryingAfterError), so the banner and its Try again stay mounted.
  if (queries.some((q) => q.data === undefined && awaitsData(q) && !retryingAfterError(q))) return 'loading'
  if (queries.some((q) => q.data === undefined && (q.isError || retryingAfterError(q)))) return 'error'
  return 'ready'
}

/** The rows not decided here. A decided row leaves at once, before the refetch drops it. */
export function visibleRows(model: GroupModel, gone: ReadonlyMap<string, number>): QuickRow[] {
  return model.rows.filter((row) => !gone.has(rowKey(model.key, row.id)))
}

/** The pill: the server's total, less the decided rows it still lists. */
export function shownCount(model: GroupModel, gone: ReadonlyMap<string, number>): number {
  return model.count - (model.rows.length - visibleRows(model, gone).length)
}

/**
 * On the page while waiting, failed, holding a row, holding a notice, or while the server still counts rows beyond the ones decided here (every
 * fetched row decided before the refetch lands), or while a bulk run goes. Only a ready group with nothing left is absent, and named clear.
 */
export function isPresent(model: GroupModel, gone: ReadonlyMap<string, number>, notices: number, running = false): boolean {
  // A bulk run keeps its tab: the real server's refetch can empty it mid-run, before the run's notice exists (SHAPE §6).
  return running || model.phase !== 'ready' || visibleRows(model, gone).length > 0 || shownCount(model, gone) > 0 || notices > 0
}

/**
 * The xl table's measured track minimums (QuickGroup's useSubjectMin), so a title wins over free-text facts: each free-text fact's minimum is its floor,
 * or its own width when shorter; the title's is its full width, unless the table cannot fit that with every free-text fact at its floor. Widths in px;
 * `fixed` is everything that never gives way (dates, short facts, the buttons).
 */
export function trackMinimums({ table, fixed, floor, subject, facts }: { table: number; fixed: number; floor: number; subject: number; facts: number[] }) {
  const factMins = facts.map((width) => Math.min(floor, width))
  const left = table - fixed - factMins.reduce((sum, width) => sum + width, 0)
  return { subject: Math.max(0, Math.min(subject, left)), facts: factMins }
}
