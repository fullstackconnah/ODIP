import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import ParticipantDetailPage from './ParticipantDetailPage'
import type { ParticipantDetailDto } from '@/api/types/participants'
import type { ParticipantChecklistItemDto } from '@/api/types/checklist-items'
import { TONE } from '@/lib/tone'

const {
  mockUseParticipant, mockUseParticipantBookings, mockUseParticipantAlerts,
  mockUseDownloadIntakeFormPdf, mockUseDownloadParticipantProfilePdf, mockUseDownloadClientOverviewPdf,
  mockPatchMutateAsync, mockUseStaff,
  mockUseGenerateCaregiverLink, mockUseRevokeCaregiverLink, mockUseCaregiverSubmissions,
} = vi.hoisted(() => ({
  mockUseParticipant: vi.fn(),
  mockUseParticipantBookings: vi.fn<() => { data: Record<string, unknown>[] }>(() => ({ data: [] })),
  mockUseParticipantAlerts: vi.fn(() => ({ data: undefined })),
  // DOC-01 — mocked like every other hook this file already stubs, so the button-render/click
  // tests never run the real axios/blob mutationFn body (see the page's own hooks for that body).
  mockUseDownloadIntakeFormPdf: vi.fn(() => ({ mutate: vi.fn(), isPending: false, isError: false })),
  mockUseDownloadParticipantProfilePdf: vi.fn(() => ({ mutate: vi.fn(), isPending: false, isError: false })),
  // PF-10.6 — same reasoning as the two DOC-01 hooks above.
  mockUseDownloadClientOverviewPdf: vi.fn(() => ({ mutate: vi.fn(), isPending: false, isError: false })),
  // PD-7 — the real Details-tab section components (kept real below, see the './participant-detail'
  // mock) call usePatchParticipant()/useStaff() directly. Every PDETAIL-01 test in this file uses
  // the default 'SupportWorker' role (canWriteParticipantDetails === false), so no section's Edit
  // button/mutateAsync path is actually exercised here — these exist only so the modules resolve.
  mockPatchMutateAsync: vi.fn(),
  mockUseStaff: vi.fn(() => ({ data: [] })),
  // cg04 Task 9 — the header's CaregiverLinkControl. Mocked the same way as the DOC-01 hooks
  // above so its own tests never run the real axios mutationFn body.
  mockUseGenerateCaregiverLink: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false, isError: false })),
  mockUseRevokeCaregiverLink: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, isError: false })),
  mockUseCaregiverSubmissions: vi.fn<(status?: string) => { data: Record<string, unknown>[] }>(() => ({ data: [] })),
}))

// Only the API layer is mocked. The nested-CRUD sections (Contacts/Risks/Consents/Health
// Conditions/ADL Assessments/Medications/Notes/Routines/Restrictive Practices) each have their
// own dedicated test file already — stubbed here so this page's tests stay about page
// composition/the Community Access card, not those sections' own hooks (same "mirror
// PortalShiftDetailPage.test.tsx's ShiftNotesSection stub" approach used there).
vi.mock('@/api/hooks', () => ({
  useParticipant: mockUseParticipant,
  useParticipantBookings: mockUseParticipantBookings,
  useParticipantAlerts: mockUseParticipantAlerts,
  useDownloadIntakeFormPdf: mockUseDownloadIntakeFormPdf,
  useDownloadParticipantProfilePdf: mockUseDownloadParticipantProfilePdf,
  useDownloadClientOverviewPdf: mockUseDownloadClientOverviewPdf,
  usePatchParticipant: () => ({ mutateAsync: mockPatchMutateAsync, isPending: false }),
  useStaff: mockUseStaff,
  useGenerateCaregiverLink: mockUseGenerateCaregiverLink,
  useRevokeCaregiverLink: mockUseRevokeCaregiverLink,
  useCaregiverSubmissions: mockUseCaregiverSubmissions,
}))

vi.mock('./participant-detail', async () => {
  // PD-7 — the 11 Details-tab section-edit components (ParticipantIdentitySection etc.) are kept
  // REAL via importActual: this page's own PDETAIL-01 tests assert on text those components
  // render, and each section also has its own dedicated test file for edit/save/cancel/gate
  // behaviour (mirroring SupportProfileTab's "own hooks have their own test file" approach).
  // Only the nested-CRUD tabs/sections below (which have PRE-EXISTING dedicated test files of
  // their own and whose hooks this page's tests don't stub) are replaced with lightweight stubs.
  const actual = await vi.importActual<typeof import('./participant-detail')>('./participant-detail')
  return {
    ...actual,
    MedicationsTab: () => <div data-testid="medications-tab" />,
    NotesTab: () => <div data-testid="notes-tab" />,
    RoutinesTab: () => <div data-testid="routines-tab" />,
    RestrictivePracticesTab: () => <div data-testid="restrictive-practices-tab" />,
    RiskEntriesSection: () => <div data-testid="risk-entries-section" />,
    ParticipantConsentsSection: () => <div data-testid="consents-section" />,
    ParticipantHealthConditionsSection: () => <div data-testid="health-conditions-section" />,
    ParticipantAdlAssessmentsSection: () => <div data-testid="adl-assessments-section" />,
    ContactsTab: () => <div data-testid="contacts-tab" />,
    // PD-6 — the Support Profile tab has its own dedicated test file (SupportProfileTab.test.tsx);
    // stubbed here so this page's tests stay about page composition/tab wiring, same "own hooks
    // have their own test file" approach as every other nested-CRUD section above.
    SupportProfileTab: () => <div data-testid="support-profile-tab" />,
    // Shift-completion design spec §4 — Claims tab has its own dedicated test file
    // (ClaimsTab.test.tsx); stubbed here for the same reason as every nested-CRUD tab above.
    ClaimsTab: () => <div data-testid="claims-tab" />,
    // Connection map item 12 — Rostering tab has its own dedicated test file
    // (RosteringTab.test.tsx); stubbed here for the same reason as every nested-CRUD tab above.
    RosteringTab: () => <div data-testid="rostering-tab" />,
    // Budget phase 1 — the Funding tab has its own dedicated test file (FundingTab.test.tsx); stubbed here so this page's tests stay about tab wiring.
    FundingTab: ({ participantId, planType }: { participantId: string; planType: string }) => <div data-testid="funding-tab" data-participant={participantId} data-plan-type={planType} />,
  }
})

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

