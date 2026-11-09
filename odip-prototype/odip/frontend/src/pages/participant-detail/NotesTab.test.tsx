import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import NotesTab from './NotesTab'
import type { ParticipantNoteDto } from '@/api/types/notes'

const {
  mockUseParticipantNotes, mockCreateMutateAsync, mockUpdateMutateAsync,
  mockDismissDriftMutateAsync, mockRegenerateMutateAsync,
} = vi.hoisted(() => ({
  mockUseParticipantNotes: vi.fn(() => ({ data: [] as ParticipantNoteDto[], isLoading: false })),
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockDismissDriftMutateAsync: vi.fn(),
  mockRegenerateMutateAsync: vi.fn(),
}))

// Only the API layer is mocked — Modal, FormField, ConfirmDialog, EmptyState are the real
// components, so this exercises the actual add/edit/archive/drift-hint wiring.
vi.mock('@/api/hooks', () => ({
  useParticipantNotes: mockUseParticipantNotes,
  useCreateNote: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false }),
  useUpdateNote: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false }),
  useDismissNoteDrift: () => ({ mutateAsync: mockDismissDriftMutateAsync, isPending: false }),
  useRegenerateNote: () => ({ mutateAsync: mockRegenerateMutateAsync, isPending: false }),
}))

function makeNote(overrides: Partial<ParticipantNoteDto> = {}): ParticipantNoteDto {
  return {
    id: 'note-1',
    participantId: 'participant-1',
    title: 'Haircut preference',
    description: 'Short bob, above the shoulders.',
    isPinned: false,
    isArchived: false,
    createdByName: 'Sam Coordinator',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    sourceKey: null,
    hasSourceDrift: false,
    ...overrides,
  }
}

function setUserRole(role: string) {
  localStorage.setItem('odip_user', JSON.stringify({ role }))
}

beforeEach(() => {
  mockCreateMutateAsync.mockClear()
  mockUpdateMutateAsync.mockClear()
  mockDismissDriftMutateAsync.mockClear()
  mockRegenerateMutateAsync.mockClear()
  mockUseParticipantNotes.mockReturnValue({ data: [], isLoading: false })
  setUserRole('Coordinator')
})

afterEach(() => {
  localStorage.clear()
})

