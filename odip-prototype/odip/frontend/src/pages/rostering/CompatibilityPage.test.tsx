import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CompatibilityPage from './CompatibilityPage'

const { mockUpsertMutate } = vi.hoisted(() => ({ mockUpsertMutate: vi.fn() }))

vi.mock('@/lib/permissions', () => ({
  usePermissions: () => ({ canWrite: true }),
}))

vi.mock('@/api/hooks', () => ({
  useParticipants: () => ({
    data: [
      { id: 'p1', fullName: 'Alex Rivera' },
      { id: 'p2', fullName: 'Jamie Chen' },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useStaff: () => ({
    data: [
      { id: 's1', fullName: 'Sam Taylor' },
      { id: 's2', fullName: 'Morgan Lee' },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useUpsertCompatibility: () => ({ mutate: mockUpsertMutate }),
}))

vi.mock('./lib/useCompatibilityMatrix', () => ({
  useCompatibilityMatrix: () => ({
    byKey: new Map(),
    isLoading: false,
    isError: false,
    refetchAll: vi.fn(),
  }),
}))

describe('CompatibilityPage — PP-53 staff/participant filters', () => {
  it('filters staff rows by the staff filter text', async () => {
    const user = userEvent.setup()
    render(<CompatibilityPage />)

    expect(screen.getByText('Sam Taylor')).toBeInTheDocument()
    expect(screen.getByText('Morgan Lee')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Filter staff'), 'Sam')

    expect(screen.getByText('Sam Taylor')).toBeInTheDocument()
    expect(screen.queryByText('Morgan Lee')).not.toBeInTheDocument()
  })

  it('filters participant columns by the participant filter text', async () => {
    const user = userEvent.setup()
    render(<CompatibilityPage />)

    expect(screen.getByText('Alex Rivera')).toBeInTheDocument()
    expect(screen.getByText('Jamie Chen')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Filter participants'), 'Jamie')

    expect(screen.queryByText('Alex Rivera')).not.toBeInTheDocument()
    expect(screen.getByText('Jamie Chen')).toBeInTheDocument()
  })
})

// ── The server's refusal (readiness Enforce mode) ────────────────────────────────────────────────────────────────────
// A refused cell edit rolled back and showed only a 4-second icon: the server's reason was dropped. In Enforce mode that reason is
// "Participant is not ready for booking or rostering."; it has to be on screen, and stay there until dismissed or the next edit.
const NOT_READY_MESSAGE = 'Participant is not ready for booking or rostering.'
const GENERIC_SAVE_ERROR = "Couldn't save that change. Please try again."

/** What axios rejects with for a 400 carrying the API's ApiResponse envelope. */
function badRequest(...errors: string[]) {
  return { response: { status: 400, data: { success: false, errors } } }
}

/** Makes the next upsert fail the way the real hook would: mutate's own onError gets the thrown error. */
function failNextUpsertWith(err: unknown) {
  mockUpsertMutate.mockImplementationOnce((_vars: unknown, opts?: { onError?: (e: unknown) => void }) => opts?.onError?.(err))
}

describe('CompatibilityPage — the server\'s refusal reaches the user', () => {
  beforeEach(() => {
    mockUpsertMutate.mockReset()
  })

  it('shows the server\'s own message, not the generic line, rolls the cell back, and sent the full body', async () => {
    const user = userEvent.setup()
    failNextUpsertWith(badRequest(NOT_READY_MESSAGE))
    render(<CompatibilityPage />)

    await user.selectOptions(screen.getByLabelText('Sam Taylor with Alex Rivera: Allowed'), 'Preferred')

    expect(mockUpsertMutate).toHaveBeenCalledTimes(1)
    expect(mockUpsertMutate).toHaveBeenCalledWith(
      { staffId: 's1', participantId: 'p1', level: 'Preferred', reason: null },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    )
    const message = await screen.findByText(NOT_READY_MESSAGE)
    expect(message.closest('[role="alert"]')).not.toBeNull()
    expect(screen.queryByText(GENERIC_SAVE_ERROR)).not.toBeInTheDocument()
    // The optimistic change is rolled back to what the server last confirmed.
    expect(screen.getByLabelText('Sam Taylor with Alex Rivera: Allowed')).toHaveValue('Allowed')
    expect(screen.queryByLabelText('Sam Taylor with Alex Rivera: Preferred')).not.toBeInTheDocument()
  })

  it('falls back to the generic line when the failure carries no message', async () => {
    const user = userEvent.setup()
    failNextUpsertWith(new Error('Network Error'))
    render(<CompatibilityPage />)

    await user.selectOptions(screen.getByLabelText('Morgan Lee with Jamie Chen: Allowed'), 'Preferred')

    expect(await screen.findByText(GENERIC_SAVE_ERROR)).toBeInTheDocument()
    expect(screen.queryByText(NOT_READY_MESSAGE)).not.toBeInTheDocument()
  })

  it('stays until dismissed, and is cleared when the next edit starts', async () => {
    const user = userEvent.setup()
    failNextUpsertWith(badRequest(NOT_READY_MESSAGE))
    render(<CompatibilityPage />)

    await user.selectOptions(screen.getByLabelText('Sam Taylor with Alex Rivera: Allowed'), 'Preferred')
    expect(await screen.findByText(NOT_READY_MESSAGE)).toBeInTheDocument()

    // Dismissible.
    await user.click(screen.getByRole('button', { name: 'Dismiss error' }))
    expect(screen.queryByText(NOT_READY_MESSAGE)).not.toBeInTheDocument()

    // And a fresh refusal is cleared the moment the next edit begins (the mock does not fail this one).
    failNextUpsertWith(badRequest(NOT_READY_MESSAGE))
    await user.selectOptions(screen.getByLabelText('Sam Taylor with Alex Rivera: Allowed'), 'Preferred')
    expect(await screen.findByText(NOT_READY_MESSAGE)).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Morgan Lee with Alex Rivera: Allowed'), 'Preferred')
    expect(screen.queryByText(NOT_READY_MESSAGE)).not.toBeInTheDocument()
    expect(mockUpsertMutate).toHaveBeenCalledTimes(3)
  })

  it('exclusion: sends the reason with the full body and shows the refusal', async () => {
    const user = userEvent.setup()
    failNextUpsertWith(badRequest(NOT_READY_MESSAGE))
    render(<CompatibilityPage />)

    await user.selectOptions(screen.getByLabelText('Sam Taylor with Jamie Chen: Allowed'), 'Excluded')
    await user.type(screen.getByLabelText(/reason/i), 'Personality clash')
    await user.click(screen.getByRole('button', { name: 'Exclude' }))

    expect(mockUpsertMutate).toHaveBeenCalledTimes(1)
    expect(mockUpsertMutate).toHaveBeenCalledWith(
      { staffId: 's1', participantId: 'p2', level: 'Excluded', reason: 'Personality clash' },
      expect.anything(),
    )
    expect(await screen.findByText(NOT_READY_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByText(GENERIC_SAVE_ERROR)).not.toBeInTheDocument()
  })
})

// A refused edit leaves a warning icon on its cell for four seconds, one timer per cell. Those timers were bare setTimeouts: one left running past
// the page fired setFailedKeys into a tree that was gone, and past the end of the test environment it threw "window is not defined", which fails
// the whole run even though every test passed. Only setTimeout/clearTimeout are faked, and the tests use fireEvent and read the DOM straight away.
describe('CompatibilityPage — the failed-cell icon timers', () => {
  const FAILED_ICON = "Couldn't save — try again."
  const SAM_WITH_ALEX = 'Sam Taylor with Alex Rivera: Allowed'
  const MORGAN_WITH_JAMIE = 'Morgan Lee with Jamie Chen: Allowed'

  beforeEach(() => {
    mockUpsertMutate.mockReset()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const refuse = (label: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: 'Preferred' } })
  const elapse = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

  it('leaves nothing pending when the page unmounts while icons are still showing', () => {
    failNextUpsertWith(badRequest(NOT_READY_MESSAGE))
    failNextUpsertWith(badRequest(NOT_READY_MESSAGE))
    const { unmount } = render(<CompatibilityPage />)

    refuse(SAM_WITH_ALEX)
    refuse(MORGAN_WITH_JAMIE)
    expect(screen.getAllByTitle(FAILED_ICON)).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(2)

    elapse(1000)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('gives a cell that is refused again a fresh four seconds, instead of letting its first timer take the icon away early', () => {
    failNextUpsertWith(badRequest(NOT_READY_MESSAGE))
    failNextUpsertWith(badRequest(NOT_READY_MESSAGE))
    render(<CompatibilityPage />)

    refuse(SAM_WITH_ALEX)                       // icon up, first timer due at 4000
    elapse(3000)
    refuse(SAM_WITH_ALEX)                       // the same cell refused again, second timer due at 7000
    expect(vi.getTimerCount()).toBe(1)

    elapse(2000)                                // 5000: past the first timer, inside the second
    expect(screen.getAllByTitle(FAILED_ICON)).toHaveLength(1)
    elapse(2000)                                // 7000
    expect(screen.queryByTitle(FAILED_ICON)).not.toBeInTheDocument()
  })
})
