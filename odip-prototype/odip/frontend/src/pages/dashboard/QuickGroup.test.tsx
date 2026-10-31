import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { ROW_ACTIONS_CARD } from '@/components/tapArea'
import { QuickGroup } from './QuickGroup'
import { useDecisionState } from './useDecisionState'
import type { ActionOutcome, GroupModel, QuickForm, QuickRow, RowAction } from './quickGroupModel'

// The bar and the table header switch on the house breakpoint hook; jsdom reads as a phone, so a desktop case flips this (SHAPE card42 §5).
const screenSize = vi.hoisted(() => ({ belowMd: true }))
vi.mock('@/hooks/useIsBelowMd', () => ({ useIsBelowMd: () => screenSize.belowMd }))
beforeEach(() => { screenSize.belowMd = true })

function Harness({ model }: { model: GroupModel }) {
  const state = useDecisionState()
  return (
    <MemoryRouter>
      <AnnouncementRegion message={state.announcement} />
      <QuickGroup model={model} state={state} />
    </MemoryRouter>
  )
}

const deferred = () => {
  let resolve!: (o: ActionOutcome) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<ActionOutcome>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const approve = (id: string, run: () => Promise<ActionOutcome>): RowAction =>
  ({ kind: 'tap', label: 'Approve', busyLabel: 'Approving…', name: `Approve leave: Person ${id}`, failText: "Couldn't approve. Try again.", run })
const decline = (id: string, form: Partial<QuickForm> = {}): RowAction => ({
  kind: 'form', label: 'Decline', name: `Decline leave: Person ${id}`,
  form: { field: 'textarea', label: 'Reason (optional)', hint: 'Person sees this.', submitLabel: 'Decline request', busyLabel: 'Declining…', danger: true,
    failText: "Couldn't decline it. Try again.", submit: vi.fn(async () => ({ announce: `Declined Person ${id}.` })), ...form },
})
const row = (id: string, o: Partial<QuickRow> = {}): QuickRow =>
  ({ id, subject: `Person ${id}`, facts: ['Annual leave', '20–24 Oct 2026, 5 days', null], flags: [], actions: [], ...o })
const model = (o: Partial<GroupModel> = {}): GroupModel => ({
  key: 'leave', title: 'Leave', noun: 'leave requests', phase: 'ready', refetch: vi.fn(), count: 2,
  subjectHeader: 'Staff', columns: [{ header: 'Type' }, { header: 'Dates' }, { header: 'Note', long: true }],
  rows: [row('a'), row('b')], link: { to: '/rostering/leave', openLabel: 'Open Leave' }, ...o,
})
const status = () => screen.getAllByRole('status').find((el) => el.classList.contains('sr-only'))!
const axiosError = (message: string) => ({ response: { data: { success: false, message } } })
/** The decision rows: every body row but a detail row (the error or form under a row). */
const bodyRows = () => screen.queryAllByRole('row').filter((tr) => tr.closest('tbody') && !tr.hasAttribute('data-row-detail'))
/** A decision row's row group: its row, and its detail row while it has one. */
const rowOf = (subject: string) => screen.getByText(subject).closest('tr')!

describe('QuickGroup — the table', () => {
  it('heads its columns with the subject, then each fact, then an empty actions header', () => {
    render(<Harness model={model()} />)

    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Staff', 'Type', 'Dates', 'Note', 'Actions'])
    // The header row is the table's look from xl; below xl each row is a card and the header is not shown.
    expect(screen.getAllByRole('row')[0].closest('thead')).toHaveClass('sticky')
  })

  it('draws one plain value per column, a dash for a missing one, and cuts long text in the table with its full text in the tooltip', () => {
    render(<Harness model={model({ rows: [row('a', { facts: ['Annual leave', '20–24 Oct 2026, 5 days', 'Family wedding'] }), row('b')] })} />)

    expect(within(rowOf('Person a')).getAllByRole('cell').map((td) => td.textContent)).toEqual(['Person a', 'Annual leave', '20–24 Oct 2026, 5 days', 'Family wedding', ''])
    expect(within(rowOf('Person b')).getAllByRole('cell')[3]).toHaveTextContent('—')
    expect(screen.getByText('Family wedding')).toHaveAttribute('title', 'Family wedding')
    expect(screen.getByText('Family wedding')).toHaveClass('md:truncate')
  })

  it('uses the shared house table with bounded context cells and no preview sorting or pager', () => {
    render(<Harness model={model()} />)
    expect(screen.getByRole('table')).toHaveClass('mobile-card-table')
    expect(screen.getAllByRole('columnheader').every(header => !header.hasAttribute('aria-sort'))).toBe(true)
    expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument()
  })
  it('reserves the busy label on a one-tap button, so "Approving…" never moves the columns', () => {
    render(<Harness model={model({ count: 1, rows: [row('a', { actions: [approve('a', vi.fn())] })] })} />)

    const button = screen.getByRole('button', { name: 'Approve leave: Person a' })
    expect(button).toHaveTextContent(/^Approve$/)
    expect(button.querySelector('[data-reserve]')).toHaveAttribute('data-reserve', 'Approving…')
    // A date never breaks or is cut, at any width.
    expect(within(rowOf('Person a')).getAllByRole('cell')[2]).toHaveClass('md:whitespace-nowrap')
  })

  it('keeps all fact columns available and marks context for the shared phone-card layout', () => {
    const columns = [{ header: 'Type' }, { header: 'Due' }, { header: 'Trip', long: true, fromLg: true }]
    render(<Harness model={model({ count: 1, columns, rows: [row('a', { facts: [null, '8 Oct', 'Beach Trip'] })] })} />)
    const cells = within(rowOf('Person a')).getAllByRole('cell')
    expect(cells[1]).toHaveTextContent('\u2014')
    expect(cells[2]).toHaveAttribute('data-card', 'meta')
    expect(cells[3]).toHaveTextContent('Beach Trip')
    expect(cells[3]).not.toHaveClass('max-lg:hidden')
  })
  it('shows five rows and says "See all" (no number) when there are more, naming the group for a screen reader', () => {
    render(<Harness model={model({ count: 7, rows: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => row(id)) })} />)

    expect(bodyRows()).toHaveLength(5)
    const link = screen.getByRole('link', { name: 'See all leave requests' })
    expect(link.textContent).toBe('See all')
  })

  it('opens the full page by name when every row is shown, with a touch floor', () => {
    render(<Harness model={model()} />)

    const link = screen.getByRole('link', { name: 'Open Leave' })
    expect(link).toHaveAttribute('href', '/rostering/leave')
    expect(link).toHaveClass('pointer-coarse:inline-flex', 'min-h-[var(--tap-min)]', 'pointer-coarse:min-w-11')
  })
})