describe('NotesTab', () => {
  it('renders an empty state when there are no notes', () => {
    render(<NotesTab participantId="participant-1" />, { wrapper: MemoryRouter })
    expect(screen.getByText('No notes yet')).toBeInTheDocument()
  })

  // ── PD-5: auto-generated note distinguished from a manual one ──────────

  it('renders an "Auto-generated" tag on an auto note but not on a manual note', () => {
    mockUseParticipantNotes.mockReturnValue({
      data: [
        makeNote({ id: 'manual-1', title: 'Manual note', sourceKey: null }),
        makeNote({ id: 'auto-1', title: 'Allergies (auto)', sourceKey: 'safety:allergies' }),
      ],
      isLoading: false,
    })

    render(<NotesTab participantId="participant-1" />, { wrapper: MemoryRouter })

    // The tag renders as a sibling of the title within the same title-row wrapper.
    const manualTitleRow = screen.getByText('Manual note').closest('div')!
    const autoTitleRow = screen.getByText('Allergies (auto)').closest('div')!
    expect(within(manualTitleRow).queryByText('Auto-generated')).not.toBeInTheDocument()
    expect(within(autoTitleRow).getByText('Auto-generated')).toBeInTheDocument()
  })

  it('does not render the drift hint for a note with no drift', () => {
    mockUseParticipantNotes.mockReturnValue({
      data: [makeNote({ sourceKey: 'safety:allergies', hasSourceDrift: false })],
      isLoading: false,
    })

    render(<NotesTab participantId="participant-1" />, { wrapper: MemoryRouter })

    expect(screen.queryByText(/source data has changed/i)).not.toBeInTheDocument()
  })

  // ── PD-5: drift hint + both its actions ─────────────────────────────────

  it('renders the drift hint with working Dismiss and Regenerate actions when hasSourceDrift is true', async () => {
    const user = userEvent.setup()
    mockUseParticipantNotes.mockReturnValue({
      data: [makeNote({ id: 'auto-1', sourceKey: 'safety:allergies', hasSourceDrift: true })],
      isLoading: false,
    })

    render(<NotesTab participantId="participant-1" />, { wrapper: MemoryRouter })

    expect(screen.getByText(/source data has changed since this note was edited/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(mockDismissDriftMutateAsync).toHaveBeenCalledWith('auto-1')

    await user.click(screen.getByRole('button', { name: 'Regenerate' }))
    expect(mockRegenerateMutateAsync).toHaveBeenCalledWith('auto-1')
  })

  it('styles the drift hint with the warning tokens, not raw amber', () => {
    mockUseParticipantNotes.mockReturnValue({
      data: [makeNote({ sourceKey: 'safety:allergies', hasSourceDrift: true })],
      isLoading: false,
    })

    render(<NotesTab participantId="participant-1" />, { wrapper: MemoryRouter })

    const hint = screen.getByText(/source data has changed since this note was edited/i).closest('[class*="warning-container"]') as HTMLElement
    expect(hint).not.toBeNull()
    // amber-50 -> warning container, amber-800 -> on-warning container, amber-200 -> the warning colour at 40%.
    expect(hint).toHaveClass(
      'bg-[var(--color-warning-container)]',
      'text-[var(--color-on-warning-container)]',
      'border-[var(--color-warning)]/40',
    )
    expect(hint.className).not.toMatch(/amber-/)
  })

  it('hides the drift hint actions for a ReadOnly user', () => {
    setUserRole('ReadOnly')
    mockUseParticipantNotes.mockReturnValue({
      data: [makeNote({ sourceKey: 'safety:allergies', hasSourceDrift: true })],
      isLoading: false,
    })

    render(<NotesTab participantId="participant-1" />, { wrapper: MemoryRouter })

    expect(screen.getByText(/source data has changed/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Regenerate' })).not.toBeInTheDocument()
  })

  // ── PD-5: editing an auto-note doesn't crash/lose data ──────────────────

  it('editing an auto-note pre-fills the form and saves via the normal update path', async () => {
    const user = userEvent.setup()
    mockUseParticipantNotes.mockReturnValue({
      data: [makeNote({
        id: 'auto-1', title: 'Allergies (auto)', description: 'Allergies: Peanuts',
        sourceKey: 'safety:allergies', hasSourceDrift: false,
      })],
      isLoading: false,
    })

    render(<NotesTab participantId="participant-1" />, { wrapper: MemoryRouter })

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText(/title/i)).toHaveValue('Allergies (auto)')
    expect(screen.getByLabelText(/description/i)).toHaveValue('Allergies: Peanuts')

    await user.clear(screen.getByLabelText(/description/i))
    await user.type(screen.getByLabelText(/description/i), 'Clinician-confirmed: severe peanut allergy, EpiPen in bag.')
    await user.click(screen.getByRole('button', { name: /save note/i }))

    expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1)
    const [call] = mockUpdateMutateAsync.mock.calls[0]
    expect(call.id).toBe('auto-1')
    expect(call.data.title).toBe('Allergies (auto)')
    expect(call.data.description).toBe('Clinician-confirmed: severe peanut allergy, EpiPen in bag.')
  })

  // ── Archive / restore flow ───────────────────────────────────────────────

  it('archives a note after confirmation', async () => {
    const user = userEvent.setup()
    mockUseParticipantNotes.mockReturnValue({ data: [makeNote()], isLoading: false })

    render(<NotesTab participantId="participant-1" />, { wrapper: MemoryRouter })

    await user.click(screen.getByRole('button', { name: 'Archive' }))
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }))

    expect(mockUpdateMutateAsync).toHaveBeenCalledWith({
      id: 'note-1',
      data: { title: 'Haircut preference', description: 'Short bob, above the shoulders.', isPinned: false, isArchived: true },
    })
  })

  it('restores an archived note', async () => {
    const user = userEvent.setup()
    mockUseParticipantNotes.mockReturnValue({ data: [makeNote({ isArchived: true })], isLoading: false })

    render(<NotesTab participantId="participant-1" />, { wrapper: MemoryRouter })

    // Archived notes are collapsed behind the "Archived" toggle.
    await user.click(screen.getByRole('button', { name: /archived/i }))
    await user.click(screen.getByRole('button', { name: 'Restore' }))

    expect(mockUpdateMutateAsync).toHaveBeenCalledWith({
      id: 'note-1',
      data: { title: 'Haircut preference', description: 'Short bob, above the shoulders.', isPinned: false, isArchived: false },
    })
  })

  it('creates a new note with the entered title, description and pin flag', async () => {
    const user = userEvent.setup()
    render(<NotesTab participantId="participant-1" />, { wrapper: MemoryRouter })

    // The header button and the empty-state action both read "New note" — the header one is first.
    await user.click(screen.getAllByRole('button', { name: /new note/i })[0])
    await user.type(screen.getByLabelText(/title/i), 'Evening wind-down')
    await user.type(screen.getByLabelText(/description/i), 'Dim the lights from 8pm.')
    await user.click(screen.getByRole('button', { name: /save note/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    const [call] = mockCreateMutateAsync.mock.calls[0]
    expect(call.participantId).toBe('participant-1')
    expect(call.data.title).toBe('Evening wind-down')
    expect(call.data.description).toBe('Dim the lights from 8pm.')
  })

  async function addNote(user: ReturnType<typeof userEvent.setup>, title: string) {
    await user.click(screen.getAllByRole('button', { name: /new note/i })[0])
    await user.type(screen.getByLabelText(/title/i), title)
    await user.type(screen.getByLabelText(/description/i), 'Dim the lights from 8pm.')
    await user.click(screen.getByRole('button', { name: /save note/i }))
  }

  it('a rejected first save and a second press in the same modal send the same retry key; a new opening sends a new one', async () => {
    const user = userEvent.setup()
    mockCreateMutateAsync.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({})
    render(<NotesTab participantId="participant-1" />, { wrapper: MemoryRouter })

    await addNote(user, 'Evening wind-down')
    await screen.findByText(/failed to save note|offline/i)
    await user.click(screen.getByRole('button', { name: /save note/i }))
    await addNote(user, 'Morning routine')

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(3)
    const [first, second, third] = mockCreateMutateAsync.mock.calls.map(([c]) => c.data.idempotencyKey)
    expect(first).toEqual(expect.any(String))
    expect(first.length).toBeGreaterThan(0)
    expect(second).toBe(first)
    expect(third).toEqual(expect.any(String))
    expect(third).not.toBe(first)
  })

  it('an edit sends no retry key', async () => {
    const user = userEvent.setup()
    mockUseParticipantNotes.mockReturnValue({ data: [makeNote()], isLoading: false })
    render(<NotesTab participantId="participant-1" />, { wrapper: MemoryRouter })

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByLabelText(/title/i), ' updated')
    await user.click(screen.getByRole('button', { name: /save note/i }))

    expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockUpdateMutateAsync.mock.calls[0][0].data).not.toHaveProperty('idempotencyKey')
  })

  it('row actions work: Edit opens the edit form, Archive only asks until confirmed', async () => {
    const user = userEvent.setup()
    mockUseParticipantNotes.mockReturnValue({ data: [makeNote()], isLoading: false })

    render(<NotesTab participantId="participant-1" />, { wrapper: MemoryRouter })

    await user.click(screen.getByRole('button', { name: 'Archive' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(mockUpdateMutateAsync).not.toHaveBeenCalled()
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('dialog', { name: 'Edit note' })).toBeInTheDocument()
    expect(screen.getByLabelText(/title/i)).toHaveValue('Haircut preference')
  })

  it('hides write actions for a ReadOnly user', () => {
    setUserRole('ReadOnly')
    mockUseParticipantNotes.mockReturnValue({ data: [makeNote()], isLoading: false })

    render(<NotesTab participantId="participant-1" />, { wrapper: MemoryRouter })

    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /new note/i })).not.toBeInTheDocument()
  })
})