function renderAtTab(id: string, tab: string) {
  return render(
    <MemoryRouter initialEntries={[`/participants/${id}?tab=${tab}`]}>
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
  mockUseParticipantAlerts.mockReturnValue({ data: undefined })
  mockUseDownloadIntakeFormPdf.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false })
  mockUseDownloadParticipantProfilePdf.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false })
  mockUseGenerateCaregiverLink.mockReturnValue({ mutateAsync: vi.fn(), isPending: false, isError: false })
  mockUseRevokeCaregiverLink.mockReturnValue({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, isError: false })
  mockUseCaregiverSubmissions.mockReturnValue({ data: [] })
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

  it('PD-6: no longer shows a "Support Needs & Mobility" card — those fields moved to the Support Profile tab', () => {
    mockUseParticipant.mockReturnValue({
      data: makeParticipant({
        isIntensiveSupport: true, mobilityNotes: 'Prefers left-side approach.',
        equipmentRequirements: 'Needs a slide sheet.', transportRequirements: 'Wheelchair-accessible van only.',
      }),
      isLoading: false,
    })
    renderAt('participant-1')

    expect(screen.queryByRole('heading', { name: 'Support Needs & Mobility' })).not.toBeInTheDocument()
    // No longer under a generic "Notes" heading either — PDETAIL-01 already retired that card;
    // PD-6 now retires its PDETAIL-01 successor from this tab too.
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

  it('orders the remaining Details-tab step-family groups to mirror the wizard step order end to end: Identity, NDIS & Funding, Key Identifiers, Cultural Background, Medical, Behaviour & Communication, Community Access, Daily Living, Risks & Hazards (Support Needs & Mobility moved to the Support Profile tab under PD-6)', () => {
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
    // PD-6: "Support Needs & Mobility" no longer sits between Cultural Background and Medical —
    // that card was removed from this tab entirely.
    expect(idx('Support Needs & Mobility')).toBe(-1)
    expect(idx('Cultural Background')).toBeLessThan(idx('Medical'))
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

  it('packs every short card first and stacks the full-width sections (Consents, Health, ADLs, Risk entries) after them, so none is stranded beside a row-wide void', () => {
    mockUseParticipant.mockReturnValue({
      // Same one-trigger-per-conditional-card data as the wizard-order test above.
      data: makeParticipant({
        medicareNumber: 'MED123', isCald: true, primaryDiagnosis: 'Autism', memory: 'Fair',
        serviceStreams: 'CommunityAccessDailyLiving', favouriteBreakfast: 'Toast',
        behaviourRiskSummary: 'Escalates when routine changes.',
      }),
      isLoading: false,
    })
    renderAt('participant-1')

    const expectedOrder = [
      ...['Identity', 'Address & Living Arrangements', 'NDIS & Funding', 'Key Identifiers', 'Cultural Background',
        'Medical', 'Behaviour & Communication', 'Community Access', 'Meals & Diet', 'Risks & Hazards Summary']
        .map((name) => screen.getByRole('heading', { name })),
      ...['consents-section', 'health-conditions-section', 'adl-assessments-section', 'risk-entries-section']
        .map((testId) => screen.getByTestId(testId)),
    ]
    const inDocumentOrder = [...expectedOrder].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    expect(inDocumentOrder).toEqual(expectedOrder)
  })

  it('uses the auto-fill items-start section grid with a min(26rem,100%) floor, and gives the table-based Health/ADL sections a bare wrapper instead of a second bordered Card', () => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAt('participant-1')

    // jsdom has no layout, so the class is the only observable proof of the mobile fix: a bare
    // minmax(26rem,1fr) floor (416px) overflows a 390px viewport and scrolls the page sideways.
    const health = screen.getByTestId('health-conditions-section').parentElement as HTMLElement
    const grid = health.parentElement as HTMLElement
    expect(grid).toHaveClass('grid', 'items-start')
    expect(grid).toHaveClass('grid-cols-[repeat(auto-fill,minmax(min(26rem,100%),1fr))]')

    // DataTable draws its own border — a Card around it nested a second one (one border, not two).
    for (const testId of ['health-conditions-section', 'adl-assessments-section']) {
      const wrapper = screen.getByTestId(testId).parentElement as HTMLElement
      expect(wrapper).toHaveClass('col-span-full')
      expect(wrapper).not.toHaveClass('border')
      expect(wrapper).not.toHaveClass('rounded-md')
    }
  })
})

describe('ParticipantDetailPage — header meta row', () => {
  it('ends the meta row at the last real fact: no trailing "—" when the participant has no service streams', () => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ serviceStreams: 'None' }), isLoading: false })
    renderAt('participant-1')

    const meta = screen.getByText(/Support Ratio:/).parentElement as HTMLElement
    expect(within(meta).queryByText('—')).not.toBeInTheDocument()
    expect(meta.lastElementChild).toHaveTextContent(/Support Ratio:/)
  })

  // Landing-spotted: the header printed the raw enums "PlanManaged" and "TwoToOne".
  it('prints the plan type and support ratio as labels, never as raw enums', () => {
    mockUseParticipant.mockReturnValue({
      data: makeParticipant({ region: 'Gold Coast', planType: 'PlanManaged', supportRatio: 'TwoToOne' }),
      isLoading: false,
    })
    renderAt('participant-1')

    const meta = screen.getByText(/Support Ratio:/)
    expect(meta).toHaveTextContent('Gold Coast · Plan Managed · Support Ratio: 2:1')
    expect(screen.queryByText(/PlanManaged|TwoToOne/)).not.toBeInTheDocument()
  })

  it('still shows a chip per service stream at the end of the meta row', () => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ serviceStreams: 'STA,InHomeSupport' }), isLoading: false })
    renderAt('participant-1')

    const meta = screen.getByText(/Support Ratio:/).parentElement as HTMLElement
    expect(within(meta).getByText('STA')).toBeInTheDocument()
    expect(within(meta).getByText('In-Home Support')).toBeInTheDocument()
  })
})