describe('QuickGroup — a row', () => {
  it('draws at most two flags after the subject, each a word, and cuts the subject only in the table', () => {
    const flags = [{ label: '1 incident', tone: 'danger' as const }, { label: 'Outlier time', tone: 'warning' as const }, { label: 'Manual start', tone: 'warning' as const }]
    render(<Harness model={model({ count: 1, rows: [row('a', { flags })] })} />)

    expect(screen.getByText('Person a')).toHaveAttribute('title', 'Person a')
    expect(screen.getByText('Person a')).toHaveClass('md:truncate')
    expect(screen.getByText('1 incident')).toBeInTheDocument()
    expect(screen.getByText('Outlier time')).toBeInTheDocument()
    expect(screen.queryByText('Manual start')).not.toBeInTheDocument()
  })

  it('uses the primitive responsive row token and primary identity cell', () => {
    render(<Harness model={model({ count: 1, rows: [row('a')] })} />)
    expect(rowOf('Person a')).toHaveClass('md:h-[var(--row-h)]')
    expect(screen.getByText('Person a').closest('td')).toHaveAttribute('data-card', 'primary')
  })
  it('puts its buttons in the house row-action cluster: 44px on a phone card, a wider gap on touch, the one-tap action last and primary', () => {
    render(<Harness model={model({ count: 1, rows: [row('a', { actions: [decline('a'), approve('a', vi.fn())] })] })} />)

    const buttons = within(rowOf('Person a')).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['Decline', 'Approve'])
    expect(buttons[0].parentElement!.className).toContain(ROW_ACTIONS_CARD)
    expect(buttons[0].parentElement).toHaveClass('gap-1.5', 'pointer-coarse:gap-2')
    expect(buttons[1].className).toContain('bg-[var(--color-primary)]')
    expect(buttons[0].className).not.toContain('bg-[var(--color-primary)]')
  })

  it('names every button with its row, so a screen reader never hears "Approve" ten times', () => {
    render(<Harness model={model({ count: 1, rows: [row('a', { actions: [decline('a'), approve('a', vi.fn())] })] })} />)

    expect(screen.getByRole('button', { name: 'Approve leave: Person a' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Decline leave: Person a' })).toBeInTheDocument()
  })
})

describe('QuickGroup — waiting and failed', () => {
  it('shows one loading line while its request waits: no table, never clear', () => {
    render(<Harness model={model({ phase: 'loading', rows: [], count: 0 })} />)

    expect(screen.getByText('Loading leave requests…')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('says it could not load, with a Try again that refetches, and keeps the link to the full page', () => {
    const refetch = vi.fn()
    render(<Harness model={model({ phase: 'error', rows: [], count: 0, refetch })} />)

    expect(screen.getByText("Couldn't load this leave queue. Check your connection and try again.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'Open Leave' })).toBeInTheDocument()
  })

  // A group of two requests (leave and unavailability) can hold one list while the other waits or failed: the rows it holds are not the group, so the
  // group shows only its one line until every request has answered (SHAPE §6: "no rows" while waiting, "one row" when it failed).
  it.each(['loading', 'error'] as const)('draws no rows while it is %s, even when one of its requests has answered', (phase) => {
    render(<Harness model={model({ phase, rows: [row('a')], count: 0 })} />)

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText('Person a')).not.toBeInTheDocument()
  })
})

describe('QuickGroup — one tap', () => {
  it('reads "Approving…" and holds both buttons of that row while in flight, so a double tap sends one request; the other rows stay live', async () => {
    const pending = deferred()
    const run = vi.fn(() => pending.promise)
    render(<Harness model={model({ rows: [row('a', { actions: [decline('a'), approve('a', run)] }), row('b', { actions: [approve('b', vi.fn())] })] })} />)

    const button = screen.getByRole('button', { name: 'Approve leave: Person a' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(run).toHaveBeenCalledTimes(1)
    expect(button).toHaveTextContent('Approving…')
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Decline leave: Person a' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Approve leave: Person b' })).not.toHaveAttribute('aria-disabled')
    await act(async () => pending.resolve({ announce: 'Approved Person a.' }))
  })

  it('takes the row away at once on success and announces the sentence', async () => {
    render(<Harness model={model({ rows: [row('a', { actions: [approve('a', async () => ({ announce: "Approved Person a's leave." }))] }), row('b')] })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Approve leave: Person a' }))

    await waitFor(() => expect(screen.queryByText('Person a')).not.toBeInTheDocument())
    expect(bodyRows()).toHaveLength(1)
    expect(status()).toHaveTextContent("Approved Person a's leave.")
  })

  it("keeps the row on a refusal, says the server's words in a line under it, and leaves focus on the button", async () => {
    const run = vi.fn(async () => { throw axiosError('This request has already been decided.') })
    render(<Harness model={model({ rows: [row('a', { actions: [approve('a', run)] })], count: 1 })} />)

    const button = screen.getByRole('button', { name: 'Approve leave: Person a' })
    button.focus()
    fireEvent.click(button)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('This request has already been decided.')
    // The line sits in the row's own detail row, inside its row group (and so inside its card below xl).
    expect(alert.closest('tr')).toHaveAttribute('data-row-detail')
    expect(rowOf('Person a').nextElementSibling).toContainElement(alert)
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveTextContent('Approve')
    expect(document.activeElement).toBe(button)
  })

  it('keeps an unknown outcome blocked until a successful status check, then requires a deliberate retry', async () => {
    const reread = vi.fn(async () => ['a'])
    const run = vi.fn().mockRejectedValueOnce(new Error('network')).mockReturnValueOnce(deferred().promise)
    render(<Harness model={model({ reread, rows: [row('a', { actions: [approve('a', run)] })], count: 1 })} />)
    const button = screen.getByRole('button', { name: 'Approve leave: Person a' })
    fireEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't approve. Try again.")
    fireEvent.click(button)
    expect(run).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Check latest status' }))
    await waitFor(() => expect(reread).toHaveBeenCalledWith(['a']))
    await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'))
    expect(run).toHaveBeenCalledTimes(1)
    fireEvent.click(button)
    expect(run).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('shows a consequence as a notice UNDER the rows, with its link, and keeps the announcement silent', async () => {
    const notice = { title: 'Person a', message: 'Leave approved. It overlaps 2 shifts, and each one has a cover task.', link: { label: 'Open roster', to: '/rostering' } }
    render(<Harness model={model({ rows: [row('a', { actions: [approve('a', async () => ({ notice }))] }), row('b')] })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Approve leave: Person a' }))

    const message = await screen.findByText(notice.message)
    expect(screen.getByRole('link', { name: 'Open roster' })).toHaveAttribute('href', '/rostering')
    expect(screen.getByRole('table').compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(status()).toHaveTextContent('')
  })

  it('keeps its link and notice, with no table, while a notice is held after its last row has left', async () => {
    const notice = { title: 'Person a', message: 'Leave approved. It overlaps 1 shift, and it has a cover task.', link: { label: 'Open roster', to: '/rostering' } }
    render(<Harness model={model({ count: 1, rows: [row('a', { actions: [approve('a', async () => ({ notice }))] })] })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Approve leave: Person a' }))

    await screen.findByText(notice.message)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Leave' })).toBeInTheDocument()
  })

  it('keeps a row whose outcome says it still needs somebody', async () => {
    render(<Harness model={model({ count: 1, rows: [row('a', { actions: [approve('a', async () => ({ keep: true, announce: 'Saved.' }))] })] })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Approve leave: Person a' }))

    await waitFor(() => expect(status()).toHaveTextContent('Saved.'))
    expect(screen.getByText('Person a')).toBeInTheDocument()
  })
})

describe('QuickGroup — an action that needs input', () => {
  const returnForm = (submit = vi.fn(async () => ({ announce: 'Returned.' }))) => decline('a', {
    label: 'Why are you returning it?', hint: 'Person sees this.', required: "Say why you're returning it.", maxLength: 5,
    submitLabel: 'Return shift', busyLabel: 'Returning…', submit,
  })

  it('opens a form in a detail row under its row from a disclosure button, spanning the table, and moves focus into its field', () => {
    render(<Harness model={model({ count: 1, rows: [row('a', { actions: [decline('a')] })] })} />)

    const opener = screen.getByRole('button', { name: 'Decline leave: Person a' })
    expect(opener).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(opener)

    expect(opener).toHaveAttribute('aria-expanded', 'true')
    const form = document.getElementById(opener.getAttribute('aria-controls')!)!
    expect(form.tagName).toBe('FORM')
    expect(rowOf('Person a').nextElementSibling).toContainElement(form)
    expect(form.closest('td')).toHaveAttribute('colspan', '5')
    expect(document.activeElement).toBe(within(form).getByLabelText(/Reason \(optional\)/))
    expect(within(form).getByText('Person sees this.')).toBeInTheDocument()
  })

  it('closes on Escape or Cancel and gives focus back to the opener', () => {
    render(<Harness model={model({ count: 1, rows: [row('a', { actions: [decline('a')] })] })} />)
    const opener = screen.getByRole('button', { name: 'Decline leave: Person a' })

    fireEvent.click(opener)
    fireEvent.keyDown(screen.getByLabelText(/Reason \(optional\)/), { key: 'Escape' })
    expect(opener).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(opener)

    fireEvent.click(opener)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(opener)
  })

  it('mirrors the server: a blank required reason, or one over the cap once trimmed, is refused here and nothing is sent', () => {
    const submit = vi.fn(async () => ({ announce: 'Returned.' }))
    render(<Harness model={model({ count: 1, rows: [row('a', { actions: [returnForm(submit)] })] })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Decline leave: Person a' }))
    const field = screen.getByLabelText(/Why are you returning it/)

    fireEvent.change(field, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Return shift' }))
    expect(screen.getByRole('alert')).toHaveTextContent("Say why you're returning it.")

    fireEvent.change(field, { target: { value: ' sixsix ' } })
    expect(screen.getByText('8 / 5')).toHaveClass('text-[var(--color-destructive)]')
    fireEvent.click(screen.getByRole('button', { name: 'Return shift' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Keep it to 5 characters.')
    expect(submit).not.toHaveBeenCalled()
  })

  it('sends the text as typed, and on a refusal shows the server words in the field and keeps the text', async () => {
    const submit = vi.fn(async () => { throw axiosError('This shift is already on a claim.') })
    render(<Harness model={model({ count: 1, rows: [row('a', { actions: [returnForm(submit)] })] })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Decline leave: Person a' }))
    fireEvent.change(screen.getByLabelText(/Why are you returning it/), { target: { value: ' late ' } })

    fireEvent.click(screen.getByRole('button', { name: 'Return shift' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('This shift is already on a claim.')
    expect(submit).toHaveBeenCalledWith(' late ')
    expect(screen.getByLabelText(/Why are you returning it/)).toHaveValue(' late ')
  })

  it('takes the row away on success and announces', async () => {
    render(<Harness model={model({ rows: [row('a', { actions: [returnForm()] }), row('b')] })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Decline leave: Person a' }))
    fireEvent.change(screen.getByLabelText(/Why are you returning it/), { target: { value: 'late' } })

    fireEvent.click(screen.getByRole('button', { name: 'Return shift' }))

    await waitFor(() => expect(screen.queryByText('Person a')).not.toBeInTheDocument())
    expect(status()).toHaveTextContent('Returned.')
  })

  it("keeps each row's form its own: two can be open, and typed text survives the other one's opening", () => {
    render(<Harness model={model({ rows: [row('a', { actions: [decline('a')] }), row('b', { actions: [decline('b')] })] })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Decline leave: Person a' }))
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Short-staffed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Decline leave: Person b' }))

    expect(screen.getAllByRole('textbox')).toHaveLength(2)
    expect(screen.getAllByRole('textbox')[0]).toHaveValue('Short-staffed')
  })
})

describe('QuickGroup — focus when a row leaves (SHAPE §5)', () => {
  it("moves focus to the next row's first button, so the next decision is under the finger", async () => {
    render(<Harness model={model({ rows: [
      row('a', { actions: [approve('a', async () => ({ announce: 'Approved Person a.' }))] }),
      row('b', { actions: [decline('b'), approve('b', vi.fn())] }),
    ] })} />)
    const button = screen.getByRole('button', { name: 'Approve leave: Person a' })
    button.focus()

    fireEvent.click(button)

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Decline leave: Person b' })))
  })

  it("moves focus to the group's link when the last row leaves and the tab stays (the server still counts more)", async () => {
    render(<Harness model={model({ count: 3, rows: [
      row('a', { actions: [approve('a', async () => ({ announce: 'Approved Person a.' }))] }),
    ] })} />)
    const last = screen.getByRole('button', { name: 'Approve leave: Person a' })
    last.focus()

    fireEvent.click(last)

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('link', { name: 'See all leave requests' })))
  })
})

describe('QuickGroup — fix round 1', () => {
  it('stays with See all when every fetched row was decided here but the server still counts more (deep S4)', async () => {
    const tap = (id: string) => approve(id, async () => ({ announce: `Approved Person ${id}.` }))
    render(<Harness model={model({ count: 3, rows: [row('a', { actions: [tap('a')] })] })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Approve leave: Person a' }))

    await waitFor(() => expect(screen.queryByText('Person a')).not.toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'See all leave requests' })).toBeInTheDocument()
  })

  it.each([409, 404])('on a %i refetches the group and announces the server words, so the row decided elsewhere resolves (N1)', async (code) => {
    const refetch = vi.fn()
    const run = vi.fn(async () => { throw { response: { status: code, data: { message: 'This request has already been decided.' } } } })
    render(<Harness model={model({ count: 1, refetch, rows: [row('a', { actions: [approve('a', run)] })] })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Approve leave: Person a' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('This request has already been decided.')
    expect(refetch).toHaveBeenCalled()
    expect(status()).toHaveTextContent('This request has already been decided.')
  })

  it('does not refetch on any other refusal', async () => {
    const refetch = vi.fn()
    const run = vi.fn(async () => { throw { response: { status: 400, data: { message: 'Nope.' } } } })
    render(<Harness model={model({ count: 1, refetch, rows: [row('a', { actions: [approve('a', run)] })] })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Approve leave: Person a' }))

    await screen.findByRole('alert')
    expect(refetch).not.toHaveBeenCalled()
  })
})

describe('QuickGroup — select and Complete all (decision-bulk SHAPE §3–§6)', () => {
  const ok = (id: string) => vi.fn(async (): Promise<ActionOutcome> => ({ announce: `Approved Person ${id}.` }))
  const tapRow = (id: string, run: () => Promise<ActionOutcome> = ok(id)) => row(id, { actions: [decline(id), approve(id, run)] })
  const confirmRun = (label: string) => fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: label }))
  const notice = () => document.querySelector('[data-quick-group] [role="status"] [data-tone]')

  it('keeps selection separate from ineligible rows and shows no unselected bulk action', () => {
    render(<Harness model={model({ rows: [tapRow('a'), row('b', { flags: [{ label: 'Your request', tone: 'neutral' }] })] })} />)
    expect(screen.getAllByRole('columnheader').map(th => th.textContent)).toEqual(['Select', 'Staff', 'Type', 'Dates', 'Note', 'Actions'])
    expect(within(rowOf('Person b')).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select leave: Person a' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select all shown leave requests' })).not.toBeChecked()
    expect(screen.queryByRole('button', { name: /Approve \d+ selected/ })).not.toBeInTheDocument()
  })
  it('draws no column and no bar where nothing is safe, or on a tab without a bulk action', () => {
    const { unmount } = render(<Harness model={model()} />)
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getAllByRole('columnheader')).toHaveLength(5)
    unmount()

    render(<Harness model={model({ key: 'incidents', rows: [tapRow('a')] })} />)
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Approve all|^Approve 1 / })).toBeNull()
  })

  it('offers selection only for the five shown rows and no whole-tab action', () => {
    render(<Harness model={model({ count: 7, rows: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => tapRow(id)) })} />)

    expect(screen.getAllByRole('checkbox', { name: /^Select leave/ })).toHaveLength(5)
    expect(screen.queryByRole('button', { name: 'Approve all 7 leave requests' })).not.toBeInTheDocument()
  })

  it("swaps Complete all for the selection's action when a box is ticked: a count, Clear, Select all mixed; Clear puts focus back on the action", () => {
    render(<Harness model={model({ count: 3, rows: [tapRow('a'), tapRow('b'), tapRow('c')] })} />)
    const all = screen.getByRole('checkbox', { name: 'Select all shown leave requests' }) as HTMLInputElement

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select leave: Person a' }))
    expect(all.indeterminate).toBe(true)
    // Once ticked, the bar's box takes the row boxes' touch pad (size-4 + TAP_AREA), so the count sits where "Select all" was (finish fix 2).
    expect(all.closest('label')).toHaveClass('min-h-[var(--control-h)]')

    const action = screen.getByRole('button', { name: 'Approve 1 selected leave request' })

    fireEvent.click(all)
    expect(screen.getAllByRole('checkbox', { name: /^Select leave/ }).every((box) => (box as HTMLInputElement).checked)).toBe(true)
    expect(all.indeterminate).toBe(false)
    expect(action).toHaveAccessibleName('Approve 3 selected leave requests')

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.queryByText(/selected$/)).toBeNull()
    expect(action).not.toBeInTheDocument()
    expect(all).toHaveFocus()
  })

  it("unticks and disables a row's box while its form is open, and Complete all leaves it out", () => {
    render(<Harness model={model({ count: 2, rows: [tapRow('a'), tapRow('b')] })} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select leave: Person a' }))

    fireEvent.click(screen.getByRole('button', { name: 'Decline leave: Person a' }))

    expect(screen.getByRole('checkbox', { name: 'Select leave: Person a' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Select leave: Person a' })).not.toBeChecked()
    expect(screen.queryByRole('button', { name: /Approve \d+ selected/ })).not.toBeInTheDocument()
  })

  it('selection never touches the table: the header holds only the box, the count, Clear and the action sit in the bar (card42 T3)', async () => {
    screenSize.belowMd = false
    const first = deferred()
    const { unmount } = render(<Harness model={model({ count: 3, rows: [tapRow('a', () => first.promise), tapRow('b'), tapRow('c')] })} />)
    const heads = () => screen.getAllByRole('columnheader').map((th) => th.textContent)
    const before = heads()
    expect(before).toEqual(['Select all shown leave requests', 'Staff', 'Type', 'Dates', 'Note', 'Actions'])
    expect(screen.getByText('None selected')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select leave: Person a' }))
    expect(heads()).toEqual(before)
    expect(screen.getByText('1 selected').closest('table')).toBeNull()
    expect(screen.getByRole('button', { name: 'Approve 1 selected leave request' }).closest('table')).toBeNull()
    expect(screen.getByRole('button', { name: 'Clear' }).closest('table')).toBeNull()
    unmount()

    screenSize.belowMd = true
    // A fresh run of its own: the first render is unmounted, and nothing from it carries over.
    const second = deferred()
    render(<Harness model={model({ count: 3, rows: [tapRow('a', () => second.promise), tapRow('b'), tapRow('c')] })} />)
    expect(screen.getAllByRole('columnheader')[0]).toHaveTextContent(/^Select$/)
    expect(screen.queryByText('None selected')).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all shown leave requests' }))
    expect(screen.queryByText(/^\d+ selected$/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Approve 3 selected leave requests' }))
    confirmRun('Approve 3')
    await screen.findByRole('button', { name: 'Approving 1 of 3…' })
    // On a phone Clear is not drawn while a run goes: the running label needs the room, and Clear is held then anyway.
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
    await act(async () => { second.resolve({ announce: 'Approved Person a.' }) })
  })

  it('the bar still sticks below xl, and a tabbed-to control clears it (card42 T4)', () => {
    render(<Harness model={model({ count: 2, rows: [tapRow('a'), tapRow('b')] })} />)
    const bar = screen.getByRole('checkbox', { name: 'Select all shown leave requests' }).closest('.max-xl\\:sticky')
    expect(bar).not.toBeNull()
    expect(bar).toHaveClass('max-xl:top-12')
    expect(document.querySelector('[data-quick-group]')!.className).toContain('max-xl:[&_:is(a,button,input,textarea)]:scroll-mt-[calc(3rem+var(--control-h)+1rem)]')
  })

  it('runs the ticked rows one at a time in row order through their own taps, then ONE notice; decided rows leave together, a refused one stays', async () => {
    const first = deferred()
    const runA = vi.fn(() => first.promise)
    const runB = vi.fn(async (): Promise<ActionOutcome> => { throw axiosError('Somebody said no.') })
    const runC = ok('c')
    render(<Harness model={model({ count: 3, rows: [tapRow('a', runA), tapRow('b', runB), tapRow('c', runC)] })} />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all shown leave requests' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve 3 selected leave requests' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Approve 3 selected leave requests?')
    confirmRun('Approve 3')

    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() => expect(runA).toHaveBeenCalled())
    expect(runB).not.toHaveBeenCalled()
    // Its name is its visible count (WCAG 2.5.3), and the run is announced once as it starts, never per row.
    expect(screen.getByRole('button', { name: 'Approving 1 of 3…' })).toHaveAttribute('aria-disabled', 'true')
    expect(status()).toHaveTextContent('Approving 1 of 3…')
    expect(screen.getByRole('button', { name: 'Approve leave: Person a' })).toHaveAttribute('aria-disabled', 'true')
    // The run holds the selection it took: every box, and the bar's controls (aria-disabled, so focus stays).
    expect(screen.getByRole('checkbox', { name: 'Select leave: Person c' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Select all shown leave requests' })).toHaveAttribute('aria-disabled', 'true')
    // A phone does not draw Clear while a run goes (card42 §3.1); from md it stays, held (T3 covers both).
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
    await act(async () => first.resolve({ announce: 'Approved Person a.' }))

    await waitFor(() => expect(notice()).toHaveTextContent('Approved 2 leave requests'))
    expect(runC.mock.invocationCallOrder[0]).toBeGreaterThan(runB.mock.invocationCallOrder[0])
    expect(notice()).toHaveTextContent("1 couldn't be approved: Person b: Somebody said no.")
    expect(screen.queryByText('Person a')).toBeNull()
    expect(screen.queryByText('Person c')).toBeNull()
    expect(screen.getByRole('checkbox', { name: 'Select leave: Person b' })).not.toBeChecked()
    expect(notice()!.contains(document.activeElement)).toBe(true)
    // No announcement per row: the notice is the one report.
    expect(status()).not.toHaveTextContent('Approved Person a.')
  })

  it('reports a row somebody else decided first (409) as stale, and refetches once', async () => {
    const refetch = vi.fn()
    const gone = vi.fn(async (): Promise<ActionOutcome> => { throw { response: { status: 409, data: { message: 'This request has already been decided.' } } } })
    render(<Harness model={model({ count: 2, refetch, rows: [tapRow('a'), tapRow('b', gone)] })} />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all shown leave requests' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve 2 selected leave requests' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Approve 2 selected leave requests?')
    confirmRun('Approve 2')

    await waitFor(() => expect(notice()).toHaveTextContent('Approved 1 leave request'))
    expect(notice()).toHaveTextContent('1 was already decided by someone else.')
    expect(refetch).toHaveBeenCalledTimes(1)
  })
})

describe('QuickGroup — selected shown acceptance', () => {
  it('keeps consequential bulk action absent until eligible shown rows are selected', () => {
    const run = vi.fn(async () => ({}))
    render(<Harness model={model({ count: 6, rows: ['a', 'b', 'c', 'd', 'e', 'hidden'].map(id => row(id, { actions: [approve(id, run)] })) })} />)
    expect(screen.queryByRole('button', { name: /Approve (all|the first|\d+ clean)/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Approve \d+ selected/ })).not.toBeInTheDocument()
    expect(run).not.toHaveBeenCalled()
  })

  it('selects eligible shown rows only and confirms that exact scope, never the hidden sixth row', async () => {
    const calls = ['a', 'b', 'c', 'd', 'e', 'hidden'].map(() => vi.fn(async () => ({})))
    render(<Harness model={model({ count: 6, rows: ['a', 'b', 'c', 'd', 'e', 'hidden'].map((id, i) => row(id, { actions: [approve(id, calls[i])] })) })} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all shown leave requests' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve 5 selected leave requests' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('5 selected')
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Approve 5' }))
    await waitFor(() => expect(calls[4]).toHaveBeenCalledTimes(1))
    expect(calls[5]).not.toHaveBeenCalled()
  })
})





describe('QuickGroup — fresh-check and stable detail acceptance', () => {
  it('blocks both individual and bulk retry routes until a successful explicit reread', async () => {
    const run = vi.fn(async () => { throw axiosError('Explicit refusal') })
    const reread = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(['a'])
    render(<Harness model={model({ count: 1, reread, rows: [row('a', { actions: [approve('a', run)] })] })} />)
    const button = screen.getByRole('button', { name: 'Approve leave: Person a' })
    fireEvent.click(button)
    await screen.findByText('Explicit refusal')
    fireEvent.click(button)
    expect(run).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('checkbox', { name: 'Select leave: Person a' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /selected leave/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Check latest status' }))
    await screen.findByText('Status could not be checked')
    fireEvent.click(button)
    expect(run).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Check latest status' }))
    await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'))
    expect(run).toHaveBeenCalledTimes(1)
    expect(reread).toHaveBeenNthCalledWith(1, ['a'])
    expect(reread).toHaveBeenNthCalledWith(2, ['a'])
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select leave: Person a' }))
    expect(screen.getByRole('button', { name: 'Approve 1 selected leave request' })).toBeInTheDocument()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('uses newly read eligibility and flags rather than an old approval closure', async () => {
    const run = vi.fn(async () => { throw axiosError('Refused') })
    const changed = row('a', { flags: [{ label: 'Individual review needed', tone: 'warning' }], actions: [{ kind: 'link', label: 'Review', name: 'Review changed Person a', to: '/rostering/leave' }] })
    const reread = vi.fn(async () => { refresh(); return ['a'] })
    const view = render(<Harness model={model({ count: 1, reread, rows: [row('a', { actions: [approve('a', run)] })] })} />)
    const refresh = () => view.rerender(<Harness model={model({ count: 1, reread, rows: [changed] })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve leave: Person a' }))
    await screen.findByText('Refused')
    fireEvent.click(screen.getByRole('button', { name: 'Check latest status' }))
    await screen.findByText('Individual review needed')
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review changed Person a' })).toHaveAttribute('href', '/rostering/leave')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('preserves the exact typed field and focus through selection rerenders and a rejected save', async () => {
    const submit = vi.fn(async () => { throw axiosError('Reason refused') })
    render(<Harness model={model({ rows: [row('a', { actions: [decline('a', { submit })] }), row('b', { actions: [approve('b', vi.fn())] })] })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Decline leave: Person a' }))
    const field = screen.getByRole('textbox')
    fireEvent.change(field, { target: { value: 'Keep this exact reason' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select leave: Person b' }))
    expect(screen.getByRole('textbox')).toBe(field)
    expect(field).toHaveValue('Keep this exact reason')
    field.focus()
    fireEvent.submit(field.closest('form')!)
    await screen.findByText('Reason refused')
    expect(screen.getByRole('textbox')).toBe(field)
    expect(field).toHaveValue('Keep this exact reason')
    expect(field).toHaveFocus()
    expect(submit).toHaveBeenCalledWith('Keep this exact reason')
  })
})


it('drops stale selection when shown eligibility changes, even if the row later becomes eligible again', () => {
  const eligible = row('a', { actions: [approve('a', vi.fn())] })
  const view = render(<Harness model={model({ count: 1, rows: [eligible] })} />)
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select leave: Person a' }))
  view.rerender(<Harness model={model({ count: 1, rows: [row('a', { flags: [{ label: 'Review needed', tone: 'warning' }] })] })} />)
  view.rerender(<Harness model={model({ count: 1, rows: [eligible] })} />)
  expect(screen.getByRole('checkbox', { name: 'Select leave: Person a' })).not.toBeChecked()
  expect(screen.queryByRole('button', { name: 'Approve 1 selected leave request' })).not.toBeInTheDocument()
})
