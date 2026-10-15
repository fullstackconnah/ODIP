import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { ROW_ACTIONS_CARD } from '@/components/tapArea'
import { QuickGroup } from './QuickGroup'
import { useDecisionState } from './useDecisionState'
import type { ActionOutcome, GroupModel, QuickForm, QuickRow, RowAction } from './quickGroupModel'

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
const axiosError = (message: string) => ({ response: { data: { message } } })
/** The decision rows: every body row but a detail row (the error or form under a row). */
const bodyRows = () => screen.queryAllByRole('row').filter((tr) => tr.closest('tbody') && !tr.hasAttribute('data-detail'))
/** A decision row's row group: its row, and its detail row while it has one. */
const rowOf = (subject: string) => screen.getByText(subject).closest('tbody')!

describe('QuickGroup — the table', () => {
  it('heads its columns with the subject, then each fact, then an empty actions header', () => {
    render(<Harness model={model()} />)

    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Staff', 'Type', 'Dates', 'Note', ''])
    // The header row is the table's look from xl; below xl each row is a card and the header is not shown.
    expect(screen.getAllByRole('row')[0].closest('thead')).toHaveClass('max-xl:hidden')
  })

  it('draws one plain value per column, a dash for a missing one, and cuts long text in the table with its full text in the tooltip', () => {
    render(<Harness model={model({ rows: [row('a', { facts: ['Annual leave', '20–24 Oct 2026, 5 days', 'Family wedding'] }), row('b')] })} />)

    expect(within(rowOf('Person a')).getAllByRole('cell').map((td) => td.textContent)).toEqual(['Person a', 'Annual leave', '20–24 Oct 2026, 5 days', 'Family wedding', ''])
    expect(within(rowOf('Person b')).getAllByRole('cell')[3]).toHaveTextContent('—')
    expect(screen.getByText('Family wedding')).toHaveAttribute('title', 'Family wedding')
    expect(screen.getByText('Family wedding')).toHaveClass('xl:truncate')
  })

  // jsdom has no layout: the sizing rule is pinned as the grid template; the captures measure it (no text cut while any column has spare width).
  it('sizes its columns by their content from xl: text grows to its full width before the spare goes to a gap ahead of the buttons', () => {
    render(<Harness model={model()} />)

    const table = screen.getByRole('table')
    expect(table).toHaveClass('xl:grid')
    // Subject and free text: no minimum, up to their content. Dates and short facts: their content. Then the spare. Then the buttons, as wide as they are.
    // The subject's minimum is measured (--subject-min): it keeps its full width until every free-text fact is down to its floor.
    expect(table.style.gridTemplateColumns).toBe('minmax(var(--subject-min, 0px), max-content) max-content max-content minmax(0, max-content) minmax(0, 1fr) max-content')
    for (const tr of screen.getAllByRole('row')) expect(tr).toHaveClass('xl:grid-cols-subgrid', 'xl:col-span-full')
    // The buttons sit in the last track, past the spare.
    expect(within(rowOf('Person a')).getAllByRole('cell').at(-1)).toHaveClass('xl:col-[-2/-1]')
    expect(screen.getAllByRole('columnheader').at(-1)).toHaveClass('xl:col-[-2/-1]')
  })

  it('reserves the busy label on a one-tap button, so "Approving…" never moves the columns', () => {
    render(<Harness model={model({ count: 1, rows: [row('a', { actions: [approve('a', vi.fn())] })] })} />)

    const button = screen.getByRole('button', { name: 'Approve leave: Person a' })
    expect(button).toHaveTextContent(/^Approve$/)
    expect(button.querySelector('[data-reserve]')).toHaveAttribute('data-reserve', 'Approving…')
    // A date never breaks or is cut, at any width.
    expect(within(rowOf('Person a')).getAllByRole('cell')[2]).toHaveClass('whitespace-nowrap')
  })

  it('leaves a missing fact out of the card (below xl), and a from-lg column off the card below lg', () => {
    const columns = [{ header: 'Type' }, { header: 'Due' }, { header: 'Trip', long: true, fromLg: true }]
    render(<Harness model={model({ count: 1, columns, rows: [row('a', { facts: [null, '8 Oct', 'Beach Trip'] })] })} />)

    const cells = within(rowOf('Person a')).getAllByRole('cell')
    expect(cells[1]).toHaveTextContent('—')
    expect(cells[1]).toHaveClass('max-xl:hidden')
    expect(cells[2]).not.toHaveClass('max-xl:hidden')
    expect(cells[3]).toHaveClass('max-lg:hidden')
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
    expect(link).toHaveClass('pointer-coarse:inline-flex', 'min-h-[var(--tap-min)]')
  })
})

describe('QuickGroup — a row', () => {
  it('draws at most two flags after the subject, each a word, and cuts the subject only in the table', () => {
    const flags = [{ label: '1 incident', tone: 'danger' as const }, { label: 'Outlier time', tone: 'warning' as const }, { label: 'Manual start', tone: 'warning' as const }]
    render(<Harness model={model({ count: 1, rows: [row('a', { flags })] })} />)

    expect(screen.getByText('Person a')).toHaveAttribute('title', 'Person a')
    expect(screen.getByText('Person a')).toHaveClass('xl:truncate')
    expect(screen.getByText('1 incident')).toBeInTheDocument()
    expect(screen.getByText('Outlier time')).toBeInTheDocument()
    expect(screen.queryByText('Manual start')).not.toBeInTheDocument()
  })

  // jsdom has no layout, so the responsive contract is pinned as classes; the captures measure it.
  it('is a house phone card below xl (drawn on its row group), and a --row-h table row from xl', () => {
    render(<Harness model={model({ count: 1, rows: [row('a')] })} />)

    expect(rowOf('Person a').className).toContain('max-xl:rounded-2xl')
    expect(rowOf('Person a').className).toContain('max-xl:border')
    expect(screen.getByText('Person a').closest('tr')).toHaveClass('xl:h-[var(--row-h)]')
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

    expect(screen.getByText("Couldn't load leave requests.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again: leave requests' }))
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
    expect(alert.closest('tr')).toHaveAttribute('data-detail')
    expect(rowOf('Person a')).toContainElement(alert)
    expect(button).not.toHaveAttribute('aria-disabled')
    expect(button).toHaveTextContent('Approve')
    expect(document.activeElement).toBe(button)
  })

  it("falls back to the action's own words when the server sends none, and clears the line on the next tap", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('network')).mockReturnValueOnce(deferred().promise)
    render(<Harness model={model({ rows: [row('a', { actions: [approve('a', run)] })], count: 1 })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Approve leave: Person a' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't approve. Try again.")
    fireEvent.click(screen.getByRole('button', { name: 'Approve leave: Person a' }))
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
    expect(rowOf('Person a')).toContainElement(form)
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
