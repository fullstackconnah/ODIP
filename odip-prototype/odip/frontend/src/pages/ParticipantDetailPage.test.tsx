import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ParticipantDetailPage from './ParticipantDetailPage'
import type { ParticipantDetailDto } from '@/api/types/participants'
import type { ParticipantChecklistItemDto } from '@/api/types/checklist-items'

const {
  mockUseParticipant, mockUseParticipantBookings, mockUseSupportProfile, mockUseParticipantAlerts,
} = vi.hoisted(() => ({
  mockUseParticipant: vi.fn(),
  mockUseParticipantBookings: vi.fn(() => ({ data: [] })),
  mockUseSupportProfile: vi.fn(() => ({ data: undefined })),
  mockUseParticipantAlerts: vi.fn(() => ({ data: undefined })),
}))

// Only the API layer is mocked. The nested-CRUD sections (Contacts/Risks/Consents/Health
// Conditions/ADL Assessments/Medications/Notes/Routines/Restrictive Practices) each have their
// own dedicated test file already — stubbed here so this page's tests stay about page
// composition/the Community Access card, not those sections' own hooks (same "mirror
// PortalShiftDetailPage.test.tsx's ShiftNotesSection stub" approach used there).
vi.mock('@/api/hooks', () => ({
  useParticipant: mockUseParticipant,
  useParticipantBookings: mockUseParticipantBookings,
  useSupportProfile: mockUseSupportProfile,
  useParticipantAlerts: mockUseParticipantAlerts,
}))

vi.mock('./participant-detail', () => ({
  MedicationsTab: () => <div data-testid="medications-tab" />,
  NotesTab: () => <div data-testid="notes-tab" />,
  RoutinesTab: () => <div data-testid="routines-tab" />,
  RestrictivePracticesTab: () => <div data-testid="restrictive-practices-tab" />,
  RiskEntriesSection: () => <div data-testid="risk-entries-section" />,
  ParticipantConsentsSection: () => <div data-testid="consents-section" />,
  ParticipantHealthConditionsSection: () => <div data-testid="health-conditions-section" />,
  ParticipantAdlAssessmentsSection: () => <div data-testid="adl-assessments-section" />,
  ContactsTab: () => <div data-testid="contacts-tab" />,
}))

