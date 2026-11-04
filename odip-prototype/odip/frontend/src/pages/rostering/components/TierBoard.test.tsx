import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CompatibilityRowDto } from '@/api/types'
import { TierBoard } from './TierBoard'

const { mockApiGet, mockApiPut, perms } = vi.hoisted(() => ({ mockApiGet: vi.fn(), mockApiPut: vi.fn(), perms: { canWrite: true } }))

vi.mock('@/lib/permissions', () => ({ usePermissions: () => perms }))
vi.mock('@/api/client', async orig => ({ ...(await orig<object>()), apiGet: mockApiGet, apiPut: mockApiPut }))

const STAFF = ['Ava Hill', 'Ben Cole', 'Cara Dunn', 'Dev Rao', 'Eli Fox', 'Fay Gray', 'Gus Holt', 'Hal Ives'].map((fullName, i) => ({ id: `s${i + 1}`, fullName, isActive: true }))
vi.mock('@/api/hooks', async orig => ({
  ...(await orig<object>()),
  useStaff: () => ({ data: STAFF, isLoading: false, isError: false, refetch: vi.fn() }),
}))

const row = (n: number, level: CompatibilityRowDto['level'], rank: number, reason: string | null = null): CompatibilityRowDto =>
  ({ staffId: `s${n}`, staffName: STAFF[n - 1].fullName, participantId: 'p5', participantName: 'Noah Fraser', level, rank, reason, updatedAt: '2026-10-01T00:00:00Z' })

let rows: CompatibilityRowDto[]
const onMarkNo = vi.fn()
const onEditNo = vi.fn()
const onRemoveNo = vi.fn()

function renderBoard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <TierBoard participantId="p5" participantName="Noah Fraser" onMarkNo={onMarkNo} onEditNo={onEditNo} onRemoveNo={onRemoveNo} />
    </QueryClientProvider>,
  )
}

const column = (name: string) => screen.getByRole('region', { name })

beforeEach(() => {
  perms.canWrite = true
  rows = [
    row(2, 'Preferred', 2),
    row(1, 'Preferred', 1, 'Knows the routine'),
    row(3, 'Backup', 1),
    row(5, 'Excluded', 0, 'Past conflict'),
  ]
  onMarkNo.mockReset(); onEditNo.mockReset(); onRemoveNo.mockReset()
  mockApiGet.mockReset().mockImplementation(async () => rows)
  mockApiPut.mockReset().mockResolvedValue({})
})

