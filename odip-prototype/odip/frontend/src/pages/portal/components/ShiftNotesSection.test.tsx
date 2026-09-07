import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ShiftNotesSection, type ShiftNotesSectionProps } from './ShiftNotesSection'
import type { ShiftNoteDto } from '@/api/types'

const {
  mockUseShiftNotes, mockUseCreateShiftNote, mockUseUpdateShiftNote, mockUseAcknowledgeShiftNoteFlags,
  mockCreateMutateAsync, mockUpdateMutateAsync, mockAcknowledgeMutate, mockRefetch, mockNavigate,
} = vi.hoisted(() => ({
  mockUseShiftNotes: vi.fn(),
  mockUseCreateShiftNote: vi.fn(),
  mockUseUpdateShiftNote: vi.fn(),
  mockUseAcknowledgeShiftNoteFlags: vi.fn(),
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockAcknowledgeMutate: vi.fn(),
  mockRefetch: vi.fn(),
  mockNavigate: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useShiftNotes: mockUseShiftNotes,
  useCreateShiftNote: mockUseCreateShiftNote,
  useUpdateShiftNote: mockUseUpdateShiftNote,
  useAcknowledgeShiftNoteFlags: mockUseAcknowledgeShiftNoteFlags,
}))

// ShiftNotesSection calls useNavigate (NOTES-02's "File incident report" action), which requires
// a Router ancestor — same mocking pattern as RecordAdministrationModal.test.tsx (INC-03).
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

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
    flaggedCategories: [],
    flagsAcknowledgedAt: null,
    ...overrides,
  }
}

const defaultProps: ShiftNotesSectionProps = {
  shiftId: 'shift-1',
  participantId: 'participant-1',
  participantName: 'Sophie Brown',
  serviceDate: '2026-08-17',
  startTime: '09:00:00',
  endTime: '17:00:00',
  endsNextDay: false,
}

function renderSection(props: Partial<ShiftNotesSectionProps> = {}) {
  return render(
    <MemoryRouter>
      <ShiftNotesSection {...defaultProps} {...props} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockUseShiftNotes.mockReset()
  mockCreateMutateAsync.mockReset()
  mockUpdateMutateAsync.mockReset()
  mockAcknowledgeMutate.mockReset()
  mockRefetch.mockReset()
  mockNavigate.mockReset()
  mockUseCreateShiftNote.mockReset().mockReturnValue({ mutateAsync: mockCreateMutateAsync, isPending: false })
  mockUseUpdateShiftNote.mockReset().mockReturnValue({ mutateAsync: mockUpdateMutateAsync, isPending: false })
  mockUseAcknowledgeShiftNoteFlags.mockReset().mockReturnValue({ mutate: mockAcknowledgeMutate, isPending: false, variables: undefined })
  localStorage.clear()
})

