import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { Link } from 'react-router-dom'
import { Button } from '@/components/Button'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { StatusBadge } from '@/components/StatusBadge'
import { NoticesRegion } from '@/components/NoticesRegion'
import { TextAreaField } from '@/components/TextAreaField'
import { TextField } from '@/components/TextField'
import { ROW_ACTIONS_CARD, TAP_AREA, TAP_FLOOR } from '@/components/tapArea'
import { formatRatio } from '@/lib/format'
import { extractErrorMessage } from '@/lib/utils'
import { useIsBelowXl } from '@/hooks/useIsBelowXl'
import { PAGE_SIZE, isPresent, pageCount, pageRows, rowKey, shownCount, visibleRows, type ActionOutcome, type FactColumn, type GroupModel, type QuickForm, type QuickRow, type RowAction } from './quickGroupModel'
import type { DecisionState } from './useDecisionState'
import { BATCH_MAX, actionLabel, bannerCopy, confirmCopy, isBulkKey, resultNotice, rowRef, runningLabel, selectName, type BulkResult } from './bulkCopy'

// A busy control is aria-disabled, not disabled: a disabled button drops focus in some browsers, and a refused tap must leave focus where it was (SHAPE §4).
const HELD = 'opacity-50 cursor-not-allowed'
// DataTable's checkbox, at 16px. Its <label> carries the touch pad (an input takes no pseudo-element), so it is 44 by 44 on touch.
const BOX = 'm-0 size-4 rounded border-[var(--color-border)] accent-[var(--color-primary)] cursor-pointer disabled:cursor-not-allowed'

type TapAction = Extract<RowAction, { kind: 'tap' }>
/** A row's one-tap decision: what makes it safe to tick and to Complete all (SHAPE §3). */
const tapOf = (row: QuickRow) => row.actions.find((a): a is TapAction => a.kind === 'tap')
const statusOf = (err: unknown) => (err as { response?: { status?: number } } | undefined)?.response?.status
/**
 * No answer from ODIP itself, so the server may have committed and the outcome is unknown, not failed. ODIP answers with its ApiResponse envelope (every
 * handled and unhandled error: ExceptionHandlingMiddleware), or on a 4xx with a problem body. Anything else is a proxy or a dropped connection: no response,
 * an HTML page or no body (a 500, a Cloudflare 520 or 524), or a gateway's 502/503/504 whatever it carries.
 */
const noAnswer = (err: unknown) => {
  const response = (err as { response?: { status?: number; data?: { success?: unknown; status?: unknown } | string | null } } | undefined)?.response
  const { status = 0, data } = response ?? {}
  if (!response || !data || typeof data !== 'object' || status === 502 || status === 503 || status === 504) return true
  return !(data.success === false || (status >= 400 && status < 500 && typeof data.status === 'number'))
}

/** When the tab itself has gone, looked up after it went: the newly opened tab, else the section's heading, else the All clear field. Never the top of the page. */
const afterTabLeft = () =>
  document.querySelector<HTMLElement>('[role="tab"][id^="decisions-tab-"][aria-selected="true"]')
  ?? document.getElementById('dashboard-decisions')
  ?? document.getElementById('dashboard-alerts')

/** A row's inline form (SHAPE §4, "An action that needs input"): in the detail row under its row. Its checks mirror the server's, never exceed them. */
function RowForm({ id, form, onClose, onBusy, onDone, onRefused }: {
  id: string
  form: QuickForm
  onClose: () => void
  onBusy: (busy: boolean) => void
  onDone: (outcome: ActionOutcome) => void
  onRefused: (err: unknown, message: string) => void
}) {
  const [value, setValue] = useState(form.initial ?? '')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLFormElement>(null)
  useEffect(() => { ref.current?.querySelector<HTMLElement>('textarea, input')?.focus() }, [])
  const over = !!form.maxLength && value.trim().length > form.maxLength

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (form.required && !value.trim()) return setError(form.required)
    if (over) return setError(`Keep it to ${form.maxLength} characters.`)
    setError(undefined)
    setBusy(true)
    onBusy(true)
    try {
      onDone(await form.submit(value))
    } catch (err) {
      // The refusal shows in the field's own error slot, and the typed text stays.
      const message = extractErrorMessage(err, form.failText)
      setError(message)
      onRefused(err, message)
      setBusy(false)
      onBusy(false)
    }
  }

  const field = { label: form.label, hint: form.hint, error, required: !!form.required, value, onChange: (e: { target: { value: string } }) => setValue(e.target.value) }
  return (
    <form
      id={id}
      ref={ref}
      noValidate
      onSubmit={submit}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }}
      className="flex flex-col gap-2 pb-2 md:flex-row md:items-start md:gap-3"
    >
      {form.field === 'textarea' ? (
        <div className="min-w-0 flex-1">
          <TextAreaField {...field} rows={2} />
          {form.maxLength ? (
            <p className={`mt-1 text-right text-xs tabular-nums ${over ? 'text-[var(--color-destructive)]' : 'text-[var(--color-muted-foreground)]'}`}>
              {formatRatio(value.length, form.maxLength)}
            </p>
          ) : null}
        </div>
      ) : (
        <TextField {...field} type="date" className="md:w-48" />
      )}
      <div className="flex shrink-0 justify-end gap-1.5 pointer-coarse:gap-2 md:pt-5">
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant={form.danger ? 'danger' : 'primary'} size="sm" aria-disabled={busy || undefined} className={busy ? HELD : undefined}>
          {busy ? form.busyLabel : form.submitLabel}
        </Button>
      </div>
    </form>
  )
}

