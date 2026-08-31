import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShiftNotesSection } from './ShiftNotesSection'
import type { ShiftNoteDto } from '@/api/types'

const {
  mockUseShiftNotes, mockUseCreateShiftNote, mockUseUpdateShiftNote,
  mockCreateMutateAsync, mockUpdateMutateAsync, mockRefetch,
} = vi.hoisted(() => ({
  mockUseShiftNotes: vi.fn(),
  mockUseCreateShiftNote: vi.fn(),
  mockUseUpdateShiftNote: vi.fn(),
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockRefetch: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useShiftNotes: mockUseShiftNotes,
  useCreateShiftNote: mockUseCreateShiftNote,
  useUpdateShiftNote: mockUseUpdateShiftNote,
}))

function setCurrentUser(id: string | null) {
  if (id) localStorage.setItem('odip_user', JSON.stringify({ id, role: 'SupportWorker' }))
  else localStorage.removeItem('odip_user')
}

function makeNote(overrides: Partial<ShiftNoteDto> = {}): ShiftNoteDto {
  return {
    id: 'note-1',
    shiftId: 'shift-1',
    authorUserId: 'user-1',
    authorName: 'Ben Turner',
    body: 'Quiet shift, no concerns.',
    createdAt: '2026-08-17T09:30:00Z',
    updatedAt: '2026-08-17T09:30:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  mockUseShiftNotes.mockReset()
  mockCreateMutateAsync.mockReset()
  mockUpdateMutateAsync.mockReset()
  mockRefetch.mockReset()
  mockUseCreateShiftNote.mockReset().mockReturnValue({ mutateAsync: mockCreateMutateAsync, isPending: false })
  mockUseUpdateShiftNote.mockReset().mockReturnValue({ mutateAsync: mockUpdateMutateAsync, isPending: false })
  localStorage.clear()
})

describe('ShiftNotesSection', () => {
  it('announces a loading state', () => {
    mockUseShiftNotes.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: mockRefetch })
    render(<ShiftNotesSection shiftId="shift-1" />)

    expect(screen.getByText(/loading shift notes/i)).toBeInTheDocument()
  })

  it('shows a distinct error state with a retry action, not a bare empty state', () => {
    mockUseShiftNotes.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: mockRefetch })
    render(<ShiftNotesSection shiftId="shift-1" />)

    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't load shift notes/i)
    expect(screen.queryByText(/no notes yet/i)).not.toBeInTheDocument()
  })

  it('shows an empty state when there are no notes yet', () => {
    mockUseShiftNotes.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: mockRefetch })
    render(<ShiftNotesSection shiftId="shift-1" />)

    expect(screen.getByText(/no notes yet for this shift/i)).toBeInTheDocument()
  })

  it('renders existing notes with author and local time', () => {
    mockUseShiftNotes.mockReturnValue({ data: [makeNote()], isLoading: false, isError: false, refetch: mockRefetch })
    render(<ShiftNotesSection shiftId="shift-1" />)

    expect(screen.getByText('Ben Turner')).toBeInTheDocument()
    expect(screen.getByText('Quiet shift, no concerns.')).toBeInTheDocument()
  })

  it('submits a new note and clears the textarea on success', async () => {
    const user = userEvent.setup()
    mockUseShiftNotes.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: mockRefetch })
    mockCreateMutateAsync.mockResolvedValue(makeNote())
    render(<ShiftNotesSection shiftId="shift-1" />)

    const textarea = screen.getByLabelText(/add a note/i)
    await user.type(textarea, 'Handover: meds given at 8am.')
    await user.click(screen.getByRole('button', { name: /add note/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledWith('Handover: meds given at 8am.')
    await waitFor(() => expect(textarea).toHaveValue(''))
  })

  it('shows a pending state on the submit button while saving', () => {
    mockUseShiftNotes.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: mockRefetch })
    mockUseCreateShiftNote.mockReturnValue({ mutateAsync: mockCreateMutateAsync, isPending: true })
    render(<ShiftNotesSection shiftId="shift-1" />)

    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled()
  })

  it('shows an error message when the create request fails, without losing the draft', async () => {
    const user = userEvent.setup()
    mockUseShiftNotes.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: mockRefetch })
    mockCreateMutateAsync.mockRejectedValue(new Error('network error'))
    render(<ShiftNotesSection shiftId="shift-1" />)

    const textarea = screen.getByLabelText(/add a note/i)
    await user.type(textarea, 'This should fail to save.')
    await user.click(screen.getByRole('button', { name: /add note/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't save your note/i)
    expect(textarea).toHaveValue('This should fail to save.')
  })

  it('shows a character counter that reflects the current draft length', async () => {
    const user = userEvent.setup()
    mockUseShiftNotes.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: mockRefetch })
    render(<ShiftNotesSection shiftId="shift-1" />)

    await user.type(screen.getByLabelText(/add a note/i), 'Hello')

    expect(screen.getByText('5 / 1000')).toBeInTheDocument()
  })

  it("offers an Edit action only on the current user's own note", () => {
    setCurrentUser('user-1')
    mockUseShiftNotes.mockReturnValue({
      data: [makeNote({ id: 'note-mine', authorUserId: 'user-1' }), makeNote({ id: 'note-theirs', authorUserId: 'user-2', authorName: 'Cara Lee' })],
      isLoading: false, isError: false, refetch: mockRefetch,
    })
    render(<ShiftNotesSection shiftId="shift-1" />)

    expect(screen.getAllByRole('button', { name: /edit/i })).toHaveLength(1)
  })

  it('lets the author edit and save their own note', async () => {
    const user = userEvent.setup()
    setCurrentUser('user-1')
    mockUseShiftNotes.mockReturnValue({ data: [makeNote({ authorUserId: 'user-1' })], isLoading: false, isError: false, refetch: mockRefetch })
    mockUpdateMutateAsync.mockResolvedValue(makeNote({ body: 'Corrected note.' }))
    render(<ShiftNotesSection shiftId="shift-1" />)

    await user.click(screen.getByRole('button', { name: /edit/i }))
    const editTextarea = screen.getByLabelText(/edit note/i)
    await user.clear(editTextarea)
    await user.type(editTextarea, 'Corrected note.')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(mockUpdateMutateAsync).toHaveBeenCalledWith({ id: 'note-1', body: 'Corrected note.' })
  })
})
