import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { Link } from 'react-router-dom'
import { Button } from '@/components/Button'
import { CheckboxField } from '@/components/CheckboxField'
import { Callout } from '@/components/Callout'
import { PageState } from '@/components/PageState'
import { CellText, DataTable, type Column } from '@/components/DataTable'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { StatusBadge } from '@/components/StatusBadge'
import { NoticesRegion } from '@/components/NoticesRegion'
import { TextAreaField } from '@/components/TextAreaField'
import { TextField } from '@/components/TextField'
import { ROW_ACTIONS_CARD, TAP_FLOOR } from '@/components/tapArea'
import { formatRatio } from '@/lib/format'
import { extractErrorMessage } from '@/lib/utils'
import { SHOWN_ROWS, isPresent, rowKey, shownCount, visibleRows, type ActionOutcome, type GroupModel, type QuickForm, type QuickRow, type RowAction } from './quickGroupModel'
import type { DecisionState } from './useDecisionState'
import { BATCH_MAX, actionLabel, confirmCopy, isBulkKey, resultNotice, rowRef, runningLabel, selectName, type BulkResult } from './bulkCopy'

// A busy control is aria-disabled, not disabled: a disabled button drops focus in some browsers, and a refused tap must leave focus where it was (SHAPE §4).
const HELD = 'opacity-50 cursor-not-allowed'

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
  const detail = rowEl.nextElementSibling?.hasAttribute('data-row-detail') ? rowEl.nextElementSibling as HTMLElement : null
  if (!rowEl.contains(document.activeElement) && !detail?.contains(document.activeElement)) return null
  return [
    (detail?.nextElementSibling ?? rowEl.nextElementSibling)?.querySelector<HTMLElement>('a, button'),
    rowEl.closest('[data-quick-group]')?.querySelector<HTMLElement>('[data-group-link]'),
  ]
}

/** When the tab itself has gone, looked up after it went: the newly opened tab, else the section's heading, else the All clear field. Never the top of the page. */
const afterTabLeft = () =>
  document.querySelector<HTMLElement>('[role="tab"][id^="decisions-tab-"][aria-selected="true"]')
  ?? document.getElementById('dashboard-decisions')
  ?? document.getElementById('dashboard-alerts')

/** A row's inline form (SHAPE §4, "An action that needs input"): in the detail row under its row. Its checks mirror the server's, never exceed them. */
function RowForm({ id, form, held = false, onClose, onBusy, onDone, onRefused }: {
  id: string
  form: QuickForm
  held?: boolean
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
    if (busy || held) return
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
        <Button type="submit" variant={form.danger ? 'danger' : 'primary'} size="sm" aria-disabled={busy || held || undefined} className={busy || held ? HELD : undefined}>
          {busy ? form.busyLabel : form.submitLabel}
        </Button>
      </div>
    </form>
  )
}

/**
 * One decision tab's panel (SHAPE §4, §5): its table of up to five rows (the shared DataTable and its house phone cards below md), the link to the full page
 * under it, and the group's notices under that (a notice inserted above would push every row down under a moving finger). A waiting or failed group says
 * so in place of the table and is never clear (`awaitsData`). A tab with a one-tap decision also gets the bulk bar over its table and a box column
 * (decision-bulk SHAPE §3–§6).
 */