describe('NotesTab — how long ago', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads the age of a note in running text (formatRelative, long), counting a timestamp sent without a zone as UTC', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-30T13:30:00Z'))
    mockUseParticipantNotes.mockReturnValue({
      data: [
        makeNote({ id: 'a', title: 'Two days', createdAt: '2026-09-28T12:00:00Z' }),
        makeNote({ id: 'b', title: 'Zone-less', createdAt: '2026-09-30T11:30:00' }),
        makeNote({ id: 'c', title: 'Moments', createdAt: '2026-09-30T13:29:40Z' }),
        makeNote({ id: 'd', title: 'Old', createdAt: '2026-06-22T00:00:00Z' }),
      ],
      isLoading: false,
    })
    render(<NotesTab participantId="participant-1" />, { wrapper: MemoryRouter })

    expect(screen.getByText(/Sam Coordinator · 2 days ago/)).toBeInTheDocument()
    expect(screen.getByText(/Sam Coordinator · 2 hrs ago/)).toBeInTheDocument()
    expect(screen.getByText(/Sam Coordinator · just now/)).toBeInTheDocument()
    expect(screen.getByText(/Sam Coordinator · 3 months ago/)).toBeInTheDocument()
  })
})

describe('NotesTab — long list (T10)', () => {
  it('shows 5 of 23 active notes, then all 23 with focus on the 6th row', async () => {
    const user = userEvent.setup()
    mockUseParticipantNotes.mockReturnValue({
      data: Array.from({ length: 23 }, (_, i) => makeNote({ id: `n${i}`, title: `Note ${i}` })),
      isLoading: false,
    })
    const { container } = render(<NotesTab participantId="participant-1" />, { wrapper: MemoryRouter })
    expect(container.querySelectorAll('[data-show-row]')).toHaveLength(5)
    await user.click(screen.getByRole('button', { name: 'Show all 23' }))
    const rows = container.querySelectorAll('[data-show-row]')
    expect(rows).toHaveLength(23)
    expect(rows[5]).toHaveFocus()
  })
})

