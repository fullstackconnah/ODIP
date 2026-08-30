import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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

function makeRoutine(overrides: Partial<ParticipantRoutineDto> = {}): ParticipantRoutineDto {
  return {
    id: 'routine-1',
    participantId: 'participant-1',
    title: 'Morning routine',
    description: 'Wake gently, offer a warm drink.',
    category: 'PersonalCare',
    dayOfWeek: null,
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
        makeRoutine({ id: 'r1', title: 'Seizure protocol', isCritical: true, dayOfWeek: null }),
        makeRoutine({ id: 'r2', title: 'Saturday swimming', dayOfWeek: 'Saturday', startTime: '09:30:00', endTime: '11:30:00' }),
      ],
      isLoading: false,
    })

    render(<RoutinesTab participantId="participant-1" />)

    expect(screen.getByText('Every day')).toBeInTheDocument()
    expect(screen.getByText('Saturday')).toBeInTheDocument()
    expect(screen.getByText('Seizure protocol')).toBeInTheDocument()
    expect(screen.getByText('Saturday swimming')).toBeInTheDocument()
    expect(screen.getByText('Critical')).toBeInTheDocument()
    expect(screen.getByLabelText('Critical')).toBeInTheDocument()
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
    expect(call.data.dayOfWeek).toBeNull()
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
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(mockDeleteMutateAsync).toHaveBeenCalledWith({ id: 'routine-1', participantId: 'participant-1' })
  })
})
