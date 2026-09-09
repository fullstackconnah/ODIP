import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RoutinesTab from './RoutinesTab'
import type { ParticipantRoutineDto } from '@/api/types/routines'

const {
  mockUseParticipantRoutines, mockCreateMutateAsync, mockUpdateMutateAsync, mockDeleteMutateAsync,
} = vi.hoisted(() => ({
  mockUseParticipantRoutines: vi.fn(() => ({ data: [] as ParticipantRoutineDto[], isLoading: false })),
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockDeleteMutateAsync: vi.fn(),
}))

// Only the API layer is mocked — Modal, FormField, ConfirmDialog, Dropdown, EmptyState are the
// real components, so this exercises the actual add/edit/delete wiring.
vi.mock('@/api/hooks', () => ({
  useParticipantRoutines: mockUseParticipantRoutines,
  useCreateRoutine: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false }),
  useUpdateRoutine: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false }),
  useDeleteRoutine: () => ({ mutateAsync: mockDeleteMutateAsync, isPending: false }),
}))

const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function makeRoutine(overrides: Partial<ParticipantRoutineDto> = {}): ParticipantRoutineDto {
  return {
    id: 'routine-1',
    participantId: 'participant-1',
    title: 'Morning routine',
    description: 'Wake gently, offer a warm drink.',
    category: 'PersonalCare',
    days: ALL_DAYS,
    startTime: null,
    endTime: null,
    isCritical: false,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function setUserRole(role: string) {
  localStorage.setItem('odip_user', JSON.stringify({ role }))
}

beforeEach(() => {
  mockCreateMutateAsync.mockClear()
  mockUpdateMutateAsync.mockClear()
  mockDeleteMutateAsync.mockClear()
  mockUseParticipantRoutines.mockReturnValue({ data: [], isLoading: false })
  setUserRole('Coordinator')
})

afterEach(() => {
  localStorage.clear()
})

describe('RoutinesTab', () => {
  it('renders an empty state when there are no routines', () => {
    render(<RoutinesTab participantId="participant-1" />)
    expect(screen.getByText('No routines yet')).toBeInTheDocument()
  })

  it('groups routines into Every day and weekday sections, critical items flagged', () => {
    mockUseParticipantRoutines.mockReturnValue({
      data: [
        makeRoutine({ id: 'r1', title: 'Seizure protocol', isCritical: true, days: ALL_DAYS }),
        makeRoutine({ id: 'r2', title: 'Saturday swimming', days: ['Saturday'], startTime: '09:30:00', endTime: '11:30:00' }),
      ],
      isLoading: false,
    })

    render(<RoutinesTab participantId="participant-1" />)

    // "Every day" also appears as this routine's own day-set label on its card (formatDaySet),
    // so the group heading is asserted by role to disambiguate from that second occurrence.
    expect(screen.getByRole('heading', { name: 'Every day' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Saturday' })).toBeInTheDocument()
    expect(screen.getByText('Seizure protocol')).toBeInTheDocument()
    expect(screen.getByText('Saturday swimming')).toBeInTheDocument()
    expect(screen.getByText('Critical')).toBeInTheDocument()
    expect(screen.getByLabelText('Critical')).toBeInTheDocument()
  })

  // PD-4: a routine can apply to any non-empty subset of the 7 days, not just "every day" or a
  // single day.
  describe('PD-4 — multi-day selection', () => {
    it('a Mon/Wed/Fri routine appears in all three day groups, never in Every day', () => {
      mockUseParticipantRoutines.mockReturnValue({
        data: [makeRoutine({ title: 'Physio exercises', days: ['Monday', 'Wednesday', 'Friday'] })],
        isLoading: false,
      })

      render(<RoutinesTab participantId="participant-1" />)

      expect(screen.queryByRole('heading', { name: 'Every day' })).not.toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Monday' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Wednesday' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Friday' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Tuesday' })).not.toBeInTheDocument()
      // One card render per applicable day bucket — never dropped from any but the first.
      expect(screen.getAllByText('Physio exercises')).toHaveLength(3)
    })

    it('"Every day" is derived: unchecking it (only possible when all 7 are checked) clears the selection, and checking it selects all 7', async () => {
      const user = userEvent.setup()
      render(<RoutinesTab participantId="participant-1" />)
      await user.click(screen.getAllByRole('button', { name: /new routine/i })[0])

      const everyDayCheckbox = screen.getByRole('checkbox', { name: 'Every day' })
      const mondayCheckbox = screen.getByRole('checkbox', { name: 'Monday' })

      // The create form defaults to every day selected.
      expect(everyDayCheckbox).toBeChecked()
      expect(mondayCheckbox).toBeChecked()

      // Unchecking "Every day" clears the whole selection, forcing an explicit re-pick rather
      // than falling back to some arbitrary default day.
      await user.click(everyDayCheckbox)
      expect(everyDayCheckbox).not.toBeChecked()
      expect(mondayCheckbox).not.toBeChecked()

      // Ticking individual days one at a time doesn't re-check "Every day" until all 7 are picked.
      for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) {
        await user.click(screen.getByRole('checkbox', { name: day }))
      }
      expect(everyDayCheckbox).not.toBeChecked()
      await user.click(screen.getByRole('checkbox', { name: 'Sunday' }))
      expect(everyDayCheckbox).toBeChecked()

      // Checking "Every day" directly from a partial (not just empty) selection forces all 7.
      await user.click(mondayCheckbox)
      expect(everyDayCheckbox).not.toBeChecked()
      await user.click(everyDayCheckbox)
      expect(mondayCheckbox).toBeChecked()
    })

    it('rejects saving with no days selected', async () => {
      const user = userEvent.setup()
      render(<RoutinesTab participantId="participant-1" />)

      await user.click(screen.getAllByRole('button', { name: /new routine/i })[0])
      await user.type(screen.getByLabelText(/title/i), 'No days task')
      await user.type(screen.getByLabelText(/description/i), 'Should not save.')
      await user.click(screen.getByRole('checkbox', { name: 'Every day' })) // all 7 -> none

      await user.click(screen.getByRole('button', { name: /save routine/i }))

      expect(screen.getByText('Select at least one day')).toBeInTheDocument()
      expect(mockCreateMutateAsync).not.toHaveBeenCalled()
    })

    it('saves a multi-day selection as exactly the chosen set', async () => {
      const user = userEvent.setup()
      render(<RoutinesTab participantId="participant-1" />)

      await user.click(screen.getAllByRole('button', { name: /new routine/i })[0])
      await user.type(screen.getByLabelText(/title/i), 'Swimming')
      await user.type(screen.getByLabelText(/description/i), 'Pool session.')
      await user.click(screen.getByRole('checkbox', { name: 'Every day' })) // clear to none
      await user.click(screen.getByRole('checkbox', { name: 'Monday' }))
      await user.click(screen.getByRole('checkbox', { name: 'Wednesday' }))
      await user.click(screen.getByRole('checkbox', { name: 'Friday' }))
      await user.click(screen.getByRole('button', { name: /save routine/i }))

      expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
      const [call] = mockCreateMutateAsync.mock.calls[0]
      expect(call.data.days).toEqual(['Monday', 'Wednesday', 'Friday'])
    })

    it('prefills the day checkboxes from the routine being edited', async () => {
      const user = userEvent.setup()
      mockUseParticipantRoutines.mockReturnValue({
        data: [makeRoutine({ days: ['Monday', 'Wednesday', 'Friday'] })],
        isLoading: false,
      })

      render(<RoutinesTab participantId="participant-1" />)
      await user.click(screen.getAllByRole('button', { name: 'Edit' })[0])

      expect(screen.getByRole('checkbox', { name: 'Every day' })).not.toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Monday' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Wednesday' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Friday' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Tuesday' })).not.toBeChecked()
    })

    it('formats the day-set label for the common cases: Every day, Weekdays, Weekends, and an arbitrary subset', () => {
      mockUseParticipantRoutines.mockReturnValue({ data: [makeRoutine({ days: ALL_DAYS })], isLoading: false })
      const { unmount: unmount1 } = render(<RoutinesTab participantId="participant-1" />)
      expect(screen.getAllByText('Every day').length).toBeGreaterThan(0)
      unmount1()

      mockUseParticipantRoutines.mockReturnValue({
        data: [makeRoutine({ days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] })],
        isLoading: false,
      })
      const { unmount: unmount2 } = render(<RoutinesTab participantId="participant-1" />)
      // One card render per applicable day bucket (5), each showing the "Weekdays" label.
      expect(screen.getAllByText('Weekdays')).toHaveLength(5)
      unmount2()

      mockUseParticipantRoutines.mockReturnValue({ data: [makeRoutine({ days: ['Saturday', 'Sunday'] })], isLoading: false })
      const { unmount: unmount3 } = render(<RoutinesTab participantId="participant-1" />)
      expect(screen.getAllByText('Weekends')).toHaveLength(2)
      unmount3()

      mockUseParticipantRoutines.mockReturnValue({
        data: [makeRoutine({ days: ['Monday', 'Wednesday', 'Friday'] })],
        isLoading: false,
      })
      render(<RoutinesTab participantId="participant-1" />)
      expect(screen.getAllByText('Mon, Wed, Fri')).toHaveLength(3)
    })
  })

  it('hides Edit/Delete actions for a ReadOnly user', () => {
    setUserRole('ReadOnly')
    mockUseParticipantRoutines.mockReturnValue({ data: [makeRoutine()], isLoading: false })

    render(<RoutinesTab participantId="participant-1" />)

    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /new routine/i })).not.toBeInTheDocument()
  })

  it('creates a new routine with the entered title, description and critical flag', async () => {
    const user = userEvent.setup()
    render(<RoutinesTab participantId="participant-1" />)

    // Both the header button and the empty-state action read "New routine" — the header one is first.
    await user.click(screen.getAllByRole('button', { name: /new routine/i })[0])
    await user.type(screen.getByLabelText(/title/i), 'Evening wind-down')
    await user.type(screen.getByLabelText(/description/i), 'Dim the lights and lower the volume from 8pm.')
    await user.click(screen.getByLabelText(/critical/i))
    await user.click(screen.getByRole('button', { name: /save routine/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    const [call] = mockCreateMutateAsync.mock.calls[0]
    expect(call.participantId).toBe('participant-1')
    expect(call.data.title).toBe('Evening wind-down')
    expect(call.data.description).toBe('Dim the lights and lower the volume from 8pm.')
    expect(call.data.isCritical).toBe(true)
    expect(call.data.days).toEqual(ALL_DAYS)
    expect(call.data.startTime).toBeNull()
  })

  it('requires a title and description before saving', async () => {
    const user = userEvent.setup()
    render(<RoutinesTab participantId="participant-1" />)

    await user.click(screen.getAllByRole('button', { name: /new routine/i })[0])
    await user.click(screen.getByRole('button', { name: /save routine/i }))

    expect(mockCreateMutateAsync).not.toHaveBeenCalled()
    expect(screen.getByText('Title is required')).toBeInTheDocument()
    expect(screen.getByText('Description is required')).toBeInTheDocument()
  })

  it('edits an existing routine, prefilling the form', async () => {
    const user = userEvent.setup()
    mockUseParticipantRoutines.mockReturnValue({
      data: [makeRoutine({ title: 'Morning routine', description: 'Original description' })],
      isLoading: false,
    })

    render(<RoutinesTab participantId="participant-1" />)

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText(/title/i)).toHaveValue('Morning routine')

    await user.clear(screen.getByLabelText(/description/i))
    await user.type(screen.getByLabelText(/description/i), 'Updated description')
    await user.click(screen.getByRole('button', { name: /save routine/i }))

    expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1)
    const [call] = mockUpdateMutateAsync.mock.calls[0]
    expect(call.id).toBe('routine-1')
    expect(call.data.description).toBe('Updated description')
  })

  it('deletes a routine after confirmation', async () => {
    const user = userEvent.setup()
    mockUseParticipantRoutines.mockReturnValue({ data: [makeRoutine()], isLoading: false })

    render(<RoutinesTab participantId="participant-1" />)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(mockDeleteMutateAsync).toHaveBeenCalledWith({ id: 'routine-1', participantId: 'participant-1' })
  })

  // PD-3: start/end time are independent optional fields with no "has a specific time window"
  // gate — a routine's time window may be a start only, an end only, both, or neither.
  describe('PD-3 — partial time windows', () => {
    it('saves a routine with only a start time set', async () => {
      const user = userEvent.setup()
      render(<RoutinesTab participantId="participant-1" />)

      await user.click(screen.getAllByRole('button', { name: /new routine/i })[0])
      await user.type(screen.getByLabelText(/title/i), 'Take morning tablets')
      await user.type(screen.getByLabelText(/description/i), 'Must start no earlier than this time.')
      fireEvent.change(screen.getByLabelText(/start time/i), { target: { value: '07:00' } })
      await user.click(screen.getByRole('button', { name: /save routine/i }))

      expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
      const [call] = mockCreateMutateAsync.mock.calls[0]
      expect(call.data.startTime).toBe('07:00:00')
      expect(call.data.endTime).toBeNull()
    })

    it('saves a routine with only an end time set', async () => {
      const user = userEvent.setup()
      render(<RoutinesTab participantId="participant-1" />)

      await user.click(screen.getAllByRole('button', { name: /new routine/i })[0])
      await user.type(screen.getByLabelText(/title/i), 'Finish evening chores')
      await user.type(screen.getByLabelText(/description/i), 'Must be wrapped up by this time.')
      fireEvent.change(screen.getByLabelText(/end time/i), { target: { value: '17:00' } })
      await user.click(screen.getByRole('button', { name: /save routine/i }))

      expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
      const [call] = mockCreateMutateAsync.mock.calls[0]
      expect(call.data.startTime).toBeNull()
      expect(call.data.endTime).toBe('17:00:00')
    })

    it('renders "From {time}" for a start-only routine and "By {time}" for an end-only routine', () => {
      mockUseParticipantRoutines.mockReturnValue({
        data: [
          makeRoutine({ id: 'r1', title: 'Start-only task', days: ALL_DAYS, startTime: '07:00:00', endTime: null }),
          makeRoutine({ id: 'r2', title: 'End-only task', days: ALL_DAYS, startTime: null, endTime: '17:00:00' }),
        ],
        isLoading: false,
      })

      render(<RoutinesTab participantId="participant-1" />)

      expect(screen.getByText('From 7am')).toBeInTheDocument()
      expect(screen.getByText('By 5pm')).toBeInTheDocument()
    })

    it('still renders "Untimed" when neither time is set, and a range when both are set', () => {
      mockUseParticipantRoutines.mockReturnValue({
        data: [
          makeRoutine({ id: 'r1', title: 'Untimed task', days: ALL_DAYS, startTime: null, endTime: null }),
          makeRoutine({ id: 'r2', title: 'Ranged task', days: ALL_DAYS, startTime: '09:30:00', endTime: '11:30:00' }),
        ],
        isLoading: false,
      })

      render(<RoutinesTab participantId="participant-1" />)

      expect(screen.getByText('Untimed')).toBeInTheDocument()
      expect(screen.getByText('9:30am–11:30am')).toBeInTheDocument()
    })

    it('shows an end-before-start validation error only when both times are present', async () => {
      const user = userEvent.setup()
      render(<RoutinesTab participantId="participant-1" />)

      await user.click(screen.getAllByRole('button', { name: /new routine/i })[0])
      await user.type(screen.getByLabelText(/title/i), 'Bad window')
      await user.type(screen.getByLabelText(/description/i), 'End is before start.')
      fireEvent.change(screen.getByLabelText(/start time/i), { target: { value: '17:00' } })
      fireEvent.change(screen.getByLabelText(/end time/i), { target: { value: '07:00' } })
      await user.click(screen.getByRole('button', { name: /save routine/i }))

      expect(screen.getByText('End time must be after start time')).toBeInTheDocument()
      expect(mockCreateMutateAsync).not.toHaveBeenCalled()

      // Clearing the end time (start-only) removes the ordering error entirely — the rule only
      // fires when both times are present.
      fireEvent.change(screen.getByLabelText(/end time/i), { target: { value: '' } })
      await user.click(screen.getByRole('button', { name: /save routine/i }))

      expect(screen.queryByText('End time must be after start time')).not.toBeInTheDocument()
      expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    })

    it('round-trips all three time states through edit-mode hydration', async () => {
      const user = userEvent.setup()

      // Start-only
      mockUseParticipantRoutines.mockReturnValue({
        data: [makeRoutine({ startTime: '07:00:00', endTime: null })],
        isLoading: false,
      })
      const { unmount: unmount1 } = render(<RoutinesTab participantId="participant-1" />)
      await user.click(screen.getByRole('button', { name: 'Edit' }))
      expect(screen.getByLabelText(/start time/i)).toHaveValue('07:00')
      expect(screen.getByLabelText(/end time/i)).toHaveValue('')
      unmount1()

      // End-only
      mockUseParticipantRoutines.mockReturnValue({
        data: [makeRoutine({ startTime: null, endTime: '17:00:00' })],
        isLoading: false,
      })
      const { unmount: unmount2 } = render(<RoutinesTab participantId="participant-1" />)
      await user.click(screen.getByRole('button', { name: 'Edit' }))
      expect(screen.getByLabelText(/start time/i)).toHaveValue('')
      expect(screen.getByLabelText(/end time/i)).toHaveValue('17:00')
      unmount2()

      // Both
      mockUseParticipantRoutines.mockReturnValue({
        data: [makeRoutine({ startTime: '09:30:00', endTime: '11:30:00' })],
        isLoading: false,
      })
      const { unmount: unmount3 } = render(<RoutinesTab participantId="participant-1" />)
      await user.click(screen.getByRole('button', { name: 'Edit' }))
      expect(screen.getByLabelText(/start time/i)).toHaveValue('09:30')
      expect(screen.getByLabelText(/end time/i)).toHaveValue('11:30')
      unmount3()

      // Neither
      mockUseParticipantRoutines.mockReturnValue({
        data: [makeRoutine({ startTime: null, endTime: null })],
        isLoading: false,
      })
      render(<RoutinesTab participantId="participant-1" />)
      await user.click(screen.getByRole('button', { name: 'Edit' }))
      expect(screen.getByLabelText(/start time/i)).toHaveValue('')
      expect(screen.getByLabelText(/end time/i)).toHaveValue('')
    })
  })
})
