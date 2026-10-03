import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PatternsPage from './PatternsPage'
import type { ShiftPatternDto } from '@/api/types'

// Activating and deactivating a pattern is a PUT the readiness gate can refuse. In Enforce mode the API answers 400
// "Participant is not ready for booking or rostering."; the page used to swallow it (the activate had no error handler at all and
// the deactivate was an unhandled rejection), so the click simply seemed to do nothing.
const { mockUsePatterns, mockUpdateMutate, mockUpdateMutateAsync } = vi.hoisted(() => ({
  mockUsePatterns: vi.fn(),
  mockUpdateMutate: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
}))

vi.mock('@/lib/permissions', () => ({
  usePermissions: () => ({ canWrite: true }),
}))

// The slide-over and the generate dialog (both mounted by the page, closed) call these hooks on every render.
vi.mock('@/api/hooks', () => ({
  usePatterns: mockUsePatterns,
  useUpdatePattern: () => ({ mutate: mockUpdateMutate, mutateAsync: mockUpdateMutateAsync, isPending: false }),
  useParticipants: () => ({ data: [{ id: 'participant-1', fullName: 'Mia Chen' }] }),
  useStaff: () => ({ data: [{ id: 'staff-1', fullName: 'Alex Rivera' }] }),
  useCreatePattern: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeletePattern: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useGeneratePattern: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

const NOT_READY_MESSAGE = 'Participant is not ready for booking or rostering.'

function makePattern(overrides: Partial<ShiftPatternDto> = {}): ShiftPatternDto {
  return {
    id: 'pattern-1',
    participantId: 'participant-1',
    participantName: 'Mia Chen',
    defaultStaffId: 'staff-1',
    defaultStaffName: 'Alex Rivera',
    dayOfWeek: 'Monday',
    startTime: '09:00:00',
    endTime: '17:00:00',
    endsNextDay: false,
    ratio: 'OneToOne',
    nightType: 'None',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    isActive: true,
    notes: 'Weekly respite',
    ...overrides,
  }
}

/** The write fields PatternsPage round-trips through update, with only `isActive` flipped. */
function fullPayload(p: ShiftPatternDto, isActive: boolean) {
  return {
    participantId: p.participantId,
    defaultStaffId: p.defaultStaffId,
    dayOfWeek: p.dayOfWeek,
    startTime: p.startTime,
    endTime: p.endTime,
    endsNextDay: p.endsNextDay,
    ratio: p.ratio,
    nightType: p.nightType,
    effectiveFrom: p.effectiveFrom,
    effectiveTo: p.effectiveTo,
    isActive,
    notes: p.notes,
  }
}

/** What axios rejects with for a 400 carrying the API's ApiResponse envelope. */
function badRequest(...errors: string[]) {
  return { response: { status: 400, data: { success: false, errors } } }
}

beforeEach(() => {
  mockUsePatterns.mockReset()
  mockUpdateMutate.mockReset()
  mockUpdateMutateAsync.mockReset()
})

describe('PatternsPage — activating a pattern the server refuses', () => {
  it('shows the server\'s own message, not a generic line, and sent the full body', async () => {
    const user = userEvent.setup()
    const pattern = makePattern({ isActive: false })
    mockUsePatterns.mockReturnValue({ data: [pattern], isLoading: false, isError: false, refetch: vi.fn() })
    mockUpdateMutate.mockImplementation((_vars: unknown, opts?: { onError?: (e: unknown) => void }) => opts?.onError?.(badRequest(NOT_READY_MESSAGE)))
    render(<PatternsPage />)

    await user.click(screen.getByRole('button', { name: "Activate Mia Chen's Monday pattern" }))

    expect(mockUpdateMutate).toHaveBeenCalledTimes(1)
    expect(mockUpdateMutate).toHaveBeenCalledWith(
      { id: 'pattern-1', data: fullPayload(pattern, true) },
      expect.objectContaining({ onError: expect.any(Function) }),
    )
    const message = await screen.findByText(NOT_READY_MESSAGE)
    expect(message.closest('[role="alert"]')).not.toBeNull()
    expect(screen.queryByText(/something went wrong activating/i)).not.toBeInTheDocument()
  })

  it('falls back to the generic line when the failure carries no message', async () => {
    const user = userEvent.setup()
    mockUsePatterns.mockReturnValue({ data: [makePattern({ isActive: false })], isLoading: false, isError: false, refetch: vi.fn() })
    mockUpdateMutate.mockImplementation((_vars: unknown, opts?: { onError?: (e: unknown) => void }) => opts?.onError?.(new Error('Network Error')))
    render(<PatternsPage />)

    await user.click(screen.getByRole('button', { name: "Activate Mia Chen's Monday pattern" }))

    expect(await screen.findByText('Something went wrong activating this pattern. Please try again.')).toBeInTheDocument()
    expect(screen.queryByText(NOT_READY_MESSAGE)).not.toBeInTheDocument()
  })

  it('can be dismissed, and is cleared when the next toggle starts', async () => {
    const user = userEvent.setup()
    mockUsePatterns.mockReturnValue({ data: [makePattern({ isActive: false })], isLoading: false, isError: false, refetch: vi.fn() })
    mockUpdateMutate.mockImplementationOnce((_vars: unknown, opts?: { onError?: (e: unknown) => void }) => opts?.onError?.(badRequest(NOT_READY_MESSAGE)))
    render(<PatternsPage />)

    await user.click(screen.getByRole('button', { name: "Activate Mia Chen's Monday pattern" }))
    expect(await screen.findByText(NOT_READY_MESSAGE)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Dismiss error' }))
    expect(screen.queryByText(NOT_READY_MESSAGE)).not.toBeInTheDocument()

    mockUpdateMutate.mockImplementationOnce((_vars: unknown, opts?: { onError?: (e: unknown) => void }) => opts?.onError?.(badRequest(NOT_READY_MESSAGE)))
    await user.click(screen.getByRole('button', { name: "Activate Mia Chen's Monday pattern" }))
    expect(await screen.findByText(NOT_READY_MESSAGE)).toBeInTheDocument()
    // The next attempt (this one goes through) clears the old message at the start.
    await user.click(screen.getByRole('button', { name: "Activate Mia Chen's Monday pattern" }))
    expect(screen.queryByText(NOT_READY_MESSAGE)).not.toBeInTheDocument()
  })
})

describe('PatternsPage — deactivating a pattern the server refuses', () => {
  it('shows the server\'s own message on the page, closes the confirm so the message is not behind it, and sent the full body', async () => {
    const user = userEvent.setup()
    const pattern = makePattern({ isActive: true })
    mockUsePatterns.mockReturnValue({ data: [pattern], isLoading: false, isError: false, refetch: vi.fn() })
    mockUpdateMutateAsync.mockRejectedValueOnce(badRequest(NOT_READY_MESSAGE))
    render(<PatternsPage />)

    await user.click(screen.getByRole('button', { name: "Deactivate Mia Chen's Monday pattern" }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Deactivate' }))

    expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockUpdateMutateAsync).toHaveBeenCalledWith({ id: 'pattern-1', data: fullPayload(pattern, false) })
    expect(await screen.findByText(NOT_READY_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByText(/something went wrong deactivating/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('falls back to the generic line when the failure carries no message', async () => {
    const user = userEvent.setup()
    mockUsePatterns.mockReturnValue({ data: [makePattern({ isActive: true })], isLoading: false, isError: false, refetch: vi.fn() })
    mockUpdateMutateAsync.mockRejectedValueOnce({ response: { status: 500, data: {} } })
    render(<PatternsPage />)

    await user.click(screen.getByRole('button', { name: "Deactivate Mia Chen's Monday pattern" }))
    await user.click(screen.getByRole('button', { name: 'Deactivate' }))

    expect(await screen.findByText('Something went wrong deactivating this pattern. Please try again.')).toBeInTheDocument()
    expect(screen.queryByText(NOT_READY_MESSAGE)).not.toBeInTheDocument()
  })

  it('closes the confirm and shows no error when the deactivate succeeds', async () => {
    const user = userEvent.setup()
    mockUsePatterns.mockReturnValue({ data: [makePattern({ isActive: true })], isLoading: false, isError: false, refetch: vi.fn() })
    mockUpdateMutateAsync.mockResolvedValueOnce(makePattern({ isActive: false }))
    render(<PatternsPage />)

    await user.click(screen.getByRole('button', { name: "Deactivate Mia Chen's Monday pattern" }))
    await user.click(screen.getByRole('button', { name: 'Deactivate' }))

    expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

// Plan builder phase D: the patterns an approved agreement made are in the list like any other, badged with the version they came from and with what they ask of a worker.
describe('PatternsPage — patterns made by an agreement', () => {
  const agreement = (overrides: Partial<ShiftPatternDto> = {}) => makePattern({
    id: 'pattern-agreement', dayOfWeek: 'Tuesday', notes: 'From agreement v2: Community access, community',
    sourceDraftId: 'draft-2', sourceBlockKey: 'mornings', sourceDraftVersion: 2, workerSlot: 1, requirements: { workerGender: 'Female', driver: true, skills: ['FirstAid', 'ManualHandling'] },
    ...overrides,
  })

  it('badges a pattern with the version of the agreement it came from, and shows what it asks of a worker, on its own row', () => {
    mockUsePatterns.mockReturnValue({ data: [agreement(), makePattern({ id: 'pattern-hand', dayOfWeek: 'Wednesday' })], isLoading: false, isError: false, refetch: vi.fn() })
    render(<PatternsPage />)

    const row = screen.getByText('From agreement v2').closest('tr')!
    expect(row).toHaveTextContent('Tuesday')
    const chips = within(row).getByRole('list', { name: 'Asks for' })
    expect(within(chips).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Female worker', 'Driver', 'First aid', 'Manual handling'])
    // the hand-made pattern beside it has no badge and no chips
    const handMade = screen.getAllByRole('row').find(r => r.textContent?.includes('Wednesday'))!
    expect(within(handMade).queryByText(/From agreement/)).not.toBeInTheDocument()
    expect(within(handMade).queryByRole('list', { name: 'Asks for' })).not.toBeInTheDocument()
  })

  it('says "an agreement" when the revision is not known, and draws no chips for a pattern that asks for nothing', () => {
    mockUsePatterns.mockReturnValue({ data: [agreement({ sourceDraftVersion: undefined, requirements: { workerGender: 'NoPreference', driver: false, skills: [] } })], isLoading: false, isError: false, refetch: vi.fn() })
    render(<PatternsPage />)

    expect(screen.getByText('From an agreement')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Asks for' })).not.toBeInTheDocument()
  })

  it('deactivates an agreement pattern with the fields the page always sends and none of its source: nothing about it is locked', async () => {
    const user = userEvent.setup()
    mockUsePatterns.mockReturnValue({ data: [agreement()], isLoading: false, isError: false, refetch: vi.fn() })
    mockUpdateMutateAsync.mockResolvedValue({})
    render(<PatternsPage />)

    await user.click(screen.getByRole('button', { name: /Deactivate Mia Chen's Tuesday pattern/ }))
    await user.click(screen.getByRole('button', { name: 'Deactivate' }))

    expect(mockUpdateMutateAsync).toHaveBeenCalledWith({ id: 'pattern-agreement', data: fullPayload(agreement(), false) })
  })
})
