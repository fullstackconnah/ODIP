import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { ROW_ACTIONS_CARD } from '@/components/tapArea'
import { QuickGroup } from './QuickGroup'
import { useDecisionState } from './useDecisionState'
import type { ActionOutcome, GroupModel, QuickForm, QuickRow, RowAction } from './quickGroup'

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
  ({ id, subject: `Person ${id}`, meta: ['Annual leave', null, '5 days'], flags: [], actions: [], ...o })
const model = (o: Partial<GroupModel> = {}): GroupModel => ({
  key: 'leave', title: 'Leave', noun: 'leave requests', phase: 'ready', refetch: vi.fn(), count: 2,
  rows: [row('a'), row('b')], link: { to: '/rostering/leave', openLabel: 'Open Leave' }, ...o,
})
const status = () => screen.getAllByRole('status').find((el) => el.classList.contains('sr-only'))!
const axiosError = (message: string) => ({ response: { data: { message } } })

describe('QuickGroup — the heading line', () => {
  it('names the group in an h3 with its count in a neutral pill, and opens the full page by name when every row is shown', () => {
    render(<Harness model={model()} />)

    expect(screen.getByRole('heading', { level: 3, name: 'Leave' })).toBeInTheDocument()
    expect(screen.getByText('2')).toHaveClass('tabular-nums')
    const link = screen.getByRole('link', { name: 'Open Leave' })
    expect(link).toHaveAttribute('href', '/rostering/leave')
    expect(link).toHaveClass('pointer-coarse:inline-flex', 'min-h-[var(--tap-min)]')
  })

  it('shows five rows and says "See all" (no number) when there are more, naming the group for a screen reader', () => {
    render(<Harness model={model({ count: 7, rows: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => row(id)) })} />)

    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    const link = screen.getByRole('link', { name: 'See all leave requests' })
    expect(link.textContent).toBe('See all')
    expect(screen.getByText('7')).toBeInTheDocument()
  })
})