function Where() {
  const { pathname, search } = useLocation()
  return <p data-testid="where">{pathname + search}</p>
}

describe('Quick add from the Overview (?add=1)', () => {
  const url = '/p?tab=records&section=notes&add=1'
  const renderAt = (entry: string) => render(<MemoryRouter initialEntries={[entry]}><NotesTab participantId="participant-1" /><Where /></MemoryRouter>)

  it('opens the add once, removes the param with replace, and returns focus to the section Add button on close', async () => {
    const user = userEvent.setup()
    renderAt(url)
    expect(await screen.findByRole('dialog', { name: /New note/i })).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/p?tab=records&section=notes')
    expect(screen.getByTestId('where')).not.toHaveTextContent('add=1')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /New note/i })[0]).toHaveFocus()
  })

  it('does not reopen after the param is gone (refresh, Back)', async () => {
    renderAt('/p?tab=records&section=notes')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a role without the write gate opens nothing and still drops the param', async () => {
    setUserRole('ReadOnly')
    renderAt(url)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('where')).not.toHaveTextContent('add=1')
  })
})

describe('NotesTab — unsaved text', () => {
  it('Escape after typing asks before discarding; Keep editing keeps the text; a clean New note closes at once', async () => {
    const user = userEvent.setup()
    render(<NotesTab participantId="participant-1" />, { wrapper: MemoryRouter })
    await user.click(screen.getAllByRole('button', { name: /new note/i })[0])
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: /new note/i })[0])
    await user.type(screen.getByLabelText(/title/i), 'Evening')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog', { name: 'Discard changes?' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByLabelText(/title/i)).toHaveValue('Evening')
  })

  it('editing: an untouched note closes at once, a changed one asks', async () => {
    const user = userEvent.setup()
    mockUseParticipantNotes.mockReturnValue({ data: [makeNote()], isLoading: false })
    render(<NotesTab participantId="participant-1" />, { wrapper: MemoryRouter })
    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /edit/i }))
    await user.type(screen.getByLabelText(/title/i), ' ')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })
})
