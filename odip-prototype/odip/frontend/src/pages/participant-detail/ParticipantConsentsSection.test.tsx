import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ParticipantConsentsSection from './ParticipantConsentsSection'
import { CONSENT_TYPES } from '@/api/types/enums'
import type { ParticipantConsentDto } from '@/api/types/consents'

const {
  mockUseParticipantConsents, mockUpsertMutateAsync,
} = vi.hoisted(() => ({
  mockUseParticipantConsents: vi.fn(() => ({ data: [] as ParticipantConsentDto[], isLoading: false })),
  mockUpsertMutateAsync: vi.fn(),
}))

// Only the API layer is mocked — Modal, FormField, ToggleGroup, StatusBadge are the real
// components, mirroring RiskEntriesSection.test.tsx's approach for the same nested-CRUD shape.
vi.mock('@/api/hooks', () => ({
  useParticipantConsents: mockUseParticipantConsents,
  useUpsertConsent: () => ({ mutateAsync: mockUpsertMutateAsync, isPending: false }),
}))

// One placeholder row per ConsentType (Id=null, Granted=null) — matches what
// ParticipantConsentsController.GetForParticipant actually returns for a participant with no
// answered consents yet.
function unansweredConsents(): ParticipantConsentDto[] {
  return CONSENT_TYPES.map((type) => ({
    id: null, participantId: 'participant-1', consentType: type,
    granted: null, recordedAt: null, signedByName: null, signedDate: null, createdAt: null, updatedAt: null,
  }))
}

function makeConsent(overrides: Partial<ParticipantConsentDto> = {}): ParticipantConsentDto {
  return {
    id: 'consent-1', participantId: 'participant-1', consentType: 'PhotoVideo',
    granted: null, recordedAt: null, signedByName: null, signedDate: null,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function setUserRole(role: string) {
  localStorage.setItem('odip_user', JSON.stringify({ role }))
}

beforeEach(() => {
  mockUpsertMutateAsync.mockClear()
  mockUseParticipantConsents.mockReturnValue({ data: unansweredConsents(), isLoading: false })
  setUserRole('Coordinator')
})

afterEach(() => {
  localStorage.clear()
})

describe('ParticipantConsentsSection', () => {
  it('renders all seven consent types, all "Not recorded" when nothing has been answered', () => {
    render(<ParticipantConsentsSection participantId="participant-1" />)

    expect(screen.getByText('Photo & Video (promotional use)')).toBeInTheDocument()
    expect(screen.getByText('Terms & Conditions')).toBeInTheDocument()
    expect(screen.getAllByText('Not recorded')).toHaveLength(7)
  })

  it('shows Granted/Declined status distinctly, and only shows a signed-by line for a granted consent', () => {
    const data = unansweredConsents()
    data[0] = makeConsent({ consentType: 'PhotoVideo', granted: true, signedByName: 'Sophie Brown', signedDate: '2026-01-15' })
    data[1] = makeConsent({ id: 'consent-2', consentType: 'Alcohol', granted: false })
    mockUseParticipantConsents.mockReturnValue({ data, isLoading: false })

    render(<ParticipantConsentsSection participantId="participant-1" />)

    expect(screen.getByText('Granted')).toBeInTheDocument()
    expect(screen.getByText('Declined')).toBeInTheDocument()
    expect(screen.getAllByText('Not recorded')).toHaveLength(5)
    expect(screen.getByText(/Signed by Sophie Brown/)).toBeInTheDocument()
  })

  it('hides the Edit action for a role without consent-write permission (e.g. SupportWorker)', () => {
    setUserRole('SupportWorker')
    render(<ParticipantConsentsSection participantId="participant-1" />)

    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('opens the edit modal for a row, answers Yes, fills in signed-by/date, and upserts', async () => {
    const user = userEvent.setup()
    mockUpsertMutateAsync.mockResolvedValue({ success: true, data: makeConsent({ granted: true }) })

    render(<ParticipantConsentsSection participantId="participant-1" />)

    const alcoholRow = screen.getByText('Alcohol').closest('div')!.parentElement!
    await user.click(within(alcoholRow).getByRole('button', { name: 'Edit' }))

    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: 'Yes' }))
    await user.type(within(dialog).getByLabelText('Signed by'), 'Jamie Smith')
    await user.click(within(dialog).getByRole('button', { name: 'Save consent' }))

    expect(mockUpsertMutateAsync).toHaveBeenCalledWith({
      participantId: 'participant-1',
      consentType: 'Alcohol',
      data: { granted: true, signedByName: 'Jamie Smith', signedDate: null },
    })
  })

  it('editing a granted consent back to No clears the signature from the upsert payload', async () => {
    const user = userEvent.setup()
    const data = unansweredConsents()
    data[0] = makeConsent({ id: 'consent-1', consentType: 'PhotoVideo', granted: true, signedByName: 'Sophie Brown', signedDate: '2026-01-15' })
    mockUseParticipantConsents.mockReturnValue({ data, isLoading: false })
    mockUpsertMutateAsync.mockResolvedValue({ success: true, data: makeConsent({ granted: false }) })

    render(<ParticipantConsentsSection participantId="participant-1" />)

    const photoVideoRow = screen.getByText('Photo & Video (promotional use)').closest('div')!.parentElement!
    await user.click(within(photoVideoRow).getByRole('button', { name: 'Edit' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByLabelText('Signed by')).toHaveValue('Sophie Brown')
    await user.click(within(dialog).getByRole('radio', { name: 'No' }))
    expect(within(dialog).queryByLabelText('Signed by')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Save consent' }))

    expect(mockUpsertMutateAsync).toHaveBeenCalledWith({
      participantId: 'participant-1',
      consentType: 'PhotoVideo',
      data: { granted: false, signedByName: null, signedDate: null },
    })
  })

  it('the modal exposes a "Not recorded" third option, with a real accessible name on the radiogroup', async () => {
    const user = userEvent.setup()
    const data = unansweredConsents()
    data[0] = makeConsent({ id: 'consent-1', consentType: 'PhotoVideo', granted: true, signedByName: 'Sophie Brown', signedDate: '2026-01-15' })
    mockUseParticipantConsents.mockReturnValue({ data, isLoading: false })
    mockUpsertMutateAsync.mockResolvedValue({ success: true, data: makeConsent({ granted: null }) })

    render(<ParticipantConsentsSection participantId="participant-1" />)

    const photoVideoRow = screen.getByText('Photo & Video (promotional use)').closest('div')!.parentElement!
    await user.click(within(photoVideoRow).getByRole('button', { name: 'Edit' }))

    const dialog = screen.getByRole('dialog')
    // Proof, not a DOM-proximity guess — getByRole('radiogroup', { name }) only finds a match if
    // ToggleGroup's ariaLabel is actually wired through (see ParticipantConsentsSection.tsx).
    const grantedGroup = within(dialog).getByRole('radiogroup', { name: 'Granted' })

    // An already-granted consent (with a signature) can be walked all the way back to
    // unanswered — the whole point of the third option, not just a Yes<->No toggle.
    await user.click(within(grantedGroup).getByRole('radio', { name: 'Not recorded' }))
    expect(within(dialog).queryByLabelText('Signed by')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Save consent' }))

    expect(mockUpsertMutateAsync).toHaveBeenCalledWith({
      participantId: 'participant-1',
      consentType: 'PhotoVideo',
      data: { granted: null, signedByName: null, signedDate: null },
    })
  })
})
