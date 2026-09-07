import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ClaimBatchesPage from './ClaimBatchesPage'

const { mockUseClaimBatches } = vi.hoisted(() => ({
  mockUseClaimBatches: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useClaimBatches: mockUseClaimBatches,
}))

function baseBatch(overrides: Record<string, unknown> = {}) {
  return {
    id: 'batch-1',
    fileName: 'PRODA_20260901_0001.txt',
    createdAt: '2026-09-01T10:00:00Z',
    submittedAt: null,
    eventCount: 3,
    totalAmount: 450.5,
    ...overrides,
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/billing/claim-batches']}>
      <Routes>
        <Route path="/billing/claim-batches" element={<ClaimBatchesPage />} />
        <Route path="/billing/claim-batches/:id" element={<div>Claim batch detail</div>} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
})

afterEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('ClaimBatchesPage', () => {
  it('renders rows from useClaimBatches', () => {
    mockUseClaimBatches.mockReturnValue({
      data: [baseBatch()],
      isLoading: false,
    })
    renderPage()

    expect(screen.getByText('PRODA_20260901_0001.txt')).toBeInTheDocument()
    expect(screen.getByText('Not submitted')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('shows an empty state when there are no claim batches', () => {
    mockUseClaimBatches.mockReturnValue({ data: [], isLoading: false })
    renderPage()

    expect(screen.getByText('No claim batches yet')).toBeInTheDocument()
  })

  it('shows an error message instead of the empty state when the fetch fails', () => {
    mockUseClaimBatches.mockReturnValue({ data: undefined, isLoading: false, isError: true })
    renderPage()

    expect(screen.getByText(/failed to load claim batches/i)).toBeInTheDocument()
    expect(screen.queryByText('No claim batches yet')).not.toBeInTheDocument()
  })

  it('links a row to the claim batch detail route', async () => {
    mockUseClaimBatches.mockReturnValue({
      data: [baseBatch()],
      isLoading: false,
    })
    renderPage()

    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    await user.click(screen.getByText('PRODA_20260901_0001.txt'))

    expect(await screen.findByText('Claim batch detail')).toBeInTheDocument()
  })
})
