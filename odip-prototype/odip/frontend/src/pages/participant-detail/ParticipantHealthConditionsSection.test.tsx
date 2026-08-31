import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ParticipantHealthConditionsSection from './ParticipantHealthConditionsSection'
import { HEALTH_CONDITION_TYPES } from '@/api/types/enums'
import type { ParticipantHealthConditionDto } from '@/api/types/health-conditions'

const {
  mockUseParticipantHealthConditions, mockUpsertMutateAsync,
} = vi.hoisted(() => ({
  mockUseParticipantHealthConditions: vi.fn(() => ({ data: [] as ParticipantHealthConditionDto[], isLoading: false })),
  mockUpsertMutateAsync: vi.fn(),
}))

// Only the API layer is mocked — Modal, FormField, ToggleGroup, StatusBadge, DataTable are the
// real components, mirroring ParticipantConsentsSection.test.tsx's approach for the same
// fixed-enumerated-set nested-CRUD shape.
vi.mock('@/api/hooks', () => ({
  useParticipantHealthConditions: mockUseParticipantHealthConditions,
  useUpsertHealthCondition: () => ({ mutateAsync: mockUpsertMutateAsync, isPending: false }),
}))

// One placeholder row per HealthConditionType (Id=null, Has=null) — matches what
// ParticipantHealthConditionsController.GetForParticipant actually returns for a participant with
// no answered conditions yet.
function unansweredConditions(): ParticipantHealthConditionDto[] {
  return HEALTH_CONDITION_TYPES.map((type) => ({
    id: null, participantId: 'participant-1', conditionType: type,
    has: null, severity: null, planProvided: null, trainingRequired: null, notes: null,
    createdAt: null, updatedAt: null,
  }))
}

