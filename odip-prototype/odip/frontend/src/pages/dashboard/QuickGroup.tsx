import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
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
import { isPresent, pageRows, rowKey, shownCount, visibleRows, type ActionOutcome, type FactColumn, type GroupModel, type QuickForm, type QuickRow, type RowAction } from './quickGroupModel'
import type { DecisionState } from './useDecisionState'
import { BATCH_MAX, actionLabel, confirmCopy, isBulkKey, resultNotice, rowRef, runningLabel, selectName, type BulkResult } from './bulkCopy'

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

/**
 * A fact cell (SHAPE §4): one plain value, left out when empty. Below xl the card wraps it as today; from xl it joins line 2's muted run, a middle dot after
 * it when a later fact follows (so a wrapped line never starts with one), and free text takes one line with its full text in the tooltip.
 */
function FactCell({ column, value, sep }: { column: FactColumn; value: string | null | undefined | false; sep: boolean }) {
  const classes = ['order-3 mt-1 text-[13px] text-[var(--color-muted-foreground)] xl:flex', column.long ? 'xl:min-w-0 xl:max-w-full' : 'whitespace-nowrap',
    !value && 'hidden', column.fromLg && 'max-lg:hidden']
  return (
    <td role="cell" className={classes.filter(Boolean).join(' ')}>
      {value && (column.long ? <span className="block break-words xl:min-w-0 xl:truncate" title={value}>{value}</span> : value)}
      {sep && <span aria-hidden className="ml-1 shrink-0 max-xl:hidden">·</span>}
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
  const filled = row.facts.map(Boolean)
  return (
    <tbody ref={rowRef} role="rowgroup" className="block max-xl:rounded-2xl max-xl:border max-xl:border-[var(--color-border)] max-xl:bg-[var(--color-card)] max-xl:p-4 xl:transition-colors xl:hover:bg-[var(--color-surface-container-low)]">
      {/* One flex row, two looks: the card's lines below xl, the list row's two lines from xl (buttons on line 1 by `order`, the ::after breaks to line 2). Every
          line-1 item and line-2 item carries the 4px between lines itself (gap-y-0), so the break adds nothing; below xl the row's -mt-1 takes back line 1's. */}
      <tr role="row" className={`relative flex flex-wrap gap-y-0 after:order-2 after:h-0 after:basis-full after:content-[''] max-xl:-mt-1 max-xl:items-center max-xl:gap-x-3 xl:items-start xl:gap-x-2 xl:px-[var(--card-pad)] xl:py-2 ${box !== undefined ? 'xl:pl-[calc(var(--card-pad)+1.5rem)]' : ''}`}>
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
        {columns.map((column, i) => <FactCell key={column.header} column={column} value={row.facts[i]} sep={filled[i] && filled.slice(i + 1).some(Boolean)} />)}
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
                    {/* Both labels in one grid cell, the one not shown invisible: the button keeps the wider one's width at one line's height (SHAPE §4). */}
                    <span className="grid">
                      <span aria-hidden={tapping || undefined} className={`[grid-area:1/1] ${tapping ? 'invisible' : ''}`}>{action.label}</span>
                      <span aria-hidden={!tapping || undefined} className={`[grid-area:1/1] ${tapping ? '' : 'invisible'}`}>{action.busyLabel}</span>
                    </span>
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
  const shown = ready ? pageRows(rows, 1) : []
  const cut = ready && shownCount(model, state.gone) > shown.length
  const notices = state.notices.filter((notice) => notice.subject === model.key)

  // Bulk: safe = a row with a one-tap decision, anywhere in the tab; the ticks are only the rows on screen.
  const bulkKey = isBulkKey(model.key) ? model.key : null
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [occupied, setOccupied] = useState<ReadonlySet<string>>(() => new Set())
  const [confirm, setConfirm] = useState<'all' | 'selected' | null>(null)
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
  const ticked = tickable.filter((row) => selected.has(row.id))
  const bar = !!bulkKey && (safe.some((row) => !unsure.has(row.id)) || !!progress)
  const mode = ticked.length > 0 ? 'selected' : 'all'
  const count = mode === 'selected' ? ticked.length : free.length
  const action = bulkKey && actionLabel(bulkKey, mode, count)
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
      if (unchecked.length) setHeld((prev) => new Map([...prev, ...unchecked.map((id): [string, number] => [id, readAtRef.current])]))
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
              // Once ticked, the box alone: the row boxes' size-4 + touch pad, so the count sits where "Select all" was (no jump on a phone).
              <label className={ticked.length > 0 ? `${TAP_AREA} flex size-4`
                : 'flex min-h-[var(--control-h)] items-center gap-2 text-[13px] font-medium text-[var(--color-foreground)] pointer-coarse:min-w-[var(--tap-min)]'}>
                <input
                  ref={allRef}
                  type="checkbox"
                  className={BOX}
                  aria-label={`Select all shown ${model.noun}`}
                  checked={ticked.length > 0 && ticked.length === tickable.length}
                  aria-disabled={progress ? true : undefined}
                  onChange={(e) => { if (!progress) setSelected(new Set(e.target.checked ? tickable.map((row) => row.id) : [])) }}
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
              // While running, the name is the visible count (label in name, WCAG 2.5.3).
              aria-label={progress ? undefined : action.name}
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
        // The list's box (SHAPE §4): DataTable's from xl, and never a scroll container (no overflow). It is the size container for the row forms and the pager,
        // never the group root: the bulk ConfirmDialog renders inside the root as `fixed`, and containment would centre it in the group, not the screen.
        <div className="@container xl:rounded-md xl:border xl:border-[var(--color-border)] xl:bg-[var(--color-card)]">
          {/* Explicit roles: a table drawn as a list (xl) or as cards (below xl) keeps its table semantics in every browser. */}
          <table
            ref={tableRef}
            role="table"
            className="w-full text-sm tabular-nums max-xl:flex max-xl:flex-col max-xl:gap-3 xl:block xl:divide-y xl:divide-[var(--color-border)] xl:[&>tbody:last-of-type]:rounded-b-[calc(var(--radius-md)-1px)]"
          >
            <thead role="rowgroup" className="sr-only">
              <tr role="row" className="flex">
                {bar && <th role="columnheader" data-select>Select</th>}
                <th role="columnheader">{model.subjectHeader}</th>
                <th role="columnheader" data-flags>Flags</th>
                {[...model.columns.map((column) => column.header), ''].map((header, i) => <th key={i} role="columnheader">{header}</th>)}
              </tr>
            </thead>
            {shown.map((row) => (
              <QuickRowView
                key={row.id}
                row={row}
                columns={model.columns}
                box={!bar ? undefined : tapOf(row) ? {
                  checked: selected.has(row.id),
                  // A run holds every box: its selection was taken at Confirm.
                  locked: !!progress || unsure.has(row.id),
                  onChange: (checked) => setSelected((prev) => { const next = new Set(prev); if (checked) next.add(row.id); else next.delete(row.id); return next }),
                } : null}
                inRun={!!progress?.ids.has(row.id) || unsure.has(row.id)}
                unconfirmed={unsure.has(row.id)}
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