/**
 * A button's labels in ONE grid cell (SHAPE §4), every one but `shown` invisible and aria-hidden: the button keeps the widest one's width at one line's
 * height, so a busy or running label never moves it or its neighbours.
 */
function Reserve({ shown, also }: { shown: string; also: string[] }) {
  return (
    <span className="grid">
      <span className="[grid-area:1/1]">{shown}</span>
      {[...new Set(also)].filter((label) => label !== shown).map((label) => <span key={label} aria-hidden className="invisible [grid-area:1/1]">{label}</span>)}
    </span>
  )
}

/**
 * The house pager, DataTable's footer copied (SHAPE §6): the list box's footer row in the side column, after the cards in place. Previous and Next are
 * aria-disabled at the ends or while `held`, never disabled, so focus stays on the pressed one. "Page N of M" goes sr-only in a list under 30rem.
 * shortcut: two copies of the pager (DataTable.tsx), extract one when a third appears
 */
function Pager({ page, pages, total, held, onPage }: { page: number; pages: number; total: number; held: boolean; onPage: (to: number) => void }) {
  const control = (label: 'Previous' | 'Next', to: number, off: boolean) => (
    <button
      type="button"
      onClick={() => { if (!off) onPage(to) }}
      aria-disabled={off || undefined}
      aria-label={`${label} page`}
      className={`h-[var(--control-h-sm)] pointer-coarse:h-[var(--control-h)] px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-colors ${off ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      {label}
    </button>
  )
  return (
    <div className="flex min-h-[var(--row-h)] items-center justify-between gap-2 text-sm max-xl:mt-3 xl:border-t xl:border-[var(--color-border)] xl:px-[var(--card-pad)]">
      <span className="text-[var(--color-muted-foreground)]">
        Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, total)} of {total}
      </span>
      <div className="flex items-center gap-2">
        <span className="text-[var(--color-muted-foreground)] @max-[30rem]:sr-only" aria-current="page">Page {page} of {pages}</span>
        {control('Previous', page - 1, page <= 1 || held)}
        {control('Next', page + 1, page >= pages || held)}
      </div>
    </div>
  )
}

/**
 * A fact cell (SHAPE §4): one plain value, left out when empty. Below xl the card wraps it as today; from xl it joins line 2's muted run, set apart by the
 * row's 12px gap (no dot, so a wrapped line never ends in one). Free text takes the rest of its line (a 8rem floor, else it wraps to its own) and cuts
 * there, with its full text in the tooltip.
 */
function FactCell({ column, value }: { column: FactColumn; value: string | null | undefined | false }) {
  const classes = ['order-3 mt-1 text-[13px] text-[var(--color-muted-foreground)] xl:flex', column.long ? 'xl:min-w-0 xl:basis-32 xl:grow xl:max-w-max' : 'whitespace-nowrap',
    !value && 'hidden', column.fromLg && 'max-lg:hidden']
  return (
    <td role="cell" className={classes.filter(Boolean).join(' ')}>
      {value && (column.long ? <span className="block break-words xl:min-w-0 xl:truncate" title={value}>{value}</span> : value)}
    </td>
  )
}

/**
 * One decision row (dtable SHAPE §4): its own row group, so its error line and form (the detail row) stay with it. Below xl the house phone card: the
 * subject and its flags, the facts line, the buttons under them. From xl a list row of two lines: the box, the subject and the buttons; then the flags and the facts.
 */
function QuickRowView({ row, columns, box, inRun, unconfirmed, onOccupied, onDone, onRefused }: {
  row: QuickRow
  columns: FactColumn[]
  /** The bulk box column (SHAPE §3): absent on a tab without it; null for a row with nothing to tick (its cell stays, empty). */
  box?: { checked: boolean; locked: boolean; onChange: (checked: boolean) => void } | null
  /** In a bulk run: its buttons are held, as a tap in flight holds them. */
  inRun: boolean
  /** Sent with no answer and not yet re-read: the row says why its buttons are held, for as long as they are. */
  unconfirmed: boolean
  /** Tells the group while a form is open or a tap is in flight here: its box is unticked and disabled, and Complete all leaves it out. */
  onOccupied: (rowId: string, occupied: boolean) => void
  onDone: (outcome: ActionOutcome, rowEl: HTMLElement) => void
  onRefused: (err: unknown, message: string) => void
}) {
  const rowRef = useRef<HTMLTableSectionElement>(null)
  const formId = useId()
  const [tapping, setTapping] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()
  const [formOpen, setFormOpen] = useState(false)
  const busy = tapping || submitting || inRun
  const occupied = tapping || submitting || formOpen
  useEffect(() => onOccupied(row.id, occupied), [onOccupied, row.id, occupied])
  useEffect(() => () => onOccupied(row.id, false), [onOccupied, row.id])
  const tapAction = tapOf(row)
  const formAction = row.actions.find((a): a is Extract<RowAction, { kind: 'form' }> => a.kind === 'form')
  const opener = () => rowRef.current?.querySelector<HTMLElement>(`[aria-controls="${formId}"]`)

  function closeForm() {
    setFormOpen(false)
    opener()?.focus()
  }

  function done(outcome: ActionOutcome) {
    onDone(outcome, rowRef.current!)
    setFormOpen(false)
    if (outcome.keep) {
      setTapping(false)
      setSubmitting(false)
      opener()?.focus()
    }
  }

  async function tap(action: Extract<RowAction, { kind: 'tap' }>) {
    if (busy) return
    setError(undefined)
    setTapping(true)
    try {
      done(await action.run())
    } catch (err) {
      const message = extractErrorMessage(err, action.failText)
      setError(message)
      onRefused(err, message)
      setTapping(false)
    }
  }

  const held = busy ? HELD : undefined
  const form = formOpen && formAction
  const flagged = row.flags.length > 0 || unconfirmed
  return (
    <tbody ref={rowRef} role="rowgroup" data-row-id={row.id} className="block max-xl:rounded-2xl max-xl:border max-xl:border-[var(--color-border)] max-xl:bg-[var(--color-card)] max-xl:p-4 xl:transition-colors xl:hover:bg-[var(--color-surface-container-low)]">
      {/* One flex row, two looks: the card's lines below xl, the list row's two lines from xl (buttons on line 1 by `order`, the ::after breaks to line 2). Every
          line-1 item and line-2 item carries the 4px between lines itself (gap-y-0), so the break adds nothing; below xl the row's -mt-1 takes back line 1's. */}
      <tr role="row" className={`relative flex flex-wrap gap-y-0 after:order-2 after:h-0 after:basis-full after:content-[''] max-xl:-mt-1 max-xl:items-center max-xl:gap-x-3 xl:items-start xl:gap-x-3 xl:px-[var(--card-pad)] xl:py-2 ${box !== undefined ? 'xl:pl-[calc(var(--card-pad)+1.5rem)]' : ''}`}>
        {box !== undefined && (
          // Below xl the box leads the card's subject line. From xl it sits in the row's left padding on the subject's first line, so both lines start at the
          // subject's x. A row with nothing to tick keeps its empty cell, so every name in the list starts at one edge.
          <td role="cell" data-select className="max-xl:mt-1 max-xl:w-4 max-xl:shrink-0 max-xl:self-start max-xl:pt-0.5 xl:absolute xl:left-[var(--card-pad)] xl:top-2.5">
            {box && tapAction && (
              <label className={`${TAP_AREA} flex size-4`}>
                <input
                  type="checkbox"
                  className={BOX}
                  aria-label={selectName(tapAction.name)}
                  checked={box.checked && !occupied}
                  disabled={occupied || box.locked}
                  onChange={(e) => box.onChange(e.target.checked)}
                />
              </label>
            )}
          </td>
        )}
        <td role="cell" data-subject className={`min-w-0 max-xl:mt-1 xl:flex-1 ${box !== undefined ? 'max-xl:max-w-[calc(100%-1.75rem)]' : 'max-xl:max-w-full'}`}>
          <span className="text-sm font-semibold text-[var(--color-foreground)] xl:line-clamp-2" title={row.subject}>{row.subject}</span>
        </td>
        {/* After the subject on the card's first line (the row's 12px gap less 4: today's 8px), leading line 2 from xl. */}
        <td role="cell" data-flags className={flagged ? 'mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 max-xl:-ml-1 xl:order-3' : 'hidden'}>
          {row.flags.slice(0, 2).map((flag) => (
            <StatusBadge key={flag.label} tone={flag.tone} label={flag.label} className="shrink-0 whitespace-nowrap" />
          ))}
          {unconfirmed && <StatusBadge tone="neutral" label="Not confirmed yet" className="shrink-0 whitespace-nowrap" />}
        </td>
        {columns.map((column, i) => <FactCell key={column.header} column={column} value={row.facts[i]} />)}
        <td role="cell" className={`order-4 mt-3 basis-full whitespace-nowrap xl:order-1 xl:mt-0 xl:shrink-0 xl:basis-auto ${row.actions.length === 0 ? 'hidden' : ''}`}>
          {row.actions.length > 0 && (
            <div className={`flex items-center justify-end gap-1.5 pointer-coarse:gap-2 ${ROW_ACTIONS_CARD}`}>
              {row.actions.map((action) =>
                action.kind === 'link' ? (
                  <Button key={action.label} variant="secondary" size="sm" to={action.to} aria-label={action.name}>{action.label}</Button>
                ) : action.kind === 'form' ? (
                  <Button
                    key={action.label}
                    variant="secondary"
                    size="sm"
                    aria-label={action.name}
                    aria-expanded={formOpen}
                    aria-controls={formId}
                    aria-disabled={busy || undefined}
                    className={held}
                    onClick={() => { if (!busy) { if (formOpen) closeForm(); else setFormOpen(true) } }}
                  >
                    {action.label}
                  </Button>
                ) : (
                  <Button key={action.label} size="sm" aria-label={action.name} aria-disabled={busy || undefined} className={held} onClick={() => tap(action)}>
                    <Reserve shown={tapping ? action.busyLabel : action.label} also={[action.label, action.busyLabel]} />
                  </Button>
                ),
              )}
            </div>
          )}
        </td>
      </tr>
      {(error || form) && (
        <tr data-detail role="row" className="block">
          <td role="cell" colSpan={columns.length + 3 + (box === undefined ? 0 : 1)} className="block max-xl:pt-3 xl:px-[var(--card-pad)] xl:pb-2">
            {error && <p role="alert" className="pb-1 text-xs text-[var(--color-destructive)]">{error}</p>}
            {form && <RowForm id={formId} form={form.form} onClose={closeForm} onBusy={setSubmitting} onDone={done} onRefused={onRefused} />}
          </td>
        </tr>
      )}
    </tbody>
  )
}

/**
 * One decision tab's panel (SHAPE §4, §5): its table of rows, ten a page (DataTable's look from xl, house phone cards below it), the link to the full page
 * under it, and the group's notices under that (a notice inserted above would push every row down under a moving finger). A waiting or failed group says
 * so in place of the table and is never clear (`awaitsData`). A tab with a one-tap decision also gets its bulk control in the table's header row and a box
 * column (decision-bulk SHAPE §3–§6).
 */
export function QuickGroup({ model, state }: { model: GroupModel; state: DecisionState }) {
  const linkRef = useRef<HTMLAnchorElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const groupRef = useRef<HTMLDivElement>(null)
  const allRef = useRef<HTMLInputElement>(null)
  const rows = visibleRows(model, state.gone)
  // Rows only once every request has answered: a group whose other list is still waiting or failed shows its one line, not half its rows (SHAPE §6).
  const ready = model.phase === 'ready'
  // Ten a page (SHAPE §6). The page clamps as it is drawn, never stored clamped, so rows that come back or leave re-slice the pages where they are.
  const [page, setPage] = useState(1)
  const pages = pageCount(rows)
  const current = Math.min(page, pages)
  const shown = ready ? pageRows(rows, current) : []
  // "See all": the server holds more than this group fetched (rows on another page are one Next away).
  const cut = ready && shownCount(model, state.gone) > rows.length
  // In the side column the list keeps the outgoing page's height, so a short last page never pulls the pager up under the pointer. Kept for this row count
  // only; a resize drops it.
  const [minHold, setMinHold] = useState<{ px: number; count: number } | null>(null)
  useEffect(() => {
    const drop = () => setMinHold(null)
    window.addEventListener('resize', drop)
    return () => window.removeEventListener('resize', drop)
  }, [])
  const notices = state.notices.filter((notice) => notice.subject === model.key)

  // Bulk: safe = a row with a one-tap decision, anywhere in the tab; the ticks are only the rows on screen.
  const bulkKey = isBulkKey(model.key) ? model.key : null
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [tabWide, setTabWide] = useState(false)
  const belowXl = useIsBelowXl()
  const [occupied, setOccupied] = useState<ReadonlySet<string>>(() => new Set())
  // What the open dialog will send, frozen as it opens: its title, its button and the run all read this, so a refetch meanwhile never relabels it or sweeps in new rows.
  const [confirm, setConfirm] = useState<{ mode: 'all' | 'selected'; ids: string[]; skipped: number } | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number; ids: ReadonlySet<string> } | null>(null)
  // Sent with no answer, and the re-read failed too: each held (no retry) with when the group was last read, until a later read succeeds (review #266 F1).
  const [held, setHeld] = useState<ReadonlyMap<string, number>>(() => new Map())
  const readAt = model.readAt ?? 0
  const readAtRef = useRef(readAt)
  useEffect(() => { readAtRef.current = readAt })
  const unsure: ReadonlySet<string> = new Set([...held].filter(([, at]) => at >= readAt).map(([id]) => id))
  const onOccupied = useCallback((rowId: string, on: boolean) => setOccupied((prev) => {
    if (prev.has(rowId) === on) return prev
    const next = new Set(prev)
    if (on) next.add(rowId)
    else next.delete(rowId)
    return next
  }), [])
  const safe = ready ? rows.filter((row) => tapOf(row)) : []
  const free = safe.filter((row) => !occupied.has(row.id) && !unsure.has(row.id))
  const tickable = shown.filter((row) => tapOf(row) && !occupied.has(row.id) && !unsure.has(row.id))
  // Tab-wide is a mode, not a list (Gmail, SHAPE §5): its count and its run are `free`, read now. Over the batch cap it IS Complete all. It lapses with
  // nothing left to send (every safe row decided or held), so the banner never reads "All 0" and the mode never comes back on a release.
  const wide = tabWide && free.length > 0
  const ticked = wide ? tickable : tickable.filter((row) => selected.has(row.id))
  const bar = !!bulkKey && (safe.some((row) => !unsure.has(row.id)) || !!progress)
  const mode: 'all' | 'selected' = wide ? (model.approveBatch && free.length > BATCH_MAX ? 'all' : 'selected') : ticked.length > 0 ? 'selected' : 'all'
  const count = mode === 'selected' && !wide ? ticked.length : free.length
  const action = bulkKey && actionLabel(bulkKey, mode, count)
  // The banner (SHAPE §5): B1 once this page's tickable rows are all ticked and the tab holds more safe rows; B2 while every one in the tab is selected.
  const banner = bulkKey && bar ? bannerCopy(bulkKey, tickable.length, free.length) : null
  const bannerShown = !banner ? null : wide ? 'b2' : tickable.length > 0 && ticked.length === tickable.length && free.length > ticked.length ? 'b1' : null
  // The run's size, for the bulk button's width reserve.
  const runSize = model.approveBatch ? Math.min(free.length, BATCH_MAX) : free.length
  useEffect(() => { if (allRef.current) allRef.current.indeterminate = ticked.length > 0 && ticked.length < tickable.length })

  // Decided or removed elsewhere (409, 404): say so, since the refetch may take the row and its alert line away, and refetch so the row resolves.
  function refused(err: unknown, message: string) {
    const status = statusOf(err)
    if (status !== 404 && status !== 409) return
    state.announce(message)
    model.refetch()
  }

  function finish(row: QuickRow, outcome: ActionOutcome, rowEl: HTMLElement) {
    if (outcome.notice) state.notify('success', outcome.notice.title, outcome.notice.message, model.key, outcome.notice.link)
    else if (outcome.announce) state.announce(outcome.announce)
    if (outcome.keep) return
    // Where focus goes, read BEFORE the row leaves (SHAPE §6): the row that takes its place, else the row before it (the page clamps back to it), else the
    // tab's link. Only when focus is in the row, so nothing moves for somebody working elsewhere (a tap that finishes in a tab the viewer has left).
    const inRow = rowEl.contains(document.activeElement)
    const at = rows.findIndex((r) => r.id === row.id)
    const rest = rows.filter((r) => r.id !== row.id)
    const nextId = (rest[at] ?? rest[at - 1])?.id
    // Commit the row's leaving now (finish runs after an await, outside React's batching), so focus lands on what is on the page after it, the newly
    // opened tab included (NeedsYourDecision picks it in the same render). A ticked row drops out of the selection with it.
    flushSync(() => {
      state.markGone(rowKey(model.key, row.id))
      setSelected((prev) => { const next = new Set(prev); next.delete(row.id); return next })
    })
    if (!inRow) return
    const group = groupRef.current
    const nextRow = [...(group?.querySelectorAll<HTMLElement>('[data-row-id]') ?? [])].find((el) => el.dataset.rowId === nextId)
    const target = [nextRow?.querySelector<HTMLElement>('a, button'), group?.querySelector<HTMLElement>('[data-group-link]')].find((el) => el?.isConnected)
    ;(target ?? afterTabLeft())?.focus()
  }

  // Dismissing the last thing a tab holds takes the tab, and its NoticesRegion (which would place focus) with it: place focus once that has committed.
  function dismiss(id: number) {
    if (isPresent(model, state.gone, notices.length - 1, !!progress)) return state.dismiss(id)
    flushSync(() => state.dismiss(id))
    afterTabLeft()?.focus()
  }

  /**
   * A confirmed run (SHAPE §6), from a snapshot of its rows taken now: Completions in ONE approve-batch request, Leave and Tasks through each row's own
   * tap, one at a time in row order. No announcement per row; at the end ONE commit adds the run's notice and takes every decided row away together.
   */
  async function run({ mode: runMode, ids, skipped }: NonNullable<typeof confirm>) {
    if (!bulkKey) return
    setConfirm(null)
    const byId = new Map(rows.map((row) => [row.id, row]))
    const picked = ids.flatMap((id) => byId.get(id) ?? [])
    const list = model.approveBatch ? picked.slice(0, BATCH_MAX) : picked
    const result: BulkResult = {
      total: list.length, decided: 0, stale: 0, failed: [], overlaps: [],
      skipped: runMode === 'all' ? skipped : 0,
      of: model.approveBatch && picked.length > BATCH_MAX ? picked.length : undefined,
    }
    const leaving: string[] = []
    const unanswered: QuickRow[] = []
    let unchecked: string[] = []
    state.setRunning(model.key, true)
    setProgress({ done: 0, total: list.length, ids: new Set(list.map((row) => row.id)) })
    // Once, as it starts (the button's count is the progress; no announcement per row).
    state.announce(runningLabel(bulkKey, 0, list.length))
    if (model.approveBatch) {
      try {
        const answers = new Map((await model.approveBatch(list.map((row) => row.id))).map((answer) => [answer.shiftId, answer]))
        for (const row of list) {
          const answer = answers.get(row.id)
          if (answer?.approved) { result.decided++; leaving.push(row.id) }
          // Stale as the single approve's 409 and 404 are: reviewed already, or the shift or its completion gone (a not-found shift has no code).
          else if (answer && (answer.code === null || answer.code === 'SHIFT_NOT_PENDING_REVIEW' || answer.code === 'SHIFT_COMPLETION_NOT_FOUND')) result.stale++
          // Flagged since the queue read: the server skipped it (clean only); it stays, needing review.
          else if (answer?.code === 'SHIFT_NEEDS_REVIEW') result.skipped++
          else result.failed.push({ ref: rowRef(tapOf(row)!.name), message: answer?.message ?? '' })
        }
      } catch (err) {
        // One SaveChanges on the server: a request ODIP refused approved nothing. With no answer, it may have committed.
        if (noAnswer(err)) unanswered.push(...list)
        else result.wholeFailed = true
      }
    } else {
      for (const [i, row] of list.entries()) {
        const tap = tapOf(row)!
        setProgress((p) => p && { ...p, done: i })
        try {
          const outcome = await tap.run()
          if (outcome.stale) result.stale++
          else {
            result.decided++
            if (outcome.overlap) result.overlaps.push(outcome.overlap)
          }
          if (!outcome.keep) leaving.push(row.id)
        } catch (err) {
          const status = statusOf(err)
          if (status === 404 || status === 409) result.stale++
          else if (noAnswer(err)) unanswered.push(row)
          else result.failed.push({ ref: rowRef(tap.name), message: extractErrorMessage(err, '') })
        }
      }
    }
    // Unknown is never reported as approved or as failed: a fresh read says which rows have left the list and which still wait.
    if (unanswered.length) {
      try {
        const pending = new Set(await model.reread!(unanswered.map((row) => row.id)))
        for (const row of unanswered) {
          if (pending.has(row.id)) result.waiting = (result.waiting ?? 0) + 1
          else { result.left = (result.left ?? 0) + 1; leaving.push(row.id) }
        }
      } catch {
        result.unchecked = unanswered.length
        unchecked = unanswered.map((row) => row.id)
      }
    }
    const notice = resultNotice(bulkKey, result)
    flushSync(() => {
      state.notify(notice.tone, notice.title, notice.message, model.key, notice.link)
      for (const id of leaving) state.markGone(rowKey(model.key, id))
      state.setRunning(model.key, false)
      setProgress(null)
      setSelected(new Set())
      setTabWide(false)
      if (unchecked.length) setHeld((prev) => new Map([...prev, ...unchecked.map((id): [string, number] => [id, readAtRef.current])]))
    })
    if (result.stale) model.refetch()
    // Onto the run's notice (newest first), unless the viewer has gone to another tab or elsewhere.
    const group = groupRef.current
    if (group?.contains(document.activeElement) || document.activeElement === document.body) {
      group?.querySelector<HTMLElement>('[role="status"] [data-tone] a, [role="status"] [data-tone] button')?.focus()
    }
  }

  // The header box (Gmail, SHAPE §5): unticked, it ticks this page's tickable rows; mixed or ticked, it clears. Each banner is said once, from its click.
  function tickPage() {
    if (progress || !banner) return
    if (ticked.length === 0) {
      setSelected(new Set(tickable.map((row) => row.id)))
      if (free.length > tickable.length) state.announce(banner.b1)
    } else clearSelection()
  }

  // Clearing says the empty sentence, so the next tick of the page is said again (the region only prints what it holds).
  function clearSelection() {
    setSelected(new Set())
    setTabWide(false)
    state.announce('')
  }

  // B1's button selects every safe row in the tab and becomes B2's Clear selection, in the same place; Clear puts focus on the header box.
  function onBanner() {
    if (progress || !banner) return
    if (wide) {
      clearSelection()
      allRef.current?.focus()
      return
    }
    flushSync(() => setTabWide(true))
    groupRef.current?.querySelector<HTMLElement>('[data-banner-action]')?.focus()
    state.announce(banner.b2)
  }

  function openConfirm() {
    if (progress) return
    setConfirm({ mode, ids: (mode === 'selected' && !wide ? ticked : free).map((row) => row.id), skipped: rows.length - safe.length })
  }

  /** Previous and Next (SHAPE §6). Held while a row on the page is busy: paging would unmount a half-typed reason or strand a tap in flight. */
  function go(to: number) {
    if (to < 1 || to > pages || occupied.size > 0) return
    const table = tableRef.current
    flushSync(() => {
      setPage(to)
      // A hidden tick on another page, acted on by "Approve 5", is a trap; tab-wide is a mode, so it pages with the list.
      if (!wide) setSelected(new Set())
      setMinHold(!belowXl && table ? { px: table.offsetHeight, count: rows.length } : null)
    })
    if (!belowXl) {
      // In the side column the pager stays put, so the new page's first row may be above the fold: bring it into view (nothing moves if it is already on screen).
      const first = table?.querySelector('tbody')
      if (typeof first?.scrollIntoView === 'function') first.scrollIntoView({ block: 'nearest', behavior: 'instant' })
    } else if (table) {
      // In place the pager is a screen or more below the rows: bring the list's top under the 3rem app header, then focus its first card.
      window.scrollTo({ top: window.scrollY + table.getBoundingClientRect().top - 48, behavior: 'instant' })
      // A held box (a busy or unconfirmed row) would swallow focus.
      table.querySelector('tbody')?.querySelector<HTMLElement>('input:not(:disabled), a, button')?.focus({ preventScroll: true })
    }
  }

  const copy = bulkKey && confirm && confirmCopy(bulkKey, confirm.mode, confirm.ids.length, confirm.skipped)
  return (
    <div
      ref={groupRef}
      data-quick-group={model.key}
      // A control tabbed to never hides under the stuck header row: the app header (3rem), then the row (below xl the band, its padding and the strip under it;
      // from xl --table-head-h), plus the banner while it shows (two lines at the narrowest; over-reserving is harmless).
      className={bar ? '[&_:is(a,button,input,textarea,tbody)]:scroll-mt-[calc(3rem+var(--control-h)+1.75rem+var(--banner-h,0px))] xl:[&_:is(a,button,input,textarea,tbody)]:scroll-mt-[calc(3rem+var(--table-head-h)+var(--banner-h,0px))]' : '[&_tbody]:scroll-mt-12'}
      style={bannerShown ? { '--banner-h': 'calc(var(--row-h) * 2)' } as CSSProperties : undefined}
    >
      {model.phase === 'loading' && <p className="text-[13px] text-[var(--color-muted-foreground)]">Loading {model.noun}…</p>}
      {model.phase === 'error' && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] text-[var(--color-destructive)]">Couldn't load {model.noun}.</p>
          <Button variant="secondary" size="sm" onClick={() => model.refetch()} aria-label={`Try again: ${model.noun}`}>Try again</Button>
        </div>
      )}
      {(shown.length > 0 || (bar && !!progress)) && (
        // The list's box (SHAPE §4), kept while a run goes with every row gone (its header row holds the count). DataTable's from xl, and never a scroll
        // container (no overflow). It is the size container for the row forms and the pager, never the group root: the bulk ConfirmDialog renders inside the
        // root as `fixed`, and containment would centre it in the group, not the screen.
        <div className="@container xl:rounded-md xl:border xl:border-[var(--color-border)] xl:bg-[var(--color-card)]">
          {/* Explicit roles: a table drawn as a list (xl) or as cards (below xl) keeps its table semantics in every browser. */}
          <table
            ref={tableRef}
            role="table"
            style={minHold && minHold.count === rows.length ? { minHeight: minHold.px } : undefined}
            // With no pager the last row rounds the box's bottom corners, so its hover tint never squares them; with one, the pager is the bottom row.
            className={`w-full text-sm tabular-nums max-xl:flex max-xl:flex-col max-xl:gap-3 xl:block xl:divide-y xl:divide-[var(--color-border)] ${pages > 1 ? '' : 'xl:[&>tbody:last-of-type]:rounded-b-[calc(var(--radius-md)-1px)]'}`}
          >
            {/* A bulk tab's header row is its bulk control (SHAPE §5): Select all in the first cell, the one bulk action in the last, the column labels sr-only
                between. It sticks under the app header inside its own table, so it never leaves its tab. Below xl it is a Mist band on an opaque strip of
                page paper (the cards slide under it, never through its gap); from xl the list box's Mist head. Any other tab's head is sr-only labels. */}
            <thead
              role="rowgroup"
              className={bar ? 'sticky top-12 z-20 block shadow-[0_24px_32px_-12px_color-mix(in_srgb,var(--color-foreground)_4%,transparent)] max-xl:-mb-3 max-xl:bg-[var(--color-background)] max-xl:pb-3' : 'sr-only'}
            >
              <tr role="row" className={bar ? 'flex items-center justify-between gap-3 bg-[var(--color-surface-container)] max-xl:min-h-[calc(var(--control-h)+1rem)] max-xl:rounded-md max-xl:px-[calc(1px+1rem)] max-xl:py-2 xl:h-[var(--table-head-h)] xl:rounded-t-[calc(var(--radius-md)-1px)] xl:px-[var(--card-pad)]' : 'flex'}>
                {bar && (
                  <th role="columnheader" data-select className="text-left font-normal">
                    {tickable.length > 0 ? (
                      <label className="flex min-h-[var(--tap-min)] items-center gap-2 text-[13px] font-medium text-[var(--color-foreground)]">
                        <input
                          ref={allRef}
                          type="checkbox"
                          className={BOX}
                          aria-label={`Select all ${model.noun} on this page`}
                          checked={ticked.length > 0 && ticked.length === tickable.length}
                          aria-disabled={progress ? true : undefined}
                          onChange={tickPage}
                        />
                        Select all
                      </label>
                    ) : <span className="sr-only">Select</span>}
                  </th>
                )}
                {[model.subjectHeader, 'Flags', ...model.columns.map((column) => column.header)].map((header, i) => (
                  <th key={i} role="columnheader" data-flags={i === 1 || undefined} className={bar ? 'sr-only' : undefined}>{header}</th>
                ))}
                <th role="columnheader" className="font-normal">
                  {bulkKey && action && (count > 0 || progress) && (
                    <Button
                      data-bulk-action
                      size={belowXl ? 'md' : 'sm'}
                      // While running, the name is the visible count (label in name, WCAG 2.5.3).
                      aria-label={progress ? undefined : action.name}
                      aria-disabled={progress ? true : undefined}
                      className={`shrink-0 ${progress ? HELD : ''}`}
                      onClick={openConfirm}
                    >
                      <Reserve
                        shown={progress ? runningLabel(bulkKey, progress.done, progress.total) : action.label}
                        also={[actionLabel(bulkKey, 'all', free.length).label, runningLabel(bulkKey, runSize - 1, runSize)]}
                      />
                    </Button>
                  )}
                </th>
              </tr>
              {banner && bannerShown && (
                <tr role="row" className="flex max-xl:mt-2">
                  <td
                    colSpan={model.columns.length + 4}
                    className="flex min-h-[var(--row-h)] flex-1 flex-wrap items-center gap-x-2 bg-[var(--color-surface-container-low)] px-[var(--card-pad)] py-1 text-[13px] text-[var(--color-foreground)] max-xl:rounded-md max-xl:border max-xl:border-[var(--color-border)]"
                  >
                    <span>{bannerShown === 'b1' ? banner.b1 : banner.b2}</span>
                    <Button
                      data-banner-action
                      variant="ghost"
                      size={belowXl ? 'md' : 'sm'}
                      aria-disabled={progress ? true : undefined}
                      className={progress ? HELD : undefined}
                      onClick={onBanner}
                    >
                      {bannerShown === 'b1' ? banner.b1Action : 'Clear selection'}
                    </Button>
                  </td>
                </tr>
              )}
            </thead>
            {shown.map((row) => (
              <QuickRowView
                key={row.id}
                row={row}
                columns={model.columns}
                box={!bar ? undefined : tapOf(row) ? {
                  // A held row is never in the tab-wide run, so it never shows ticked beside its count.
                  checked: (wide && !unsure.has(row.id)) || selected.has(row.id),
                  // A run holds every box: its selection was taken at Confirm.
                  locked: !!progress || unsure.has(row.id),
                  onChange: (checked) => {
                    // Unticking a row in tab-wide mode leaves the mode and keeps the rest of this page ticked (Gmail).
                    if (wide && !checked) {
                      setTabWide(false)
                      setSelected(new Set(tickable.filter((other) => other.id !== row.id).map((other) => other.id)))
                      return
                    }
                    setSelected((prev) => { const next = new Set(prev); if (checked) next.add(row.id); else next.delete(row.id); return next })
                  },
                } : null}
                inRun={!!progress?.ids.has(row.id) || unsure.has(row.id)}
                unconfirmed={unsure.has(row.id)}
                onOccupied={onOccupied}
                onDone={(outcome, rowEl) => finish(row, outcome, rowEl)}
                onRefused={refused}
              />
            ))}
          </table>
          {ready && pages > 1 && <Pager page={current} pages={pages} total={rows.length} held={occupied.size > 0} onPage={go} />}
        </div>
      )}
      <div className="mt-2 flex justify-end first:mt-0">
        <Link
          ref={linkRef}
          data-group-link
          to={model.link.to}
          aria-label={cut ? `See all ${model.noun}` : undefined}
          className={`${TAP_FLOOR} text-xs font-bold text-[var(--color-primary)] hover:underline`}
        >
          {cut ? 'See all' : model.link.openLabel}
        </Link>
      </div>
      <NoticesRegion notices={notices} onDismiss={dismiss} focusAfterDismiss={() => linkRef.current} className="mt-2 empty:mt-0" />
      {copy && confirm && (
        <ConfirmDialog open onCancel={() => setConfirm(null)} onConfirm={() => void run(confirm)} title={copy.title} message={copy.message} confirmLabel={copy.confirm} />
      )}
    </div>
  )
}