// DOC-01 — header Documents buttons (Intake Form PDF / Participant Profile PDF). Both hooks are
// mocked (see the vi.hoisted block above) so these tests never exercise the real axios/blob
// mutationFn body.
describe('ParticipantDetailPage — DOC-01 Documents header buttons', () => {
  function setup() {
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    return renderAt('participant-1')
  }

  it('renders both Documents buttons with their labels', () => {
    setup()

    expect(screen.getByRole('button', { name: /intake form pdf/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /participant profile pdf/i })).toBeInTheDocument()
  })

  it('calls the intake form mutation with the participant id and a filename when clicked', async () => {
    const user = userEvent.setup()
    const mutate = vi.fn()
    mockUseDownloadIntakeFormPdf.mockReturnValue({ mutate, isPending: false, isError: false })
    setup()

    await user.click(screen.getByRole('button', { name: /intake form pdf/i }))

    expect(mutate).toHaveBeenCalledWith({ id: 'participant-1', fileName: expect.stringContaining('.pdf') })
  })

  it('calls the participant profile mutation with the participant id and a filename when clicked', async () => {
    const user = userEvent.setup()
    const mutate = vi.fn()
    mockUseDownloadParticipantProfilePdf.mockReturnValue({ mutate, isPending: false, isError: false })
    setup()

    await user.click(screen.getByRole('button', { name: /participant profile pdf/i }))

    expect(mutate).toHaveBeenCalledWith({ id: 'participant-1', fileName: expect.stringContaining('.pdf') })
  })

  it('disables the Intake Form button and shows loading state while its mutation is pending', () => {
    mockUseDownloadIntakeFormPdf.mockReturnValue({ mutate: vi.fn(), isPending: true, isError: false })
    setup()

    const button = screen.getByRole('button', { name: /preparing/i })
    expect(button).toBeDisabled()
  })

  it('disables the Participant Profile button and shows loading state while its mutation is pending', () => {
    mockUseDownloadParticipantProfilePdf.mockReturnValue({ mutate: vi.fn(), isPending: true, isError: false })
    setup()

    // Both buttons share the same "Preparing…" label while pending — assert two are showing it
    // (the Intake Form button stays in its default, non-pending state).
    expect(screen.getAllByRole('button', { name: /preparing/i })).toHaveLength(1)
  })

  it('shows an error alert under the Intake Form button when its mutation errors', () => {
    mockUseDownloadIntakeFormPdf.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: true })
    setup()

    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't download the file/i)
  })

  it('shows an error alert under the Participant Profile button when its mutation errors', () => {
    mockUseDownloadParticipantProfilePdf.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: true })
    setup()

    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't download the file/i)
  })

  // PF-10.6 — third Documents button (Client Overview PDF), no tripId since this page has no
  // trip context (the safer-default, more-availability product call — see this branch's report).
  it('renders the Client Overview PDF button', () => {
    setup()

    expect(screen.getByRole('button', { name: /client overview pdf/i })).toBeInTheDocument()
  })

  it('calls the client overview mutation with the participant id (no tripId) and a filename when clicked', async () => {
    const user = userEvent.setup()
    const mutate = vi.fn()
    mockUseDownloadClientOverviewPdf.mockReturnValue({ mutate, isPending: false, isError: false })
    setup()

    await user.click(screen.getByRole('button', { name: /client overview pdf/i }))

    expect(mutate).toHaveBeenCalledWith({ id: 'participant-1', fileName: expect.stringContaining('.pdf') })
  })

  it('disables the Client Overview button and shows loading state while its mutation is pending', () => {
    mockUseDownloadClientOverviewPdf.mockReturnValue({ mutate: vi.fn(), isPending: true, isError: false })
    setup()

    expect(screen.getAllByRole('button', { name: /preparing/i })).toHaveLength(1)
  })

  it('shows an error alert under the Client Overview button when its mutation errors', () => {
    mockUseDownloadClientOverviewPdf.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: true })
    setup()

    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't download the file/i)
  })
})

// PD-1 — the header's Draft signal is the existing role="status" banner alone. A separate amber
// "Draft" pill was deliberately NOT added alongside it: the banner already carries the status
// role, the explanatory text, and (for canWrite users) the "Resume intake" action, so a second
// same-coloured pill directly above it would just duplicate the same signal with no independent
// value. The banner was already a full-width block below the name row (not sharing a line with
// the button cluster), so it never had the pill's resize bug — removing the redundant inline
// pill from the name row resolves PD-1 without introducing a duplicate.
describe('ParticipantDetailPage — PD-1 header warning pill', () => {
  it('shows exactly one draft indicator (the status banner) for a draft participant — no separate pill', () => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ isDraft: true }), isLoading: false })
    renderAt('participant-1')

    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent(/this participant is a draft/i)
    // No standalone "Draft" badge/pill anywhere else on the page (Active/Inactive is the only
    // other status-style badge in the name row, and it never reads "Draft").
    expect(screen.queryByText('Draft')).not.toBeInTheDocument()
  })

  it('renders no banner at all, and no stray draft indicator, for a non-draft participant', () => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ isDraft: false }), isLoading: false })
    renderAt('participant-1')

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByText('Draft')).not.toBeInTheDocument()
    expect(screen.queryByText(/this participant is a draft/i)).not.toBeInTheDocument()
  })

  it('still shows the draft banner (without the Resume intake action) for a role without canWrite', () => {
    // beforeEach already sets role to 'SupportWorker', which usePermissions.canWrite excludes.
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ isDraft: true }), isLoading: false })
    renderAt('participant-1')

    expect(screen.queryByRole('link', { name: /^edit$/i })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/this participant is a draft/i)
    expect(screen.queryByRole('link', { name: /resume intake/i })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Sophie Brown' })).toBeInTheDocument()
  })

  it('keeps the draft banner and its Resume intake action regardless of the button cluster width (Edit button present, PDF download pending)', () => {
    setUserRole('Admin')
    mockUseDownloadIntakeFormPdf.mockReturnValue({ mutate: vi.fn(), isPending: true, isError: false })
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ isDraft: true }), isLoading: false })
    renderAt('participant-1')

    // Widened cluster: Edit button shown, one download button in its longer "Preparing…" state.
    expect(screen.getByRole('link', { name: /^edit$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /preparing/i })).toBeInTheDocument()

    expect(screen.getByRole('status')).toHaveTextContent(/this participant is a draft/i)
    expect(screen.getByRole('link', { name: /resume intake/i })).toBeInTheDocument()
  })
})

