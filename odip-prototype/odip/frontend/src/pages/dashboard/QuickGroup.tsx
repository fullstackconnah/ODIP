import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
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
import { SHOWN_ROWS, isPresent, rowKey, shownCount, trackMinimums, visibleRows, type ActionOutcome, type FactColumn, type GroupModel, type QuickForm, type QuickRow, type RowAction } from './quickGroupModel'
import type { DecisionState } from './useDecisionState'
import { BATCH_MAX, actionLabel, confirmCopy, isBulkKey, resultNotice, rowRef, runningLabel, selectName, type BulkResult } from './bulkCopy'

// A busy control is aria-disabled, not disabled: a disabled button drops focus in some browsers, and a refused tap must leave focus where it was (SHAPE §4).
const HELD = 'opacity-50 cursor-not-allowed'
// DataTable's cell: --cell-px across, no padding down, centred in the row. Below xl a row is a card and its cells are plain flex items.
const CELL = 'px-[var(--cell-px)] align-middle max-xl:p-0'
// DataTable's checkbox, at 16px. Its <label> carries the touch pad (an input takes no pseudo-element), so it is 44 by 44 on touch.
const BOX = 'm-0 size-4 rounded border-[var(--color-border)] accent-[var(--color-primary)] cursor-pointer disabled:cursor-not-allowed'
// The box track: --cell-px, the box, --cell-px (DataTable's w-10). Fixed, so the columns never shift as rows with a box come and go.
const BOX_TRACK = 'calc(var(--cell-px) * 2 + 1rem)'

type TapAction = Extract<RowAction, { kind: 'tap' }>
/** A row's one-tap decision: what makes it safe to tick and to Complete all (SHAPE §3). */
const tapOf = (row: QuickRow) => row.actions.find((a): a is TapAction => a.kind === 'tap')
const statusOf = (err: unknown) => (err as { response?: { status?: number } } | undefined)?.response?.status

/**
 * Where focus goes when the row that holds it leaves (SHAPE §5), read BEFORE it leaves: the next row's first control, else this tab's link while the tab
 * stays. Null when focus is not in the row, so nothing is moved for somebody working elsewhere (a tap that finishes in a tab the viewer has left).
 */