function makeCondition(overrides: Partial<ParticipantHealthConditionDto> = {}): ParticipantHealthConditionDto {
  return {
    id: 'hc-1', participantId: 'participant-1', conditionType: 'Epilepsy',
    has: null, severity: null, planProvided: null, trainingRequired: null, notes: null,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/**
 * Replaces the row for `overrides.conditionType` IN PLACE at its actual HEALTH_CONDITION_TYPES
 * index — not a fixed array position, which would silently duplicate one type and drop another
 * (the component looks up each row by conditionType, not array position; see
 * ParticipantHealthConditionsSection.tsx's `ordered` computation).
 */
function replaceCondition(data: ParticipantHealthConditionDto[], overrides: Partial<ParticipantHealthConditionDto> & { conditionType: ParticipantHealthConditionDto['conditionType'] }): void {
  const index = HEALTH_CONDITION_TYPES.indexOf(overrides.conditionType)
  data[index] = makeCondition(overrides)
}

function setUserRole(role: string) {
  localStorage.setItem('odip_user', JSON.stringify({ role }))
}

beforeEach(() => {
  mockUpsertMutateAsync.mockClear()
  mockUseParticipantHealthConditions.mockReturnValue({ data: unansweredConditions(), isLoading: false })
  setUserRole('Coordinator')
})

afterEach(() => {
  localStorage.clear()
})

describe('ParticipantHealthConditionsSection', () => {
  it('renders all ten condition types as table rows, all "Not recorded" when nothing has been answered', () => {
    render(<ParticipantHealthConditionsSection participantId="participant-1" />)

    expect(screen.getByText('Epilepsy')).toBeInTheDocument()
    expect(screen.getByText('Dysphagia')).toBeInTheDocument()
    expect(screen.getAllByText('Not recorded')).toHaveLength(10)
  })

  it('shows Yes/No status distinctly, and severity/plan/training columns for an answered row', () => {
    const data = unansweredConditions()
    replaceCondition(data, { conditionType: 'IntellectualDisability', has: true, severity: 'Mild', planProvided: true, trainingRequired: false })
    replaceCondition(data, { id: 'hc-2', conditionType: 'Asthma', has: false })
    mockUseParticipantHealthConditions.mockReturnValue({ data, isLoading: false })

    render(<ParticipantHealthConditionsSection participantId="participant-1" />)

    const row = screen.getByText('Intellectual Disability').closest('tr')!
    // Two "Yes" cells on this row (Has status badge + Plan Provided="Yes"), plus "No" for
    // Training Required — assert the full set rather than a single ambiguous getByText('Yes').
    expect(within(row).getAllByText('Yes')).toHaveLength(2)
    expect(within(row).getByText('No')).toBeInTheDocument()
    expect(within(row).getByText('Mild')).toBeInTheDocument()

    const asthmaRow = screen.getByText('Asthma').closest('tr')!
    expect(within(asthmaRow).getByText('No')).toBeInTheDocument()

    expect(screen.getAllByText('Not recorded')).toHaveLength(8)
  })

  it('hides the Edit action for a role without health-condition-write permission (e.g. SupportWorker)', () => {
    setUserRole('SupportWorker')
    render(<ParticipantHealthConditionsSection participantId="participant-1" />)

    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('opens the edit modal for a row, answers Yes, fills in severity/plan/training/notes, and upserts', async () => {
    const user = userEvent.setup()
    mockUpsertMutateAsync.mockResolvedValue({ success: true, data: makeCondition({ has: true }) })

    render(<ParticipantHealthConditionsSection participantId="participant-1" />)

    const epilepsyRow = screen.getByText('Epilepsy').closest('tr')!
    await user.click(within(epilepsyRow).getByRole('button', { name: 'Edit' }))

    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: 'Yes' }))
    await user.type(within(dialog).getByLabelText('Severity'), 'GrandMal')
    const planGroup = within(dialog).getByRole('radiogroup', { name: 'Plan Provided' })
    await user.click(within(planGroup).getByRole('radio', { name: 'Yes' }))
    const trainingGroup = within(dialog).getByRole('radiogroup', { name: 'Training Required' })
    await user.click(within(trainingGroup).getByRole('radio', { name: 'Yes' }))
    await user.type(within(dialog).getByLabelText('Notes'), 'Seizure plan on file.')
    await user.click(within(dialog).getByRole('button', { name: 'Save condition' }))

    expect(mockUpsertMutateAsync).toHaveBeenCalledWith({
      participantId: 'participant-1',
      conditionType: 'Epilepsy',
      data: { has: true, severity: 'GrandMal', planProvided: true, trainingRequired: true, notes: 'Seizure plan on file.' },
    })
  })

  it('editing an answered "Yes" row back to No clears severity/plan/training/notes from the upsert payload', async () => {
    const user = userEvent.setup()
    const data = unansweredConditions()
    replaceCondition(data, { id: 'hc-1', conditionType: 'Epilepsy', has: true, severity: 'GrandMal', planProvided: true, trainingRequired: true, notes: 'Seizure plan on file.' })
    mockUseParticipantHealthConditions.mockReturnValue({ data, isLoading: false })
    mockUpsertMutateAsync.mockResolvedValue({ success: true, data: makeCondition({ has: false }) })

    render(<ParticipantHealthConditionsSection participantId="participant-1" />)

    const epilepsyRow = screen.getByText('Epilepsy').closest('tr')!
    await user.click(within(epilepsyRow).getByRole('button', { name: 'Edit' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByLabelText('Severity')).toHaveValue('GrandMal')
    const hasGroup = within(dialog).getByRole('radiogroup', { name: 'Has this condition / support need' })
    await user.click(within(hasGroup).getByRole('radio', { name: 'No' }))
    expect(within(dialog).queryByLabelText('Severity')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Save condition' }))

    expect(mockUpsertMutateAsync).toHaveBeenCalledWith({
      participantId: 'participant-1',
      conditionType: 'Epilepsy',
      data: { has: false, severity: null, planProvided: null, trainingRequired: null, notes: null },
    })
  })

  it('the modal exposes a "Not recorded" third option, with a real accessible name on the radiogroup', async () => {
    const user = userEvent.setup()
    const data = unansweredConditions()
    replaceCondition(data, { id: 'hc-1', conditionType: 'Epilepsy', has: true, severity: 'GrandMal' })
    mockUseParticipantHealthConditions.mockReturnValue({ data, isLoading: false })
    mockUpsertMutateAsync.mockResolvedValue({ success: true, data: makeCondition({ has: null }) })

    render(<ParticipantHealthConditionsSection participantId="participant-1" />)

    const epilepsyRow = screen.getByText('Epilepsy').closest('tr')!
    await user.click(within(epilepsyRow).getByRole('button', { name: 'Edit' }))

    const dialog = screen.getByRole('dialog')
    // Proof, not a DOM-proximity guess — getByRole('radiogroup', { name }) only finds a match if
    // ToggleGroup's ariaLabel is actually wired through (see ParticipantHealthConditionsSection.tsx).
    const hasGroup = within(dialog).getByRole('radiogroup', { name: 'Has this condition / support need' })

    await user.click(within(hasGroup).getByRole('radio', { name: 'Not recorded' }))
    expect(within(dialog).queryByLabelText('Severity')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Save condition' }))

    expect(mockUpsertMutateAsync).toHaveBeenCalledWith({
      participantId: 'participant-1',
      conditionType: 'Epilepsy',
      data: { has: null, severity: null, planProvided: null, trainingRequired: null, notes: null },
    })
  })
})
