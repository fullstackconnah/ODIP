import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
const axiosError = (message: string) => ({ response: { data: { success: false, message } } })
/** The decision rows: every body row but a detail row (the error or form under a row). */
const bodyRows = () => screen.queryAllByRole('row').filter((tr) => tr.closest('tbody') && !tr.hasAttribute('data-detail'))
/** A decision row's row group: its row, and its detail row while it has one. */
const rowOf = (subject: string) => screen.getByText(subject).closest('tbody')!

describe('QuickGroup — the row (SHAPE §4)', () => {
  it('heads every column with an sr-only label', () => {
    render(<Harness model={model()} />)

    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Staff', 'Flags', 'Type', 'Dates', 'Note', ''])
    expect(screen.getAllByRole('row')[0].closest('thead')).toHaveClass('sr-only')
  })

  it('draws the flags in their own cell after the subject, at most two', () => {
    const flags = [{ label: '1 incident', tone: 'danger' as const }, { label: 'Outlier time', tone: 'warning' as const }, { label: 'Manual start', tone: 'warning' as const }]
    render(<Harness model={model({ count: 1, rows: [row('a', { flags })] })} />)

    const cells = within(rowOf('Person a')).getAllByRole('cell')
    expect(cells.slice(0, 2).map((td) => td.textContent)).toEqual(['Person a', '1 incidentOutlier time'])
    expect(cells[1]).toHaveAttribute('data-flags')
    expect(screen.queryByText('Manual start')).not.toBeInTheDocument()
    expect(screen.getByText('Person a')).toHaveAttribute('title', 'Person a')
    expect(screen.getByText('Person a')).toHaveClass('xl:line-clamp-2')
  })

  it('leaves an empty fact out at every width, and a from-lg fact off below lg', () => {
    const columns = [{ header: 'Type' }, { header: 'Due' }, { header: 'Trip', long: true, fromLg: true }]
    render(<Harness model={model({ count: 1, columns, rows: [row('a', { facts: [null, '8 Oct', 'Beach Trip'] })] })} />)

    const cells = within(rowOf('Person a')).getAllByRole('cell')
    expect(cells[2]).toHaveClass('hidden')
    expect(cells[2]).toHaveTextContent('')
    expect(cells[3]).not.toHaveClass('hidden')
    expect(cells[4]).toHaveClass('max-lg:hidden')
    // A date never breaks or is cut, at any width.
    expect(cells[3]).toHaveClass('whitespace-nowrap')
  })

  it('separates the facts with a middle dot, skipping an empty one', () => {
    render(<Harness model={model({ count: 1, rows: [row('a', { facts: ['Annual leave', null, 'Family wedding'] })] })} />)

    const dots = rowOf('Person a').querySelectorAll('[aria-hidden="true"]')
    expect(dots).toHaveLength(1)
    expect(dots[0]).toHaveTextContent('·')
    expect(dots[0].closest('td')).toHaveTextContent(/^Annual leave·$/)
    expect(dots[0].previousSibling?.textContent).toBe('Annual leave')
    expect(screen.getByText('Family wedding')).toHaveAttribute('title', 'Family wedding')
    expect(screen.getByText('Family wedding')).toHaveClass('xl:truncate')
  })

  it("holds a one-tap button's busy label in the same grid cell, hidden, and has no reserve attribute", () => {
    const { container } = render(<Harness model={model({ count: 1, rows: [row('a', { actions: [approve('a', vi.fn())] })] })} />)

    const button = screen.getByRole('button', { name: 'Approve leave: Person a' })
    const [label, busy] = within(button).getAllByText(/^Approv/)
    expect(label).toHaveTextContent('Approve')
    expect(busy).toHaveTextContent('Approving…')
    expect(label).toHaveClass('[grid-area:1/1]')
    expect(busy).toHaveClass('[grid-area:1/1]', 'invisible')
    expect(busy).toHaveAttribute('aria-hidden', 'true')
    expect(label).not.toHaveClass('invisible')
    expect(container.querySelector('[data-reserve]')).toBeNull()
  })

  // jsdom has no layout, so the responsive contract is pinned as classes; the captures measure it.
  it('is a house card below xl and a list row from xl, in a box that never scrolls', () => {
    render(<Harness model={model({ count: 1, rows: [row('a')] })} />)

    expect(rowOf('Person a')).toHaveClass('max-xl:rounded-2xl', 'max-xl:border', 'xl:hover:bg-[var(--color-surface-container-low)]')
    const group = document.querySelector('[data-quick-group]')!
    expect(group.className).not.toContain('@container')
    expect(screen.getByRole('table').parentElement).toHaveClass('@container', 'xl:rounded-md', 'xl:border')
    expect(rowOf('Person a').querySelector('td[data-flags]')).toHaveClass('hidden')
    for (const el of group.querySelectorAll('*')) expect(String(el.className)).not.toMatch(/overflow-(x-|y-)?(auto|scroll|hidden)/)
  })

  it('opens the full page by name when every row is shown, with a touch floor', () => {
    render(<Harness model={model()} />)

    const link = screen.getByRole('link', { name: 'Open Leave' })
    expect(link).toHaveAttribute('href', '/rostering/leave')
    expect(link).toHaveClass('pointer-coarse:inline-flex', 'min-h-[var(--tap-min)]')
  })
})