describe('QuickGroup — a row', () => {
  it('joins its facts with middots, dropping the empty ones, and draws at most two flags, each a word', () => {
    const flags = [{ label: '1 incident', tone: 'danger' as const }, { label: 'Outlier time', tone: 'warning' as const }, { label: 'Manual start', tone: 'warning' as const }]
    render(<Harness model={model({ count: 1, rows: [row('a', { flags })] })} />)

    expect(screen.getByText('Annual leave · 5 days')).toBeInTheDocument()
    // Subject and facts truncate on a narrow row; the full text stays in the tooltip.
    expect(screen.getByText('Person a')).toHaveAttribute('title', 'Person a')
    expect(screen.getByText('Annual leave · 5 days')).toHaveAttribute('title', 'Annual leave · 5 days')
    expect(screen.getByText('1 incident')).toBeInTheDocument()
    expect(screen.getByText('Outlier time')).toBeInTheDocument()
    expect(screen.queryByText('Manual start')).not.toBeInTheDocument()
  })

  it('puts its buttons in the house row-action cluster: 44px on a phone card, a wider gap on touch, the one-tap action last and primary', () => {
    render(<Harness model={model({ count: 1, rows: [row('a', { actions: [decline('a'), approve('a', vi.fn())] })] })} />)

    const buttons = within(screen.getByRole('listitem')).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['Decline', 'Approve'])
    expect(buttons[0].parentElement!.className).toContain(ROW_ACTIONS_CARD)
    expect(buttons[0].parentElement).toHaveClass('gap-1.5', 'pointer-coarse:gap-2')
    expect(buttons[1].className).toContain('bg-[var(--color-primary)]')
    expect(buttons[0].className).not.toContain('bg-[var(--color-primary)]')
    expect(screen.getByRole('listitem').innerHTML).not.toContain('44px')
  })

  it('names every button with its row, so a screen reader never hears "Approve" ten times', () => {
    render(<Harness model={model({ count: 1, rows: [row('a', { actions: [decline('a'), approve('a', vi.fn())] })] })} />)

    expect(screen.getByRole('button', { name: 'Approve leave: Person a' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Decline leave: Person a' })).toBeInTheDocument()
  })
})

describe('QuickGroup — waiting and failed', () => {
  it('shows an en dash, busy, and one loading line while its request waits: no rows, never clear', () => {
    render(<Harness model={model({ phase: 'loading', rows: [], count: 0 })} />)

    const pill = screen.getByText('Loading', { selector: '.sr-only' }).parentElement!
    expect(pill).toHaveAttribute('aria-busy', 'true')
    expect(pill).toHaveTextContent('–')
    expect(screen.getByText('Loading leave requests…')).toBeInTheDocument()
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })

  it('says it could not load, with a Try again that refetches, and keeps the link to the full page', () => {
    const refetch = vi.fn()
    render(<Harness model={model({ phase: 'error', rows: [], count: 0, refetch })} />)

    expect(screen.getByText("Couldn't load leave requests.")).toBeInTheDocument()
    expect(screen.getByText("Couldn't load", { selector: '.sr-only' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again: leave requests' }))
    expect(refetch).toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'Open Leave' })).toBeInTheDocument()
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

  it('takes the row away at once on success, drops the pill by one and announces the sentence', async () => {
    render(<Harness model={model({ rows: [row('a', { actions: [approve('a', async () => ({ announce: "Approved Person a's leave." }))] }), row('b')] })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Approve leave: Person a' }))

    await waitFor(() => expect(screen.queryByText('Person a')).not.toBeInTheDocument())
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(status()).toHaveTextContent("Approved Person a's leave.")
  })

  it("keeps the row on a refusal, says the server's words under it, and leaves focus on the button", async () => {
    const run = vi.fn(async () => { throw axiosError('This request has already been decided.') })
    render(<Harness model={model({ rows: [row('a', { actions: [approve('a', run)] })], count: 1 })} />)

    const button = screen.getByRole('button', { name: 'Approve leave: Person a' })
    button.focus()
    fireEvent.click(button)

    expect(await screen.findByRole('alert')).toHaveTextContent('This request has already been decided.')
    expect(screen.getByText('Person a')).toBeInTheDocument()
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
    const list = screen.getByRole('list')
    expect(list.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(status()).toHaveTextContent('')
  })

  it('stays, without its pill, while a notice is held after its last row has left', async () => {
    const notice = { title: 'Person a', message: 'Leave approved. It overlaps 1 shift, and it has a cover task.', link: { label: 'Open roster', to: '/rostering' } }
    render(<Harness model={model({ count: 1, rows: [row('a', { actions: [approve('a', async () => ({ notice }))] })] })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Approve leave: Person a' }))

    await screen.findByText(notice.message)
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Leave' })).toBeInTheDocument()
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

  it('opens a form under the row from a disclosure button, and moves focus into its field', () => {
    render(<Harness model={model({ count: 1, rows: [row('a', { actions: [decline('a')] })] })} />)

    const opener = screen.getByRole('button', { name: 'Decline leave: Person a' })
    expect(opener).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(opener)

    expect(opener).toHaveAttribute('aria-expanded', 'true')
    const form = document.getElementById(opener.getAttribute('aria-controls')!)!
    expect(form.tagName).toBe('FORM')
    expect(screen.getByRole('listitem')).toContainElement(form)
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

describe('QuickGroup — focus when a row leaves (SHAPE §10)', () => {
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

  it("moves focus to the group's link when the last row leaves", async () => {
    render(<Harness model={model({ count: 2, rows: [
      row('a', { actions: [approve('a', async () => ({ announce: 'Approved Person a.' }))] }),
      row('b', { actions: [approve('b', async () => ({ announce: 'Approved Person b.' }))] }),
    ] })} />)
    const last = screen.getByRole('button', { name: 'Approve leave: Person b' })
    last.focus()

    fireEvent.click(last)

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Open Leave' })))
  })
})