function setUserRole(role: string) {
  localStorage.setItem('odip_user', JSON.stringify({ role }))
}

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/participants/${id}`]}>
      <Routes>
        <Route path="/participants/:id" element={<ParticipantDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** Same lean-required-fields-plus-cast shape as ContactsTab.test.tsx's makeParticipant. */
function makeParticipant(overrides: Partial<ParticipantDetailDto> = {}): ParticipantDetailDto {
  return {
    id: 'participant-1', firstName: 'Sophie', lastName: 'Brown', fullName: 'Sophie Brown',
    planType: 'SelfManaged', isActive: true, isRepeatClient: false, mobilityAidWheelchair: false,
    mobilityAidWalker: false, isHighSupport: false, isIntensiveSupport: false, supportRatio: 'OneToOne',
    overnightSupport: 'None', hasRestrictivePracticeFlag: false, serviceStreams: 'None',
    hasActiveMedications: false, isDraft: false, fundingSource: 'Ndis', mobilitySupportOptions: [],
    otherDiagnoses: [], hidpaSupportCategories: 'None', overnightRatio: 'OneToOne',
    requiresHiLoBed: false, requiresHoist: false, requiresShowerChair: false, requiresCommode: false,
    requiresStandingMachine: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as ParticipantDetailDto
}

function makeChecklistItem(overrides: Partial<ParticipantChecklistItemDto> & { itemType: ParticipantChecklistItemDto['itemType'] }): ParticipantChecklistItemDto {
  return {
    id: 'checklist-1', participantId: 'participant-1', value: null, notes: null,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  mockUseParticipant.mockReset()
  mockUseParticipantBookings.mockReturnValue({ data: [] })
  mockUseSupportProfile.mockReturnValue({ data: undefined })
  mockUseParticipantAlerts.mockReturnValue({ data: undefined })
  // A role without canViewAlerts keeps the alerts banner path (and its own separate hook
  // contract) out of scope for these tests — see ParticipantAlertsBanner's own test file for that.
  setUserRole('SupportWorker')
})

afterEach(() => {
  localStorage.clear()
})

describe('ParticipantDetailPage — INTAKE-03 Community Access card', () => {
  it('is absent when the participant does not have the CommunityAccessDailyLiving stream', () => {
    mockUseParticipant.mockReturnValue({
      data: makeParticipant({ serviceStreams: 'InHomeSupport', signsHappyAndSettled: 'Hums quietly.' }),
      isLoading: false,
    })
    renderAt('participant-1')

    expect(screen.queryByRole('heading', { name: 'Community Access' })).not.toBeInTheDocument()
    // Even stray data saved while the stream was briefly on must not surface once it's off — the
    // card's own gate is the stream flag itself, not field presence (see the component's doc).
    expect(screen.queryByText('Hums quietly.')).not.toBeInTheDocument()
  })

  it('is present, with the flat fields, supports-look-like block, and non-placeholder checklist items, when the participant has the stream and CA data', () => {
    mockUseParticipant.mockReturnValue({
      data: makeParticipant({
        serviceStreams: 'CommunityAccessDailyLiving',
        signsHappyAndSettled: 'Smiles and hums when content.',
        whatHelpsMeCalmDown: 'Quiet room, weighted blanket.',
        bocTriggers: 'Loud unexpected noises.',
        supportsLookLikeMorning: 'Gentle wake, warm drink.',
        supportsLookLikeDay: 'Community outing with 1:1 support.',
        checklistItems: [
          makeChecklistItem({ itemType: 'UsesWheelchair', value: 'Yes', notes: 'Manual wheelchair, needs ramp access.' }),
          makeChecklistItem({ itemType: 'HarmToSelf', value: 'No' }),
          // Explicitly unanswered (value: null) — present in the array, but must NOT render, same
          // "only Value-set rows show" idiom as answeredChecklistItems' own doc comment.
          makeChecklistItem({ itemType: 'FallsRisk', value: null }),
        ],
      }),
      isLoading: false,
    })
    renderAt('participant-1')

    expect(screen.getByRole('heading', { name: 'Community Access' })).toBeInTheDocument()
    expect(screen.getByText('Smiles and hums when content.')).toBeInTheDocument()
    expect(screen.getByText('Quiet room, weighted blanket.')).toBeInTheDocument()
    expect(screen.getByText('Loud unexpected noises.')).toBeInTheDocument()
    expect(screen.getByText(/Morning: Gentle wake, warm drink\./)).toBeInTheDocument()
    expect(screen.getByText(/Day: Community outing with 1:1 support\./)).toBeInTheDocument()

    // Only the two rows with an actual Value show — not a wall of 19 unanswered placeholder rows.
    expect(screen.getByText('Uses wheelchair')).toBeInTheDocument()
    expect(screen.getByText('Manual wheelchair, needs ramp access.')).toBeInTheDocument()
    expect(screen.getByText('Harm to self')).toBeInTheDocument()
    expect(screen.queryByText('Falls risk')).not.toBeInTheDocument()
  })
})

// PDETAIL-01 — the Details tab's card order now mirrors the intake wizard's step-family order
// (see ParticipantDetailPage.tsx's own doc comment above the 'details' tab block). One test per
// top-level group asserting its key fields render under the right heading, plus a group-order
// smoke test and a "the nested CRUD sections all survived the reorg" smoke test.
describe('ParticipantDetailPage — Details tab groups (PDETAIL-01)', () => {
  it('renders the Identity group with the full identity field set, including First/Last/Preferred Name (review round — previously unrendered)', () => {
    mockUseParticipant.mockReturnValue({
      data: makeParticipant({
        firstName: 'Sophie', lastName: 'Brown', preferredName: 'Soph',
        middleName: 'Anne', dateOfBirth: '2000-01-15', gender: 'Other', genderSelfDescription: 'Genderfluid',
        placeOfBirth: 'Brisbane', phone: '0400 000 000', email: 'sophie@example.com', preferredStaffName: 'Jamie Lee',
      }),
      isLoading: false,
    })
    renderAt('participant-1')

    expect(screen.getByRole('heading', { name: 'Identity' })).toBeInTheDocument()
    // The header <h1> only ever shows the single computed FullName string ("Soph Brown" once a
    // preferred name is set) — these three must appear as their OWN distinct row values, proving
    // the underlying FirstName/LastName/PreferredName are each independently visible here too.
    expect(screen.getByText('Sophie')).toBeInTheDocument()
    expect(screen.getByText('Brown')).toBeInTheDocument()
    expect(screen.getByText('Soph')).toBeInTheDocument()
    expect(screen.getByText('Anne')).toBeInTheDocument()
    expect(screen.getByText('15/01/2000')).toBeInTheDocument()
    expect(screen.getByText('Other (Genderfluid)')).toBeInTheDocument()
    expect(screen.getByText('Brisbane')).toBeInTheDocument()
    expect(screen.getByText('0400 000 000')).toBeInTheDocument()
    expect(screen.getByText('sophie@example.com')).toBeInTheDocument()
    expect(screen.getByText('Jamie Lee')).toBeInTheDocument()
  })

  it('falls back to "—" for Preferred Name when unset, per this card\'s always-visible empty-state idiom', () => {
    mockUseParticipant.mockReturnValue({
      data: makeParticipant({ preferredName: null }),
      isLoading: false,
    })
    renderAt('participant-1')

    const row = screen.getByText('Preferred Name').nextElementSibling
    expect(row).toHaveTextContent('—')
  })

  it('renders the NDIS & Funding group split out from Identity, including the DSOA/repeat-client flags', () => {
    mockUseParticipant.mockReturnValue({
      data: makeParticipant({
        fundingSource: 'Ndis', ndisNumber: '123456789', maskedNdisNumber: null,
        planStartDate: '2026-02-01', planEndDate: '2027-02-01', isDsoa: true, isRepeatClient: true,
      }),
      isLoading: false,
    })
    renderAt('participant-1')

    expect(screen.getByRole('heading', { name: 'NDIS & Funding' })).toBeInTheDocument()
    expect(screen.getByText('NDIS')).toBeInTheDocument()
    expect(screen.getByText('••••••••9')).toBeInTheDocument()
    expect(screen.getByText('01/02/2026')).toBeInTheDocument()
    expect(screen.getByText('01/02/2027')).toBeInTheDocument()
    // DSOA and Repeat Client both render as a plain "Yes" value — at least those two.
    expect(screen.getAllByText('Yes').length).toBeGreaterThanOrEqual(2)
  })

  it('shows the Other-funding fields and hides the NDIS plan fields when fundingSource is Other', () => {
    mockUseParticipant.mockReturnValue({
      data: makeParticipant({ fundingSource: 'Other', fundingOrganisation: 'Local Council' }),
      isLoading: false,
    })
    renderAt('participant-1')

    expect(screen.getByText('Local Council')).toBeInTheDocument()
    expect(screen.queryByText('NDIS Number')).not.toBeInTheDocument()
  })

  it('renders Support Needs & Mobility with Intensive Support (previously unrendered) and the relocated free-text fields, and retires the old generic "Notes" card', () => {
    mockUseParticipant.mockReturnValue({
      data: makeParticipant({
        isIntensiveSupport: true, mobilityNotes: 'Prefers left-side approach.',
        equipmentRequirements: 'Needs a slide sheet.', transportRequirements: 'Wheelchair-accessible van only.',
      }),
      isLoading: false,
    })
    renderAt('participant-1')

    expect(screen.getByRole('heading', { name: 'Support Needs & Mobility' })).toBeInTheDocument()
    expect(screen.getByText('Intensive Support')).toBeInTheDocument()
    expect(screen.getByText('Prefers left-side approach.')).toBeInTheDocument()
    expect(screen.getByText('Needs a slide sheet.')).toBeInTheDocument()
    expect(screen.getByText('Wheelchair-accessible van only.')).toBeInTheDocument()
    // No longer under a generic "Notes" heading — PDETAIL-01 retired that card in favour of
    // relocating its fields to their real wizard-step homes.
    expect(screen.queryByRole('heading', { name: 'Notes' })).not.toBeInTheDocument()
  })

  it('renders the Risks & Hazards Summary card with behaviourRiskSummary (previously unrendered anywhere on this page) alongside General Notes', () => {
    mockUseParticipant.mockReturnValue({
      data: makeParticipant({ behaviourRiskSummary: 'Escalates when routine changes without warning.', notes: 'Prefers morning visits.' }),
      isLoading: false,
    })
    renderAt('participant-1')

    expect(screen.getByRole('heading', { name: 'Risks & Hazards Summary' })).toBeInTheDocument()
    expect(screen.getByText(/Escalates when routine changes without warning\./)).toBeInTheDocument()
    expect(screen.getByText(/Prefers morning visits\./)).toBeInTheDocument()
  })

  it('orders ALL ten Details-tab step-family groups to mirror the wizard step order end to end: Identity, NDIS & Funding, Key Identifiers, Cultural Background, Support Needs & Mobility, Medical, Behaviour & Communication, Community Access, Daily Living, Risks & Hazards', () => {
    mockUseParticipant.mockReturnValue({
      // One field (or the CommunityAccessDailyLiving stream itself, for the stream-gated card)
      // per whole-card-conditional group, so every group's Card actually renders and can be
      // located in the heading list — same minimal-trigger approach as each group's own test above.
      data: makeParticipant({
        medicareNumber: 'MED123',                              // Key Identifiers
        isCald: true,                                          // Cultural Background
        primaryDiagnosis: 'Autism',                            // Medical
        memory: 'Fair',                                        // Behaviour & Communication
        serviceStreams: 'CommunityAccessDailyLiving',          // Community Access (stream-gated — see the card's own doc comment: gated on the flag itself, no field needed)
        favouriteBreakfast: 'Toast',                           // Daily Living (Meals & Diet)
        behaviourRiskSummary: 'Escalates when routine changes.', // Risks & Hazards Summary
      }),
      isLoading: false,
    })
    renderAt('participant-1')

    const headings = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)
    const idx = (name: string) => headings.indexOf(name)
    expect(idx('Identity')).toBeGreaterThanOrEqual(0)
    expect(idx('Identity')).toBeLessThan(idx('NDIS & Funding'))
    expect(idx('NDIS & Funding')).toBeLessThan(idx('Key Identifiers'))
    expect(idx('Key Identifiers')).toBeLessThan(idx('Cultural Background'))
    expect(idx('Cultural Background')).toBeLessThan(idx('Support Needs & Mobility'))
    expect(idx('Support Needs & Mobility')).toBeLessThan(idx('Medical'))
    expect(idx('Medical')).toBeLessThan(idx('Behaviour & Communication'))
    // Community Access is stream-gated overflow content belonging to the Support Needs & Mobility /
    // Behaviour & Communication steps (see the Community Access card's own doc comment) —
    // positioned directly after Behaviour & Communication, matching where it actually renders.
    expect(idx('Behaviour & Communication')).toBeLessThan(idx('Community Access'))
    // Daily Living has no single card of its own (its ADL grid section carries no title) — Meals &
    // Diet is one of its constituent cards and stands in as the group's position marker here.
    expect(idx('Community Access')).toBeLessThan(idx('Meals & Diet'))
    expect(idx('Meals & Diet')).toBeLessThan(idx('Risks & Hazards Summary'))
  })

  it('still renders every nested CRUD section (consents/health-conditions/ADL/risk-entries) after the reorg', () => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAt('participant-1')

    expect(screen.getByTestId('consents-section')).toBeInTheDocument()
    expect(screen.getByTestId('health-conditions-section')).toBeInTheDocument()
    expect(screen.getByTestId('adl-assessments-section')).toBeInTheDocument()
    expect(screen.getByTestId('risk-entries-section')).toBeInTheDocument()
  })
})
