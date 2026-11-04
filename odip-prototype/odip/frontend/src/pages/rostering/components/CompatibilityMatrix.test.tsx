import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CompatibilityRowDto } from '@/api/types'
import { useAllCompatibility } from '@/api/hooks'
import { CompatibilityMatrix } from './CompatibilityMatrix'

const { mockApiGet, mockApiPut } = vi.hoisted(() => ({ mockApiGet: vi.fn(), mockApiPut: vi.fn() }))
vi.mock('@/api/client', async orig => ({ ...(await orig<object>()), apiGet: mockApiGet, apiPut: mockApiPut }))

const PEOPLE = [
  { id: 'p1', fullName: 'Alex Rivera' },
  { id: 'p2', fullName: 'Jamie Chen' },
  { id: 'p3', fullName: 'Kit Doyle' },
]
const STAFF = [
  { id: 's1', fullName: 'Sam Taylor' },
  { id: 's2', fullName: 'Morgan Lee' },
  { id: 's3', fullName: 'Casey Wong' },
]
const nameOf = (list: { id: string; fullName: string }[], id: string) => list.find(x => x.id === id)?.fullName ?? id

function row(participantId: string, staffId: string, level: CompatibilityRowDto['level'], rank = 0, reason: string | null = null): CompatibilityRowDto {
  return { staffId, staffName: nameOf(STAFF, staffId), participantId, participantName: nameOf(PEOPLE, participantId), level, rank, reason, updatedAt: '2026-11-03T00:00:00Z' }
}

let rows: CompatibilityRowDto[]
const handlers = { markNo: vi.fn(), removeNo: vi.fn() }

function Harness({ canWrite = true, people = PEOPLE, staff = STAFF }: { canWrite?: boolean; people?: typeof PEOPLE; staff?: typeof STAFF }) {
  const all = useAllCompatibility()
  const [q, setQ] = useState('')
  const [sq, setSq] = useState('')
  if (!all.data) return null
  return (
    <CompatibilityMatrix
      rows={all.data} participants={people} staff={staff} canWrite={canWrite}
      participantQuery={q} onParticipantQuery={setQ} staffQuery={sq} onStaffQuery={setSq}
      onMarkNo={handlers.markNo} onRemoveNo={handlers.removeNo}
    />
  )
}
function renderMatrix(props: Parameters<typeof Harness>[0] = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><Harness {...props} /></QueryClientProvider>)
}

const cell = (p: string, s: string) => screen.getByRole('gridcell', { name: new RegExp(`^${p} and ${s}:`) })
const putCalls = () => mockApiPut.mock.calls.map(c => c[1])
const allRowGets = () => mockApiGet.mock.calls.filter(c => c[0] === '/rostering/compatibility').length

beforeEach(() => {
  rows = [
    row('p1', 's1', 'Preferred', 1, 'Knows the insulin routine'),
    row('p1', 's2', 'Backup', 1),
    row('p2', 's2', 'Excluded', 0, 'Past conflict'),
    row('p3', 's2', 'Excluded', 0, 'Left the team'),
    row('p3', 's3', 'Backup', 1),
  ]
  handlers.markNo.mockReset()
  handlers.removeNo.mockReset()
  mockApiGet.mockReset().mockImplementation(async () => rows.map(r => ({ ...r })))
  // Places a row last in its tier, like the server's PlaceAsync, and keeps the sent reason.
  mockApiPut.mockReset().mockImplementation(async (_url: string, body: { staffId: string; participantId: string; level: CompatibilityRowDto['level']; rank?: number | null; reason: string | null }) => {
    const prev = rows.find(r => r.staffId === body.staffId && r.participantId === body.participantId)
    const others = rows.filter(r => r.participantId === body.participantId && r.level === body.level && r !== prev)
    const next = row(body.participantId, body.staffId, body.level, ['Preferred', 'Backup', 'Emergency'].includes(body.level) ? (body.rank ?? others.length + 1) : 0, body.reason)
    rows = prev ? rows.map(r => (r === prev ? next : r)) : [...rows, next]
    return next
  })
})