describe('QuickGroup — a row', () => {
  it('puts its buttons in the house row-action cluster: 44px on a phone card, a wider gap on touch, the one-tap action last and primary', () => {
    render(<Harness model={model({ count: 1, rows: [row('a', { actions: [decline('a'), approve('a', vi.fn())] })] })} />)

    const buttons = within(rowOf('Person a')).getAllByRole('button')
    expect(buttons.map((b) => b.getAttribute('aria-label')!.split(' ')[0])).toEqual(['Decline', 'Approve'])
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
    expect(within(button).getByText('Approving…')).not.toHaveClass('invisible')
    expect(within(button).getByText('Approve')).toHaveClass('invisible')
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
    expect(form.closest('td')).toHaveAttribute('colspan', '6')
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

  it('adds a box column to a bulk tab with a one-tap row: a box on each such row only, named from its action, and Select all in the header row', () => {
    render(<Harness model={model({ rows: [tapRow('a'), row('b', { flags: [{ label: 'Your request', tone: 'neutral' }] })] })} />)

    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Select all', 'Staff', 'Flags', 'Type', 'Dates', 'Note', 'Approve 1Approving 1 of 1…'])
    // A row with nothing to tick keeps its empty box cell on a card too, so every name in the list starts at one edge (finish fix 3).
    const empty = rowOf('Person b').querySelector('td[data-select]')!
    expect(empty).toBeEmptyDOMElement()
    expect(empty).not.toHaveClass('max-xl:hidden')
    expect(rowOf('Person b').querySelector('td[data-subject]')).toHaveClass('max-xl:max-w-[calc(100%-1.75rem)]')
    expect(screen.getByRole('checkbox', { name: 'Select leave: Person a' })).not.toBeChecked()
    expect(within(rowOf('Person b')).queryByRole('checkbox')).toBeNull()
    expect(screen.getByRole('checkbox', { name: 'Select all leave requests on this page' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Approve 1 leave request' })).toHaveTextContent('Approve 1')
  })

  it('draws no column and no bar where nothing is safe, or on a tab without a bulk action', () => {
    const { unmount } = render(<Harness model={model()} />)
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getAllByRole('columnheader')).toHaveLength(6)
    unmount()

    render(<Harness model={model({ key: 'incidents', rows: [tapRow('a')] })} />)
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Approve all|^Approve 1 / })).toBeNull()
  })

  it('counts every safe row in the whole tab for Complete all, not only the ten shown', () => {
    render(<Harness model={model({ count: 12, rows: Array.from({ length: 12 }, (_, i) => tapRow(String(i))) })} />)

    expect(screen.getAllByRole('checkbox', { name: /^Select leave/ })).toHaveLength(10)
    expect(screen.getByRole('button', { name: 'Approve all 12 leave requests' })).toHaveTextContent('Approve all 12')
  })

  /** The label a bulk button shows: its one visible span (the others are its width reserve). */
  const shownLabel = (el: Element) => [...el.querySelectorAll('[class*="grid-area"]')].find((s) => !s.classList.contains('invisible'))?.textContent
  const bulk = () => document.querySelector('[data-bulk-action]')!
  const headBox = (noun = 'leave requests') => screen.getByRole('checkbox', { name: `Select all ${noun} on this page` }) as HTMLInputElement
  const tapRows = (n: number, run?: (i: number) => () => Promise<ActionOutcome>) => Array.from({ length: n }, (_, i) => tapRow(String(i), run?.(i)))

  it("holds the select-all box and the bulk action in thead's first and last cells, and nothing outside the table", () => {
    render(<Harness model={model({ count: 3, rows: tapRows(3) })} />)

    const headRow = headBox().closest('thead')!.querySelector('tr')!
    expect(headBox().closest('th')).toBe(headRow.firstElementChild)
    expect(bulk().closest('th')).toBe(headRow.lastElementChild)
    expect(within(headRow).getByText('Select all')).toBeInTheDocument()
    expect(headBox().closest('thead')).not.toHaveClass('sr-only')
    for (const el of [...screen.getAllByRole('checkbox'), bulk()]) expect(el.closest('table')).not.toBeNull()
  })

  it('draws no visible header row on a tab without bulk', () => {
    const { unmount } = render(<Harness model={model({ key: 'incidents', rows: tapRows(2) })} />)
    expect(screen.getAllByRole('row')[0].closest('thead')).toHaveClass('sr-only')
    expect(document.querySelector('[data-bulk-action]')).toBeNull()
    unmount()

    render(<Harness model={model()} />)
    expect(screen.getAllByRole('row')[0].closest('thead')).toHaveClass('sr-only')
    expect(document.querySelector('[data-bulk-action]')).toBeNull()
  })

  it("ticks this page's tickable rows from the header box, and clears from mixed or ticked", () => {
    render(<Harness model={model({ count: 3, rows: tapRows(3) })} />)

    fireEvent.click(headBox())
    expect(screen.getAllByRole('checkbox', { name: /^Select leave/ }).every((box) => (box as HTMLInputElement).checked)).toBe(true)
    expect(bulk()).toHaveAccessibleName('Approve 3 selected leave requests')
    expect(shownLabel(bulk())).toBe('Approve 3')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select leave: Person 0' }))
    expect(headBox().indeterminate).toBe(true)
    fireEvent.click(headBox())
    expect(screen.getAllByRole('checkbox', { name: /^Select leave/ }).some((box) => (box as HTMLInputElement).checked)).toBe(false)
    expect(bulk()).toHaveAccessibleName('Approve all 3 leave requests')
  })

  it('offers every safe row in the tab once the page is ticked, then says all are selected', () => {
    render(<Harness model={model({ count: 23, rows: tapRows(23) })} />)

    fireEvent.click(headBox())
    expect(within(screen.getByRole('table')).getByText('All 10 on this page are selected.')).toBeInTheDocument()
    expect(status()).toHaveTextContent('All 10 on this page are selected.')
    fireEvent.click(screen.getByRole('button', { name: 'Select all 23 leave requests' }))
    expect(within(screen.getByRole('table')).getByText('All 23 leave requests are selected.')).toBeInTheDocument()
    expect(status()).toHaveTextContent('All 23 leave requests are selected.')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Clear selection' }))
    expect(bulk()).toHaveAccessibleName('Approve 23 selected leave requests')
    expect(shownLabel(bulk())).toBe('Approve 23')

    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(document.activeElement).toBe(headBox())
    expect(screen.getAllByRole('checkbox', { name: /^Select leave/ }).some((box) => (box as HTMLInputElement).checked)).toBe(false)
    expect(status()).toHaveTextContent(/^$/)
    // Tick, clear, tick: said again, through the empty sentence.
    fireEvent.click(headBox())
    fireEvent.click(headBox())
    expect(status()).toHaveTextContent(/^$/)
    fireEvent.click(headBox())
    expect(status()).toHaveTextContent('All 10 on this page are selected.')
  })

  it('runs all 23 in tab-wide mode, in row order', async () => {
    const runs = Array.from({ length: 23 }, (_, i) => ok(String(i)))
    render(<Harness model={model({ count: 23, rows: tapRows(23, (i) => runs[i]) })} />)

    fireEvent.click(headBox())
    fireEvent.click(screen.getByRole('button', { name: 'Select all 23 leave requests' }))
    fireEvent.click(bulk())
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Approve 23 selected leave requests?')
    confirmRun('Approve 23')

    await waitFor(() => expect(notice()).toHaveTextContent('Approved 23 leave requests'))
    for (const [i, run] of runs.entries()) {
      expect(run).toHaveBeenCalledTimes(1)
      if (i) expect(run.mock.invocationCallOrder[0]).toBeGreaterThan(runs[i - 1].mock.invocationCallOrder[0])
    }
  })

  it('treats tab-wide over 100 completions as Complete all', async () => {
    const approveBatch = vi.fn(async (ids: string[]) => ids.map((shiftId) => ({ shiftId, approved: true, code: null, message: null })))
    const review = (id: string): RowAction => ({ kind: 'link', label: 'Review', name: `Review shift: ${id}`, to: '/rostering/completions' })
    const rows = [...tapRows(134), ...Array.from({ length: 6 }, (_, i) => row(`f${i}`, { actions: [review(`f${i}`)] }))]
    render(<Harness model={model({ key: 'completions', noun: 'shift completions', count: 140, rows, approveBatch })} />)

    fireEvent.click(headBox('shift completions'))
    fireEvent.click(screen.getByRole('button', { name: 'Select all 134 clean completions' }))
    expect(within(screen.getByRole('table')).getByText('All 134 clean completions are selected. A run approves the first 100.')).toBeInTheDocument()
    expect(shownLabel(bulk())).toBe('Approve 100 of 134 clean')
    fireEvent.click(bulk())
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Approve the first 100 of 134 clean completions?')
    confirmRun('Approve 100')

    await waitFor(() => expect(approveBatch).toHaveBeenCalledTimes(1))
    expect(approveBatch).toHaveBeenCalledWith(Array.from({ length: 100 }, (_, i) => String(i)))
  })

  it("leaves tab-wide mode when a row is unticked, keeping the page's other ticks", () => {
    render(<Harness model={model({ count: 23, rows: tapRows(23) })} />)

    fireEvent.click(headBox())
    fireEvent.click(screen.getByRole('button', { name: 'Select all 23 leave requests' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select leave: Person 0' }))
    const boxes = screen.getAllByRole('checkbox', { name: /^Select leave/ }) as HTMLInputElement[]
    expect(boxes.map((box) => box.checked)).toEqual([false, ...Array(9).fill(true)])
    expect(bulk()).toHaveAccessibleName('Approve 9 selected leave requests')
    expect(within(screen.getByRole('table')).queryByText(/are selected\.$/)).toBeNull()
  })

  it('sends every safe row in the tab from Complete all at rest', async () => {
    const runs = Array.from({ length: 23 }, (_, i) => ok(String(i)))
    render(<Harness model={model({ count: 23, rows: tapRows(23, (i) => runs[i]) })} />)

    expect(bulk()).toHaveAccessibleName('Approve all 23 leave requests')
    fireEvent.click(bulk())
    confirmRun('Approve 23')

    await waitFor(() => expect(notice()).toHaveTextContent('Approved 23 leave requests'))
    expect(runs.every((run) => run.mock.calls.length === 1)).toBe(true)
  })

  it('tab-wide leaves an unconfirmed row out', async () => {
    const lost = vi.fn(async (): Promise<ActionOutcome> => { throw {} })
    const runs = Array.from({ length: 12 }, (_, i) => (i === 0 ? lost : ok(String(i))))
    const reread = vi.fn(async (): Promise<string[]> => { throw new Error('offline') })
    render(<Harness model={model({ count: 12, reread, readAt: 1, rows: tapRows(12, (i) => runs[i]) })} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select leave: Person 0' }))
    fireEvent.click(bulk())
    confirmRun('Approve 1')
    await waitFor(() => expect(notice()).toBeTruthy())

    fireEvent.click(headBox())
    expect(within(screen.getByRole('table')).getByText('All 9 on this page are selected.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Select all 11 leave requests' }))
    expect(within(screen.getByRole('table')).getByText('All 11 leave requests are selected.')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select leave: Person 0' })).not.toBeChecked()
    fireEvent.click(bulk())
    confirmRun('Approve 11')

    await waitFor(() => expect(runs[11]).toHaveBeenCalled())
    expect(lost).toHaveBeenCalledTimes(1)
    expect(within(screen.getByRole('table')).queryByText(/^All 0 /)).toBeNull()
    expect(document.querySelector('[data-bulk-action]')?.textContent ?? '').not.toMatch(/Approve 0/)
  })

  it('holds the header box, the banner button and the bulk button while a run goes', async () => {
    const first = deferred()
    render(<Harness model={model({ count: 23, rows: tapRows(23, (i) => (i === 0 ? () => first.promise : ok(String(i)))) })} />)
    fireEvent.click(headBox())
    fireEvent.click(screen.getByRole('button', { name: 'Select all 23 leave requests' }))
    fireEvent.click(bulk())
    confirmRun('Approve 23')

    await waitFor(() => expect(bulk()).toHaveAttribute('aria-disabled', 'true'))
    expect(headBox()).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Clear selection' })).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(headBox())
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(within(screen.getByRole('table')).getByText('All 23 leave requests are selected.')).toBeInTheDocument()
    await act(async () => first.resolve({ announce: 'Approved Person 0.' }))
  })

  it("keeps the bulk button's width: its reserve holds the rest and running labels", () => {
    render(<Harness model={model({ count: 23, rows: tapRows(23) })} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select leave: Person 0' }))

    expect(shownLabel(bulk())).toBe('Approve 1')
    const copies = [...bulk().querySelectorAll('[aria-hidden="true"]')].map((el) => el.textContent)
    expect(copies).toEqual(expect.arrayContaining(['Approve all 23', 'Approving 23 of 23…']))
    for (const el of bulk().querySelectorAll('[aria-hidden="true"]')) expect(el).toHaveClass('invisible', '[grid-area:1/1]')
  })

  it("unticks and disables a row's box while its form is open, and Complete all leaves it out", () => {
    render(<Harness model={model({ count: 2, rows: [tapRow('a'), tapRow('b')] })} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select leave: Person a' }))

    fireEvent.click(screen.getByRole('button', { name: 'Decline leave: Person a' }))

    expect(screen.getByRole('checkbox', { name: 'Select leave: Person a' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Select leave: Person a' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Approve 1 leave request' })).toBeInTheDocument()
  })

  it('runs the ticked rows one at a time in row order through their own taps, then ONE notice; decided rows leave together, a refused one stays', async () => {
    const first = deferred()
    const runA = vi.fn(() => first.promise)
    const runB = vi.fn(async (): Promise<ActionOutcome> => { throw axiosError('Somebody said no.') })
    const runC = ok('c')
    render(<Harness model={model({ count: 3, rows: [tapRow('a', runA), tapRow('b', runB), tapRow('c', runC)] })} />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all leave requests on this page' }))
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
    expect(screen.getByRole('checkbox', { name: 'Select all leave requests on this page' })).toHaveAttribute('aria-disabled', 'true')
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

    fireEvent.click(screen.getByRole('button', { name: 'Approve all 2 leave requests' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Approve 2 leave requests?')
    confirmRun('Approve 2')

    await waitFor(() => expect(notice()).toHaveTextContent('Approved 1 leave request'))
    expect(notice()).toHaveTextContent('1 was already decided by someone else.')
    expect(refetch).toHaveBeenCalledTimes(1)
  })
})

describe('QuickGroup — 10 a page (SHAPE §6)', () => {
  const ok = (id: string) => vi.fn(async (): Promise<ActionOutcome> => ({ announce: `Approved Person ${id}.` }))
  const tapRow = (id: string, run: () => Promise<ActionOutcome> = ok(id)) => row(id, { actions: [decline(id), approve(id, run)] })
  const many = (n: number, make: (id: string) => QuickRow = (id) => row(id)) => Array.from({ length: n }, (_, i) => make(String(i)))
  // The side column: matchMedia says the viewport is xl or wider.
  const side = () => vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(min-width: 80rem)', addEventListener() {}, removeEventListener() {} }))
  // jsdom has no scrolling: a page change in place scrolls the window.
  beforeEach(() => { vi.spyOn(window, 'scrollTo').mockImplementation(() => {}) })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
  const next = () => screen.getByRole('button', { name: 'Next page' })
  const previous = () => screen.getByRole('button', { name: 'Previous page' })
  const subjectsShown = () => bodyRows().map((tr) => tr.querySelector('td[data-subject] span')!.textContent)
  const stubHeight = (px: number) => Object.defineProperty(screen.getByRole('table'), 'offsetHeight', { configurable: true, get: () => px })
  const bulkName = () => document.querySelector('[data-bulk-action]')!.getAttribute('aria-label')

  it('pages 23 rows ten at a time', () => {
    render(<Harness model={model({ count: 23, rows: many(23) })} />)

    expect(bodyRows()).toHaveLength(10)
    expect(screen.getByText('Showing 1-10 of 23')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 3')).toHaveAttribute('aria-current', 'page')
    expect(previous()).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(next())
    expect(subjectsShown()).toEqual(Array.from({ length: 10 }, (_, i) => `Person ${i + 10}`))
    expect(screen.getByText('Showing 11-20 of 23')).toBeInTheDocument()
  })

  it('draws no pager at 10 rows or fewer', () => {
    render(<Harness model={model({ count: 10, rows: many(10) })} />)

    expect(bodyRows()).toHaveLength(10)
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull()
  })

  it('holds Next on the last page and keeps focus there, in the side column', () => {
    side()
    render(<Harness model={model({ count: 23, rows: many(23) })} />)
    fireEvent.click(next())
    fireEvent.click(next())

    expect(next()).toHaveAttribute('aria-disabled', 'true')
    expect(next()).not.toBeDisabled()
    next().focus()
    fireEvent.click(next())
    expect(document.activeElement).toBe(next())
    expect(subjectsShown()).toEqual(['Person 20', 'Person 21', 'Person 22'])
  })

  it("moves focus to the first row's first control after a page change, in place", () => {
    const scrollTo = vi.mocked(window.scrollTo)
    render(<Harness model={model({ count: 23, rows: many(23, (id) => tapRow(id)) })} />)

    fireEvent.click(next())
    expect(bodyRows()[0].closest('tbody')!.contains(document.activeElement)).toBe(true)
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'instant' }))
  })

  it("holds the outgoing page's height on a short last page, in the side column", () => {
    side()
    render(<Harness model={model({ count: 23, rows: many(23) })} />)
    fireEvent.click(next())
    stubHeight(640)
    fireEvent.click(next())

    expect(screen.getByRole('table').style.minHeight).toBe('640px')
  })

  it('a resize drops the held height', () => {
    side()
    render(<Harness model={model({ count: 23, rows: many(23) })} />)
    stubHeight(640)
    fireEvent.click(next())
    expect(screen.getByRole('table').style.minHeight).toBe('640px')

    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(screen.getByRole('table').style.minHeight).toBe('')
  })

  it('a returning row keeps the page and resets the hold', () => {
    side()
    const twenty = many(20)
    const { rerender } = render(<Harness model={model({ count: 20, rows: twenty })} />)
    stubHeight(640)
    fireEvent.click(next())
    expect(screen.getByRole('table').style.minHeight).toBe('640px')

    rerender(<Harness model={model({ count: 21, rows: [...twenty, row('20')] })} />)
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
    expect(screen.getByRole('table').style.minHeight).toBe('')
  })

  it('paging is held while a row is busy', () => {
    render(<Harness model={model({ count: 23, rows: many(23, (id) => tapRow(id)) })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Decline leave: Person 0' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } })

    expect(next()).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(next())
    expect(screen.getByText('Showing 1-10 of 23')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue('x')
  })

  it('clears a partial selection on a page change, and keeps tab-wide mode', () => {
    render(<Harness model={model({ count: 23, rows: many(23, (id) => tapRow(id)) })} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select leave: Person 0' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select leave: Person 1' }))
    fireEvent.click(next())

    expect(bulkName()).toBe('Approve all 23 leave requests')
    expect(screen.getAllByRole('checkbox', { name: /^Select leave/ }).some((box) => (box as HTMLInputElement).checked)).toBe(false)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all leave requests on this page' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select all 23 leave requests' }))
    fireEvent.click(next())
    expect(screen.getAllByRole('checkbox', { name: /^Select leave/ }).every((box) => (box as HTMLInputElement).checked)).toBe(true)
    expect(within(screen.getByRole('table')).getByText('All 23 leave requests are selected.')).toBeInTheDocument()
  })

  it('a tick that slides off the page is not counted or sent', async () => {
    const runs = new Map(Array.from({ length: 23 }, (_, i) => [String(i), ok(String(i))]))
    const all = many(23, (id) => tapRow(id, runs.get(id)))
    const { rerender } = render(<Harness model={model({ count: 23, rows: all })} />)
    fireEvent.click(next())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select leave: Person 10' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select leave: Person 11' }))
    expect(bulkName()).toBe('Approve 2 selected leave requests')

    // Person 0 leaves elsewhere: Person 10 moves up to page 1, out of sight.
    rerender(<Harness model={model({ count: 22, rows: all.slice(1) })} />)
    expect(bulkName()).toBe('Approve 1 selected leave request')
    fireEvent.click(document.querySelector('[data-bulk-action]')!)
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Approve 1' }))
    await waitFor(() => expect(document.querySelector('[data-quick-group] [role="status"] [data-tone]')).toBeTruthy())
    expect(runs.get('11')).toHaveBeenCalledTimes(1)
    expect(runs.get('10')).not.toHaveBeenCalled()
  })

  it("pulls row 11 up when page 1's tenth row is decided, and focuses its first button", async () => {
    render(<Harness model={model({ count: 23, rows: many(23, (id) => tapRow(id)) })} />)
    const tenth = screen.getByRole('button', { name: 'Approve leave: Person 9' })
    tenth.focus()

    fireEvent.click(tenth)

    await waitFor(() => expect(subjectsShown()[9]).toBe('Person 10'))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Decline leave: Person 10' }))
  })

  it('clamps to the page before when a run empties the last page, with focus in the run\'s notice', async () => {
    render(<Harness model={model({ count: 11, rows: many(11, (id) => tapRow(id)) })} />)
    fireEvent.click(next())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all leave requests on this page' }))
    fireEvent.click(document.querySelector('[data-bulk-action]')!)
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Approve 1' }))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull())
    expect(bodyRows()).toHaveLength(10)
    expect(document.activeElement!.closest('[role="status"] [data-tone]')).not.toBeNull()
  })

  it('says See all only when the server counts more than the group holds', () => {
    const { unmount } = render(<Harness model={model({ count: 30, rows: many(12) })} />)
    expect(screen.getByRole('link', { name: 'See all leave requests' })).toHaveTextContent(/^See all$/)
    unmount()

    render(<Harness model={model({ count: 12, rows: many(12) })} />)
    expect(screen.getByRole('link', { name: 'Open Leave' })).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
  })
})