// SPEC-05 PF-10.5 — the three-way resume-banner state, derived from IntakeCompletedAt/IsDraft.
describe('ParticipantDetailPage — PF-10.5 three-way resume banner', () => {
  it('no IntakeCompletedAt: shows "Resume intake" routed to the Intake wizard at /participants/:id/intake', () => {
    setUserRole('Admin')
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ isDraft: true, intakeCompletedAt: null }), isLoading: false })
    renderAt('participant-1')

    const link = screen.getByRole('link', { name: /resume intake/i })
    expect(link).toHaveAttribute('href', '/participants/participant-1/intake')
    expect(screen.getByRole('status')).toHaveTextContent(/intake hasn't been completed yet/i)
  })

  it('IntakeCompletedAt set, IsDraft still true: shows "Continue profile" routed to the Profile wizard at /participants/:id/profile', () => {
    setUserRole('Admin')
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ isDraft: true, intakeCompletedAt: '2026-08-01T00:00:00Z' }), isLoading: false })
    renderAt('participant-1')

    const link = screen.getByRole('link', { name: /continue profile/i })
    expect(link).toHaveAttribute('href', '/participants/participant-1/profile')
    expect(screen.queryByRole('link', { name: /resume intake/i })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/profile isn't finished yet/i)
  })

  it('IsDraft false: no banner at all, regardless of IntakeCompletedAt', () => {
    setUserRole('Admin')
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ isDraft: false, intakeCompletedAt: '2026-08-01T00:00:00Z' }), isLoading: false })
    renderAt('participant-1')

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /resume intake/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /continue profile/i })).not.toBeInTheDocument()
  })
})

