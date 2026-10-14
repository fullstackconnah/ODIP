import { awaitsData, type QueryPhase } from '@/lib/queryPhase'
import type { Tone } from '@/lib/tone'

// The dashboard's decision groups (SHAPE §4, §5): one model per kind, drawn by QuickGroup. A group hook (pages/dashboard/groups) maps its queries and the
// REAL mutation hooks to this; QuickGroup only draws it and keeps each row's in-flight and error state.

/** The groups, in the page's fixed order. PR C adds 'unfilled' after 'incidents' and 'agreements' after 'tasks'. */
export type GroupKey = 'completions' | 'leave' | 'incidents' | 'tasks' | 'compliance'

/** What a decision did besides leaving the list. */
export interface ActionOutcome {
  /** The sentence the page's AnnouncementRegion says for a plain success. */
  announce?: string
  /** A consequence the server returned: a visible notice under the group's rows, with its next step. It announces itself, so `announce` is left out. */
  notice?: { title: string; message: string; link: { label: string; to: string } }
  /** The row still needs somebody (a credential saved with a date still inside the window): it stays, and the refetch redraws it. */
  keep?: boolean
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

export interface QuickRow {
  id: string
  /** Who or what the decision is about. */
  subject: string
  /** The facts, joined by middots. An empty one is dropped before the dots are placed (PageHeaderMeta's rule). */
  meta: Array<string | null | undefined | false>
  /** Only the true ones; the first two are drawn. Colour always comes with its word. */
  flags: Array<{ label: string; tone: Tone }>
  /** At most two, secondary first: a `tap` action (the one-tap decision, primary) is always last, at the right edge. */
  actions: RowAction[]
}

export interface GroupModel {
  key: GroupKey
  /** The h3: "Leave". */
  title: string
  /** How the All clear row and the loading and failed lines name it: "leave requests". */
  noun: string
  phase: QueryPhase
  refetch: () => void
  /** The server's total. */
  count: number
  /** Every row the group fetched, in its order. QuickGroup shows the first SHOWN_ROWS still undecided. */
  rows: QuickRow[]
  /** The full page: "Open Leave" when every row is shown, "See all" when rows are cut. Never a number (call 13). */
  link: { to: string; openLabel: string }
}

export const SHOWN_ROWS = 5

/** A short fact kept on one line when a phone row wraps its meta ("expired 10 Sep", never "expired 10" then "Sep"). */
export const noBreak = (fact: string) => fact.replace(/ /g, '\u00a0')

export const rowKey = (group: GroupKey, rowId: string) => `${group}:${rowId}`

type QueryLike = { data?: unknown; isError?: boolean; isPending?: boolean; fetchStatus?: string }

/** One phase for a group's requests: waiting while any has no answer yet (paused offline too: awaitsData), failed when any failed with nothing held. Rows already held win over a failed background refetch. */
export function groupPhase(...queries: QueryLike[]): QueryPhase {
  if (queries.some((q) => q.data === undefined && awaitsData(q))) return 'loading'
  if (queries.some((q) => q.data === undefined && q.isError)) return 'error'
  return 'ready'
}

/** The rows not decided here. A decided row leaves at once, before the refetch drops it. */
export function visibleRows(model: GroupModel, gone: ReadonlySet<string>): QuickRow[] {
  return model.rows.filter((row) => !gone.has(rowKey(model.key, row.id)))
}

/** The pill: the server's total, less the decided rows it still lists. */
export function shownCount(model: GroupModel, gone: ReadonlySet<string>): number {
  return model.count - (model.rows.length - visibleRows(model, gone).length)
}

/**
 * On the page while waiting, failed, holding a row, holding a notice, or while the server still counts rows beyond the ones decided here (every
 * fetched row decided before the refetch lands). Only a ready group with nothing left is absent, and named clear.
 */
export function isPresent(model: GroupModel, gone: ReadonlySet<string>, notices: number): boolean {
  return model.phase !== 'ready' || visibleRows(model, gone).length > 0 || shownCount(model, gone) > 0 || notices > 0
}
