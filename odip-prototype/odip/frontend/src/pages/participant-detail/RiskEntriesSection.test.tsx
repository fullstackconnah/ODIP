import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RiskEntriesSection from './RiskEntriesSection'
import type { ParticipantRiskEntryDto } from '@/api/types/risk-entries'

const {
  mockUseParticipantRiskEntries, mockCreateMutateAsync, mockUpdateMutateAsync, mockDeleteMutateAsync,
} = vi.hoisted(() => ({
  mockUseParticipantRiskEntries: vi.fn(() => ({ data: [] as ParticipantRiskEntryDto[], isLoading: false })),
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockDeleteMutateAsync: vi.fn(),
}))

// Only the API layer is mocked — Modal, FormField, ConfirmDialog, Dropdown, EmptyState are the
// real components, mirroring RoutinesTab.test.tsx's approach for the same nested-CRUD shape.
vi.mock('@/api/hooks', () => ({
  useParticipantRiskEntries: mockUseParticipantRiskEntries,
  useCreateRiskEntry: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false }),
  useUpdateRiskEntry: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false }),
  useDeleteRiskEntry: () => ({ mutateAsync: mockDeleteMutateAsync, isPending: false }),
}))

function makeEntry(overrides: Partial<ParticipantRiskEntryDto> = {}): ParticipantRiskEntryDto {
  return {
    id: 'risk-1',
    participantId: 'participant-1',
    atRiskParty: 'Participant',
    description: 'Risk of falls during transfers.',
    mitigationNotes: 'Use the hoist for all transfers.',
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
  mockUseParticipantRiskEntries.mockReturnValue({ data: [], isLoading: false })
  setUserRole('Coordinator')
})

afterEach(() => {
  localStorage.clear()
})

describe('RiskEntriesSection', () => {
  it('renders an empty state when there are no risk entries', () => {
    render(<RiskEntriesSection participantId="participant-1" />)
    expect(screen.getByText('No risks recorded')).toBeInTheDocument()
  })

  it('renders active risk entries with a party badge, description, and mitigation notes', () => {
    mockUseParticipantRiskEntries.mockReturnValue({
      data: [makeEntry({ atRiskParty: 'Staff', description: 'Risk of aggression towards staff.', mitigationNotes: 'Two-person support.' })],
      isLoading: false,
    })

    render(<RiskEntriesSection participantId="participant-1" />)

    expect(screen.getByText('Staff')).toBeInTheDocument()
    expect(screen.getByText('Risk of aggression towards staff.')).toBeInTheDocument()
    expect(screen.getByText(/two-person support/i)).toBeInTheDocument()
  })

  it('hides inactive entries by default, behind a disclosure', async () => {
    const user = userEvent.setup()
    mockUseParticipantRiskEntries.mockReturnValue({
      data: [makeEntry({ id: 'active-1', description: 'Active risk' }), makeEntry({ id: 'inactive-1', description: 'Retired risk', isActive: false })],
      isLoading: false,
    })

    render(<RiskEntriesSection participantId="participant-1" />)

    expect(screen.getByText('Active risk')).toBeInTheDocument()
    expect(screen.queryByText('Retired risk')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /inactive risks/i }))
    expect(screen.getByText('Retired risk')).toBeInTheDocument()
  })

  it('hides Add/Edit/Delete actions for a ReadOnly user', () => {
    setUserRole('ReadOnly')
    mockUseParticipantRiskEntries.mockReturnValue({ data: [makeEntry()], isLoading: false })

    render(<RiskEntriesSection participantId="participant-1" />)

    expect(screen.queryByRole('button', { name: 'Add risk' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('creates a new risk entry via the modal', async () => {
    const user = userEvent.setup()
    mockCreateMutateAsync.mockResolvedValue({ success: true, data: makeEntry() })

    render(<RiskEntriesSection participantId="participant-1" />)

    // Both the header button and the empty-state action read "Add risk" — the header one is first.
    await user.click(screen.getAllByRole('button', { name: 'Add risk' })[0])
    await user.type(screen.getByPlaceholderText('Describe the risk...'), 'Risk of wandering.')
    await user.click(screen.getByRole('button', { name: 'Save risk entry' }))

    expect(mockCreateMutateAsync).toHaveBeenCalledWith({
      participantId: 'participant-1',
      data: { atRiskParty: 'Participant', description: 'Risk of wandering.', mitigationNotes: null, isActive: true },
    })
  })

  it('blocks save when description is blank', async () => {
    const user = userEvent.setup()

    render(<RiskEntriesSection participantId="participant-1" />)

    await user.click(screen.getAllByRole('button', { name: 'Add risk' })[0])
    await user.click(screen.getByRole('button', { name: 'Save risk entry' }))

    expect(screen.getByText('Description is required')).toBeInTheDocument()
    expect(mockCreateMutateAsync).not.toHaveBeenCalled()
  })

  it('edits an existing risk entry and can retire it', async () => {
    const user = userEvent.setup()
    const entry = makeEntry()
    mockUseParticipantRiskEntries.mockReturnValue({ data: [entry], isLoading: false })
    mockUpdateMutateAsync.mockResolvedValue({ success: true, data: { ...entry, isActive: false } })

    render(<RiskEntriesSection participantId="participant-1" />)

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByLabelText('Active'))
    await user.click(screen.getByRole('button', { name: 'Save risk entry' }))

    expect(mockUpdateMutateAsync).toHaveBeenCalledWith({
      id: entry.id,
      data: { atRiskParty: 'Participant', description: entry.description, mitigationNotes: entry.mitigationNotes, isActive: false },
    })
  })

  it('deletes a risk entry after confirmation', async () => {
    const user = userEvent.setup()
    const entry = makeEntry()
    mockUseParticipantRiskEntries.mockReturnValue({ data: [entry], isLoading: false })
    mockDeleteMutateAsync.mockResolvedValue({ success: true, data: true })

    render(<RiskEntriesSection participantId="participant-1" />)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(mockDeleteMutateAsync).toHaveBeenCalledWith({ id: entry.id, participantId: 'participant-1' })
  })
})