// cg04 Task 9 — the header's caregiver-link control (design §5): gated on
// canWriteParticipantDetails (not canWrite — see B14 in the discovery fact sheet), showing a
// status chip plus Generate/Regenerate and, once a link is active, Revoke. A freshly generated
// URL is shown exactly once with a Copy button.
describe('ParticipantDetailPage — cg04 Task 9 caregiver link control', () => {
  function activeSubmission(overrides: Record<string, unknown> = {}) {
    return {
      id: 'submission-1', participantId: 'participant-1', participantName: 'Sophie Brown',
      status: 'Submitted', caregiverName: 'Jane Doe', createdAt: '2026-08-01T00:00:00Z',
      expiresAt: '2026-09-17T00:00:00Z', submittedAt: '2026-08-02T00:00:00Z',
      ...overrides,
    }
  }

  function setup() {
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    return renderAt('participant-1')
  }

  it('hides the control for a role without canWriteParticipantDetails', () => {
    setUserRole('SupportWorker')
    setup()

    expect(screen.queryByRole('button', { name: /generate caregiver link/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId('caregiver-link-control')).not.toBeInTheDocument()
  })

  it('shows Generate link for a role with canWriteParticipantDetails (Coordinator)', () => {
    setUserRole('Coordinator')
    setup()

    expect(screen.getByRole('button', { name: /generate caregiver link/i })).toBeInTheDocument()
  })

  it('after generating, shows the URL once with a Copy button and the expiry, and never again once dismissed by navigation away', async () => {
    setUserRole('Admin')
    const user = userEvent.setup()
    const mutateAsync = vi.fn(async () => ({ success: true, data: { token: 'tok-123', expiresAt: '2026-09-17T00:00:00Z' } }))
    mockUseGenerateCaregiverLink.mockReturnValue({ mutateAsync, isPending: false, isError: false })
    const first = setup()

    await user.click(screen.getByRole('button', { name: /generate caregiver link/i }))

    expect(mutateAsync).toHaveBeenCalledWith({ participantId: 'participant-1' })
    const control = screen.getByTestId('caregiver-link-control')
    expect(within(control).getByText(`${window.location.origin}/caregiver/tok-123`)).toBeInTheDocument()
    expect(within(control).getByRole('button', { name: /copy/i })).toBeInTheDocument()
    expect(within(control).getByText(/won't be shown again/i)).toBeInTheDocument()

    // Unmounting and re-rendering the page (simulating navigating away and back) must not
    // resurrect the URL — it lives only in this render's local state, never in the query cache
    // or anywhere else the UI could recover it from.
    first.unmount()
    setup()
    expect(screen.queryByText(`${window.location.origin}/caregiver/tok-123`)).not.toBeInTheDocument()
  })

  it('shows a status chip and Revoke when a link is active', () => {
    setUserRole('Admin')
    mockUseCaregiverSubmissions.mockImplementation((status?: string) => ({
      data: status === 'Submitted' ? [activeSubmission()] : [],
    }))
    setup()

    const control = screen.getByTestId('caregiver-link-control')
    expect(within(control).getByText('Submitted')).toBeInTheDocument()
    expect(within(control).getByRole('button', { name: /^revoke$/i })).toBeInTheDocument()
    expect(within(control).getByRole('button', { name: /regenerate caregiver link/i })).toBeInTheDocument()
  })

  // PP-40 — Revoke now stages behind a ConfirmDialog rather than firing immediately, same
  // pattern as RiskEntriesSection's delete.
  it('Revoke does not call the mutation until confirmed in the dialog', async () => {
    setUserRole('Admin')
    const user = userEvent.setup()
    const revokeMutateAsync = vi.fn(async () => ({ success: true }))
    mockUseRevokeCaregiverLink.mockReturnValue({ mutate: vi.fn(), mutateAsync: revokeMutateAsync, isPending: false, isError: false })
    mockUseCaregiverSubmissions.mockImplementation((status?: string) => ({
      data: status === 'Submitted' ? [activeSubmission()] : [],
    }))
    setup()

    await user.click(screen.getByRole('button', { name: /^revoke$/i }))
    expect(revokeMutateAsync).not.toHaveBeenCalled()

    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(/revoke caregiver link/i)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: /^revoke$/i }))

    expect(revokeMutateAsync).toHaveBeenCalledWith({ participantId: 'participant-1' })
  })

  it('Revoke cancel dismisses the dialog without calling the mutation', async () => {
    setUserRole('Admin')
    const user = userEvent.setup()
    const revokeMutateAsync = vi.fn(async () => ({ success: true }))
    mockUseRevokeCaregiverLink.mockReturnValue({ mutate: vi.fn(), mutateAsync: revokeMutateAsync, isPending: false, isError: false })
    mockUseCaregiverSubmissions.mockImplementation((status?: string) => ({
      data: status === 'Submitted' ? [activeSubmission()] : [],
    }))
    setup()

    await user.click(screen.getByRole('button', { name: /^revoke$/i }))
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }))

    expect(revokeMutateAsync).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

// PP-39 — the History tab (and its content) must be gated on usePermissions()'s isAdmin/isSuperAdmin,
// not a raw localStorage-derived role check, so SuperAdmin also sees it.
describe('ParticipantDetailPage — PP-39 History tab permissions', () => {
  it('shows the History tab for a SuperAdmin role', () => {
    setUserRole('SuperAdmin')
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAt('participant-1')

    expect(screen.getByRole('tab', { name: 'History' })).toBeInTheDocument()
  })

  it('shows the History tab for an Admin role', () => {
    setUserRole('Admin')
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAt('participant-1')

    expect(screen.getByRole('tab', { name: 'History' })).toBeInTheDocument()
  })

  it('hides the History tab for a SupportWorker role', () => {
    setUserRole('SupportWorker')
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAt('participant-1')

    expect(screen.queryByRole('button', { name: 'History' })).not.toBeInTheDocument()
  })
})

// Shift-completion design spec §4 "Claims entry point" — the Claims tab is gated on
// canAccessPage('claims'), which SupportWorker's restricted page set excludes (see
// SUPPORT_WORKER_PAGES in lib/permissions.ts), unlike every other role.
describe('ParticipantDetailPage — Claims tab', () => {
  it('shows the Claims tab and deep-links to it via ?tab=claims for a Coordinator', () => {
    setUserRole('Coordinator')
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAtTab('participant-1', 'claims')

    expect(screen.getByRole('tab', { name: 'Claims' })).toBeInTheDocument()
    expect(screen.getByTestId('claims-tab')).toBeInTheDocument()
  })

  it('hides the Claims tab for a SupportWorker role', () => {
    setUserRole('SupportWorker')
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAtTab('participant-1', 'claims')

    expect(screen.queryByRole('button', { name: 'Claims' })).not.toBeInTheDocument()
    // Same "deep-linked to a tab this role can't see" behaviour as the pre-existing History tab
    // (PP-39 above): the tab content is simply not rendered, matching that established pattern.
    expect(screen.queryByTestId('claims-tab')).not.toBeInTheDocument()
  })
})

// Connection map item 12 — the Rostering tab is gated on canAccessPage('rostering'), which
// SupportWorker's restricted page set excludes (see SUPPORT_WORKER_PAGES in lib/permissions.ts),
// same gating pattern as the Claims tab above.
describe('ParticipantDetailPage — Rostering tab', () => {
  it('shows the Rostering tab and deep-links to it via ?tab=rostering for a Coordinator', () => {
    setUserRole('Coordinator')
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAtTab('participant-1', 'rostering')

    expect(screen.getByRole('tab', { name: 'Rostering' })).toBeInTheDocument()
    expect(screen.getByTestId('rostering-tab')).toBeInTheDocument()
  })

  it('hides the Rostering tab for a SupportWorker role', () => {
    setUserRole('SupportWorker')
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAtTab('participant-1', 'rostering')

    expect(screen.queryByRole('button', { name: 'Rostering' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('rostering-tab')).not.toBeInTheDocument()
  })
})

// Density verdict (mobile) — below md the header can't fit three PDF buttons, "Agreement draft" and Edit
// without stacking five 44px rows over the participant's name, so the four document actions fold into
// one "Documents" menu (the shared Dropdown "menu" variant) and Edit stays a visible button. jsdom has no
// matchMedia — every test above therefore sees the wide layout — so these stub one.
describe('ParticipantDetailPage — Documents menu below md', () => {
  const ERROR_COPY = /couldn't download the file/i

  function stubMatchMedia(matches: boolean) {
    const mql = {
      matches, media: '', onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    }
    window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia
  }

  function idleDownloads() {
    mockUseDownloadIntakeFormPdf.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false })
    mockUseDownloadParticipantProfilePdf.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false })
    mockUseDownloadClientOverviewPdf.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false })
  }

  function renderWithAgreementRoute() {
    return render(
      <MemoryRouter initialEntries={['/participants/participant-1']}>
        <Routes>
          <Route path="/participants/:id" element={<ParticipantDetailPage />} />
          <Route path="/participants/:id/agreement-draft" element={<div data-testid="agreement-draft-route" />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  beforeEach(() => {
    // Admin: canWrite (Edit + Agreement draft) and canWriteParticipantDetails (caregiver control).
    setUserRole('Admin')
    idleDownloads()
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    stubMatchMedia(false)
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
    idleDownloads()
  })

  it('folds the three PDF buttons and Agreement draft into one Documents menu and keeps Edit visible', () => {
    renderAt('participant-1')

    expect(screen.getByRole('button', { name: 'Documents' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /intake form pdf/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /participant profile pdf/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /client overview pdf/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /agreement draft/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^edit$/i })).toHaveAttribute('href', '/participants/participant-1/profile')
  })

  // Round 1b (review F18, decided): an agreement draft carries money, which is never visible to ReadOnly or SupportWorker (the API refuses them its GETs). ReadOnly satisfies canWrite, so it was offered the page.
  it.each(['ReadOnly', 'SupportWorker'])('does not offer Agreement draft to %s, in the menu or as a button, and still offers the PDFs', async role => {
    const user = userEvent.setup()
    setUserRole(role)
    const menu = renderAt('participant-1')
    await user.click(screen.getByRole('button', { name: 'Documents' }))
    expect(screen.getByRole('option', { name: 'Intake Form PDF' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Agreement draft' })).not.toBeInTheDocument()
    menu.unmount()

    stubMatchMedia(true)
    renderAt('participant-1')
    expect(screen.getByRole('button', { name: /intake form pdf/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /agreement draft/i })).not.toBeInTheDocument()
  })

  it.each(['SuperAdmin', 'Admin', 'Coordinator'])('offers Agreement draft to %s, in the menu and as a button', async role => {
    const user = userEvent.setup()
    setUserRole(role)
    const menu = renderAt('participant-1')
    await user.click(screen.getByRole('button', { name: 'Documents' }))
    expect(screen.getByRole('option', { name: 'Agreement draft' })).toBeInTheDocument()
    menu.unmount()

    stubMatchMedia(true)
    renderAt('participant-1')
    expect(screen.getByRole('link', { name: /agreement draft/i })).toHaveAttribute('href', '/participants/participant-1/agreement-draft')
  })

  it('lists the three PDFs and Agreement draft when the menu opens', async () => {
    const user = userEvent.setup()
    renderAt('participant-1')

    await user.click(screen.getByRole('button', { name: 'Documents' }))

    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual([
      'Intake Form PDF', 'Participant Profile PDF', 'Client Overview PDF', 'Agreement draft',
    ])
  })

  it('carries the coarse-pointer height floor on every option row and on the trigger, since Dropdown takes no height prop', async () => {
    const user = userEvent.setup()
    renderAt('participant-1')

    // Trigger: the skin wrapper (button -> Dropdown's own div -> wrapper) gives the button --control-h
    // (32px, 44px under a touch pointer).
    const skin = screen.getByRole('button', { name: 'Documents' }).parentElement!.parentElement!
    expect(skin).toHaveClass('[&_button]:h-[var(--control-h)]')

    await user.click(screen.getByRole('button', { name: 'Documents' }))

    // Option rows are 32px (py-1.5 + a 20px line); the icon slot's --tap-min floor lifts them to 44px under touch.
    for (const option of screen.getAllByRole('option')) {
      const slots = Array.from(option.querySelectorAll('span')).filter(el => el.classList.contains('min-h-[calc(var(--tap-min)-12px)]'))
      expect(slots).toHaveLength(1)
    }
  })

  it('omits Agreement draft (and Edit) for a role without canWrite, like the wide layout does', async () => {
    setUserRole('SupportWorker')
    const user = userEvent.setup()
    renderAt('participant-1')

    await user.click(screen.getByRole('button', { name: 'Documents' }))

    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual([
      'Intake Form PDF', 'Participant Profile PDF', 'Client Overview PDF',
    ])
    expect(screen.queryByRole('link', { name: /^edit$/i })).not.toBeInTheDocument()
  })

  it.each([
    ['Intake Form PDF', mockUseDownloadIntakeFormPdf, 'Sophie Brown - Intake Form.pdf'],
    ['Participant Profile PDF', mockUseDownloadParticipantProfilePdf, 'Sophie Brown - Participant Profile.pdf'],
    ['Client Overview PDF', mockUseDownloadClientOverviewPdf, 'Sophie Brown - Client Overview.pdf'],
  ])('choosing %s starts that download with the participant id and the same file name as the button', async (label, hook, fileName) => {
    const user = userEvent.setup()
    const mutate = vi.fn()
    hook.mockReturnValue({ mutate, isPending: false, isError: false })
    renderAt('participant-1')

    await user.click(screen.getByRole('button', { name: 'Documents' }))
    await user.click(screen.getByRole('option', { name: label }))

    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate).toHaveBeenCalledWith({ id: 'participant-1', fileName })
    // Picking an item closes the menu.
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('choosing Agreement draft navigates to the agreement-draft page', async () => {
    const user = userEvent.setup()
    renderWithAgreementRoute()

    await user.click(screen.getByRole('button', { name: 'Documents' }))
    await user.click(screen.getByRole('option', { name: 'Agreement draft' }))

    expect(screen.getByTestId('agreement-draft-route')).toBeInTheDocument()
  })

  it('shows "Preparing…" on the trigger and disables only the option whose download is pending', async () => {
    const user = userEvent.setup()
    mockUseDownloadIntakeFormPdf.mockReturnValue({ mutate: vi.fn(), isPending: true, isError: false })
    renderAt('participant-1')

    await user.click(screen.getByRole('button', { name: /preparing/i }))

    expect(screen.getByRole('option', { name: 'Intake Form PDF' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('option', { name: 'Participant Profile PDF' })).not.toHaveAttribute('aria-disabled')
  })

  it('does not start a download when a pending option is chosen', async () => {
    const user = userEvent.setup()
    const mutate = vi.fn()
    mockUseDownloadIntakeFormPdf.mockReturnValue({ mutate, isPending: true, isError: false })
    renderAt('participant-1')

    await user.click(screen.getByRole('button', { name: /preparing/i }))
    await user.click(screen.getByRole('option', { name: 'Intake Form PDF' }))

    expect(mutate).not.toHaveBeenCalled()
  })

  it('collapses the per-button error lines into one shared alert', () => {
    mockUseDownloadIntakeFormPdf.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: true })
    mockUseDownloadClientOverviewPdf.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: true })
    renderAt('participant-1')

    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent(ERROR_COPY)
  })

  it('shows no alert when every download is idle', () => {
    renderAt('participant-1')

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the full button set (and no menu) from md up', () => {
    stubMatchMedia(true)
    renderAt('participant-1')

    expect(screen.queryByRole('button', { name: 'Documents' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /intake form pdf/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /participant profile pdf/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /client overview pdf/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /agreement draft/i })).toHaveAttribute('href', '/participants/participant-1/agreement-draft')
  })

  it('still renders the caregiver control and Edit next to the menu, so nothing is lost below md', () => {
    renderAt('participant-1')

    expect(screen.getByTestId('caregiver-link-control')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /generate caregiver link/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^edit$/i })).toBeInTheDocument()
  })
})

// Density verdict (mobile) — coarse-pointer tap targets and the compact empty state. jsdom applies no CSS,
// so these assert the class contract each fix relies on.
describe('ParticipantDetailPage — coarse-pointer targets and empty tables', () => {
  it('lifts the icon-only Back button to the --tap-min floor (44px under a coarse pointer, unchanged on a mouse)', () => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAt('participant-1')

    expect(screen.getByRole('link', { name: 'Back to participants' })).toHaveClass('min-h-[var(--tap-min)]', 'min-w-[var(--tap-min)]')
  })

  it('renders the caregiver-link buttons as Buttons (--control-h tall, 44px under a coarse pointer)', () => {
    setUserRole('Admin')
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    mockUseCaregiverSubmissions.mockReturnValue({ data: [{ id: 's1', participantId: 'participant-1', status: 'Draft' }] })
    renderAt('participant-1')

    expect(screen.getByRole('button', { name: /regenerate caregiver link/i })).toHaveClass('h-[var(--control-h)]')
    expect(screen.getByRole('button', { name: 'Revoke' })).toHaveClass('h-[var(--control-h)]')
  })

  it('gives the bookings-tab trip link the --tap-min floor so the row link is a real tap target', () => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    mockUseParticipantBookings.mockReturnValue({
      data: [{ id: 'b1', tripInstanceId: 'trip-9', tripName: 'Beach Weekend', bookingStatus: 'Confirmed', bookingDate: '2026-10-01' }],
    })
    renderAtTab('participant-1', 'bookings')

    expect(screen.getByRole('link', { name: 'Beach Weekend' })).toHaveClass('min-h-[var(--tap-min)]')
  })

  it('collapses a zero-row Health Conditions / ADL table to a strip (header hidden, py-5 message cell)', () => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAt('participant-1')

    for (const testId of ['health-conditions-section', 'adl-assessments-section']) {
      const wrapper = screen.getByTestId(testId).parentElement!
      expect(wrapper).toHaveClass('col-span-full', '[&_table:has(td[colspan])_thead]:hidden', '[&_td[colspan]]:py-5')
    }
  })
})

