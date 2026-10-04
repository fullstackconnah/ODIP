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

    await user.click(screen.getByRole('button', { name: "Activate Mia Chen's Monday 9am–5pm pattern" }))

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

    await user.click(screen.getByRole('button', { name: "Activate Mia Chen's Monday 9am–5pm pattern" }))

    expect(await screen.findByText('Something went wrong activating this pattern. Please try again.')).toBeInTheDocument()
    expect(screen.queryByText(NOT_READY_MESSAGE)).not.toBeInTheDocument()
  })

  it('can be dismissed, and is cleared when the next toggle starts', async () => {
    const user = userEvent.setup()
    mockUsePatterns.mockReturnValue({ data: [makePattern({ isActive: false })], isLoading: false, isError: false, refetch: vi.fn() })
    mockUpdateMutate.mockImplementationOnce((_vars: unknown, opts?: { onError?: (e: unknown) => void }) => opts?.onError?.(badRequest(NOT_READY_MESSAGE)))
    render(<PatternsPage />)

    await user.click(screen.getByRole('button', { name: "Activate Mia Chen's Monday 9am–5pm pattern" }))
    expect(await screen.findByText(NOT_READY_MESSAGE)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Dismiss error' }))
    expect(screen.queryByText(NOT_READY_MESSAGE)).not.toBeInTheDocument()

    mockUpdateMutate.mockImplementationOnce((_vars: unknown, opts?: { onError?: (e: unknown) => void }) => opts?.onError?.(badRequest(NOT_READY_MESSAGE)))
    await user.click(screen.getByRole('button', { name: "Activate Mia Chen's Monday 9am–5pm pattern" }))
    expect(await screen.findByText(NOT_READY_MESSAGE)).toBeInTheDocument()
    // The next attempt (this one goes through) clears the old message at the start.
    await user.click(screen.getByRole('button', { name: "Activate Mia Chen's Monday 9am–5pm pattern" }))
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

    await user.click(screen.getByRole('button', { name: "Deactivate Mia Chen's Monday 9am–5pm pattern" }))
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

    await user.click(screen.getByRole('button', { name: "Deactivate Mia Chen's Monday 9am–5pm pattern" }))
    await user.click(screen.getByRole('button', { name: 'Deactivate' }))

    expect(await screen.findByText('Something went wrong deactivating this pattern. Please try again.')).toBeInTheDocument()
    expect(screen.queryByText(NOT_READY_MESSAGE)).not.toBeInTheDocument()
  })

  it('closes the confirm and shows no error when the deactivate succeeds', async () => {
    const user = userEvent.setup()
    mockUsePatterns.mockReturnValue({ data: [makePattern({ isActive: true })], isLoading: false, isError: false, refetch: vi.fn() })
    mockUpdateMutateAsync.mockResolvedValueOnce(makePattern({ isActive: false }))
    render(<PatternsPage />)

    await user.click(screen.getByRole('button', { name: "Deactivate Mia Chen's Monday 9am–5pm pattern" }))
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

  it('calls the column "Source": the badge under a header that says "From agreement" would say the same words twice', () => {
    mockUsePatterns.mockReturnValue({ data: [agreement()], isLoading: false, isError: false, refetch: vi.fn() })
    render(<PatternsPage />)

    expect(screen.getByRole('columnheader', { name: 'Source' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'From agreement' })).not.toBeInTheDocument()
  })

  it('says which worker of a 2:1 support each of the two patterns is, so twin rows can be told apart', () => {
    mockUsePatterns.mockReturnValue({
      data: [
        agreement({ id: 'slot-1', ratio: 'TwoToOne', workerSlot: 1 }),
        agreement({ id: 'slot-2', ratio: 'TwoToOne', workerSlot: 2 }),
        agreement({ id: 'single', ratio: 'OneToOne', workerSlot: 1 }),
      ],
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    render(<PatternsPage />)

    expect(screen.getByText('From agreement v2 · worker 1 of 2')).toBeInTheDocument()
    expect(screen.getByText('From agreement v2 · worker 2 of 2')).toBeInTheDocument()
    expect(screen.getAllByText('From agreement v2')).toHaveLength(1)                    // a one-to-one pattern has no second worker to name
    // The badge is one unit and its cell has room for it: in a narrow cell it used to wrap inside its own pill ("From agreement v2 · / worker 1 of 2").
    const badge = screen.getByText('From agreement v2 · worker 1 of 2')
    expect(badge).toHaveClass('whitespace-nowrap')
    expect(badge.parentElement).toHaveClass('min-w-[14rem]')
  })

  it('names the twin rows of a 2:1 support apart in every row action, by which worker each is for: the same day, the same times, and nothing else to tell them by', () => {
    mockUsePatterns.mockReturnValue({
      data: [
        agreement({ id: 'slot-1', ratio: 'TwoToOne', workerSlot: 1, dayOfWeek: 'Sunday', startTime: '10:00:00', endTime: '14:00:00' }),
        agreement({ id: 'slot-2', ratio: 'TwoToOne', workerSlot: 2, dayOfWeek: 'Sunday', startTime: '10:00:00', endTime: '14:00:00' }),
        agreement({ id: 'single', ratio: 'OneToOne', workerSlot: 1, dayOfWeek: 'Monday', startTime: '09:00:00', endTime: '13:00:00' }),
      ],
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    render(<PatternsPage />)

    for (const action of ['Edit', 'Generate shifts for', 'Deactivate']) {
      expect(screen.getByRole('button', { name: `${action} Mia Chen's Sunday 10am–2pm pattern (worker 1 of 2)` })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: `${action} Mia Chen's Sunday 10am–2pm pattern (worker 2 of 2)` })).toBeInTheDocument()
      // a pattern that is not half of a pair has no worker to name
      expect(screen.getByRole('button', { name: `${action} Mia Chen's Monday 9am–1pm pattern` })).toBeInTheDocument()
    }
  })

  it('names each row action with the time as well as the day, so two patterns on one day can be chosen between', () => {
    mockUsePatterns.mockReturnValue({
      data: [makePattern({ id: 'a', startTime: '09:00:00', endTime: '13:00:00' }), makePattern({ id: 'b', startTime: '14:00:00', endTime: '17:00:00', endsNextDay: false })],
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    render(<PatternsPage />)

    expect(screen.getByRole('button', { name: "Edit Mia Chen's Monday 9am–1pm pattern" })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "Edit Mia Chen's Monday 2pm–5pm pattern" })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "Generate shifts for Mia Chen's Monday 9am–1pm pattern" })).toBeInTheDocument()
  })

  it('says in the deactivate confirm that turning an agreement pattern off makes the roster differ from the agreement, and says nothing of the kind for another', async () => {
    const user = userEvent.setup()
    mockUsePatterns.mockReturnValue({ data: [agreement(), makePattern({ id: 'pattern-hand', dayOfWeek: 'Wednesday' })], isLoading: false, isError: false, refetch: vi.fn() })
    render(<PatternsPage />)

    await user.click(screen.getByRole('button', { name: /Deactivate Mia Chen's Tuesday 9am–5pm pattern/ }))
    expect(screen.getByText('This pattern came from agreement v2: turning it off makes the roster differ from the agreement.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: /Deactivate Mia Chen's Wednesday 9am–5pm pattern/ }))
    expect(screen.queryByText(/came from agreement/)).not.toBeInTheDocument()
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

    await user.click(screen.getByRole('button', { name: /Deactivate Mia Chen's Tuesday 9am–5pm pattern/ }))
    await user.click(screen.getByRole('button', { name: 'Deactivate' }))

    expect(mockUpdateMutateAsync).toHaveBeenCalledWith({ id: 'pattern-agreement', data: fullPayload(agreement(), false) })
  })
})