function focusTargets(rowEl: HTMLElement): Array<HTMLElement | null | undefined> | null {
  if (!rowEl.contains(document.activeElement)) return null
  return [
    rowEl.nextElementSibling?.querySelector<HTMLElement>('a, button'),
    rowEl.closest('[data-quick-group]')?.querySelector<HTMLElement>('[data-group-link]'),
  ]
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

/** A fact cell: one plain value; a dash in the table and nothing on the card when empty. Only free text is cut (in the table) or wrapped (on a card). */
function FactCell({ column, value }: { column: FactColumn; value: string | null | undefined | false }) {
  const classes = [CELL, 'text-[13px] text-[var(--color-muted-foreground)]', !column.long && 'whitespace-nowrap', !value && 'max-xl:hidden', column.fromLg && 'max-lg:hidden']
  return (
    <td role="cell" className={classes.filter(Boolean).join(' ')}>
      {!value ? '—' : column.long ? <span className="block break-words xl:truncate" title={value}>{value}</span> : value}
    </td>
  )
}

/**
 * The table's columns from xl (SHAPE §4), sized by content: the subject and free text grow up to their full width before anything else gets spare
 * width, so text is cut only when no column has room left. The subject wins over free text: its minimum (--subject-min, set by useSubjectMin) is its
 * full width while the free-text facts can still give way to their floor. Dates and short facts are as wide as they are and never cut. What is left
 * over sits in a gap before the buttons (`minmax(0, 1fr)`), which are as wide as the widest row's own buttons, busy labels included.
 */
const gridColumns = (columns: FactColumn[], lead: number) => [
  ...(lead ? [BOX_TRACK] : []), 'minmax(var(--subject-min, 0px), max-content)',
  ...columns.map((column, i) => (column.long ? `minmax(var(--fact-min-${i + 1 + lead}, 0px), max-content)` : 'max-content')), 'minmax(0, 1fr)', 'max-content',
].join(' ')
// How narrow a free-text fact gets before a subject is cut.
const FACT_FLOOR_REM = 6

/**
 * Sets the table's --subject-min: the subject column's full width (text and flags), less whatever the table lacks once every free-text fact is at its
 * floor (or at its own width, when that is less), and each free-text fact's --fact-min-<track> to that floor (the arithmetic: trackMinimums). CSS grid
 * shares spare width equally between growing tracks, so without this a title is cut while a trip beside it stays whole. Re-measured when the table or a
 * subject changes size (a tab shown, fonts loaded, the window resized), and when the columns or the shown rows change. Its keys are strings, so a
 * render that changes neither does not re-subscribe: `freeText` has one character per fact column ('1' free text, '0' not); `rowIds` names the rows.
 * `lead` is 1 when the bulk box column comes first: every track and cell after it moves one along, and its fixed width counts as fixed.
 */
function useSubjectMin(tableRef: RefObject<HTMLTableElement | null>, freeText: string, rowIds: string, lead: number) {
  useLayoutEffect(() => {
    const table = tableRef.current
    if (!table || typeof ResizeObserver === 'undefined') return
    const px = (v: string) => parseFloat(v) || 0
    const padX = (el: Element) => { const cs = getComputedStyle(el); return px(cs.paddingLeft) + px(cs.paddingRight) }
    const textWidth = (el: Element) => { const range = document.createRange(); range.selectNodeContents(el); return range.getBoundingClientRect().width }
    // A cell's full width: a cut span counts at its whole text (scrollWidth).
    const natural = (td: Element) => { const span = td.querySelector('span[title]'); return (span ? span.scrollWidth : textWidth(td)) + padX(td) }
    const fit = () => {
      if (getComputedStyle(table).display !== 'grid') return
      const rows = [...table.querySelectorAll(':scope > tbody > tr:not([data-detail])')]
      const tracks = getComputedStyle(table).gridTemplateColumns.split(' ').map(px)
      const floor = FACT_FLOOR_REM * px(getComputedStyle(document.documentElement).fontSize)
      const subject = Math.max(0, ...rows.map((tr) => {
        const line = tr.children[lead].firstElementChild!
        const [text, ...flags] = [...line.children]
        const gap = px(getComputedStyle(line).columnGap)
        return text.scrollWidth + flags.reduce((sum, flag) => sum + gap + flag.getBoundingClientRect().width, 0) + padX(tr.children[lead])
      }))
      // Tracks lead+1..n are the facts (lead the subject, 0 the box when there is one; then the gap and the buttons). Free text gives way; everything
      // else is fixed at its width.
      const free = [...freeText].flatMap((flag, i) => (flag === '1' ? [i + 1 + lead] : []))
      const fixed = tracks[tracks.length - 1] + (lead ? tracks[0] : 0) + [...freeText].reduce((sum, flag, i) => sum + (flag === '1' ? 0 : tracks[i + 1 + lead]), 0)
      const facts = free.map((track) => Math.max(0, ...rows.map((tr) => natural(tr.children[track]))))
      const mins = trackMinimums({ table: table.clientWidth, fixed, floor, subject, facts })
      const set = (name: string, value: number) => { const v = `${Math.floor(value)}px`; if (table.style.getPropertyValue(name) !== v) table.style.setProperty(name, v) }
      free.forEach((track, k) => set(`--fact-min-${track}`, mins.facts[k]))
      set('--subject-min', mins.subject)
    }
    const observer = new ResizeObserver(fit)
    observer.observe(table)
    table.querySelectorAll(':scope > tbody > tr > td[data-subject] span[title]').forEach((span) => observer.observe(span))
    return () => observer.disconnect()
  }, [tableRef, freeText, rowIds, lead])
}

// From xl every row group and row is a subgrid of the table's columns, so each row keeps its own box (height, hairline, hover tint).
const SUBGRID = 'xl:col-span-full xl:grid xl:grid-cols-subgrid'
// The buttons' track: the last one, past the gap.
const LAST_TRACK = 'xl:col-[-2/-1]'

/**
 * One decision row (SHAPE §4, §6): its own row group, so its error line and form (the detail row) stay with it. From xl a table row of --row-h with the
 * buttons at the right edge; below xl the same elements reflow into the house phone card: the subject and its flags, the facts line, the buttons under them.
 */
function QuickRowView({ row, columns, box, inRun, onOccupied, onDone, onRefused }: {
  row: QuickRow
  columns: FactColumn[]
  /** The bulk box column (SHAPE §3): absent on a tab without it; null for a row with nothing to tick (its cell stays, empty). */
  box?: { checked: boolean; onChange: (checked: boolean) => void } | null
  /** In a bulk run: its buttons are held, as a tap in flight holds them. */
  inRun: boolean
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
  return (
    <tbody ref={rowRef} role="rowgroup" className={`max-xl:block max-xl:rounded-2xl max-xl:border max-xl:border-[var(--color-border)] max-xl:bg-[var(--color-card)] max-xl:p-4 ${SUBGRID}`}>
      <tr role="row" className={`max-xl:flex max-xl:flex-wrap max-xl:items-center max-xl:gap-x-3 max-xl:gap-y-1 xl:h-[var(--row-h)] xl:items-center xl:transition-colors xl:hover:bg-[var(--color-surface-container-low)] ${SUBGRID}`}>
        {box !== undefined && (
          // Below xl the box leads the card's subject line, on its first line (the subject wraps beside it). A row with nothing to tick keeps its cell in the table.
          <td role="cell" data-select className={`${CELL} max-xl:self-start max-xl:pt-0.5 ${box ? '' : 'max-xl:hidden'}`}>
            {box && tapAction && (
              <label className={`${TAP_AREA} flex size-4`}>
                <input
                  type="checkbox"
                  className={BOX}
                  aria-label={selectName(tapAction.name)}
                  checked={box.checked && !occupied}
                  disabled={occupied}
                  onChange={(e) => box.onChange(e.target.checked)}
                />
              </label>
            )}
          </td>
        )}
        <td role="cell" data-subject className={`${CELL} ${box ? 'max-xl:min-w-0 max-xl:basis-[calc(100%-1.75rem)]' : 'max-xl:basis-full'}`}>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 xl:flex-nowrap">
            <span className="min-w-0 text-sm font-semibold text-[var(--color-foreground)] xl:truncate" title={row.subject}>{row.subject}</span>
            {row.flags.slice(0, 2).map((flag) => (
              <StatusBadge key={flag.label} tone={flag.tone} label={flag.label} className="shrink-0 whitespace-nowrap" />
            ))}
          </div>
        </td>
        {columns.map((column, i) => <FactCell key={column.header} column={column} value={row.facts[i]} />)}
        <td role="cell" className={`${CELL} whitespace-nowrap max-xl:mt-2 max-xl:basis-full ${LAST_TRACK} ${row.actions.length === 0 ? 'max-xl:hidden' : ''}`}>
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
                    {/* An invisible, zero-height copy of the busy label holds the button at the wider of the two, so a tap never moves the columns. */}
                    <span data-reserve={action.busyLabel} className="grid after:invisible after:h-0 after:content-[attr(data-reserve)]">
                      {tapping ? action.busyLabel : action.label}
                    </span>
                  </Button>
                ),
              )}
            </div>
          )}
        </td>
      </tr>
      {(error || form) && (
        <tr data-detail role="row" className="block xl:col-span-full">
          <td role="cell" colSpan={columns.length + 2 + (box === undefined ? 0 : 1)} className="block px-[var(--cell-px)] pb-2 max-xl:p-0 max-xl:pt-3">
            {error && <p role="alert" className="pb-1 text-xs text-[var(--color-destructive)]">{error}</p>}
            {form && <RowForm id={formId} form={form.form} onClose={closeForm} onBusy={setSubmitting} onDone={done} onRefused={onRefused} />}
          </td>
        </tr>
      )}
    </tbody>
  )
}