describe('ParticipantDetailPage — failed request vs. missing record (PageState)', () => {
  it('names a failed request as a failure, with a retry, and does not call it "Participant not found"', () => {
    mockUseParticipant.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: { response: { status: 500 } }, refetch: vi.fn() })
    renderAt('p-1')

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this participant")
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByText('Participant not found')).not.toBeInTheDocument()
  })

  it('shows "Participant not found" for a 404, with nothing to retry', () => {
    mockUseParticipant.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: { response: { status: 404 } }, refetch: vi.fn() })
    renderAt('p-1')

    expect(screen.getByText('Participant not found')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to participants' })).toHaveAttribute('href', '/participants')
  })

  it('shows "Participant not found" for an answer with no record, and says "Loading participant…" while it loads', () => {
    mockUseParticipant.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() })
    const { unmount } = renderAt('p-1')
    expect(screen.getByText('Participant not found')).toBeInTheDocument()
    unmount()

    mockUseParticipant.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() })
    renderAt('p-1')
    expect(screen.getByRole('status')).toHaveTextContent('Loading participant…')
  })
})

/** Exposes the router's live location, so a test can assert what a tab switch wrote to the URL. */
function LocationProbe({ onChange }: { onChange: (value: string) => void }) {
  const { pathname, search } = useLocation()
  onChange(`${pathname}${search}`)
  return null
}

