import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StaffChecklist } from './StaffChecklist'

const { mockApiPut } = vi.hoisted(() => ({ mockApiPut: vi.fn() }))
vi.mock('@/api/client', async orig => ({ ...(await orig<object>()), apiPut: mockApiPut }))

const CANDIDATES = ['Ava Hill', 'Ben Cole', 'Cara Dunn', 'Dev Rao', 'Eli Fox'].map((fullName, i) => ({ id: `s${i + 1}`, fullName }))

const onClose = vi.fn()
const onDone = vi.fn()

function renderChecklist(candidates = CANDIDATES) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <StaffChecklist tier="Backup" participantId="p5" participantName="Noah Fraser" candidates={candidates} onClose={onClose} onDone={onDone} />
    </QueryClientProvider>,
  )
}

const tick = async (user: ReturnType<typeof userEvent.setup>, ...names: string[]) => {
  for (const n of names) await user.click(screen.getByRole('checkbox', { name: n }))
}

beforeEach(() => {
  onClose.mockReset()
  onDone.mockReset()
  mockApiPut.mockReset().mockResolvedValue({})
})

describe('StaffChecklist', () => {
  it('names the panel and keeps the primary button disabled until someone is ticked', async () => {
    const user = userEvent.setup()
    renderChecklist()
    const dialog = screen.getByRole('dialog', { name: 'Add to Backup for Noah Fraser' })
    expect(within(dialog).getByText('Tick staff in the order you want them. They join the end of Backup.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Add as Backup' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: 'Ben Cole' }))
    expect(within(dialog).getByRole('button', { name: 'Add 1 as Backup' })).toBeEnabled()
  })

  it('shows the tick order and renumbers when one is unticked', async () => {
    const user = userEvent.setup()
    renderChecklist()
    await tick(user, 'Dev Rao', 'Ava Hill', 'Cara Dunn')
    expect(screen.getByTestId('tick-order-s4')).toHaveTextContent('1')
    expect(screen.getByTestId('tick-order-s1')).toHaveTextContent('2')
    expect(screen.getByTestId('tick-order-s3')).toHaveTextContent('3')
    await user.click(screen.getByRole('checkbox', { name: 'Dev Rao' }))
    expect(screen.getByTestId('tick-order-s1')).toHaveTextContent('1')
    expect(screen.getByTestId('tick-order-s3')).toHaveTextContent('2')
    expect(screen.queryByTestId('tick-order-s4')).not.toBeInTheDocument()
  })

  it('writes one person at a time in tick order, with no rank, then closes and reports the count', async () => {
    const user = userEvent.setup()
    const releases: Array<() => void> = []
    mockApiPut.mockImplementation(() => new Promise(resolve => releases.push(() => resolve({}))))
    renderChecklist()
    await tick(user, 'Cara Dunn', 'Ava Hill', 'Eli Fox')
    await user.click(screen.getByRole('button', { name: 'Add 3 as Backup' }))

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(mockApiPut).toHaveBeenLastCalledWith('/rostering/compatibility', { staffId: 's3', participantId: 'p5', level: 'Backup', reason: null })
    expect(screen.getByRole('button', { name: 'Adding 1 of 3…' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('checkbox', { name: 'Ava Hill' })).toBeDisabled()
    releases[0]()
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(2))
    expect(mockApiPut).toHaveBeenLastCalledWith('/rostering/compatibility', { staffId: 's1', participantId: 'p5', level: 'Backup', reason: null })
    releases[1]()
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(3))
    releases[2]()
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(3))
    expect(onClose).toHaveBeenCalled()
  })

  it('stays open on a failure: the added people go, the rest stay ticked, with the exact message and a retry', async () => {
    const user = userEvent.setup()
    mockApiPut
      .mockResolvedValueOnce({}).mockResolvedValueOnce({})
      .mockRejectedValueOnce({ response: { status: 400, data: { success: false, errors: ['Staff member is not active.'] } } })
    renderChecklist()
    await tick(user, 'Ava Hill', 'Ben Cole', 'Cara Dunn', 'Dev Rao', 'Eli Fox')
    await user.click(screen.getByRole('button', { name: 'Add 5 as Backup' }))

    expect(await screen.findByText("Added 2 of 5 as Backup. Couldn't add Cara Dunn, Dev Rao, Eli Fox: Staff member is not active.")).toBeInTheDocument()
    expect(mockApiPut).toHaveBeenCalledTimes(3)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('checkbox', { name: 'Ava Hill' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Cara Dunn' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Eli Fox' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Try 3 again' })).toBeEnabled()
  })

  it('filters by the search and says so when nobody matches', async () => {
    const user = userEvent.setup()
    renderChecklist()
    await user.type(screen.getByLabelText('Search staff'), 'ben')
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    await user.clear(screen.getByLabelText('Search staff'))
    await user.type(screen.getByLabelText('Search staff'), 'zzz')
    expect(screen.getByText('No staff match “zzz”.')).toBeInTheDocument()
  })

  it('says everyone is listed when no one is addable', () => {
    renderChecklist([])
    expect(screen.getByText('Everyone active is already listed or marked No.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add as Backup' })).toBeDisabled()
  })
})
