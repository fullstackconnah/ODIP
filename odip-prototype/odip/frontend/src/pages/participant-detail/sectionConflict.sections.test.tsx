import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ParticipantDetailDto } from '@/api/types/participants'
import { ParticipantAboutMeSection } from './ParticipantAboutMeSection'
import { ParticipantAddressLivingSection } from './ParticipantAddressLivingSection'
import { ParticipantBehaviourCommunicationSection } from './ParticipantBehaviourCommunicationSection'
import { BehaviourSupportCard, TypicalDayCard } from './ParticipantCommunityAccessSection'
import { ParticipantCulturalBackgroundSection } from './ParticipantCulturalBackgroundSection'
import { ParticipantIdentitySection } from './ParticipantIdentitySection'
import { ParticipantKeyIdentifiersSection } from './ParticipantKeyIdentifiersSection'
import { ParticipantMealsDietSection } from './ParticipantMealsDietSection'
import { ParticipantMedicalSection } from './ParticipantMedicalSection'
import { ParticipantNdisFundingSection } from './ParticipantNdisFundingSection'
import { ParticipantRisksHazardsSummarySection } from './ParticipantRisksHazardsSummarySection'
import {
  EquipmentSection, MobilityAidsSection, MobilityFunctionalSection, OvernightSupportSection, SupportNeedsSection, SupportNotesSection,
} from './SupportProfileTab'

const { mockPatchMutateAsync } = vi.hoisted(() => ({ mockPatchMutateAsync: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  usePatchParticipant: () => ({ mutateAsync: mockPatchMutateAsync, isPending: false }),
  useStaff: () => ({ data: [] }),
}))

const p = {
  id: 'participant-1', firstName: 'Sophie', lastName: 'Brown', fullName: 'Sophie Brown',
  planType: 'SelfManaged', isActive: true, isRepeatClient: false, mobilityAidWheelchair: false,
  mobilityAidWalker: false, isHighSupport: false, isIntensiveSupport: false, supportRatio: 'OneToOne',
  overnightSupport: 'None', hasRestrictivePracticeFlag: false, serviceStreams: 'None',
  hasActiveMedications: false, isDraft: false, fundingSource: 'Ndis', mobilitySupportOptions: [],
  otherDiagnoses: [], hidpaSupportCategories: 'None', overnightRatio: 'OneToOne',
  requiresHiLoBed: false, requiresHoist: false, requiresShowerChair: false, requiresCommode: false,
  requiresStandingMachine: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
} as unknown as ParticipantDetailDto

const common = { p, participantId: 'participant-1', canEdit: true }

// X3: every section that saves a scalar group shows the refused state, not its generic "Failed to save" line, when the server answers
// participant-section-changed. The sections are only wired to the panel, so one row each is enough.
const rows: [string, () => ReactElement, string][] = [
  ['About Me', () => <ParticipantAboutMeSection {...common} />, 'Failed to save About Me.'],
  ['Address & Living Arrangements', () => <ParticipantAddressLivingSection {...common} />, 'Failed to save Address & Living Arrangements.'],
  ['Behaviour & Communication', () => <ParticipantBehaviourCommunicationSection {...common} />, 'Failed to save Behaviour & Communication.'],
  ['Behaviour support', () => <BehaviourSupportCard {...common} />, 'Failed to save Behaviour support.'],
  ['What my supports look like', () => <TypicalDayCard {...common} />, 'Failed to save Typical day.'],
  ['Cultural Background', () => <ParticipantCulturalBackgroundSection {...common} />, 'Failed to save Cultural Background.'],
  ['Identity', () => <ParticipantIdentitySection {...common} />, 'Failed to save Identity.'],
  ['Key Identifiers', () => <ParticipantKeyIdentifiersSection {...common} />, 'Failed to save Key Identifiers.'],
  ['Meals & Diet', () => <ParticipantMealsDietSection {...common} />, 'Failed to save Meals & Diet.'],
  ['Medical', () => <ParticipantMedicalSection {...common} />, 'Failed to save Medical.'],
  ['NDIS & Funding', () => <ParticipantNdisFundingSection {...common} />, 'Failed to save NDIS & Funding.'],
  ['Risks & Hazards Summary', () => <ParticipantRisksHazardsSummarySection {...common} />, 'Failed to save Risks & Hazards Summary.'],
  ['Support Needs', () => <SupportNeedsSection {...common} restrictiveLink={null} />, 'Failed to save Support Needs.'],
  ['Mobility Aids & Support', () => <MobilityAidsSection {...common} />, 'Failed to save Mobility Aids & Support.'],
  ['Overnight Support', () => <OvernightSupportSection {...common} />, 'Failed to save Overnight Support.'],
  ['Equipment', () => <EquipmentSection {...common} />, 'Failed to save Equipment.'],
  ['Mobility notes', () => <SupportNotesSection {...common} field="mobilityNotes" />, 'Failed to save mobility notes.'],
  ['Mobility & Functional', () => <MobilityFunctionalSection {...common} />, 'Failed to save Mobility & Functional.'],
]

const conflict = Object.assign(new Error('409'), {
  response: { status: 409, data: { success: false, code: 'participant-section-changed', errors: ['x'], data: { groupRevisions: {} } } },
})

beforeEach(() => {
  mockPatchMutateAsync.mockReset()
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
})

afterEach(() => {
  localStorage.clear()
})

describe('every scalar section refuses a stale save (X3)', () => {
  it.each(rows)('%s shows the refused state on a 409 and a generic error on anything else', async (_name, ui, fallback) => {
    const user = userEvent.setup()
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={qc}><MemoryRouter>{ui()}</MemoryRouter></QueryClientProvider>)

    mockPatchMutateAsync.mockRejectedValueOnce(conflict)
    await user.click(screen.getAllByRole('button', { name: /^(Edit|Add)/i })[0])
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Someone else saved this section since you opened it.')).toBeInTheDocument()
    expect(screen.queryByText(fallback)).toBeNull()

    mockPatchMutateAsync.mockRejectedValueOnce(new Error('boom'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/boom|Failed to save/)).toBeInTheDocument()
  })
})