/**
 * One decision tab's panel (SHAPE §4, §5): its table of up to five rows (DataTable's look from xl, house phone cards below it), the link to the full page
 * under it, and the group's notices under that (a notice inserted above would push every row down under a moving finger). A waiting or failed group says
 * so in place of the table and is never clear (`awaitsData`). A tab with a one-tap decision also gets the bulk bar over its table and a box column
 * (decision-bulk SHAPE §3–§6).
 */
export function QuickGroup({ model, state }: { model: GroupModel; state: DecisionState }) {
  const linkRef = useRef<HTMLAnchorElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const groupRef = useRef<HTMLDivElement>(null)
  const allRef = useRef<HTMLInputElement>(null)
  const rows = visibleRows(model, state.gone)
  // Rows only once every request has answered: a group whose other list is still waiting or failed shows its one line, not half its rows (SHAPE §6).
  const ready = model.phase === 'ready'
  const shown = ready ? rows.slice(0, SHOWN_ROWS) : []
  const cut = ready && shownCount(model, state.gone) > shown.length
  const notices = state.notices.filter((notice) => notice.subject === model.key)

  // Bulk: safe = a row with a one-tap decision, anywhere in the tab; the ticks are only the rows on screen.
  const bulkKey = isBulkKey(model.key) ? model.key : null
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [occupied, setOccupied] = useState<ReadonlySet<string>>(() => new Set())
  const [confirm, setConfirm] = useState<'all' | 'selected' | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number; ids: ReadonlySet<string>; name: string } | null>(null)
  const onOccupied = useCallback((rowId: string, on: boolean) => setOccupied((prev) => {
    if (prev.has(rowId) === on) return prev
    const next = new Set(prev)
    if (on) next.add(rowId)
    else next.delete(rowId)
    return next
  }), [])
  const safe = ready ? rows.filter((row) => tapOf(row)) : []
  const free = safe.filter((row) => !occupied.has(row.id))
  const tickable = shown.filter((row) => tapOf(row) && !occupied.has(row.id))
  const ticked = tickable.filter((row) => selected.has(row.id))
  const bar = !!bulkKey && (safe.length > 0 || !!progress)
  const lead = bar ? 1 : 0
  const mode = ticked.length > 0 ? 'selected' : 'all'
  const count = mode === 'selected' ? ticked.length : free.length
  const action = bulkKey && actionLabel(bulkKey, mode, count)
  useEffect(() => { if (allRef.current) allRef.current.indeterminate = ticked.length > 0 && ticked.length < tickable.length })
  useSubjectMin(tableRef, model.columns.map((column) => (column.long ? '1' : '0')).join(''), shown.map((row) => row.id).join('\n'), lead)

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
    const targets = focusTargets(rowEl)
    // Commit the row's leaving now (finish runs after an await, outside React's batching), so focus lands on what is on the page after it, the newly
    // opened tab included (NeedsYourDecision picks it in the same render). A ticked row drops out of the selection with it.
    flushSync(() => {
      state.markGone(rowKey(model.key, row.id))
      setSelected((prev) => { const next = new Set(prev); next.delete(row.id); return next })
    })
    if (targets) (targets.find((el) => el?.isConnected) ?? afterTabLeft())?.focus()
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
  async function run(runMode: 'all' | 'selected') {
    if (!bulkKey) return
    setConfirm(null)
    const picked = runMode === 'selected' ? ticked : free
    const list = model.approveBatch ? picked.slice(0, BATCH_MAX) : picked
    const result: BulkResult = {
      total: list.length, decided: 0, stale: 0, failed: [], overlaps: [],
      skipped: runMode === 'all' ? rows.length - safe.length : 0,
      of: model.approveBatch && picked.length > BATCH_MAX ? picked.length : undefined,
    }
    const leaving: string[] = []
    state.setRunning(model.key, true)
    setProgress({ done: 0, total: list.length, ids: new Set(list.map((row) => row.id)), name: actionLabel(bulkKey, runMode, count).name })
    if (model.approveBatch) {
      try {
        const answers = new Map((await model.approveBatch(list.map((row) => row.id))).map((answer) => [answer.shiftId, answer]))
        for (const row of list) {
          const answer = answers.get(row.id)
          if (answer?.approved) { result.decided++; leaving.push(row.id) }
          else if (answer?.code === 'SHIFT_NOT_PENDING_REVIEW') result.stale++
          else result.failed.push({ ref: rowRef(tapOf(row)!.name), message: answer?.message ?? tapOf(row)!.failText })
        }
      } catch {
        // One SaveChanges on the server: a failed request approved nothing.
        result.wholeFailed = true
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
          else result.failed.push({ ref: rowRef(tap.name), message: extractErrorMessage(err, tap.failText) })
        }
      }
    }
    const notice = resultNotice(bulkKey, result)
    flushSync(() => {
      state.notify(notice.tone, notice.title, notice.message, model.key, notice.link)
      for (const id of leaving) state.markGone(rowKey(model.key, id))
      state.setRunning(model.key, false)
      setProgress(null)
      setSelected(new Set())
    })
    if (result.stale) model.refetch()
    // Onto the run's notice (newest first), unless the viewer has gone to another tab or elsewhere.
    const group = groupRef.current
    if (group?.contains(document.activeElement) || document.activeElement === document.body) {
      group?.querySelector<HTMLElement>('[role="status"] [data-tone] a, [role="status"] [data-tone] button')?.focus()
    }
  }

  function clear() {
    setSelected(new Set())
    groupRef.current?.querySelector<HTMLElement>('[data-bulk-action]')?.focus()
  }

  const copy = bulkKey && confirm && confirmCopy(bulkKey, confirm, count, rows.length - safe.length)
  return (
    <div
      ref={groupRef}
      data-quick-group={model.key}
      // Below xl, a control tabbed to never hides under the stuck bar: the header (3rem) and the bar (--control-h and its 1rem padding) above it.
      className={bar ? 'max-xl:[&_:is(a,button,input,textarea)]:scroll-mt-[calc(3rem+var(--control-h)+1rem)]' : undefined}
    >
      {model.phase === 'loading' && <p className="text-[13px] text-[var(--color-muted-foreground)]">Loading {model.noun}…</p>}
      {model.phase === 'error' && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] text-[var(--color-destructive)]">Couldn't load {model.noun}.</p>
          <Button variant="secondary" size="sm" onClick={() => model.refetch()} aria-label={`Try again: ${model.noun}`}>Try again</Button>
        </div>
      )}
      {bar && action && (
        // The panel bar (SHAPE §4): Select all and Complete all at rest; the count, Clear and the selection's action once a box is ticked. Its box lines up
        // over the row boxes and its button's right edge with the row buttons'. Below xl it sticks under the app header, inside its own panel.
        <div className="mb-2 flex items-center justify-between gap-3 xl:h-[var(--control-h)] xl:px-[calc(1px+var(--cell-px))] max-xl:sticky max-xl:top-12 max-xl:z-20 max-xl:bg-[var(--color-background)] max-xl:px-[calc(1px+1rem)] max-xl:py-2 max-xl:shadow-[0_24px_32px_-12px_color-mix(in_srgb,var(--color-foreground)_4%,transparent)]">
          <div className="flex min-w-0 items-center gap-3">
            {tickable.length > 0 && (
              <label className="flex min-h-[var(--control-h)] items-center gap-2 text-[13px] font-medium text-[var(--color-foreground)] pointer-coarse:min-w-[var(--tap-min)]">
                <input
                  ref={allRef}
                  type="checkbox"
                  className={BOX}
                  aria-label={`Select all shown ${model.noun}`}
                  checked={ticked.length > 0 && ticked.length === tickable.length}
                  disabled={!!progress}
                  onChange={(e) => setSelected(new Set(e.target.checked ? tickable.map((row) => row.id) : []))}
                />
                <span className={ticked.length > 0 ? 'sr-only' : undefined}>Select all</span>
              </label>
            )}
            {ticked.length > 0 && (
              <>
                <span className="whitespace-nowrap text-[13px] tabular-nums text-[var(--color-muted-foreground)]">{ticked.length} selected</span>
                <Button variant="ghost" aria-disabled={progress ? true : undefined} className={progress ? HELD : undefined} onClick={() => { if (!progress) clear() }}>Clear</Button>
              </>
            )}
          </div>
          {(count > 0 || progress) && (
            <Button
              data-bulk-action
              aria-label={progress?.name ?? action.name}
              aria-disabled={progress ? true : undefined}
              className={`shrink-0 ${progress ? HELD : ''}`}
              onClick={() => { if (!progress) setConfirm(mode) }}
            >
              {progress && bulkKey ? runningLabel(bulkKey, progress.done, progress.total) : action.label}
            </Button>
          )}
        </div>
      )}
      {shown.length > 0 && (
        <div className="xl:overflow-x-auto xl:rounded-md xl:border xl:border-[var(--color-border)] xl:bg-[var(--color-card)]">
          {/* Explicit roles: a table drawn as a grid (xl) or as cards (below xl) keeps its table semantics in every browser. */}
          <table
            ref={tableRef}
            role="table"
            style={{ gridTemplateColumns: gridColumns(model.columns, lead) }}
            className="w-full text-sm tabular-nums max-xl:flex max-xl:flex-col max-xl:gap-3 xl:grid xl:divide-y xl:divide-[var(--color-border)]"
          >
            <thead role="rowgroup" className={`max-xl:hidden ${SUBGRID}`}>
              {/* The header band (bolder, SHAPE §2): Mist, so it reads as the table's head and never as a hovered row (that is surface-container-low). */}
              <tr role="row" className={`h-[var(--table-head-h)] bg-[var(--color-surface-container)] xl:items-center ${SUBGRID}`}>
                {lead > 0 && <th role="columnheader" data-select className={CELL}><span className="sr-only">Select</span></th>}
                {[model.subjectHeader, ...model.columns.map((column) => column.header), ''].map((header, i) => (
                  <th key={i} role="columnheader" className={`${CELL} ${i === model.columns.length + 1 ? LAST_TRACK : ''} whitespace-nowrap text-left text-xs font-semibold text-[var(--color-muted-foreground)]`}>{header}</th>
                ))}
              </tr>
            </thead>
            {shown.map((row) => (
              <QuickRowView
                key={row.id}
                row={row}
                columns={model.columns}
                box={!bar ? undefined : tapOf(row) ? {
                  checked: selected.has(row.id),
                  onChange: (checked) => setSelected((prev) => { const next = new Set(prev); if (checked) next.add(row.id); else next.delete(row.id); return next }),
                } : null}
                inRun={!!progress?.ids.has(row.id)}
                onOccupied={onOccupied}
                onDone={(outcome, rowEl) => finish(row, outcome, rowEl)}
                onRefused={refused}
              />
            ))}
          </table>
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
