import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ClaimBatchBuilderPage from './ClaimBatchBuilderPage'
import type { BillableEventDto } from '@/api/types'

const {
  mockUseBillableEvents,
  mockUseValidateClaimBatch,
  mockUseCreateClaimBatch,
  mockUseParticipants,
  mockValidateMutate,
  mockCreateMutate,
  mockNavigate,
} = vi.hoisted(() => ({
  mockUseBillableEvents: vi.fn(),
  mockUseValidateClaimBatch: vi.fn(),
  mockUseCreateClaimBatch: vi.fn(),
  mockUseParticipants: vi.fn(),
  mockValidateMutate: vi.fn(),
  mockCreateMutate: vi.fn(),
  mockNavigate: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useBillableEvents: mockUseBillableEvents,
  useValidateClaimBatch: mockUseValidateClaimBatch,
  useCreateClaimBatch: mockUseCreateClaimBatch,
  useParticipants: mockUseParticipants,
}))

vi.mock('@/lib/permissions', () => ({
  usePermissions: () => ({ canWrite: true }),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

function makeEvent(overrides: Partial<BillableEventDto> = {}): BillableEventDto {
  return {
    id: 'evt-1',
    participantId: 'p1',
    participantName: 'Sophie Brown',
    stream: 'NDIS',
    supportItemNumber: '01_002_0107_1_1',
    dayType: 'Weekday',
    supportsDeliveredFrom: '2026-08-01',
    supportsDeliveredTo: '2026-08-01',
    hours: 2,
    quantity: null,
    totalAmount: 150,
    claimReference: null,
    status: 'Draft',
    ...overrides,
  } as BillableEventDto
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<ClaimBatchBuilderPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockUseBillableEvents.mockReset()
  mockUseValidateClaimBatch.mockReset()
  mockUseCreateClaimBatch.mockReset()
  mockUseParticipants.mockReset()
  mockValidateMutate.mockReset()
  mockCreateMutate.mockReset()
  mockNavigate.mockReset()

  mockUseParticipants.mockReturnValue({ data: [], isLoading: false })
  mockUseBillableEvents.mockReturnValue({
    data: [makeEvent()],
    isLoading: false,
    isFetching: false,
    isError: false,
  })
  mockUseValidateClaimBatch.mockReturnValue({
    mutate: mockValidateMutate,
    isPending: false,
    isError: false,
  })
  mockUseCreateClaimBatch.mockReturnValue({
    mutate: mockCreateMutate,
    isPending: false,
    isError: false,
  })
})

describe('ClaimBatchBuilderPage', () => {
  it('navigates to the registered claim-batch detail route after create', async () => {
    const user = userEvent.setup()

    mockValidateMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess([])
    })
    mockCreateMutate.mockImplementation((_vars, { onSuccess }) => {
      onSuccess({ id: 'batch-42' })
    })

    renderPage()

    await user.click(screen.getByRole('checkbox', { name: 'Select all rows' }))
    await user.click(screen.getByRole('button', { name: /validate selection/i }))
    await user.click(screen.getByRole('button', { name: /^create claim batch$/i }))
    await user.click(screen.getByRole('button', { name: /^create batch$/i }))

    expect(mockNavigate).toHaveBeenCalledWith('/billing/claim-batches/batch-42')
  })
})