describe('CompatibilityMatrix', () => {
  it('shows each pairing as a letter and rank, one tab stop for the whole grid', async () => {
    renderMatrix()
    await screen.findByRole('grid')
    expect(cell('Alex Rivera', 'Sam Taylor')).toHaveTextContent('P1')
    expect(cell('Alex Rivera', 'Morgan Lee')).toHaveTextContent('B1')
    expect(cell('Jamie Chen', 'Morgan Lee')).toHaveTextContent('No')
    expect(cell('Jamie Chen', 'Sam Taylor')).toHaveTextContent('·')
    expect(document.querySelectorAll('[role="gridcell"][tabindex="0"]')).toHaveLength(1)
    expect(cell('Alex Rivera', 'Sam Taylor')).toHaveAttribute('tabindex', '0')
  })

  it('renders 2,400 cells for 40 x 60 with exactly one tab stop', async () => {
    const people = Array.from({ length: 40 }, (_, i) => ({ id: `q${i}`, fullName: `Person ${String(i).padStart(2, '0')}` }))
    const staff = Array.from({ length: 60 }, (_, i) => ({ id: `t${i}`, fullName: `Worker ${String(i).padStart(2, '0')}` }))
    rows = []
    renderMatrix({ people, staff })
    await screen.findByRole('grid')
    expect(screen.getAllByRole('gridcell')).toHaveLength(2400)
    expect(document.querySelectorAll('[role="gridcell"][tabindex="0"]')).toHaveLength(1)
  })

  it('moves with the arrow keys, Home/End and Ctrl+End', async () => {
    const user = userEvent.setup()
    renderMatrix()
    await screen.findByRole('grid')
    cell('Alex Rivera', 'Sam Taylor').focus()
    await user.keyboard('{ArrowRight}{ArrowDown}{ArrowDown}')
    expect(document.activeElement).toBe(cell('Kit Doyle', 'Morgan Lee'))
    await user.keyboard('{End}')
    expect(document.activeElement).toBe(cell('Kit Doyle', 'Casey Wong'))
    await user.keyboard('{Control>}{Home}{/Control}')
    expect(document.activeElement).toBe(cell('Alex Rivera', 'Sam Taylor'))
    await user.keyboard('{Control>}{End}{/Control}')
    expect(document.activeElement).toBe(cell('Kit Doyle', 'Casey Wong'))
  })

  it('B on an Allowed cell sends one PUT with a null rank and no reason, and reads B(n+1)', async () => {
    const user = userEvent.setup()
    renderMatrix()
    await screen.findByRole('grid')
    cell('Alex Rivera', 'Casey Wong').focus()
    await user.keyboard('b')
    expect(cell('Alex Rivera', 'Casey Wong')).toHaveTextContent('B2')
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(putCalls()[0]).toEqual({ staffId: 's3', participantId: 'p1', level: 'Backup', rank: null, reason: null })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Casey Wong is now Backup #2'))
  })

  it('keeps the existing reason on a tier key, and Undo puts back level, rank and reason', async () => {
    const user = userEvent.setup()
    renderMatrix()
    await screen.findByRole('grid')
    cell('Alex Rivera', 'Sam Taylor').focus()
    await user.keyboard('b')
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(putCalls()[0]).toEqual({ staffId: 's1', participantId: 'p1', level: 'Backup', rank: null, reason: 'Knows the insulin routine' })
    expect(await screen.findByText(/If Sam Taylor is Alex Rivera’s preferred worker, this clears it\./)).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(2))
    expect(putCalls()[1]).toEqual({ staffId: 's1', participantId: 'p1', level: 'Preferred', rank: 1, reason: 'Knows the insulin routine' })
    await waitFor(() => expect(cell('Alex Rivera', 'Sam Taylor')).toHaveTextContent('P1'))
  })

  it('does nothing when the key matches the current tier', async () => {
    const user = userEvent.setup()
    renderMatrix()
    await screen.findByRole('grid')
    cell('Alex Rivera', 'Morgan Lee').focus()
    await user.keyboard('b')
    expect(mockApiPut).not.toHaveBeenCalled()
  })

  it('sends two quick presses one after the other, so the ranks differ', async () => {
    const user = userEvent.setup()
    renderMatrix()
    await screen.findByRole('grid')
    let release!: () => void
    const gate = new Promise<void>(res => { release = res })
    const original = mockApiPut.getMockImplementation()!
    mockApiPut.mockImplementationOnce(async (...args: unknown[]) => { await gate; return original(...(args as [string, never])) })

    cell('Jamie Chen', 'Sam Taylor').focus()
    await user.keyboard('b')
    await user.keyboard('{ArrowRight}{ArrowRight}')
    await user.keyboard('b')
    expect(cell('Jamie Chen', 'Sam Taylor')).toHaveTextContent('B1')
    expect(cell('Jamie Chen', 'Casey Wong')).toHaveTextContent('B2')
    // The second write has not started while the first is unresolved.
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    await new Promise(r => setTimeout(r, 60))
    expect(mockApiPut).toHaveBeenCalledTimes(1)
    release()
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(cell('Jamie Chen', 'Casey Wong')).toHaveTextContent('B2'))
    expect(rows.filter(r => r.participantId === 'p2' && r.level === 'Backup').map(r => r.rank).sort()).toEqual([1, 2])
  })

  it('opens the cell menu on Enter and sets a tier from it', async () => {
    const user = userEvent.setup()
    renderMatrix()
    await screen.findByRole('grid')
    cell('Jamie Chen', 'Sam Taylor').focus()
    await user.keyboard('{Enter}')
    const menu = await screen.findByRole('menu')
    await user.click(within(menu).getByRole('menuitemradio', { name: 'Emergency' }))
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(putCalls()[0]).toMatchObject({ staffId: 's1', participantId: 'p2', level: 'Emergency', rank: null })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('opens the Mark as No flow on N and Remove No on Delete, without writing', async () => {
    const user = userEvent.setup()
    renderMatrix()
    await screen.findByRole('grid')
    cell('Jamie Chen', 'Sam Taylor').focus()
    await user.keyboard('n')
    expect(handlers.markNo).toHaveBeenCalledWith('s1', 'p2')
    cell('Jamie Chen', 'Morgan Lee').focus()
    await user.keyboard('{Delete}')
    expect(handlers.removeNo).toHaveBeenCalledWith(expect.objectContaining({ staffId: 's2', participantId: 'p2', level: 'Excluded' }))
    // A tier key never clears a No.
    await user.keyboard('p')
    expect(mockApiPut).not.toHaveBeenCalled()
  })

  it('bulk sets a column to Backup one at a time, skips No cells, and refetches once', async () => {
    const user = userEvent.setup()
    renderMatrix()
    await screen.findByRole('grid')
    const gets = allRowGets()
    await user.click(screen.getByRole('button', { name: 'Options for Morgan Lee' }))
    await user.click(await screen.findByRole('option', { name: 'Set all shown to Preferred' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Set 1 pairing to Preferred for Morgan Lee?')
    expect(dialog).toHaveTextContent('2 marked No are skipped')
    await user.click(within(dialog).getByRole('button', { name: 'Set 1' }))
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Set 1 pairing to Preferred for Morgan Lee.'))
    expect(allRowGets()).toBe(gets + 1)
  })

  it('bulk sends the writes in sequence, with one refetch at the end, and says it clears a preferred worker', async () => {
    const user = userEvent.setup()
    rows = [row('p1', 's1', 'Preferred', 1, 'Keeps routine')]
    renderMatrix()
    await screen.findByRole('grid')
    const gets = allRowGets()
    await user.click(screen.getByRole('button', { name: 'Options for Sam Taylor' }))
    await user.click(await screen.findByRole('option', { name: 'Set all shown to Backup' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Set 3 pairings to Backup for Sam Taylor?')
    expect(dialog).toHaveTextContent('Up to 1 participant may lose their preferred worker.')
    await user.click(within(dialog).getByRole('button', { name: 'Set 3' }))
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(3))
    expect(putCalls().find(b => b.participantId === 'p1')).toMatchObject({ reason: 'Keeps routine', level: 'Backup', rank: null })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Set 3 pairings to Backup'))
    expect(allRowGets()).toBe(gets + 1)
    // The bulk menu offers no Mark No.
    await user.click(screen.getByRole('button', { name: 'Options for Sam Taylor' }))
    expect(screen.queryByRole('option', { name: /No/ })).not.toBeInTheDocument()
  })

  it('puts a failed cell back and offers Try again with the server words', async () => {
    const user = userEvent.setup()
    renderMatrix()
    await screen.findByRole('grid')
    mockApiPut.mockRejectedValueOnce({ response: { status: 400, data: { success: false, errors: ['Participant is not ready for booking or rostering.'] } } })
    cell('Jamie Chen', 'Sam Taylor').focus()
    await user.keyboard('e')
    expect(await screen.findByText('Participant is not ready for booking or rostering.')).toBeInTheDocument()
    await waitFor(() => expect(cell('Jamie Chen', 'Sam Taylor')).toHaveTextContent('·'))
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(2))
  })

  it('filters rows and columns and says when nothing matches', async () => {
    const user = userEvent.setup()
    renderMatrix()
    await screen.findByRole('grid')
    await user.type(screen.getByLabelText('Search participants'), 'zzz')
    expect(screen.getByText('No participants match “zzz”.')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Search participants'))
    await user.type(screen.getByLabelText('Search staff'), 'sam')
    expect(screen.getAllByRole('columnheader')).toHaveLength(2)
    await user.clear(screen.getByLabelText('Search staff'))
    await user.click(screen.getByRole('radio', { name: 'No Preferred yet' }))
    expect(screen.getAllByRole('rowheader')).toHaveLength(2)
  })

  it('gives a reader plain cells: no menus, keys do nothing', async () => {
    const user = userEvent.setup()
    renderMatrix({ canWrite: false })
    await screen.findByRole('grid')
    expect(screen.queryByRole('button', { name: /^Options for/ })).not.toBeInTheDocument()
    cell('Jamie Chen', 'Sam Taylor').focus()
    await user.keyboard('b{Enter}')
    expect(mockApiPut).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('pages the rows at 50 with Show all', async () => {
    const people = Array.from({ length: 60 }, (_, i) => ({ id: `q${i}`, fullName: `Person ${String(i).padStart(2, '0')}` }))
    const user = userEvent.setup()
    rows = []
    renderMatrix({ people })
    await screen.findByRole('grid')
    expect(screen.getAllByRole('rowheader')).toHaveLength(50)
    await user.click(screen.getByRole('button', { name: 'Show all 60' }))
    expect(screen.getAllByRole('rowheader')).toHaveLength(60)
  })

  // A PUT that waits for release(), like a slow network; the next PUT after it is the normal mock.
  function holdNextPut() {
    let release!: () => void
    const gate = new Promise<void>(res => { release = res })
    const original = mockApiPut.getMockImplementation()!
    mockApiPut.mockImplementationOnce(async (...args: unknown[]) => { await gate; return original(...(args as [string, never])) })
    return release
  }
  const settle = () => new Promise(r => setTimeout(r, 60))

  it('ignores Ctrl+Z while a write is in flight', async () => {
    const user = userEvent.setup()
    renderMatrix()
    await screen.findByRole('grid')
    cell('Alex Rivera', 'Casey Wong').focus()
    await user.keyboard('b')
    await screen.findByRole('button', { name: 'Undo' })
    const release = holdNextPut()
    await user.keyboard('e')
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    await user.keyboard('{Control>}z{/Control}')
    release()
    await settle()
    expect(mockApiPut).toHaveBeenCalledTimes(2)
  })

  it('shows E, never B, on a cell written B then E while the first save finishes', async () => {
    const user = userEvent.setup()
    renderMatrix()
    await screen.findByRole('grid')
    const release1 = holdNextPut()
    const release2 = holdNextPut()
    cell('Jamie Chen', 'Sam Taylor').focus()
    await user.keyboard('b')
    await user.keyboard('e')
    expect(cell('Jamie Chen', 'Sam Taylor')).toHaveTextContent('E1')
    release1()
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(2))
    await settle()
    expect(cell('Jamie Chen', 'Sam Taylor')).toHaveTextContent('E1')
    release2()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('is now Emergency #1'))
    expect(cell('Jamie Chen', 'Sam Taylor')).toHaveTextContent('E1')
  })

  it('moves focus into the menu, onto the checked tier, and back to the cell on Escape', async () => {
    const user = userEvent.setup()
    const outer = vi.fn()
    document.addEventListener('keydown', outer)
    renderMatrix()
    await screen.findByRole('grid')
    cell('Alex Rivera', 'Morgan Lee').focus()
    await user.keyboard('{Enter}')
    const backup = await screen.findByRole('menuitemradio', { name: 'Backup' })
    expect(backup).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: 'Preferred' })).toHaveAttribute('aria-checked', 'false')
    await waitFor(() => expect(document.activeElement).toBe(backup))
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Emergency' }))
    outer.mockClear()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(outer).not.toHaveBeenCalled()
    await waitFor(() => expect(document.activeElement).toBe(cell('Alex Rivera', 'Morgan Lee')))
    document.removeEventListener('keydown', outer)
  })

  it('opens the menu above a cell near the bottom of the screen', async () => {
    const user = userEvent.setup()
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 200 })
    try {
      renderMatrix()
      await screen.findByRole('grid')
      const c = cell('Jamie Chen', 'Sam Taylor')
      c.getBoundingClientRect = () => ({ top: 716, bottom: 760, left: 100, right: 156, width: 56, height: 44, x: 100, y: 716, toJSON: () => ({}) })
      c.focus()
      await user.keyboard('{Enter}')
      const menu = await screen.findByRole('menu')
      expect(menu.style.top).toBe('512px')
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', original)
    }
  })

  it('has one tab stop for the whole grid, and reaches the header buttons by arrow keys', async () => {
    const user = userEvent.setup()
    renderMatrix()
    const grid = await screen.findByRole('grid')
    expect(grid.querySelectorAll('[tabindex="0"], button:not([tabindex="-1"]), a[href], input, select, textarea')).toHaveLength(1)
    cell('Alex Rivera', 'Sam Taylor').focus()
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Options for Sam Taylor' }))
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(cell('Alex Rivera', 'Sam Taylor'))
    await user.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Options for Alex Rivera' }))
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(cell('Alex Rivera', 'Sam Taylor'))
  })

  it('writes the singular for one pairing: "1 marked No is skipped", "1 already Backup stays"', async () => {
    const user = userEvent.setup()
    renderMatrix()
    await screen.findByRole('grid')
    await user.click(screen.getByRole('button', { name: 'Options for Kit Doyle' }))
    await user.click(await screen.findByRole('option', { name: 'Set all shown to Backup' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('1 marked No is skipped.')
    expect(dialog).toHaveTextContent('1 already Backup stays as it is.')
  })

  it('writes the plural for several: "2 already Backup stay as they are"', async () => {
    const user = userEvent.setup()
    rows = [row('p1', 's1', 'Backup', 1), row('p1', 's2', 'Backup', 2)]
    renderMatrix()
    await screen.findByRole('grid')
    await user.click(screen.getByRole('button', { name: 'Options for Alex Rivera' }))
    await user.click(await screen.findByRole('option', { name: 'Set all shown to Backup' }))
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('2 already Backup stay as they are.')
  })

  it('offers the Undo the page hands over, and sends its writes', async () => {
    const user = userEvent.setup()
    const noUndo = { message: 'Marked No: Sam Taylor and Jamie Chen.', writes: [{ staffId: 's1', participantId: 'p2', level: 'Backup' as const, rank: 1, reason: null }] }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    function WithOffer() {
      const all = useAllCompatibility()
      if (!all.data) return null
      return <CompatibilityMatrix rows={all.data} participants={PEOPLE} staff={STAFF} canWrite participantQuery="" onParticipantQuery={() => {}} staffQuery="" onStaffQuery={() => {}} onMarkNo={() => {}} onRemoveNo={() => {}} noUndo={noUndo} />
    }
    render(<QueryClientProvider client={qc}><WithOffer /></QueryClientProvider>)
    await screen.findByRole('grid')
    expect(screen.getByRole('status')).toHaveTextContent('Marked No: Sam Taylor and Jamie Chen.')
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(putCalls()[0]).toEqual(noUndo.writes[0])
  })

  it('says so when nothing is set yet', async () => {
    rows = []
    renderMatrix()
    expect(await screen.findByText('No pairings set yet. Pick a cell to set one.')).toBeInTheDocument()
  })
})