describe('TierBoard', () => {
  it('shows four columns with counts, ranked chips in order, reasons, and the empty lines', async () => {
    renderBoard()
    await screen.findByText('Knows the routine')
    for (const name of ['Preferred', 'Backup', 'Emergency', 'No']) expect(column(name)).toBeInTheDocument()
    const preferred = within(column('Preferred')).getAllByRole('listitem')
    expect(preferred.map(li => li.querySelector('[data-name]')?.textContent)).toEqual(['Ava Hill', 'Ben Cole'])
    expect(preferred[0].querySelector('[data-rank]')).toHaveTextContent('1')
    expect(column('Preferred').querySelector('[data-count]')).toHaveTextContent('2')
    expect(within(column('Emergency')).getByText('No emergency staff yet.')).toBeInTheDocument()
    expect(within(column('No')).getByText('Eli Fox')).toBeInTheDocument()
    expect(within(column('No')).getByText('Past conflict')).toBeInTheDocument()
    expect(document.querySelectorAll('select')).toHaveLength(0)
  })

  it('says nobody is marked No when the column is empty', async () => {
    rows = [row(1, 'Preferred', 1)]
    renderBoard()
    expect(await screen.findByText('No one is marked No.')).toBeInTheDocument()
  })

  it('changes a tier in two taps on the board (open the menu, pick Move to) and keeps the reason', async () => {
    const user = userEvent.setup()
    renderBoard()
    await screen.findByText('Knows the routine')
    await user.click(screen.getByRole('button', { name: 'Options for Ava Hill' }))
    await user.click(await screen.findByRole('option', { name: 'Move to Emergency' }))
    expect(mockApiPut).toHaveBeenCalledWith('/rostering/compatibility', { staffId: 's1', participantId: 'p5', level: 'Emergency', reason: 'Knows the routine' })
    expect(await screen.findByText('Ava Hill is now emergency #1.')).toBeInTheDocument()
  })

  it('offers Move up and Move down with the neighbouring rank, disabled at the ends', async () => {
    const user = userEvent.setup()
    renderBoard()
    await screen.findByText('Knows the routine')
    await user.click(screen.getByRole('button', { name: 'Options for Ava Hill' }))
    expect(await screen.findByRole('option', { name: 'Move up' })).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('option', { name: 'Move down' }))
    expect(mockApiPut).toHaveBeenCalledWith('/rostering/compatibility', { staffId: 's1', participantId: 'p5', level: 'Preferred', reason: 'Knows the routine', rank: 2 })
  })

  it('removes a person from the list by saving Allowed with no reason', async () => {
    const user = userEvent.setup()
    renderBoard()
    await screen.findByText('Knows the routine')
    await user.click(screen.getByRole('button', { name: 'Options for Cara Dunn' }))
    await user.click(await screen.findByRole('option', { name: 'Remove from list' }))
    expect(mockApiPut).toHaveBeenCalledWith('/rostering/compatibility', { staffId: 's3', participantId: 'p5', level: 'Allowed', reason: null })
    expect(await screen.findByText('Cara Dunn is no longer listed.')).toBeInTheDocument()
  })

  it('hands Mark No to the page: from a chip with the person, from the column foot with none', async () => {
    const user = userEvent.setup()
    renderBoard()
    await screen.findByText('Knows the routine')
    await user.click(screen.getByRole('button', { name: 'Options for Cara Dunn' }))
    await user.click(await screen.findByRole('option', { name: 'Mark No…' }))
    expect(onMarkNo).toHaveBeenLastCalledWith('s3')
    await user.click(screen.getByRole('button', { name: '+ Mark No' }))
    expect(onMarkNo).toHaveBeenLastCalledWith(null)
  })

  it('hands Edit reason and Remove No to the page from a No chip', async () => {
    const user = userEvent.setup()
    renderBoard()
    await screen.findByText('Past conflict')
    await user.click(screen.getByRole('button', { name: 'Options for Eli Fox' }))
    await user.click(await screen.findByRole('option', { name: 'Edit reason…' }))
    expect(onEditNo).toHaveBeenCalledWith(expect.objectContaining({ staffId: 's5' }))
    await user.click(screen.getByRole('button', { name: 'Options for Eli Fox' }))
    await user.click(await screen.findByRole('option', { name: 'Remove No…' }))
    expect(onRemoveNo).toHaveBeenCalledWith(expect.objectContaining({ staffId: 's5' }))
  })

  it('adds five people as Backup in 7 taps from the board: + Add, five ticks, submit', async () => {
    const user = userEvent.setup()
    rows = []
    renderBoard()
    await screen.findByText('No one is marked No.')
    let taps = 0
    const tap = async (el: HTMLElement) => { taps++; await user.click(el) }
    await tap(screen.getByRole('button', { name: 'Add to Backup' }))
    const dialog = await screen.findByRole('dialog')
    for (const n of ['Ava Hill', 'Ben Cole', 'Cara Dunn', 'Dev Rao', 'Eli Fox']) await tap(within(dialog).getByRole('checkbox', { name: n }))
    await tap(within(dialog).getByRole('button', { name: 'Add 5 as Backup' }))
    expect(taps).toBeLessThanOrEqual(8)
    expect(mockApiPut).toHaveBeenCalledTimes(5)
    expect(mockApiPut.mock.calls.map(c => c[1].staffId)).toEqual(['s1', 's2', 's3', 's4', 's5'])
    expect(await screen.findByText('Added 5 as Backup.')).toBeInTheDocument()
  })

  it('leaves the people who are already listed or marked No out of the checklist', async () => {
    const user = userEvent.setup()
    renderBoard()
    await screen.findByText('Knows the routine')
    await user.click(screen.getByRole('button', { name: 'Add to Emergency' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(8 - 4)
  })

  it('gives a reader plain chips: no menus, no Add buttons', async () => {
    perms.canWrite = false
    renderBoard()
    await screen.findByText('Knows the routine')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('Ava Hill')).toBeInTheDocument()
  })
})
