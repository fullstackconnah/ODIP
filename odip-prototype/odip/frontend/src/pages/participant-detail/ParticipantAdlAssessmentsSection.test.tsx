import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ParticipantAdlAssessmentsSection from './ParticipantAdlAssessmentsSection'
import { ADL_TYPES } from '@/api/types/enums'
import type { ParticipantAdlAssessmentDto } from '@/api/types/adl-assessments'

const {
  mockUseParticipantAdlAssessments, mockUpsertMutateAsync,
} = vi.hoisted(() => ({
  mockUseParticipantAdlAssessments: vi.fn(() => ({ data: [] as ParticipantAdlAssessmentDto[], isLoading: false })),
  mockUpsertMutateAsync: vi.fn(),
}))

// Only the API layer is mocked — Modal, FormField, ToggleGroup, StatusBadge, DataTable are the
// real components, mirroring ParticipantHealthConditionsSection.test.tsx's approach for the same
// fixed-enumerated-set nested-CRUD shape.
vi.mock('@/api/hooks', () => ({
  useParticipantAdlAssessments: mockUseParticipantAdlAssessments,
  useUpsertAdlAssessment: () => ({ mutateAsync: mockUpsertMutateAsync, isPending: false }),
}))

// One placeholder row per AdlType (Id=null, Level=null) — matches what
// ParticipantAdlAssessmentsController.GetForParticipant actually returns for a participant with
// no answered ADLs yet.
function unassessedRows(): ParticipantAdlAssessmentDto[] {
  return ADL_TYPES.map((type) => ({
    id: null, participantId: 'participant-1', adlType: type,
    level: null, notes: null, createdAt: null, updatedAt: null,
  }))
}

function makeAssessment(overrides: Partial<ParticipantAdlAssessmentDto> = {}): ParticipantAdlAssessmentDto {
  return {
    id: 'adl-1', participantId: 'participant-1', adlType: 'Dressing',
    level: null, notes: null,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/**
 * Replaces the row for `overrides.adlType` IN PLACE at its actual ADL_TYPES index — not a fixed
 * array position, which would silently duplicate one type and drop another (the component looks
 * up each row by adlType, not array position).
 */
function replaceAssessment(data: ParticipantAdlAssessmentDto[], overrides: Partial<ParticipantAdlAssessmentDto> & { adlType: ParticipantAdlAssessmentDto['adlType'] }): void {
  const index = ADL_TYPES.indexOf(overrides.adlType)
  data[index] = makeAssessment(overrides)
}

function setUserRole(role: string) {
  localStorage.setItem('odip_user', JSON.stringify({ role }))
}

beforeEach(() => {
  mockUpsertMutateAsync.mockClear()
  mockUseParticipantAdlAssessments.mockReturnValue({ data: unassessedRows(), isLoading: false })
  setUserRole('Coordinator')
})

afterEach(() => {
  localStorage.clear()
})

describe('ParticipantAdlAssessmentsSection', () => {
  it('renders all twenty ADL types as table rows, split across Personal and Community & Domestic sections, all "Not assessed" when nothing has been answered', () => {
    render(<ParticipantAdlAssessmentsSection participantId="participant-1" />)

    expect(screen.getByText('Dressing')).toBeInTheDocument()
    expect(screen.getByText('Banking')).toBeInTheDocument()
    expect(screen.getAllByText('Not assessed')).toHaveLength(20)

    // Personal ADLs and Community & Domestic ADLs render as two separate section headings.
    expect(screen.getByRole('heading', { name: /personal adls/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /community & domestic adls/i })).toBeInTheDocument()
  })

  it('shows a level status badge and notes for an answered row', () => {
    const data = unassessedRows()
    replaceAssessment(data, { adlType: 'Dressing', level: 'Independent' })
    replaceAssessment(data, { id: 'adl-2', adlType: 'CommunityAccess', level: 'Assistance', notes: '1:1 supervision' })
    mockUseParticipantAdlAssessments.mockReturnValue({ data, isLoading: false })

    render(<ParticipantAdlAssessmentsSection participantId="participant-1" />)

    const dressingRow = screen.getByText('Dressing').closest('tr')!
    expect(within(dressingRow).getByText(/independent/i)).toBeInTheDocument()

    const communityRow = screen.getByText('Community Access').closest('tr')!
    expect(within(communityRow).getByText(/assistance/i)).toBeInTheDocument()
    expect(within(communityRow).getByText('1:1 supervision')).toBeInTheDocument()

    expect(screen.getAllByText('Not assessed')).toHaveLength(18)
  })

  it('hides the Edit action for a role without ADL-assessment-write permission (e.g. SupportWorker)', () => {
    setUserRole('SupportWorker')
    render(<ParticipantAdlAssessmentsSection participantId="participant-1" />)

    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('opens the edit modal for a row, sets a level, fills in notes, and upserts', async () => {
    const user = userEvent.setup()
    mockUpsertMutateAsync.mockResolvedValue({ success: true, data: makeAssessment({ level: 'Supervision' }) })

    render(<ParticipantAdlAssessmentsSection participantId="participant-1" />)

    const bathingRow = screen.getByText('Bathing / Showering').closest('tr')!
    await user.click(within(bathingRow).getByRole('button', { name: 'Edit' }))

    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: 'S' }))
    await user.type(within(dialog).getByLabelText('Notes'), 'Standby supervision in the shower.')
    await user.click(within(dialog).getByRole('button', { name: 'Save assessment' }))

    expect(mockUpsertMutateAsync).toHaveBeenCalledWith({
      participantId: 'participant-1',
      adlType: 'Bathing',
      data: { level: 'Supervision', notes: 'Standby supervision in the shower.' },
    })
  })

  it('editing an assessed row back to "Not assessed" clears notes from the upsert payload', async () => {
    const user = userEvent.setup()
    const data = unassessedRows()
    replaceAssessment(data, { id: 'adl-1', adlType: 'Kitchen', level: 'Independent', notes: 'No support needed.' })
    mockUseParticipantAdlAssessments.mockReturnValue({ data, isLoading: false })
    mockUpsertMutateAsync.mockResolvedValue({ success: true, data: makeAssessment({ level: null }) })

    render(<ParticipantAdlAssessmentsSection participantId="participant-1" />)

    const kitchenRow = screen.getByText('Kitchen').closest('tr')!
    await user.click(within(kitchenRow).getByRole('button', { name: 'Edit' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByLabelText('Notes')).toHaveValue('No support needed.')
    await user.click(within(dialog).getByRole('radio', { name: 'Not assessed' }))
    expect(within(dialog).queryByLabelText('Notes')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Save assessment' }))

    expect(mockUpsertMutateAsync).toHaveBeenCalledWith({
      participantId: 'participant-1',
      adlType: 'Kitchen',
      data: { level: null, notes: null },
    })
  })

  it('the modal exposes a real accessible name on the Level radiogroup', async () => {
    const user = userEvent.setup()
    render(<ParticipantAdlAssessmentsSection participantId="participant-1" />)

    const groomingRow = screen.getByText('Grooming').closest('tr')!
    await user.click(within(groomingRow).getByRole('button', { name: 'Edit' }))

    const dialog = screen.getByRole('dialog')
    // Proof, not a DOM-proximity guess — getByRole('radiogroup', { name }) only finds a match if
    // ToggleGroup's ariaLabel is actually wired through.
    expect(within(dialog).getByRole('radiogroup', { name: 'Level' })).toBeInTheDocument()
  })
})
