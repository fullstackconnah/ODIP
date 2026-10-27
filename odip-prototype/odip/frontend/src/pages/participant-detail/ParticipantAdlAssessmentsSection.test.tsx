import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
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
    level: null, notes: null, howToHelpNotes: null, createdAt: null, updatedAt: null,
  }))
}

function makeAssessment(overrides: Partial<ParticipantAdlAssessmentDto> = {}): ParticipantAdlAssessmentDto {
  return {
    id: 'adl-1', participantId: 'participant-1', adlType: 'Dressing',
    level: null, notes: null, howToHelpNotes: null,
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

    expect(screen.getByText('18 of 20 not assessed')).toBeInTheDocument()
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

  // INTAKE-03, CommunityAccessDailyLiving stream — howToHelpNotes' "How To Help Me" column is
  // its own opt-in table column (see columns()'s `...(assessments.some(a => a.howToHelpNotes) ?
  // [...] : [])` spread in the component), not a plain per-row conditional cell: it only exists
  // at all once ANY row across the whole grid actually has a value, matching this page's
  // whole-card/column presence-or-relevance idiom rather than showing an all-"—" column for a
  // participant who was never in the CA stream.
  it('shows the "How To Help Me" column, and only that column, once any row has howToHelpNotes', async () => {
    const user = userEvent.setup()
    const data = unassessedRows()
    replaceAssessment(data, { adlType: 'Dressing', level: 'Independent', howToHelpNotes: 'Lay out clothes in order.' })
    mockUseParticipantAdlAssessments.mockReturnValue({ data, isLoading: false })

    render(<ParticipantAdlAssessmentsSection participantId="participant-1" />)
    await user.click(screen.getByRole('button', { name: 'Add an assessment' }))

    // The column is added to BOTH grouped tables (Personal + Community & Domestic) once ANY row
    // across the whole grid has howToHelpNotes — the presence check in the component isn't
    // per-table.
    expect(screen.getAllByRole('columnheader', { name: 'How To Help Me' })).toHaveLength(2)
    const dressingRow = screen.getByText('Dressing').closest('tr')!
    expect(within(dressingRow).getByText('Lay out clothes in order.')).toBeInTheDocument()
    // A row with no howToHelpNotes of its own still renders the column, with the shared "—" empty
    // cell (alongside Notes' own "—", also empty for this row — two "—" cells, not zero).
    const kitchenRow = screen.getByText('Kitchen').closest('tr')!
    expect(within(kitchenRow).getAllByText('—')).toHaveLength(2)
  })

  it('hides the "How To Help Me" column entirely when no row has howToHelpNotes (e.g. a non-CA participant)', () => {
    render(<ParticipantAdlAssessmentsSection participantId="participant-1" />)

    expect(screen.queryByRole('columnheader', { name: 'How To Help Me' })).not.toBeInTheDocument()
    expect(screen.queryByText('Lay out clothes in order.')).not.toBeInTheDocument()
  })
})

// T9: a fixed list shows what is answered, counts the rest, and lets an editor reveal them.
describe('ParticipantAdlAssessmentsSection — fixed list (T9)', () => {
  function threeAnswered() {
    const data = unassessedRows()
    for (const adlType of ADL_TYPES.slice(0, 3)) replaceAssessment(data, { id: 'adl-' + adlType, adlType, level: 'Independent' })
    mockUseParticipantAdlAssessments.mockReturnValue({ data, isLoading: false })
  }

  it('shows 3 answered rows and the count line; the editor reveals the rest and focuses the 4th row', async () => {
    const user = userEvent.setup()
    threeAnswered()
    render(<ParticipantAdlAssessmentsSection participantId="participant-1" />)
    expect(document.querySelectorAll('tbody tr')).toHaveLength(3)
    expect(screen.getByText('17 of 20 not assessed')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add an assessment' }))
    const rows = document.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(20)
    await waitFor(() => expect(within(rows[3] as HTMLElement).getByRole('button', { name: 'Edit' })).toHaveFocus())
    await user.click(screen.getByRole('button', { name: 'Show answered only' }))
    expect(document.querySelectorAll('tbody tr')).toHaveLength(3)
  })

  it('offers no reveal button to a role that cannot edit', () => {
    setUserRole('SupportWorker')
    threeAnswered()
    render(<ParticipantAdlAssessmentsSection participantId="participant-1" />)
    expect(screen.getByText('17 of 20 not assessed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add an assessment' })).not.toBeInTheDocument()
  })

  it('with nothing assessed: an editor gets a closed fold holding the rows, a viewer one plain line', () => {
    const { unmount } = render(<ParticipantAdlAssessmentsSection participantId="participant-1" />)
    const fold = screen.getByText('Not recorded: Daily living').closest('details')!
    expect(fold).not.toHaveAttribute('open')
    expect(fold).toContainElement(screen.getByText('Dressing'))
    expect(screen.getByText('20 of 20 not assessed')).toBeInTheDocument()
    unmount()

    setUserRole('SupportWorker')
    render(<ParticipantAdlAssessmentsSection participantId="participant-1" />)
    expect(screen.getByText('Not recorded: Daily living').closest('details')).toBeNull()
    expect(screen.queryByText('Dressing')).not.toBeInTheDocument()
  })
})

describe('ParticipantAdlAssessmentsSection — shared column layout', () => {
  it('gives the personal and community/domestic tables the same column widths, so Level starts at the same x', () => {
    render(<ParticipantAdlAssessmentsSection participantId="participant-1" />)

    const [personal, community] = Array.from(document.querySelectorAll('table'))
    const widths = (table: Element) => Array.from(table.querySelector('tbody tr')!.children).map((td) => td.className)
    expect(widths(personal)).toEqual(widths(community))
    const colWidths = Array.from(personal.querySelector('tbody tr')!.children).map((td) => td.getAttribute('style')?.match(/--col-w: ([^;]+)/)?.[1])
    expect(colWidths).toEqual(['22%', '14%', undefined, '72px'])
  })
})

describe('ParticipantAdlAssessmentsSection — long notes and header widths', () => {
  it('shows a 400-character note in full, not cut off', () => {
    const note = 'x'.repeat(400)
    const data = unassessedRows()
    replaceAssessment(data, { adlType: 'Dressing', level: 'Assistance', notes: note })
    mockUseParticipantAdlAssessments.mockReturnValue({ data, isLoading: false })
    render(<ParticipantAdlAssessmentsSection participantId="participant-1" />)

    const cell = screen.getByText(note)
    expect(cell.className).not.toMatch(/truncate/)
    expect(cell).not.toHaveAttribute('title')
  })

  it('lets an unbroken note (a pasted URL) wrap inside its column instead of widening the table', () => {
    const note = 'https://example.com/' + 'a'.repeat(300)
    const data = unassessedRows()
    replaceAssessment(data, { adlType: 'Dressing', level: 'Assistance', notes: note, howToHelpNotes: note })
    mockUseParticipantAdlAssessments.mockReturnValue({ data, isLoading: false })
    render(<ParticipantAdlAssessmentsSection participantId="participant-1" />)

    const cells = screen.getAllByText(note)
    expect(cells).toHaveLength(2)
    for (const cell of cells) expect(cell.className).toContain('[overflow-wrap:anywhere]')
  })

  it('puts the Level width on the header, so a table with no rows keeps its columns', () => {
    render(<ParticipantAdlAssessmentsSection participantId="participant-1" />)

    for (const th of screen.getAllByRole('columnheader', { name: 'Level' })) {
      expect(th.getAttribute('style')).toContain('--col-w: 14%')
    }
  })
})
