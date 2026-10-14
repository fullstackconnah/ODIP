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
import { SHOWN_ROWS, rowKey, shownCount, visibleRows, type ActionOutcome, type GroupModel, type QuickForm, type QuickRow, type RowAction } from './quickGroup'
import type { DecisionState } from './useDecisionState'

// A busy control is aria-disabled, not disabled: a disabled button drops focus in some browsers, and a refused tap must leave focus where it was (SHAPE §4).
const HELD = 'opacity-50 cursor-not-allowed'

/**
 * Where focus goes when the row that holds it leaves (SHAPE §10), read BEFORE it leaves: the next row's first control, else this group's link, else
 * the next group's link. Null when focus is not in the row, so nothing is moved for somebody working elsewhere on the page.
 */
function focusTargets(rowEl: HTMLElement): Array<HTMLElement | null | undefined> | null {
  if (!rowEl.contains(document.activeElement)) return null
  const group = rowEl.closest('[data-quick-group]')
  return [
    rowEl.nextElementSibling?.querySelector<HTMLElement>('a, button'),
    group?.querySelector<HTMLElement>('[data-group-link]'),
    group?.nextElementSibling?.querySelector<HTMLElement>('[data-group-link]'),
  ]
}

/** A row's inline form (SHAPE §4, "An action that needs input"): under the row's line, inside the row. Its checks mirror the server's, never exceed them. */
function RowForm({ id, form, onClose, onBusy, onDone }: {
  id: string
  form: QuickForm
  onClose: () => void
  onBusy: (busy: boolean) => void
  onDone: (outcome: ActionOutcome) => void
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
      setError(extractErrorMessage(err, form.failText))
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

/** One decision row (SHAPE §4, "A row"): the subject, its flags and its facts, then at most two buttons at the right edge, and its form under it when open. */
function QuickRowView({ row, onDone }: { row: QuickRow; onDone: (outcome: ActionOutcome, rowEl: HTMLElement) => void }) {
  const rowRef = useRef<HTMLLIElement>(null)
  const formId = useId()
  const [tapping, setTapping] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()
  const [formOpen, setFormOpen] = useState(false)
  const busy = tapping || submitting
  const meta = row.meta.filter(Boolean).join(' · ')
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
      setError(extractErrorMessage(err, action.failText))
      setTapping(false)
    }
  }

  const held = busy ? HELD : undefined
  return (
    <li ref={rowRef} className="rounded-[var(--radius-sm)] px-2 transition-colors hover:bg-[var(--color-surface-container-low)]">
      <div className="flex min-h-[var(--row-h)] flex-wrap items-center gap-x-3 gap-y-1 py-1.5 md:flex-nowrap md:py-0">
        <div className="min-w-48 flex-1 md:min-w-0">
          <div className="flex min-w-0 flex-col md:flex-row md:items-center md:gap-3">
            <div className="flex min-w-0 items-center gap-2 md:max-w-1/2 md:shrink-0">
              <span className="truncate text-sm font-medium text-[var(--color-foreground)]" title={row.subject}>{row.subject}</span>
              {row.flags.slice(0, 2).map((flag) => (
                <StatusBadge key={flag.label} tone={flag.tone} label={flag.label} className="shrink-0 whitespace-nowrap" />
              ))}
            </div>
            {meta && <p className="min-w-0 truncate text-[13px] text-[var(--color-muted-foreground)]" title={meta}>{meta}</p>}
          </div>
          {error && <p role="alert" className="text-xs text-[var(--color-destructive)]">{error}</p>}
        </div>

        {row.actions.length > 0 && (
          <div className={`ml-auto flex shrink-0 items-center gap-1.5 pointer-coarse:gap-2 ${ROW_ACTIONS_CARD}`}>
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
      </div>
      {formOpen && formAction && <RowForm id={formId} form={formAction.form} onClose={closeForm} onBusy={setSubmitting} onDone={done} />}
    </li>
  )
}

/**
 * One decision group (SHAPE §4, "A group"): the h3 and its count, the link to the full page, up to five rows, and the group's notices UNDER the rows (a
 * notice inserted above would push every row down under a moving finger). A waiting or failed group says so and is never clear (`awaitsData`).
 */
export function QuickGroup({ model, state }: { model: GroupModel; state: DecisionState }) {
  const headingId = useId()
  const linkRef = useRef<HTMLAnchorElement>(null)
  const rows = visibleRows(model, state.gone)
  // Rows only once every request has answered: a group whose other list is still waiting or failed shows its one line, not half its rows (SHAPE §6).
  const ready = model.phase === 'ready'
  const shown = ready ? rows.slice(0, SHOWN_ROWS) : []
  const count = shownCount(model, state.gone)
  const cut = ready && count > shown.length
  const notices = state.notices.filter((notice) => notice.subject === model.key)

  function finish(row: QuickRow, outcome: ActionOutcome, rowEl: HTMLElement) {
    if (outcome.notice) state.notify('success', outcome.notice.title, outcome.notice.message, model.key, outcome.notice.link)
    else if (outcome.announce) state.announce(outcome.announce)
    if (outcome.keep) return
    const targets = focusTargets(rowEl)
    // Commit the row's leaving now (finish runs after an await, outside React's batching), so focus lands on what is on the page after it.
    flushSync(() => state.markGone(rowKey(model.key, row.id)))
    // The first target still on the page, else whatever now carries #dashboard-alerts: the Alerts heading, or the All clear field when the page turned clear.
    if (targets) (targets.find((el) => el?.isConnected) ?? document.getElementById('dashboard-alerts'))?.focus()
  }

  return (
    <div data-quick-group={model.key}>
      <div className="flex min-h-[var(--row-h)] items-center justify-between gap-2 px-2">
        <div className="flex items-center gap-2">
          <h3 id={headingId} className="text-sm font-semibold">{model.title}</h3>
          {model.phase !== 'ready' ? (
            <span aria-busy={model.phase === 'loading' || undefined} className="text-xs tabular-nums text-[var(--color-muted-foreground)]">
              <span aria-hidden="true">–</span>
              <span className="sr-only">{model.phase === 'loading' ? 'Loading' : "Couldn't load"}</span>
            </span>
          ) : rows.length > 0 && (
            <StatusBadge tone="neutral" label={String(count)} className="tabular-nums" />
          )}
        </div>
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
      {model.phase === 'loading' && <p className="px-2 pb-1 text-[13px] text-[var(--color-muted-foreground)]">Loading {model.noun}…</p>}
      {model.phase === 'error' && (
        <div className="flex flex-wrap items-center gap-2 px-2 pb-1">
          <p className="text-[13px] text-[var(--color-destructive)]">Couldn't load {model.noun}.</p>
          <Button variant="secondary" size="sm" onClick={() => model.refetch()} aria-label={`Try again: ${model.noun}`}>Try again</Button>
        </div>
      )}
      {shown.length > 0 && (
        <ul aria-labelledby={headingId} className="divide-y divide-[var(--color-border)]">
          {shown.map((row) => <QuickRowView key={row.id} row={row} onDone={(outcome, rowEl) => finish(row, outcome, rowEl)} />)}
        </ul>
      )}
      <NoticesRegion notices={notices} onDismiss={state.dismiss} focusAfterDismiss={() => linkRef.current} className="mt-2 empty:mt-0" />
    </div>
  )
}