describe('ParticipantDetailPage — the tab lives in the URL (useTabParam)', () => {
  function renderWithUrl(url: string) {
    let current = url
    const view = render(
      <MemoryRouter initialEntries={[url]}>
        <LocationProbe onChange={value => { current = value }} />
        <Routes>
          <Route path="/participants/:id" element={<ParticipantDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    return { ...view, url: () => current }
  }

  beforeEach(() => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
  })

  it('writes ?tab= when a tab is chosen, and the chosen tab is the selected one', async () => {
    const user = userEvent.setup()
    const page = renderWithUrl('/participants/x-1')
    await user.click(screen.getByRole('tab', { name: 'Bookings' }))
    expect(page.url()).toBe('/participants/x-1?tab=bookings')
    expect(screen.getByRole('tab', { name: 'Bookings' })).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps the tab across a reload or a shared link: a fresh render of the written URL lands on the same tab', async () => {
    const user = userEvent.setup()
    const first = renderWithUrl('/participants/x-1')
    await user.click(screen.getByRole('tab', { name: 'Bookings' }))
    const written = first.url()
    first.unmount()
    renderWithUrl(written)
    expect(screen.getByRole('tab', { name: 'Bookings' })).toHaveAttribute('aria-selected', 'true')
  })

  it('drops the param when the default tab is chosen, and every other param survives both ways', async () => {
    const user = userEvent.setup()
    const page = renderWithUrl('/participants/x-1?from=dash&tab=bookings')
    await user.click(screen.getByRole('tab', { name: 'Details' }))
    expect(page.url()).toBe('/participants/x-1?from=dash')
    await user.click(screen.getByRole('tab', { name: 'Bookings' }))
    expect(page.url()).toBe('/participants/x-1?from=dash&tab=bookings')
  })

  it('reads an unknown ?tab= as the default tab', () => {
    renderWithUrl('/participants/x-1?tab=bogus')
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true')
  })
})

// ── Participant readiness (WARN mode) in the header ──────────────────────────────────────────────────────────────────
// What is still missing shows as a quiet warning-tone chip in the meta row, right after the Active / Inactive badge. It is
// informational: nothing on the page is gated on it, and a participant with nothing missing gets no chip at all.
describe('ParticipantDetailPage — readiness chip in the header', () => {
  const ISSUES = ['Intake not complete', 'Onboarding not complete: service type']
  const WARNING = 'Not ready: Intake not complete · Onboarding not complete: service type'

  it('shows the chip beside the status badge when the server lists issues', () => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ isActive: true, readinessIssues: ISSUES }), isLoading: false })
    renderAt('participant-1')

    const chip = screen.getByText(WARNING).closest('[title]') as HTMLElement
    expect(chip).toHaveAttribute('title', WARNING)
    for (const cls of TONE.warning.solid.split(' ')) expect(chip).toHaveClass(cls)
    // In the same meta row as the Active badge, straight after it.
    const badge = screen.getByText('Active')
    expect(chip.parentElement).toBe(badge.parentElement)
    expect(badge.nextElementSibling).toBe(chip)
    // Not an alert, and the page's actions are untouched by it.
    expect(chip.closest('[role="alert"]')).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Sophie Brown' })).toBeInTheDocument()
  })

  it('shows the chip next to an Inactive badge too', () => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ isActive: false, readinessIssues: ['No signed service agreement'] }), isLoading: false })
    renderAt('participant-1')

    const badge = screen.getByText('Inactive')
    expect(badge.nextElementSibling).toBe(screen.getByText('Not ready: No signed service agreement').closest('[title]'))
  })

  it.each([
    ['omits readinessIssues', undefined],
    ['sends an empty list', [] as string[]],
  ])('draws no chip when the server %s', (_label, readinessIssues) => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ readinessIssues }), isLoading: false })
    renderAt('participant-1')

    expect(screen.queryByText(/not ready/i)).not.toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
  })
})