describe('ShiftNotesSection', () => {
  it('announces a loading state', () => {
    mockUseShiftNotes.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: mockRefetch })
    renderSection()

    expect(screen.getByText(/loading shift notes/i)).toBeInTheDocument()
  })

  it('shows a distinct error state with a retry action, not a bare empty state', () => {
    mockUseShiftNotes.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: mockRefetch })
    renderSection()

    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't load shift notes/i)
    expect(screen.queryByText(/no notes yet/i)).not.toBeInTheDocument()
  })

  it('shows an empty state when there are no notes yet', () => {
    mockUseShiftNotes.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: mockRefetch })
    renderSection()

    expect(screen.getByText(/no notes yet for this shift/i)).toBeInTheDocument()
  })

  it('renders existing notes with author and local time', () => {
    mockUseShiftNotes.mockReturnValue({ data: [makeNote()], isLoading: false, isError: false, refetch: mockRefetch })
    renderSection()

    expect(screen.getByText('Ben Turner')).toBeInTheDocument()
    expect(screen.getByText('Quiet shift, no concerns.')).toBeInTheDocument()
  })

  // PP-56: ShiftNoteDto.updatedAt exists but was never surfaced — an edited note should say so.
  it('shows an "edited" suffix when a note was updated after it was created', () => {
    mockUseShiftNotes.mockReturnValue({
      data: [makeNote({ updatedAt: '2026-08-17T10:15:00Z' })],
      isLoading: false, isError: false, refetch: mockRefetch,
    })
    renderSection()

    expect(screen.getByText('Ben Turner').closest('p')).toHaveTextContent(/edited/i)
  })

  it('does not show an "edited" suffix on an unedited note (updatedAt === createdAt)', () => {
    mockUseShiftNotes.mockReturnValue({ data: [makeNote()], isLoading: false, isError: false, refetch: mockRefetch })
    renderSection()

    expect(screen.getByText('Ben Turner').closest('p')).not.toHaveTextContent(/edited/i)
  })

  it('submits a new note and clears the textarea on success', async () => {
    const user = userEvent.setup()
    mockUseShiftNotes.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: mockRefetch })
    mockCreateMutateAsync.mockResolvedValue(makeNote())
    renderSection()

    const textarea = screen.getByLabelText(/add a note/i)
    await user.type(textarea, 'Handover: meds given at 8am.')
    await user.click(screen.getByRole('button', { name: /add note/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledWith('Handover: meds given at 8am.')
    await waitFor(() => expect(textarea).toHaveValue(''))
  })

  it('shows a pending state on the submit button while saving', () => {
    mockUseShiftNotes.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: mockRefetch })
    mockUseCreateShiftNote.mockReturnValue({ mutateAsync: mockCreateMutateAsync, isPending: true })
    renderSection()

    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled()
  })

  it('shows an error message when the create request fails, without losing the draft', async () => {
    const user = userEvent.setup()
    mockUseShiftNotes.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: mockRefetch })
    mockCreateMutateAsync.mockRejectedValue(new Error('network error'))
    renderSection()

    const textarea = screen.getByLabelText(/add a note/i)
    await user.type(textarea, 'This should fail to save.')
    await user.click(screen.getByRole('button', { name: /add note/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't save your note/i)
    expect(textarea).toHaveValue('This should fail to save.')
  })

  it('shows a character counter that reflects the current draft length', async () => {
    const user = userEvent.setup()
    mockUseShiftNotes.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: mockRefetch })
    renderSection()

    await user.type(screen.getByLabelText(/add a note/i), 'Hello')

    expect(screen.getByText('5 / 1000')).toBeInTheDocument()
  })

  it("offers an Edit action only on the current user's own note", () => {
    setCurrentUser('user-1')
    mockUseShiftNotes.mockReturnValue({
      data: [makeNote({ id: 'note-mine', authorUserId: 'user-1' }), makeNote({ id: 'note-theirs', authorUserId: 'user-2', authorName: 'Cara Lee' })],
      isLoading: false, isError: false, refetch: mockRefetch,
    })
    renderSection()

    expect(screen.getAllByRole('button', { name: /edit/i })).toHaveLength(1)
  })

  it('lets the author edit and save their own note', async () => {
    const user = userEvent.setup()
    setCurrentUser('user-1')
    mockUseShiftNotes.mockReturnValue({ data: [makeNote({ authorUserId: 'user-1' })], isLoading: false, isError: false, refetch: mockRefetch })
    mockUpdateMutateAsync.mockResolvedValue(makeNote({ body: 'Corrected note.' }))
    renderSection()

    await user.click(screen.getByRole('button', { name: /edit/i }))
    const editTextarea = screen.getByLabelText(/edit note/i)
    await user.clear(editTextarea)
    await user.type(editTextarea, 'Corrected note.')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(mockUpdateMutateAsync).toHaveBeenCalledWith({ id: 'note-1', body: 'Corrected note.' })
  })

  describe('NOTES-02 keyword flagging', () => {
    it('shows a banner on a flagged, unacknowledged note', () => {
      mockUseShiftNotes.mockReturnValue({
        data: [makeNote({ body: 'She had a fall near the bathroom.', flaggedCategories: ['Falls'] })],
        isLoading: false, isError: false, refetch: mockRefetch,
      })
      renderSection()

      expect(screen.getByRole('status')).toHaveTextContent(/this note mentions falls/i)
      expect(screen.getByRole('button', { name: /file incident report/i })).toBeInTheDocument()
    })

    it('joins multiple flagged categories in the banner text', () => {
      mockUseShiftNotes.mockReturnValue({
        data: [makeNote({ flaggedCategories: ['Falls', 'Medication'] })],
        isLoading: false, isError: false, refetch: mockRefetch,
      })
      renderSection()

      expect(screen.getByRole('status')).toHaveTextContent(/this note mentions falls and medication/i)
    })

    it('does not show a banner on an unflagged note', () => {
      mockUseShiftNotes.mockReturnValue({ data: [makeNote({ flaggedCategories: [] })], isLoading: false, isError: false, refetch: mockRefetch })
      renderSection()

      expect(screen.queryByRole('button', { name: /file incident report/i })).not.toBeInTheDocument()
    })

    it('does not show a banner on a flagged note that has already been acknowledged', () => {
      mockUseShiftNotes.mockReturnValue({
        data: [makeNote({ flaggedCategories: ['Falls'], flagsAcknowledgedAt: '2026-08-17T10:00:00Z' })],
        isLoading: false, isError: false, refetch: mockRefetch,
      })
      renderSection()

      expect(screen.queryByRole('button', { name: /file incident report/i })).not.toBeInTheDocument()
    })

    it('dismisses the banner by acknowledging the flags', async () => {
      const user = userEvent.setup()
      mockUseShiftNotes.mockReturnValue({
        data: [makeNote({ id: 'note-9', flaggedCategories: ['Injury'] })],
        isLoading: false, isError: false, refetch: mockRefetch,
      })
      renderSection()

      await user.click(screen.getByRole('button', { name: /dismiss/i }))

      expect(mockAcknowledgeMutate).toHaveBeenCalledWith('note-9')
    })

    it('routes to the incident create page with the shift/participant context on "File incident report"', async () => {
      const user = userEvent.setup()
      mockUseShiftNotes.mockReturnValue({
        data: [makeNote({ id: 'note-9', body: 'She had a fall near the bathroom.', flaggedCategories: ['Falls'] })],
        isLoading: false, isError: false, refetch: mockRefetch,
      })
      setCurrentUser('user-42')
      renderSection({ participantId: 'participant-9', participantName: 'Sophie Brown', serviceDate: '2026-08-17', startTime: '09:00:00', endTime: '17:00:00', endsNextDay: false })

      await user.click(screen.getByRole('button', { name: /file incident report/i }))

      expect(mockNavigate).toHaveBeenCalledWith('/incidents/new', {
        state: {
          source: 'shift-note',
          shiftNoteId: 'note-9',
          categories: ['Falls'],
          participantId: 'participant-9',
          participantName: 'Sophie Brown',
          noteBody: 'She had a fall near the bathroom.',
          serviceDate: '2026-08-17',
          startTime: '09:00:00',
          endTime: '17:00:00',
          endsNextDay: false,
          reportedByUserId: 'user-42',
        },
      })
    })
  })
})
