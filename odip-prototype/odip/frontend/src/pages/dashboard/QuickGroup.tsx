import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { Link } from 'react-router-dom'
import { Button } from '@/components/Button'
import { StatusBadge } from '@/components/StatusBadge'
import { NoticesRegion } from '@/components/NoticesRegion'
import { TextAreaField } from '@/components/TextAreaField'
import { TextField } from '@/components/TextField'
import { ROW_ACTIONS_CARD, TAP_FLOOR } from '@/components/tapArea'
import { formatRatio } from '@/lib/format'
import { extractErrorMessage } from '@/lib/utils'
import { SHOWN_ROWS, isPresent, rowKey, shownCount, visibleRows, type ActionOutcome, type FactColumn, type GroupModel, type QuickForm, type QuickRow, type RowAction } from './quickGroupModel'
import type { DecisionState } from './useDecisionState'

// A busy control is aria-disabled, not disabled: a disabled button drops focus in some browsers, and a refused tap must leave focus where it was (SHAPE §4).
const HELD = 'opacity-50 cursor-not-allowed'
// DataTable's cell: --cell-px across, no padding down, centred in the row. Below xl a row is a card and its cells are plain flex items.
const CELL = 'px-[var(--cell-px)] align-middle max-xl:p-0'

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
  // A free-text column takes the table's leftover width and no minimum (width 100%, max-width 0), so on a narrow table it gives way first.
  const classes = [CELL, 'text-[13px] text-[var(--color-muted-foreground)]', column.long ? 'xl:w-full xl:max-w-0' : 'whitespace-nowrap', !value && 'max-xl:hidden', column.fromLg && 'max-lg:hidden']
  return (
    <td className={classes.filter(Boolean).join(' ')}>
      {!value ? '—' : column.long ? <span className="block break-words xl:truncate" title={value}>{value}</span> : value}
    </td>
  )
}

/**
 * One decision row (SHAPE §4, §6): its own row group, so its error line and form (the detail row) stay with it. From xl a table row of --row-h with the
 * buttons at the right edge; below xl the same elements reflow into the house phone card: the subject and its flags, the facts line, the buttons under them.
 */
function QuickRowView({ row, columns, onDone, onRefused }: {
  row: QuickRow
  columns: FactColumn[]
  onDone: (outcome: ActionOutcome, rowEl: HTMLElement) => void
  onRefused: (err: unknown, message: string) => void
}) {
  const rowRef = useRef<HTMLTableSectionElement>(null)
  const formId = useId()
  const [tapping, setTapping] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()
  const [formOpen, setFormOpen] = useState(false)
  const busy = tapping || submitting
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
    <tbody ref={rowRef} className="max-xl:block max-xl:rounded-2xl max-xl:border max-xl:border-[var(--color-border)] max-xl:bg-[var(--color-card)] max-xl:p-4">
      <tr className="max-xl:flex max-xl:flex-wrap max-xl:items-center max-xl:gap-x-3 max-xl:gap-y-1 xl:h-[var(--row-h)] xl:transition-colors xl:hover:bg-[var(--color-surface-container-low)]">
        <td className={`${CELL} max-xl:basis-full`}>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 xl:flex-nowrap">
            <span className="min-w-0 text-sm font-medium text-[var(--color-foreground)] xl:max-w-[16rem] xl:truncate" title={row.subject}>{row.subject}</span>
            {row.flags.slice(0, 2).map((flag) => (
              <StatusBadge key={flag.label} tone={flag.tone} label={flag.label} className="shrink-0 whitespace-nowrap" />
            ))}
          </div>
        </td>
        {columns.map((column, i) => <FactCell key={column.header} column={column} value={row.facts[i]} />)}
        <td className={`${CELL} whitespace-nowrap max-xl:mt-2 max-xl:basis-full xl:w-px ${row.actions.length === 0 ? 'max-xl:hidden' : ''}`}>
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
                    {tapping ? action.busyLabel : action.label}
                  </Button>
                ),
              )}
            </div>
          )}
        </td>
      </tr>
      {(error || form) && (
        <tr data-detail className="max-xl:block">
          <td colSpan={columns.length + 2} className="px-[var(--cell-px)] pb-2 max-xl:block max-xl:p-0 max-xl:pt-3">
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
 * so in place of the table and is never clear (`awaitsData`).
 */
export function QuickGroup({ model, state }: { model: GroupModel; state: DecisionState }) {
  const linkRef = useRef<HTMLAnchorElement>(null)
  const rows = visibleRows(model, state.gone)
  // Rows only once every request has answered: a group whose other list is still waiting or failed shows its one line, not half its rows (SHAPE §6).
  const ready = model.phase === 'ready'
  const shown = ready ? rows.slice(0, SHOWN_ROWS) : []
  const cut = ready && shownCount(model, state.gone) > shown.length
  const notices = state.notices.filter((notice) => notice.subject === model.key)

  // Decided or removed elsewhere (409, 404): say so, since the refetch may take the row and its alert line away, and refetch so the row resolves.
  function refused(err: unknown, message: string) {
    const status = (err as { response?: { status?: number } } | undefined)?.response?.status
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
    // opened tab included (NeedsYourDecision picks it in the same render).
    flushSync(() => state.markGone(rowKey(model.key, row.id)))
    if (targets) (targets.find((el) => el?.isConnected) ?? afterTabLeft())?.focus()
  }

  // Dismissing the last thing a tab holds takes the tab, and its NoticesRegion (which would place focus) with it: place focus once that has committed.
  function dismiss(id: number) {
    if (isPresent(model, state.gone, notices.length - 1)) return state.dismiss(id)
    flushSync(() => state.dismiss(id))
    afterTabLeft()?.focus()
  }

  return (
    <div data-quick-group={model.key}>
      {model.phase === 'loading' && <p className="text-[13px] text-[var(--color-muted-foreground)]">Loading {model.noun}…</p>}
      {model.phase === 'error' && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] text-[var(--color-destructive)]">Couldn't load {model.noun}.</p>
          <Button variant="secondary" size="sm" onClick={() => model.refetch()} aria-label={`Try again: ${model.noun}`}>Try again</Button>
        </div>
      )}
      {shown.length > 0 && (
        <div className="xl:overflow-x-auto xl:rounded-md xl:border xl:border-[var(--color-border)] xl:bg-[var(--color-card)]">
          <table className="w-full text-sm tabular-nums max-xl:flex max-xl:flex-col max-xl:gap-3 xl:divide-y xl:divide-[var(--color-border)]">
            <thead className="max-xl:hidden">
              <tr className="h-[var(--table-head-h)]">
                {[model.subjectHeader, ...model.columns.map((column) => column.header), ''].map((header, i) => (
                  <th key={i} className={`${CELL} whitespace-nowrap text-left text-xs font-medium text-[var(--color-muted-foreground)]`}>{header}</th>
                ))}
              </tr>
            </thead>
            {shown.map((row) => (
              <QuickRowView key={row.id} row={row} columns={model.columns} onDone={(outcome, rowEl) => finish(row, outcome, rowEl)} onRefused={refused} />
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
    </div>
  )
}