// L5-05: the tab keys were a static whitelist while the strip and the panels are role-gated, so ?tab=history (or claims, rostering) for a role
// without that tab matched a key but showed no tab: nothing selected, an empty body. A key the role cannot see reads as the default tab.
describe('ParticipantDetailPage — a role-gated tab key in the URL', () => {
  const selectedTab = () => screen.getAllByRole('tab').filter(tab => tab.getAttribute('aria-selected') === 'true')

  it.each(['claims', 'rostering', 'history'])('reads ?tab=%s as Details for a SupportWorker, who has no such tab', (tab) => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAtTab('participant-1', tab)

    expect(selectedTab().map(t => t.textContent)).toEqual([expect.stringMatching(/^Details/)])
  })

  it('reads ?tab=history as Details for a Coordinator (History is Admin only), and still opens a tab the Coordinator has', () => {
    setUserRole('Coordinator')
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    const { unmount } = renderAtTab('participant-1', 'history')

    expect(selectedTab().map(t => t.textContent)).toEqual([expect.stringMatching(/^Details/)])
    unmount()

    renderAtTab('participant-1', 'claims')
    expect(selectedTab().map(t => t.textContent)).toEqual([expect.stringMatching(/^Claims/)])
  })
})

// Budget phase 1: the Funding tab holds a participant's plan budget, which is money. It is for the roles the funding API admits (SuperAdmin, Admin, Coordinator) and never rides on canWrite.
describe('ParticipantDetailPage — Funding tab', () => {
  const selectedTab = () => screen.getAllByRole('tab').filter(tab => tab.getAttribute('aria-selected') === 'true')

  it.each(['Coordinator', 'Admin', 'SuperAdmin'])('shows the Funding tab to a %s, and opens it from ?tab=funding with the participant and their plan type', role => {
    setUserRole(role)
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAtTab('participant-1', 'funding')

    expect(screen.getByRole('tab', { name: 'Funding' })).toBeInTheDocument()
    expect(selectedTab().map(t => t.textContent)).toEqual([expect.stringMatching(/^Funding/)])
    const tab = screen.getByTestId('funding-tab')
    expect(tab).toHaveAttribute('data-participant', 'participant-1')
    expect(tab).toHaveAttribute('data-plan-type', makeParticipant().planType)
  })

  it.each(['SupportWorker', 'ReadOnly'])('has no Funding tab for a %s (ReadOnly satisfies canWrite and must still not see money), and reads ?tab=funding as Details', role => {
    setUserRole(role)
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAtTab('participant-1', 'funding')

    expect(screen.queryByRole('tab', { name: 'Funding' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('funding-tab')).not.toBeInTheDocument()
    expect(selectedTab().map(t => t.textContent)).toEqual([expect.stringMatching(/^Details/)])
  })

  it('does not mount the Funding tab on another tab', () => {
    setUserRole('Coordinator')
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAt('participant-1')

    expect(screen.getByRole('tab', { name: 'Funding' })).toBeInTheDocument()
    expect(screen.queryByTestId('funding-tab')).not.toBeInTheDocument()
  })
})

// L5-07: "Copy" on the caregiver link called navigator.clipboard.writeText straight away. navigator.clipboard is undefined on a non-secure origin
// (the plain-http LAN address this app is served from), so the click threw an uncaught TypeError and copied nothing.
describe('ParticipantDetailPage — copying the caregiver link on a page that is not a secure context', () => {
  it('falls back to a selection copy instead of throwing when navigator.clipboard is undefined', async () => {
    const user = userEvent.setup()
    setUserRole('Coordinator')
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    const generate = vi.fn().mockResolvedValue({ data: { token: 'tok-1', expiresAt: '2026-10-09T00:00:00Z' } })
    mockUseGenerateCaregiverLink.mockReturnValue({ mutateAsync: generate, isPending: false, isError: false })
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const execCommand = vi.fn(() => true)
    document.execCommand = execCommand
    try {
      renderAt('participant-1')
      await user.click(screen.getByRole('button', { name: /Generate/ }))
      await user.click(await screen.findByRole('button', { name: 'Copy' }))

      expect(execCommand).toHaveBeenCalledWith('copy')
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original)
      else delete (navigator as unknown as Record<string, unknown>).clipboard
    }
  })
})