export function QuickGroup({ model, state, onRecoveryChange }: { model: GroupModel; state: DecisionState; onRecoveryChange?: (key: GroupModel['key'], pending: boolean) => void }) {
  const linkRef = useRef<HTMLAnchorElement>(null)
  const subjects = useRef(new Map<string, HTMLSpanElement>())
  const [rowUi, setRowUi] = useState<Map<string, { tapping?: boolean; submitting?: boolean; formOpen?: boolean; error?: string }>>(() => new Map())
  const [needsCheck, setNeedsCheck] = useState<ReadonlySet<string>>(() => new Set())
  const [checking, setChecking] = useState(false)
  const rowUiOf = (id: string) => rowUi.get(id) ?? {}
  const updateRow = (id: string, patch: Partial<ReturnType<typeof rowUiOf>>) => setRowUi(previous => {
    const next = new Map(previous)
    next.set(id, { ...previous.get(id), ...patch })
    return next
  })
  const detailId = useId()
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
  const occupied = new Set([...rowUi].filter(([, ui]) => ui.tapping || ui.submitting || ui.formOpen).map(([id]) => id))
  const [confirm, setConfirm] = useState<'selected' | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number; ids: ReadonlySet<string> } | null>(null)
  // Sent with no answer, and the re-read failed too: each held (no retry) with when the group was last read, until an explicit status check succeeds.
  const [held, setHeld] = useState<ReadonlyMap<string, number>>(() => new Map())
  const readAt = model.readAt ?? 0
  const readAtRef = useRef(readAt)
  useEffect(() => { readAtRef.current = readAt })
  const unsure: ReadonlySet<string> = new Set(held.keys())
  const safe = ready ? rows.filter((row) => tapOf(row)) : []
  const tickable = shown.filter((row) => tapOf(row) && !occupied.has(row.id) && !unsure.has(row.id) && !needsCheck.has(row.id))
  const shownEligibility = JSON.stringify(tickable.map(row => row.id))
  const [previousEligibility, setPreviousEligibility] = useState(shownEligibility)
  if (shownEligibility !== previousEligibility) {
    setPreviousEligibility(shownEligibility)
    const eligibleIds: string[] = JSON.parse(shownEligibility)
    setSelected(previous => {
      const next = new Set([...previous].filter(id => eligibleIds.includes(id)))
      return next.size === previous.size ? previous : next
    })
  }
  const recoveryPending = needsCheck.size > 0 || held.size > 0
  useLayoutEffect(() => { onRecoveryChange?.(model.key, recoveryPending) }, [model.key, recoveryPending, onRecoveryChange])
  useEffect(() => () => onRecoveryChange?.(model.key, false), [model.key, onRecoveryChange])
  const ticked = tickable.filter((row) => selected.has(row.id))
  const bar = !!bulkKey && (shown.some((row) => tapOf(row)) || !!progress)
  const mode = 'selected' as const
  const count = ticked.length
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
  async function run() {
    if (!bulkKey) return
    setConfirm(null)
    const picked = ticked
    const list = model.approveBatch ? picked.slice(0, BATCH_MAX) : picked
    if (!list.length || progress || checking) return
    const result: BulkResult = {
      total: list.length, decided: 0, stale: 0, failed: [], overlaps: [],
      skipped: 0,
      of: model.approveBatch && picked.length > BATCH_MAX ? picked.length : undefined,
    }
    const leaving: string[] = []
    const unanswered: QuickRow[] = []
    const refusedIds: string[] = []
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
          else if (answer?.code === 'SHIFT_NEEDS_REVIEW') { result.skipped++; refusedIds.push(row.id) }
          else { result.failed.push({ ref: rowRef(tapOf(row)!.name), message: answer?.message ?? '' }); refusedIds.push(row.id) }
        }
      } catch (err) {
        // One SaveChanges on the server: a request ODIP refused approved nothing. With no answer, it may have committed.
        if (noAnswer(err)) unanswered.push(...list)
        else { result.wholeFailed = true; refusedIds.push(...list.map(row => row.id)) }
      }
    } else {
      for (const [i, row] of list.entries()) {
        const tap = tapOf(row)!
        setProgress((p) => p && { ...p, done: i })
        try {
          const outcome = await tap.run()
          if (outcome.stale && outcome.keep) result.skipped++
          else if (outcome.stale) result.stale++
          else {
            result.decided++
            if (outcome.overlap) result.overlaps.push(outcome.overlap)
          }
          if (!outcome.keep) leaving.push(row.id)
        } catch (err) {
          const status = statusOf(err)
          if (status === 404 || status === 409) result.stale++
          else if (noAnswer(err)) unanswered.push(row)
          else { result.failed.push({ ref: rowRef(tap.name), message: extractErrorMessage(err, '') }); refusedIds.push(row.id) }
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
      setNeedsCheck(previous => new Set([...previous, ...refusedIds]))
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
    allRef.current?.focus()
  }

  function refuseRow(row: QuickRow, err: unknown, message: string) {
    updateRow(row.id, { error: rowUiOf(row.id).formOpen ? undefined : message, tapping: false, submitting: false })
    setNeedsCheck(previous => new Set([...previous, row.id]))
    if (noAnswer(err)) setHeld(previous => new Map([...previous, [row.id, readAtRef.current]]))
    refused(err, message)
  }

  const rowElement = (id: string) => subjects.current.get(id)?.closest('tr')
  const formId = (id: string) => `${detailId}-${id}`
  const locked = (row: QuickRow) => !!progress || checking || unsure.has(row.id) || needsCheck.has(row.id)

  function closeForm(row: QuickRow) {
    updateRow(row.id, { formOpen: false })
    rowElement(row.id)?.querySelector<HTMLElement>('[aria-controls]')?.focus()
  }

  function done(row: QuickRow, outcome: ActionOutcome) {
    const element = rowElement(row.id)
    if (element) finish(row, outcome, element)
    updateRow(row.id, { formOpen: false, tapping: false, submitting: false, error: undefined })
  }

  async function tap(row: QuickRow, action: TapAction) {
    const ui = rowUiOf(row.id)
    if (locked(row) || ui.tapping || ui.submitting) return
    updateRow(row.id, { tapping: true, error: undefined })
    try { done(row, await action.run()) }
    catch (err) { refuseRow(row, err, extractErrorMessage(err, action.failText)) }
  }

  async function checkLatest() {
    if (checking || progress || !model.reread) return
    const ids = [...new Set([...needsCheck, ...held.keys()])]
    if (!ids.length) return
    setChecking(true)
    try {
      const pending = new Set(await model.reread(ids))
      // A successful reread updates the group hook's rows/actions too. Require a new selection;
      // never replay an old action closure or infer that this client approved an absent item.
      for (const id of ids) if (!pending.has(id)) state.markGone(rowKey(model.key, id))
      setNeedsCheck(new Set())
      setHeld(new Map())
      setSelected(new Set())
      state.notify('success', 'Status checked', 'Review the latest rows and select again if needed. Nothing was resent.', model.key)
    } catch {
      state.notify('danger', 'Status could not be checked', 'Nothing was resent. Actions stay blocked until a status check succeeds.', model.key)
    } finally { setChecking(false) }
  }

  const columns: Column<QuickRow>[] = [
    ...(bar ? [{ key: 'selection', header: 'Select', pin: false as const, mobile: 'status' as const,
      minWidth: 'calc(24px + var(--control-h))', render: (row: QuickRow) => {
        const action = tapOf(row)
        return action ? <CheckboxField label={<span className="sr-only">{selectName(action.name)}</span>}
          className="[&_input]:m-0 [&_input]:size-4 [&_input]:accent-[var(--color-primary)] pointer-coarse:[&_label]:min-w-11"
          checked={selected.has(row.id) && tickable.some(item => item.id === row.id)}
          disabled={!tickable.some(item => item.id === row.id) || !!progress || checking}
          onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(row.id); else next.delete(row.id); return next })} /> : null
      } }] : []),
    { key: 'subject', header: model.subjectHeader, pin: 'start', mobile: 'primary', minWidth: '10rem',
      render: row => <div className="flex min-w-0 flex-wrap items-center gap-2 md:flex-nowrap">
        <span ref={element => { if (element) subjects.current.set(row.id, element); else subjects.current.delete(row.id) }}
          data-quick-subject className="min-w-0 font-semibold md:max-w-[16rem] md:truncate" title={row.subject}>{row.subject}</span>
        {row.flags.slice(0, 2).map(flag => <StatusBadge key={flag.label} tone={flag.tone} label={flag.label} className="shrink-0 whitespace-nowrap" />)}
        {unsure.has(row.id) && <StatusBadge tone="neutral" label="Not confirmed yet" className="shrink-0 whitespace-nowrap" />}
      </div> },
    ...model.columns.map((column, index): Column<QuickRow> => ({
      key: `fact-${index}`, header: column.header, mobile: 'meta',
      render: row => <CellText className="text-[13px] text-[var(--color-muted-foreground)] md:max-w-[18rem]">{row.facts[index] || '\u2014'}</CellText>,
    })),
    { key: 'actions', header: '', render: row => {
      const ui = rowUiOf(row.id), busy = !!ui.tapping || !!ui.submitting || locked(row)
      return <div className={`flex items-center justify-end gap-1.5 pointer-coarse:gap-2 ${ROW_ACTIONS_CARD}`}>
        {row.actions.map(action => action.kind === 'link'
          ? <Button key={action.label} variant="secondary" size="sm" to={action.to} aria-label={action.name}>{action.label}</Button>
          : action.kind === 'form'
            ? <Button key={action.label} variant="secondary" size="sm" aria-label={action.name} aria-expanded={!!ui.formOpen}
                aria-controls={formId(row.id)} aria-disabled={busy || undefined} className={busy ? HELD : undefined}
                onClick={() => { if (!busy) { updateRow(row.id, { formOpen: !ui.formOpen }); setSelected(previous => { const next = new Set(previous); next.delete(row.id); return next }) } }}>{action.label}</Button>
            : <Button key={action.label} size="sm" aria-label={action.name} aria-disabled={busy || undefined}
                className={busy ? HELD : undefined} onClick={() => void tap(row, action)}>
                <span data-reserve={action.busyLabel} className="grid after:invisible after:h-0 after:content-[attr(data-reserve)]">{ui.tapping ? action.busyLabel : action.label}</span>
              </Button>)}
      </div>
    } },
  ]

  function rowDetail(row: QuickRow) {
    const ui = rowUiOf(row.id)
    const formAction = row.actions.find((action): action is Extract<RowAction, { kind: 'form' }> => action.kind === 'form')
    if (!ui.error && !(ui.formOpen && formAction)) return null
    return <div>
      {ui.error && <Callout tone="error">{ui.error}</Callout>}
      {ui.formOpen && formAction && <RowForm id={formId(row.id)} form={formAction.form} held={locked(row)}
        onClose={() => closeForm(row)} onBusy={busy => updateRow(row.id, { submitting: busy })}
        onDone={outcome => done(row, outcome)} onRefused={(err, message) => refuseRow(row, err, message)} />}
    </div>
  }
  const copy = bulkKey && confirm && confirmCopy(bulkKey, confirm, count, rows.length - safe.length)
  return (
    <div
      ref={groupRef}
      data-quick-group={model.key}
      // Below xl, a control tabbed to never hides under the stuck bar: the header (3rem) and the bar (--control-h and its 1rem padding) above it.
      className={bar ? 'max-xl:[&_:is(a,button,input,textarea)]:scroll-mt-[calc(3rem+var(--control-h)+1rem)]' : undefined}
    >
      {model.phase === 'loading' && <PageState kind="loading" noun={model.noun} />}
      {model.phase === 'error' && <PageState kind="error" noun={`${model.title.toLowerCase()} queue`} onRetry={() => model.refetch()} />}
      {bar && action && (
        // The panel bar (SHAPE §4): Select shown at rest; the count, Clear and the selection's action once a box is ticked. Its box lines up
        // over the row boxes and its button's right edge with the row buttons'. Below xl it sticks under the app header, inside its own panel.
        <div className="mb-2 flex items-center justify-between gap-3 xl:h-[var(--control-h)] xl:px-[calc(1px+var(--cell-px))] max-xl:sticky max-xl:top-12 max-xl:z-20 max-xl:bg-[var(--color-background)] max-xl:px-[calc(1px+1rem)] max-xl:py-2 max-xl:shadow-[0_24px_32px_-12px_color-mix(in_srgb,var(--color-foreground)_4%,transparent)]">
          <div className="flex min-w-0 items-center gap-3">
            {tickable.length > 0 && (
              <div ref={element => { allRef.current = element?.querySelector('input') ?? null }}>
                <CheckboxField label={ticked.length > 0 ? <span className="sr-only">Select all shown {model.noun}</span> : 'Select shown'}
                  className="[&_input]:m-0 [&_input]:size-4 [&_input]:accent-[var(--color-primary)] pointer-coarse:[&_label]:min-w-11"
                  aria-label={`Select all shown ${model.noun}`} checked={ticked.length > 0 && ticked.length === tickable.length}
                  aria-disabled={progress || checking ? true : undefined}
                  onChange={event => { if (!progress && !checking) setSelected(new Set(event.target.checked ? tickable.map(row => row.id) : [])) }} />
              </div>
            )}
            {ticked.length > 0 && (
              <>
                <span className="whitespace-nowrap text-[13px] tabular-nums text-[var(--color-muted-foreground)]">{ticked.length} selected</span>
                <Button variant="ghost" aria-disabled={progress || checking ? true : undefined} className={progress ? HELD : undefined} onClick={() => { if (!progress && !checking) clear() }}>Clear</Button>
              </>
            )}
          </div>
          {(count > 0 || progress) && (
            <Button
              data-bulk-action
              // While running, the name is the visible count (label in name, WCAG 2.5.3).
              aria-label={progress ? undefined : action.name}
              aria-disabled={progress || checking ? true : undefined}
              className={`shrink-0 ${progress ? HELD : ''}`}
              onClick={() => { if (!progress && !checking) setConfirm(mode) }}
            >
              {progress && bulkKey ? runningLabel(bulkKey, progress.done, progress.total) : action.label}
            </Button>
          )}
        </div>
      )}
      {(needsCheck.size > 0 || held.size > 0) && (
        <Callout tone="info" className="mb-2">
          <p>Check the latest status before retrying. No items will be resent automatically.</p>
          <Button variant="secondary" size="sm" aria-disabled={checking || !model.reread || undefined}
            onClick={() => void checkLatest()}>{checking ? 'Checking status.' : 'Check latest status'}</Button>
          {!model.reread && <Link to={model.link.to}>Open the full workflow to check</Link>}
        </Callout>
      )}
      {shown.length > 0 && <DataTable data={shown} columns={columns} keyField="id" rowDetail={rowDetail} />}
      <div className="mt-2 flex justify-end first:mt-0">
        <Link
          ref={linkRef}
          data-group-link
          to={model.link.to}
          aria-label={cut ? `See all ${model.noun}` : undefined}
          className={`${TAP_FLOOR} pointer-coarse:min-w-11 pointer-coarse:justify-end text-xs font-bold text-[var(--color-primary)] hover:underline`}
        >
          {cut ? 'See all' : model.link.openLabel}
        </Link>
      </div>
      <NoticesRegion notices={notices} onDismiss={dismiss} focusAfterDismiss={() => linkRef.current} className="mt-2 empty:mt-0" />
      {copy && confirm && (
        <ConfirmDialog open onCancel={() => setConfirm(null)} onConfirm={() => void run()} title={copy.title} message={copy.message} confirmLabel={copy.confirm} />
      )}
    </div>
  )
}
