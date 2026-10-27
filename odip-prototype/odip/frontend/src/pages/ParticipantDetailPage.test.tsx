import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation, useNavigationType } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ParticipantDetailPage from './ParticipantDetailPage'
import type { ParticipantDetailDto } from '@/api/types/participants'
import type { ParticipantChecklistItemDto } from '@/api/types/checklist-items'
import { OLD_KEY_TARGET, NEW_TABS, SUB_TABS, type GroupedTabKey } from './participant-detail/participantTabs'
import { TONE } from '@/lib/tone'
import { __testHooks } from '@/hooks/useBackNavigation'

const {
  mockUseParticipant, mockUseSupportProfile, mockUseParticipantBookings, mockUseParticipantAlerts,
  mockUseDownloadIntakeFormPdf, mockUseDownloadParticipantProfilePdf, mockUseDownloadClientOverviewPdf,
  mockPatchMutateAsync, mockUseStaff,
  mockUseGenerateCaregiverLink, mockUseRevokeCaregiverLink, mockUseCaregiverSubmissions,
  mockDeleteMutate, mockNotes, mockRisks,
} = vi.hoisted(() => ({
  mockUseParticipant: vi.fn(),
  // The page reads the support profile once for Health, Daily and Overview; 404 / empty by default.
  mockUseSupportProfile: vi.fn<() => Record<string, unknown>>(() => ({ data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() })),
  mockUseParticipantBookings: vi.fn<() => { data: Record<string, unknown>[] }>(() => ({ data: [] })),
  mockUseParticipantAlerts: vi.fn<() => { data: unknown }>(() => ({ data: undefined })),
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
  mockDeleteMutate: vi.fn(),
  mockNotes: vi.fn<() => { data: Record<string, unknown>[] }>(() => ({ data: [] })),
  mockRisks: vi.fn<() => { data: Record<string, unknown>[] }>(() => ({ data: [] })),
  mockUseCaregiverSubmissions: vi.fn<(status?: string, options?: { participantId?: string; enabled?: boolean }) => { data: Record<string, unknown>[] }>(() => ({ data: [] })),
}))

// Only the API layer is mocked. The nested-CRUD sections (Contacts/Risks/Consents/Health
// Conditions/ADL Assessments/Medications/Notes/Routines/Restrictive Practices) each have their
// own dedicated test file already — stubbed here so this page's tests stay about page
// composition/the Community Access card, not those sections' own hooks (same "mirror
// PortalShiftDetailPage.test.tsx's ShiftNotesSection stub" approach used there).
vi.mock('@/api/hooks', () => ({
  useParticipant: mockUseParticipant,
  useSupportProfile: mockUseSupportProfile,
  useUpdateSupportProfile: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
  // The More menu's archive/restore and the tab-strip counts (the lists the Health, Daily, People and Records tabs badge).
  useDeleteParticipant: () => ({ mutate: mockDeleteMutate, mutateAsync: vi.fn(), isPending: false }),
  useRestoreParticipant: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useParticipantRiskEntries: mockRisks,
  useParticipantRoutines: () => ({ data: [] }),
  useParticipantContactRoles: () => ({ data: [] }),
  useParticipantNotes: mockNotes,
}))

vi.mock('@/components/AuditHistoryTab', () => ({ default: () => <div data-testid="history-tab" /> }))

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
    // Shift-completion design spec §4 — Claims tab has its own dedicated test file
    // (ClaimsTab.test.tsx); stubbed here for the same reason as every nested-CRUD tab above.
    ClaimsTab: ({ otherFunded, funder }: { otherFunded?: boolean; funder?: string | null }) => <div data-testid="claims-tab" data-other-funded={String(!!otherFunded)} data-funder={funder ?? ''} />,
    // Connection map item 12 — Rostering tab has its own dedicated test file
    // (RosteringTab.test.tsx); stubbed here for the same reason as every nested-CRUD tab above.
    RosteringTab: () => <div data-testid="rostering-tab" />,
    // Budget phase 1 — the Funding tab has its own dedicated test file (FundingTab.test.tsx); stubbed here so this page's tests stay about tab wiring.
    FundingTab: ({ participantId, planType }: { participantId: string; planType: string }) => <div data-testid="funding-tab" data-participant={participantId} data-plan-type={planType} />,
  }
})

// The page reads the query client (tab counts, the list refetch on archive), which the mocked hooks do not need but the page itself does.
function PageWithClient() {
  return <QueryClientProvider client={new QueryClient()}><ParticipantDetailPage /></QueryClientProvider>
}

function setUserRole(role: string) {
  localStorage.setItem('odip_user', JSON.stringify({ role }))
}

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/participants/${id}`]}>
      <Routes>
        <Route path="/participants/:id" element={<PageWithClient />} />
      </Routes>
    </MemoryRouter>,
  )
}

function renderAtTab(id: string, tab: string, section?: string) {
  return render(
    <MemoryRouter initialEntries={[`/participants/${id}?tab=${tab}${section ? `&section=${section}` : ''}`]}>
      <Routes>
        <Route path="/participants/:id" element={<PageWithClient />} />
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

/** The header's one menu (VISUAL-1 V2): the documents, the agreement draft and the caregiver link, at every width. */
const documentsTrigger = () => screen.getByRole('button', { name: /^(Documents|Preparing…)$/ })
async function openDocuments() {
  await userEvent.setup().click(documentsTrigger())
}
async function chooseFromDocuments(name: RegExp | string) {
  const user = userEvent.setup()
  await user.click(documentsTrigger())
  await user.click(screen.getByRole('option', { name }))
}

describe('ParticipantDetailPage — INTAKE-03 Community Access cards (behaviour support, typical day)', () => {
  it('is absent when the participant does not have the CommunityAccessDailyLiving stream', () => {
    mockUseParticipant.mockReturnValue({
      data: makeParticipant({ serviceStreams: 'InHomeSupport', signsHappyAndSettled: 'Hums quietly.' }),
      isLoading: false,
    })
    renderAt('participant-1')

    expect(screen.queryByRole('heading', { name: 'What my supports look like' })).not.toBeInTheDocument()
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
    renderAtTab('participant-1', 'health', 'behaviour-support')

    expect(screen.getByText('Smiles and hums when content.')).toBeInTheDocument()
    expect(screen.getByText('Quiet room, weighted blanket.')).toBeInTheDocument()
    expect(screen.getByText('Loud unexpected noises.')).toBeInTheDocument()
    cleanup()
    renderAtTab('participant-1', 'health', 'community-access-risk')
    expect(screen.getByText('Earlier checklist (2)')).toBeInTheDocument()

    // Only the two rows with an actual Value show — not a wall of 19 unanswered placeholder rows.
    expect(screen.getByText('Uses wheelchair')).toBeInTheDocument()
    expect(screen.getByText('Manual wheelchair, needs ramp access.')).toBeInTheDocument()
    expect(screen.getByText('Harm to self')).toBeInTheDocument()
    expect(screen.queryByText('Falls risk')).not.toBeInTheDocument()
    cleanup()
    renderAtTab('participant-1', 'daily', 'typical-day')
    expect(screen.getByRole('heading', { name: 'What my supports look like' })).toBeInTheDocument()
    expect(screen.getByText('Gentle wake, warm drink.')).toBeInTheDocument()
    expect(screen.getByText('Community outing with 1:1 support.')).toBeInTheDocument()
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
    renderAtTab('participant-1', 'about')

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

  it('lists Preferred Name in the card\'s Not recorded line when unset, with no dash row', () => {
    mockUseParticipant.mockReturnValue({
      data: makeParticipant({ preferredName: null }),
      isLoading: false,
    })
    renderAtTab('participant-1', 'about')

    expect(screen.queryByText('Preferred Name')).not.toBeInTheDocument()
    expect(screen.getAllByText(/^Not recorded:.*Preferred Name/).length).toBeGreaterThan(0)
  })

  it('renders the NDIS & Funding group split out from Identity, including the DSOA/repeat-client flags', () => {
    mockUseParticipant.mockReturnValue({
      data: makeParticipant({
        fundingSource: 'Ndis', ndisNumber: '123456789', maskedNdisNumber: null,
        planStartDate: '2026-02-01', planEndDate: '2027-02-01', isDsoa: true, isRepeatClient: true,
      }),
      isLoading: false,
    })
    renderAtTab('participant-1', 'about', 'ndis-plan')

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
    renderAtTab('participant-1', 'about', 'ndis-plan')

    expect(screen.getByText('Local Council')).toBeInTheDocument()
    expect(screen.queryByText('NDIS Number')).not.toBeInTheDocument()
  })

  it('passes the funding source and funder to the Claims tab', () => {
    mockUseParticipant.mockReturnValue({
      data: makeParticipant({ fundingSource: 'Other', fundingOrganisation: 'Local Council' }),
      isLoading: false,
    })
    renderAtTab('participant-1', 'claims')

    expect(screen.getByTestId('claims-tab')).toHaveAttribute('data-other-funded', 'true')
    expect(screen.getByTestId('claims-tab')).toHaveAttribute('data-funder', 'Local Council')
  })

  it('PD-6: no longer shows a "Support Needs & Mobility" card — those fields moved to the Support Profile tab', () => {
    mockUseParticipant.mockReturnValue({
      data: makeParticipant({
        isIntensiveSupport: true, mobilityNotes: 'Prefers left-side approach.',
        equipmentRequirements: 'Needs a slide sheet.', transportRequirements: 'Wheelchair-accessible van only.',
      }),
      isLoading: false,
    })
    renderAtTab('participant-1', 'about')

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
    renderAtTab('participant-1', 'health', 'risks')

    expect(screen.getByRole('heading', { name: 'Risks & Hazards Summary' })).toBeInTheDocument()
    expect(screen.getByText(/Escalates when routine changes without warning\./)).toBeInTheDocument()
    expect(screen.getByText(/Prefers morning visits\./)).toBeInTheDocument()
  })

  it('lists the About sub-tabs like the wizard, and each section shows its own heading', () => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ medicareNumber: 'MED123', isCald: true }), isLoading: false })
    const { unmount } = renderAtTab('participant-1', 'about')
    expect(subLabels()).toEqual(['Identity', 'Address & living', 'NDIS & funding', 'Services', 'Key identifiers', 'Cultural background', 'About me'])
    unmount()
    const headings: Record<string, string> = {
      identity: 'Identity', 'ndis-plan': 'NDIS & Funding', 'key-identifiers': 'Key Identifiers', 'culture-and-rights': 'Cultural Background',
    }
    eachSection('about', Object.keys(headings), section => {
      expect(within(screen.getByRole('tabpanel')).getByRole('heading', { name: headings[section] })).toBeInTheDocument()
      // PD-6: "Support Needs & Mobility" is not on this tab (nor anywhere on the page).
      expect(screen.queryByRole('heading', { name: 'Support Needs & Mobility' })).not.toBeInTheDocument()
    })
  })

  it('lists the Health sub-tabs in order, with the risk summary before the entries', () => {
    mockUseParticipant.mockReturnValue({
      data: makeParticipant({
        primaryDiagnosis: 'Autism', memory: 'Fair', serviceStreams: 'CommunityAccessDailyLiving',
        behaviourRiskSummary: 'Escalates when routine changes.',
        checklistItems: [makeChecklistItem({ itemType: 'HarmToSelf', value: 'No' })],
      }),
      isLoading: false,
    })
    const { unmount } = renderAtTab('participant-1', 'health')
    expect(subLabels()).toEqual(['Emergency', 'Medical', 'Conditions', 'Medications', 'Behaviour & communication', 'Behaviour support', 'Risks', 'Restrictive practices', 'Earlier checklist'])
    unmount()
    renderAtTab('participant-1', 'health', 'risks')
    const summary = screen.getByRole('heading', { name: 'Risks & Hazards Summary' })
    expect(summary.compareDocumentPosition(screen.getByTestId('risk-entries-section')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps each nested CRUD section on the sub-tab that owns it, one section at a time', () => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    const owned: Record<string, Record<string, string>> = {
      health: { 'health-conditions': 'health-conditions-section', risks: 'risk-entries-section', medications: 'medications-tab', 'restrictive-practices': 'restrictive-practices-tab' },
      daily: { 'daily-living': 'adl-assessments-section', routines: 'routines-tab' },
      people: { contacts: 'contacts-tab' },
      records: { consents: 'consents-section', notes: 'notes-tab' },
    }
    for (const [tab, sections] of Object.entries(owned)) {
      eachSection(tab, Object.keys(sections), section => {
        expect(screen.getByTestId(sections[section]), tab + ' ' + section).toBeInTheDocument()
        for (const other of Object.values(sections).filter(id => id !== sections[section])) expect(screen.queryByTestId(other), tab + ' ' + section + ' without ' + other).not.toBeInTheDocument()
      })
    }
  })

  // A section with nothing recorded is a quiet sub-tab, reachable by everyone; its card shows Not recorded (and Edit for an editor).
  const quietSubTabs = () => within(subStrip()).getAllByRole('tab').filter(t => t.firstElementChild!.className.includes('border-dashed')).map(subLabel)

  it('marks the empty About sections as quiet sub-tabs and shows an editor the empty card with Edit', () => {
    setUserRole('Coordinator')
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ medicareNumber: 'MED123' }), isLoading: false })
    const { unmount } = renderAtTab('participant-1', 'about')
    expect(quietSubTabs()).toEqual(expect.arrayContaining(['Address & living', 'Cultural background', 'About me']))
    expect(quietSubTabs()).not.toContain('Key identifiers')
    expect(quietSubTabs()).not.toContain('Identity')
    unmount()
    renderAtTab('participant-1', 'about', 'culture-and-rights')
    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getByRole('heading', { name: 'Cultural Background' })).toBeInTheDocument()
    expect(within(panel).getByText('Not recorded')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: /Edit/ })).toBeInTheDocument()
    expect(panel.querySelector('details')).toBeNull()
  })

  it('shows a role that cannot edit the same quiet sub-tabs and an empty card with no Edit', () => {
    setUserRole('SupportWorker')
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ medicareNumber: 'MED123' }), isLoading: false })
    const { unmount } = renderAtTab('participant-1', 'about')
    expect(quietSubTabs()).toEqual(expect.arrayContaining(['Address & living', 'Cultural background', 'About me']))
    unmount()
    renderAtTab('participant-1', 'about', 'culture-and-rights')
    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getByRole('heading', { name: 'Cultural Background' })).toBeInTheDocument()
    expect(within(panel).getByText('Not recorded')).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: /^(Edit|Add)/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/^Not recorded: .* and /)).not.toBeInTheDocument()
  })

  // T6: every About section, for a role that cannot edit.
  it.each(['SupportWorker', 'ReadOnly'])('%s sees Not recorded lines, no dashes and no Add buttons in any sparse About section', role => {
    setUserRole(role)
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ medicareNumber: 'MED123' }), isLoading: false })
    let notRecorded = 0
    eachSection('about', SUB_TABS.about.map(r => r.id), section => {
      const panel = screen.getByRole('tabpanel')
      expect(panel.textContent, section).not.toContain('—')
      expect(within(panel).queryByRole('button', { name: /^Add/ }), section).not.toBeInTheDocument()
      expect(panel.querySelector('details'), section).toBeNull()
      notRecorded += within(panel).queryAllByText(/^Not recorded/).length
    })
    expect(notRecorded).toBeGreaterThan(0)
  })

  // T7: the same page for editors; Add on a part-recorded card opens edit with focus in its first empty input.
  it.each(['Coordinator', 'Admin', 'SuperAdmin'])('%s gets an Add button on a part-recorded section', async role => {
    const user = userEvent.setup()
    setUserRole(role)
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ medicareNumber: 'MED123', mainSupportPersonName: 'Jo Brown' }), isLoading: false })
    renderAtTab('participant-1', 'about', 'identity')
    const panel = screen.getByRole('tabpanel')
    const add = within(panel).getAllByRole('button', { name: 'Add' })[0]
    const card = add.closest('section') as HTMLElement
    await user.click(add)
    await waitFor(() => {
      const active = document.activeElement as HTMLInputElement
      expect(card).toContainElement(active)
      expect(active.value).toBe('')
    })
  })

  it('gives a list section the panel width and a bare wrapper, and keeps the auto-fill grid for the risks cards', () => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    const { unmount } = renderAtTab('participant-1', 'health', 'health-conditions')

    const wrapper = screen.getByTestId('health-conditions-section').parentElement as HTMLElement
    const section = wrapper.parentElement as HTMLElement
    // A list is wide: no max-w-3xl cap and no grid around it. DataTable draws its own border, so the wrapper adds none.
    expect(section).not.toHaveClass('max-w-3xl')
    expect(section).not.toHaveClass('col-span-full')
    expect(section.parentElement).not.toHaveClass('grid')
    expect(wrapper).not.toHaveClass('border')
    unmount()

    renderAtTab('participant-1', 'daily', 'daily-living')
    const adlWrapper = screen.getByTestId('adl-assessments-section').parentElement as HTMLElement
    expect(adlWrapper.parentElement).not.toHaveClass('col-span-full')
    expect(adlWrapper).not.toHaveClass('border')
    cleanup()

    // jsdom has no layout, so the class is the only observable proof of the mobile fix: a bare
    // minmax(26rem,1fr) floor (416px) overflows a 390px viewport and scrolls the page sideways.
    renderAtTab('participant-1', 'health', 'risks')
    const grid = screen.getByTestId('risk-entries-section').closest('.grid') as HTMLElement
    expect(grid).toHaveClass('items-start', 'grid-cols-[repeat(auto-fill,minmax(min(26rem,100%),1fr))]')
  })
})

describe('ParticipantDetailPage — header meta row', () => {
  // The quiet line under the name: status, region, plan, ratio, updated, then the stream chips. The page's single h1 sits above it.
  const metaOf = () => screen.getByText(/^Ratio /).parentElement!.parentElement as HTMLElement

  it('reads region, plan type, ratio and when the record last changed, in that order', () => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ serviceStreams: 'None' }), isLoading: false })
    renderAt('participant-1')

    const meta = metaOf()
    expect(within(meta).queryByText('—')).not.toBeInTheDocument()
    const time = meta.querySelector('time')
    expect(time).toHaveAttribute('datetime', '2026-01-01T00:00:00Z')
    expect(meta.textContent).toMatch(/No region.*Self Managed.*Ratio .*Updated/)
  })

  it('drops a missing plan type or ratio instead of leaving a double dot in the meta row', () => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ planType: '' as never, supportRatio: '' as never, serviceStreams: 'None' }), isLoading: false })
    renderAt('participant-1')
    const meta = screen.getByText(/^Updated/).parentElement!.parentElement as HTMLElement
    expect(meta.textContent).not.toMatch(/··/)
    expect(meta.textContent).not.toMatch(/Ratio/)
    expect(meta.textContent).toMatch(/No region·Updated/)
  })

  // Landing-spotted: the header printed the raw enums "PlanManaged" and "TwoToOne".
  it('prints the plan type and support ratio as labels, never as raw enums', () => {
    mockUseParticipant.mockReturnValue({
      data: makeParticipant({ region: 'Gold Coast', planType: 'PlanManaged', supportRatio: 'TwoToOne' }),
      isLoading: false,
    })
    renderAt('participant-1')

    expect(metaOf()).toHaveTextContent('Gold Coast')
    expect(metaOf()).toHaveTextContent('Plan Managed')
    expect(screen.getByText('Ratio 2:1')).toBeInTheDocument()
    expect(screen.queryByText(/PlanManaged|TwoToOne/)).not.toBeInTheDocument()
  })

  it('still shows a chip per service stream in the meta row', () => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ serviceStreams: 'STA,InHomeSupport' }), isLoading: false })
    renderAt('participant-1')

    expect(within(metaOf()).getByText('STA')).toBeInTheDocument()
    expect(within(metaOf()).getByText('In-Home Support')).toBeInTheDocument()
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

    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/this participant is a draft/i)
    expect(screen.queryByRole('link', { name: /resume intake/i })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Sophie Brown' })).toBeInTheDocument()
  })

  // PARTICIPANTS-3 / PARTICIPANTS-4 (owner decision 2026-10-12): ReadOnly is refused the profile wizard and the intake, so it gets neither Edit nor Resume intake.
  it('offers ReadOnly the draft banner with no Edit and no Resume intake', () => {
    setUserRole('ReadOnly')
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ isDraft: true }), isLoading: false })
    renderAt('participant-1')

    expect(screen.getByRole('status')).toHaveTextContent(/this participant is a draft/i)
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /resume intake/i })).not.toBeInTheDocument()
  })

  it.each(['Admin', 'Coordinator'])('offers %s the wizard (in More actions) and Resume intake on a draft', async role => {
    setUserRole(role)
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ isDraft: true }), isLoading: false })
    renderAt('participant-1')

    await userEvent.setup().click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.getByRole('option', { name: /edit full profile/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /resume intake/i })).toBeInTheDocument()
  })

  it('keeps the draft banner and its Resume intake action regardless of the button cluster width (More menu present, PDF download pending)', () => {
    setUserRole('Admin')
    mockUseDownloadIntakeFormPdf.mockReturnValue({ mutate: vi.fn(), isPending: true, isError: false })
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ isDraft: true }), isLoading: false })
    renderAt('participant-1')

    // Widened cluster: the More menu shown, one download button in its longer "Preparing…" state.
    expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument()
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

  it('services started, still onboarding: says they can be rostered while onboarding finishes, and links to the checklist', () => {
    setUserRole('Admin')
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ isDraft: true, isActive: true, intakeCompletedAt: '2026-08-01T00:00:00Z', servicesStartedAt: '2026-10-10T01:00:00Z' }), isLoading: false })
    renderAt('participant-1')

    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent(/Services have started, and onboarding is still open/i)
    expect(banner).not.toHaveTextContent(/Excluded from rosters/i)
    expect(screen.getByRole('link', { name: /open checklist/i })).toHaveAttribute('href', '/onboarding/participant-1')
  })

  it('services started but then switched off: the ordinary onboarding banner, not "they can be rostered" (V5)', () => {
    setUserRole('Admin')
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ isDraft: true, isActive: false, intakeCompletedAt: '2026-08-01T00:00:00Z', servicesStartedAt: '2026-10-10T01:00:00Z' }), isLoading: false })
    renderAt('participant-1')

    expect(screen.getByRole('status')).not.toHaveTextContent(/Services have started/i)
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

// cg04 Task 9 — the caregiver link (design §5): gated on canWriteParticipantDetails (not canWrite — see B14 in the discovery fact
// sheet). Since VISUAL-1 V2 its Generate/Regenerate and, once a link is active, Revoke are items of the header's Documents menu, and
// the Regenerate item names the active link's status. A freshly generated URL is shown exactly once with a Copy button.
describe('ParticipantDetailPage — cg04 Task 9 caregiver link control', () => {
  function activeSubmission(overrides: Record<string, unknown> = {}) {
    return {
      id: 'submission-1', participantId: 'participant-1', participantName: 'Sophie Brown',
      status: 'Submitted', caregiverName: 'Jane Doe', createdAt: '2026-08-01T00:00:00Z',
      expiresAt: '2026-09-17T00:00:00Z', submittedAt: '2026-08-02T00:00:00Z',
      ...overrides,
    }
  }
  const withActiveLink = () => mockUseCaregiverSubmissions.mockImplementation((status?: string) => ({
    data: status === 'Submitted' ? [activeSubmission()] : [],
  }))

  function setup() {
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    return renderAt('participant-1')
  }

  it('hides the control for a role without canWriteParticipantDetails', async () => {
    setUserRole('SupportWorker')
    setup()
    await openDocuments()

    expect(screen.queryByRole('option', { name: /generate caregiver link/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId('caregiver-link-control')).not.toBeInTheDocument()
  })

  it('asks for no caregiver submissions at all for a role the list route refuses (SupportWorker)', () => {
    mockUseCaregiverSubmissions.mockClear()
    setUserRole('SupportWorker')
    setup()

    expect(mockUseCaregiverSubmissions).toHaveBeenCalled()
    for (const [, options] of mockUseCaregiverSubmissions.mock.calls as unknown as [string, { enabled?: boolean }][]) expect(options.enabled).toBe(false)
  })

  it('asks only for this participant\x27s caregiver submissions (Coordinator)', () => {
    setUserRole('Coordinator')
    setup()

    expect(mockUseCaregiverSubmissions).toHaveBeenCalledWith('Draft', { participantId: 'participant-1', enabled: true })
    expect(mockUseCaregiverSubmissions).toHaveBeenCalledWith('Submitted', { participantId: 'participant-1', enabled: true })
  })

  it('offers Generate caregiver link in the menu (Coordinator), and no Revoke without a link', async () => {
    setUserRole('Coordinator')
    setup()
    await openDocuments()

    expect(screen.getByRole('option', { name: /generate caregiver link/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /revoke caregiver link/i })).not.toBeInTheDocument()
  })

  it('after generating, shows the URL once with a Copy button and the expiry, and never again once dismissed by navigation away', async () => {
    setUserRole('Admin')
    const mutateAsync = vi.fn(async () => ({ success: true, data: { token: 'tok-123', expiresAt: '2026-09-17T00:00:00Z' } }))
    mockUseGenerateCaregiverLink.mockReturnValue({ mutateAsync, isPending: false, isError: false })
    const first = setup()

    await chooseFromDocuments(/generate caregiver link/i)

    expect(mutateAsync).toHaveBeenCalledWith({ participantId: 'participant-1' })
    const control = screen.getByTestId('caregiver-link-control')
    expect(await within(control).findByText(`${window.location.origin}/caregiver/tok-123`)).toBeInTheDocument()
    expect(within(control).getByRole('button', { name: /copy/i })).toBeInTheDocument()
    expect(within(control).getByText(/won't be shown again/i)).toBeInTheDocument()

    // Unmounting and re-rendering the page (simulating navigating away and back) must not
    // resurrect the URL — it lives only in this render's local state, never in the query cache
    // or anywhere else the UI could recover it from.
    // T13: the panel renders once, outside the action cluster that holds the Documents menu.
    expect(screen.getAllByTestId('caregiver-link-control')).toHaveLength(1)
    expect(documentsTrigger().parentElement).not.toContainElement(control)

    first.unmount()
    setup()
    expect(screen.queryByText(`${window.location.origin}/caregiver/tok-123`)).not.toBeInTheDocument()
  })

  it('names the active link on Regenerate and offers Revoke when a link is active', async () => {
    setUserRole('Admin')
    withActiveLink()
    setup()
    await openDocuments()

    expect(screen.getByRole('option', { name: /regenerate caregiver link/i })).toHaveTextContent('Current link: submitted')
    expect(screen.getByRole('option', { name: /revoke caregiver link/i })).toBeInTheDocument()
  })

  // PP-40 — Revoke stages behind a ConfirmDialog rather than firing immediately, same pattern as RiskEntriesSection's delete.
  it('Revoke does not call the mutation until confirmed in the dialog', async () => {
    setUserRole('Admin')
    const user = userEvent.setup()
    const revokeMutateAsync = vi.fn(async () => ({ success: true }))
    mockUseRevokeCaregiverLink.mockReturnValue({ mutate: vi.fn(), mutateAsync: revokeMutateAsync, isPending: false, isError: false })
    withActiveLink()
    setup()

    await chooseFromDocuments(/revoke caregiver link/i)
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
    withActiveLink()
    setup()

    await chooseFromDocuments(/revoke caregiver link/i)
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /cancel/i }))

    expect(revokeMutateAsync).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  // Q4a follow-up: the line showed the Revoke error whenever both had failed, so a later failed Generate still read as the old Revoke refusal.
  it('shows the latest refusal: a failed Generate after a failed Revoke shows the Generate error', async () => {
    setUserRole('Admin')
    const user = userEvent.setup()
    const refused = (message: string) => async () => { throw { response: { data: { message } } } }
    mockUseRevokeCaregiverLink.mockReturnValue({ mutate: vi.fn(), mutateAsync: vi.fn(refused('Revoke refused')), isPending: false, isError: false })
    mockUseGenerateCaregiverLink.mockReturnValue({ mutateAsync: vi.fn(refused('Generate refused')), isPending: false, isError: false })
    withActiveLink()
    setup()

    await chooseFromDocuments(/revoke caregiver link/i)
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /^revoke$/i }))
    const control = screen.getByTestId('caregiver-link-control')
    expect(await within(control).findByRole('alert')).toHaveTextContent('Revoke refused')

    await chooseFromDocuments(/regenerate caregiver link/i)
    await waitFor(() => expect(within(control).getByRole('alert')).toHaveTextContent('Generate refused'))
  })
})

// PP-39 — the History tab (and its content) must be gated on usePermissions()'s isAdmin/isSuperAdmin,
// not a raw localStorage-derived role check, so SuperAdmin also sees it.
describe('ParticipantDetailPage — PP-39 History section permissions', () => {
  it.each(['SuperAdmin', 'Admin'])('shows the History section at the end of Notes & records for %s', role => {
    setUserRole(role)
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    const { unmount } = renderAtTab('participant-1', 'records')
    expect(subLabels().at(-1)).toBe('History')
    unmount()
    renderAtTab('participant-1', 'records', 'history')

    expect(screen.getByTestId('history-tab')).toBeInTheDocument()
    expect(document.getElementById('history')).toContainElement(screen.getByTestId('history-tab'))
  })

  it.each(['SupportWorker', 'Coordinator'])('hides the History section for %s', role => {
    setUserRole(role)
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAtTab('participant-1', 'records', 'history')

    expect(subLabels()).not.toContain('History')
    expect(selectedSub()).toEqual(['Notes'])
    expect(screen.queryByTestId('history-tab')).not.toBeInTheDocument()
    expect(document.getElementById('history')).toBeNull()
  })
})

// Shift-completion design spec §4 "Claims entry point" — the Claims section is gated on
// canAccessPage('claims'), which SupportWorker's restricted page set excludes (see
// SUPPORT_WORKER_PAGES in lib/permissions.ts), unlike every other role. It lives on Funding & claims.
describe('ParticipantDetailPage — Claims section', () => {
  it('shows Funding & claims and the Claims section there for a Coordinator', () => {
    setUserRole('Coordinator')
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAtTab('participant-1', 'funding', 'claims')

    expect(screen.getByRole('tab', { name: 'Funding & claims' })).toBeInTheDocument()
    expect(subLabels()).toEqual(['Plan budget', 'Claims'])
    expect(document.getElementById('claims')).toContainElement(screen.getByTestId('claims-tab'))
  })

  it('has no Funding & claims tab for a SupportWorker, and ?tab=funding reads as Overview', () => {
    setUserRole('SupportWorker')
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAtTab('participant-1', 'funding')

    expect(screen.queryByRole('tab', { name: /Funding & claims/ })).not.toBeInTheDocument()
    expect(screen.queryByTestId('claims-tab')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  })
})

// Connection map item 12 — the Rostering section is gated on canAccessPage('rostering'), which
// SupportWorker's restricted page set excludes, same gating pattern as the Claims section above. It lives on People & roster.
describe('ParticipantDetailPage — Rostering section', () => {
  it('shows the Rostering section on People & roster for a Coordinator', () => {
    setUserRole('Coordinator')
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    const { unmount } = renderAtTab('participant-1', 'people')
    expect(subLabels()).toEqual(['Contacts', 'Rostering', 'Bookings'])
    unmount()
    renderAtTab('participant-1', 'people', 'roster')

    expect(document.getElementById('roster')).toContainElement(screen.getByTestId('rostering-tab'))
  })

  it('hides the Rostering section for a SupportWorker role', () => {
    setUserRole('SupportWorker')
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAtTab('participant-1', 'people', 'roster')

    expect(subLabels()).toEqual(['Contacts', 'Bookings'])
    expect(selectedSub()).toEqual(['Contacts'])
    expect(screen.queryByTestId('rostering-tab')).not.toBeInTheDocument()
    expect(document.getElementById('roster')).toBeNull()
  })
})

// VISUAL-1 V2 — the header carried seven controls at 1440 (three PDFs, Agreement draft, the caregiver link and Revoke, Edit). The
// Documents menu (the shared Dropdown "menu" variant, secondary look) holds all but Edit at every width, and Edit is the one primary.
describe('ParticipantDetailPage — Documents menu', () => {
  const ERROR_COPY = /couldn't download the file/i

  function idleDownloads() {
    mockUseDownloadIntakeFormPdf.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false })
    mockUseDownloadParticipantProfilePdf.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false })
    mockUseDownloadClientOverviewPdf.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false })
  }

  function renderWithAgreementRoute() {
    return render(
      <MemoryRouter initialEntries={['/participants/participant-1']}>
        <Routes>
          <Route path="/participants/:id" element={<PageWithClient />} />
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
  })

  afterEach(() => {
    idleDownloads()
  })

  it('holds the PDFs, Agreement draft and the caregiver link in one secondary-look menu, beside a secondary More actions menu (no filled primary)', () => {
    renderAt('participant-1')

    expect(screen.getByRole('button', { name: 'Documents' })).toHaveClass('bg-[var(--color-card)]', 'border')
    expect(screen.getByRole('button', { name: 'Documents' })).not.toHaveClass('bg-[var(--color-primary)]')
    for (const name of [/intake form pdf/i, /participant profile pdf/i, /client overview pdf/i, /caregiver link/i, /^revoke$/i]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
    expect(screen.queryByRole('link', { name: /agreement draft/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More actions' })).not.toHaveClass('bg-[var(--color-primary)]')
    expect(screen.queryByRole('link', { name: /^edit$/i })).not.toBeInTheDocument()
  })

  // Round 1b (review F18, decided): an agreement draft carries money, which is never visible to ReadOnly or SupportWorker (the API refuses them its GETs). ReadOnly satisfies canWrite, so it was offered the page.
  it.each(['ReadOnly', 'SupportWorker'])('does not offer Agreement draft to %s, and still offers the PDFs', async role => {
    setUserRole(role)
    renderAt('participant-1')
    await openDocuments()
    expect(screen.getByRole('option', { name: 'Intake Form PDF' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Agreement draft' })).not.toBeInTheDocument()
  })

  it.each(['SuperAdmin', 'Admin', 'Coordinator'])('offers Agreement draft to %s', async role => {
    setUserRole(role)
    renderAt('participant-1')
    await openDocuments()
    expect(screen.getByRole('option', { name: 'Agreement draft' })).toBeInTheDocument()
  })

  it('lists the three PDFs, Agreement draft and the caregiver link when the menu opens', async () => {
    renderAt('participant-1')

    await openDocuments()

    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual([
      'Intake Form PDF', 'Participant Profile PDF', 'Client Overview PDF', 'Agreement draft', 'Generate caregiver link',
    ])
  })

  it('carries the coarse-pointer height floor on every option row and on the trigger', async () => {
    const user = userEvent.setup()
    renderAt('participant-1')

    // Trigger: a secondary md Button, --control-h (32px, 44px under a touch pointer).
    expect(screen.getByRole('button', { name: 'Documents' })).toHaveClass('h-[var(--control-h)]')

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

})

// Density verdict (mobile) — coarse-pointer tap targets and the compact empty state. jsdom applies no CSS,
// so these assert the class contract each fix relies on.
describe('ParticipantDetailPage — coarse-pointer targets and empty tables', () => {
  it('lifts the icon-only Back button to the --tap-min floor (44px under a coarse pointer, unchanged on a mouse)', () => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAt('participant-1')

    expect(screen.getByRole('link', { name: 'Back to participants' })).toHaveClass('min-h-[var(--tap-min)]', 'min-w-[var(--tap-min)]')
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
    for (const [tab, section, testId] of [['health', 'health-conditions', 'health-conditions-section'], ['daily', 'daily-living', 'adl-assessments-section']]) {
      const { unmount } = renderAtTab('participant-1', tab, section)
      const wrapper = screen.getByTestId(testId).parentElement!
      expect(wrapper).toHaveClass('[&_table:has(td[colspan])_thead]:hidden', '[&_td[colspan]]:py-5')
      expect(wrapper.parentElement).not.toHaveClass('max-w-3xl')
      unmount()
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

describe('ParticipantDetailPage — support profile refetch', () => {
  const defaultProfile = () => ({ data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() })
  beforeEach(() => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    setUserRole('Coordinator')
  })
  afterEach(() => mockUseSupportProfile.mockImplementation(defaultProfile))

  function renderHealth() {
    return render(
      <MemoryRouter initialEntries={['/participants/x-1?tab=health&section=emergency']}>
        <Routes><Route path="/participants/:id" element={<PageWithClient />} /></Routes>
      </MemoryRouter>,
    )
  }

  it('keeps the topic cards and their Edit when only a background refetch failed', () => {
    mockUseSupportProfile.mockReturnValue({ ...defaultProfile(), data: { emergencyConsiderations: 'Call the on-call coordinator first' }, isError: true, error: new Error('Network Error') })
    renderHealth()
    expect(screen.getByText('Call the on-call coordinator first')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Edit' }).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Couldn't load/)).not.toBeInTheDocument()
  })

  it('still shows the error card with Retry when the first load failed and there is nothing cached', () => {
    mockUseSupportProfile.mockReturnValue({ ...defaultProfile(), isError: true, error: new Error('Network Error') })
    renderHealth()
    expect(screen.getAllByText(/Couldn't load/).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Try again' }).length).toBeGreaterThan(0)
  })

  it('opens the Risks sub-tab for the nested summary hash, focuses the summary and scrolls once', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    render(
      <MemoryRouter initialEntries={['/participants/x-1?tab=health#risks-summary']}>
        <Routes><Route path="/participants/:id" element={<PageWithClient />} /></Routes>
      </MemoryRouter>,
    )
    expect(selectedSub()).toEqual(['Risks'])
    await waitFor(() => expect(document.getElementById('risks-summary')!.contains(document.activeElement)).toBe(true))
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('lists Restrictive practices after Risks, and no sub-tab for the nested summary', () => {
    renderHealth()
    const labels = subLabels()
    expect(labels).toEqual(expect.arrayContaining(['Conditions', 'Medications', 'Risks', 'Restrictive practices']))
    expect(labels.indexOf('Restrictive practices')).toBeGreaterThan(labels.indexOf('Risks'))
    expect(labels).not.toContain('Risks & Hazards Summary')
  })
})

describe('ParticipantDetailPage — the tab lives in the URL (useTabParam)', () => {
  function renderWithUrl(url: string) {
    let current = url
    const view = render(
      <MemoryRouter initialEntries={[url]}>
        <LocationProbe onChange={value => { current = value }} />
        <Routes>
          <Route path="/participants/:id" element={<PageWithClient />} />
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
    await user.click(screen.getByRole('tab', { name: /^Daily support/ }))
    expect(page.url()).toBe('/participants/x-1?tab=daily')
    expect(screen.getByRole('tab', { name: /^Daily support/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps the tab across a reload or a shared link: a fresh render of the written URL lands on the same tab', async () => {
    const user = userEvent.setup()
    const first = renderWithUrl('/participants/x-1')
    await user.click(screen.getByRole('tab', { name: /^Daily support/ }))
    const written = first.url()
    first.unmount()
    renderWithUrl(written)
    expect(screen.getByRole('tab', { name: /^Daily support/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('drops the param when the default tab is chosen, and every other param survives both ways', async () => {
    const user = userEvent.setup()
    const page = renderWithUrl('/participants/x-1?from=dash&tab=daily')
    await user.click(screen.getByRole('tab', { name: 'Overview' }))
    expect(page.url()).toBe('/participants/x-1?from=dash')
    await user.click(screen.getByRole('tab', { name: /^Daily support/ }))
    expect(page.url()).toBe('/participants/x-1?from=dash&tab=daily')
  })

  // T11: the Support needs Restrictive practice row points at its one home, worded by the viewer's gate on the register.
  it.each([['SupportWorker', 'See Restrictive practices'], ['Coordinator', 'Edit in Restrictive practices']])('%s sees "%s" on the Support needs row, and it opens Health', async (role, label) => {
    const user = userEvent.setup()
    setUserRole(role)
    Element.prototype.scrollIntoView = vi.fn()
    const page = renderWithUrl('/participants/x-1?tab=daily')
    await user.click(screen.getByRole('link', { name: label }))
    expect(page.url()).toBe('/participants/x-1?tab=health')
    expect(screen.getByRole('tab', { name: /^Health/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('reads an unknown ?tab= as the default tab', () => {
    renderWithUrl('/participants/x-1?tab=bogus')
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  })
})

// ── Participant readiness (WARN mode) in the header ──────────────────────────────────────────────────────────────────
// What is still missing shows as a quiet warning-tone chip in the meta row, right after the Active / Inactive badge. It is
// informational: nothing on the page is gated on it, and a participant with nothing missing gets no chip at all.
describe('ParticipantDetailPage — readiness chip in the header', () => {
  const ISSUES = ['Intake not complete', 'Onboarding not complete: service type']
  const WARNING = 'Not ready: Intake not complete · Onboarding not complete: service type'
  // PageHeaderMeta wraps each fact in its own span; the chip is the very next fact after the status badge.
  const itemOf = (el: HTMLElement) => { let n = el; while (n.parentElement && !n.parentElement.classList.contains('gap-y-1')) n = n.parentElement; return n }

  it('shows the chip beside the status badge when the server lists issues', () => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ isActive: true, readinessIssues: ISSUES }), isLoading: false })
    renderAt('participant-1')

    const chip = screen.getByText(WARNING).closest('[title]') as HTMLElement
    expect(chip).toHaveAttribute('title', WARNING)
    for (const cls of TONE.warning.solid.split(' ')) expect(chip).toHaveClass(cls)
    expect(itemOf(screen.getByText('Active')).nextElementSibling).toBe(itemOf(chip))
    // Not an alert, and the page's actions are untouched by it.
    expect(chip.closest('[role="alert"]')).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Sophie Brown' })).toBeInTheDocument()
  })

  it('shows the chip next to an Inactive badge too', () => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ isActive: false, readinessIssues: ['No signed service agreement'] }), isLoading: false })
    renderAt('participant-1')

    const chip = screen.getByText('Not ready: No signed service agreement').closest('[title]') as HTMLElement
    expect(itemOf(screen.getByText('Inactive')).nextElementSibling).toBe(itemOf(chip))
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

// L5-05: a tab key the role cannot see reads as the default tab, never a selected-nothing strip. Under the seven-tab layout only Funding & claims is role-gated;
// History, Claims and Rostering are sections now, so their old keys are redirected (participantTabs.test.ts) and a role without them lands on the tab that would hold them.
describe('ParticipantDetailPage — a role-gated tab key in the URL', () => {
  const selectedTab = () => within(screen.getByRole('tablist', { name: 'Participant sections' })).getAllByRole('tab').filter(tab => tab.getAttribute('aria-selected') === 'true')

  it('reads ?tab=funding as Overview for a SupportWorker, who has no such tab', () => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAtTab('participant-1', 'funding')

    expect(selectedTab().map(t => t.textContent)).toEqual(['Overview'])
  })

  it('opens a tab the Coordinator has, and keeps the History section out of Notes & records', () => {
    setUserRole('Coordinator')
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    const { unmount } = renderAtTab('participant-1', 'records')

    expect(selectedTab().map(t => t.textContent)).toEqual([expect.stringMatching(/^Notes & records/)])
    expect(screen.queryByTestId('history-tab')).not.toBeInTheDocument()
    unmount()

    renderAtTab('participant-1', 'funding')
    expect(selectedTab().map(t => t.textContent)).toEqual([expect.stringMatching(/^Funding & claims/)])
  })
})

// Budget phase 1: the plan budget is money. It is for the roles the funding API admits (SuperAdmin, Admin, Coordinator) and never rides on canWrite.
describe('ParticipantDetailPage — Funding & claims tab', () => {
  const selectedTab = () => within(screen.getByRole('tablist', { name: 'Participant sections' })).getAllByRole('tab').filter(tab => tab.getAttribute('aria-selected') === 'true')

  it.each(['Coordinator', 'Admin', 'SuperAdmin'])('shows Funding & claims to a %s, and opens it from ?tab=funding with the participant and their plan type', role => {
    setUserRole(role)
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAtTab('participant-1', 'funding')

    expect(screen.getByRole('tab', { name: 'Funding & claims' })).toBeInTheDocument()
    expect(selectedTab().map(t => t.textContent)).toEqual([expect.stringMatching(/^Funding & claims/)])
    const tab = screen.getByTestId('funding-tab')
    expect(tab).toHaveAttribute('data-participant', 'participant-1')
    expect(tab).toHaveAttribute('data-plan-type', makeParticipant().planType)
  })

  it('has no Funding & claims tab for a SupportWorker (neither may see money), and reads ?tab=funding as Overview', () => {
    setUserRole('SupportWorker')
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAtTab('participant-1', 'funding')

    expect(screen.queryByRole('tab', { name: /Funding & claims/ })).not.toBeInTheDocument()
    expect(screen.queryByTestId('funding-tab')).not.toBeInTheDocument()
    expect(selectedTab().map(t => t.textContent)).toEqual(['Overview'])
  })

  it('never shows the plan budget to a ReadOnly, who can only reach the Claims section', () => {
    setUserRole('ReadOnly')
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAtTab('participant-1', 'funding')

    expect(screen.queryByTestId('funding-tab')).not.toBeInTheDocument()
    expect(document.getElementById('plan-budget')).toBeNull()
  })

  it('does not mount the Funding section on another tab', () => {
    setUserRole('Coordinator')
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAt('participant-1')

    expect(screen.getByRole('tab', { name: 'Funding & claims' })).toBeInTheDocument()
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
      // This test's own `user`: another userEvent.setup() would put its clipboard stub back on navigator.
      await user.click(documentsTrigger())
      await user.click(screen.getByRole('option', { name: /Generate/ }))
      await user.click(await screen.findByRole('button', { name: 'Copy link' }))

      expect(execCommand).toHaveBeenCalledWith('copy')
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original)
      else delete (navigator as unknown as Record<string, unknown>).clipboard
    }
  })
})

// PARTICIPANTS-5: a refused Revoke closes its confirm, so the server's reason is not hidden behind it.
describe('ParticipantDetailPage — a refused caregiver link Revoke', () => {
  it('closes the confirm and shows the server message', async () => {
    setUserRole('Admin')
    const user = userEvent.setup()
    const refused = { response: { status: 409, data: { message: 'This link has already been used.' } } }
    mockUseRevokeCaregiverLink.mockReturnValue({ mutate: vi.fn(), mutateAsync: vi.fn().mockRejectedValue(refused), isPending: false, isError: true, error: refused } as ReturnType<typeof mockUseRevokeCaregiverLink>)
    mockUseCaregiverSubmissions.mockImplementation((status?: string) => ({
      data: status === 'Submitted' ? [{ id: 'submission-1', participantId: 'participant-1', status: 'Submitted' }] : [],
    }))
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAt('participant-1')

    await chooseFromDocuments(/revoke caregiver link/i)
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /^revoke$/i }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByText('This link has already been used.')).toBeInTheDocument()
  })
})

// Review N6: a refused Generate is caught and shown on the existing error line, not left as an unhandled rejection.
describe('ParticipantDetailPage — a refused caregiver link Generate', () => {
  it('shows the server message', async () => {
    setUserRole('Admin')
    const refused = { response: { status: 400, data: { message: 'Participant has no consent on file.' } } }
    mockUseGenerateCaregiverLink.mockReturnValue({ mutateAsync: vi.fn().mockRejectedValue(refused), isPending: false, isError: true, error: refused } as ReturnType<typeof mockUseGenerateCaregiverLink>)
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAt('participant-1')

    await chooseFromDocuments(/generate caregiver link/i)

    expect(screen.getByText('Participant has no consent on file.')).toBeInTheDocument()
  })
})

// VD1 design review: a one-row scrolling strip hid Funding, Rostering and History at 1440 with no cue on macOS or iPad. From md up
// the strip wraps, so every tab stays on screen; below md it is the default one scrolling row.
describe('ParticipantDetailPage — every tab visible from md up', () => {
  it('renders all seven tabs for an Admin in one row that scrolls sideways, never wrapping to a second row', () => {
    setUserRole('Admin')
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAt('participant-1')
    expect(screen.getAllByRole('tab').map(t => t.textContent?.replace(/d+$/, '').trim())).toEqual([
      'Overview', 'About', 'Health & safety', 'Daily support', 'People & roster', 'Funding & claims', 'Notes & records',
    ])
    expect(screen.getByRole('tablist', { name: 'Participant sections' })).not.toHaveClass('md:flex-wrap')
  })
})

// NAV F2: Back was pinned to /participants (Active), where a draft is never listed.
describe('ParticipantDetailPage — Back returns to where the user came from, else to the stage list', () => {
  afterEach(() => __testHooks.reset())
  const back = () => screen.getByRole('link', { name: /^Back to / })

  it('falls back to Enquiries for a draft whose intake is not complete', () => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ isDraft: true, isActive: false }), isLoading: false })
    renderAt('participant-1')
    expect(back()).toHaveAttribute('href', '/participants?tab=enquiries')
  })

  it('falls back to Onboarding for a draft whose intake is complete', () => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ isDraft: true, isActive: false, intakeCompletedAt: '2026-10-01T00:00:00Z' }), isLoading: false })
    renderAt('participant-1')
    expect(back()).toHaveAttribute('href', '/participants?tab=onboarding')
  })

  it('falls back to the Active list for a finalised participant', () => {
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAt('participant-1')
    expect(back()).toHaveAttribute('href', '/participants')
  })

  it('returns to the previous in-app screen when there is one', () => {
    __testHooks.recordCurrentPath('/onboarding/participant-1')
    __testHooks.recordCurrentPath('/participants/participant-1')
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAt('participant-1')
    expect(back()).toHaveAttribute('href', '/onboarding/participant-1')
  })
})

// NAV F8: a submitted caregiver form had no route to its review from the participant.
describe('ParticipantDetailPage — Review caregiver form', () => {
  it('offers the review of a submitted form in the Documents menu, and opens it', async () => {
    setUserRole('Admin')
    mockUseCaregiverSubmissions.mockImplementation((status?: string) => ({
      data: status === 'Submitted' ? [{ id: 'submission-1', participantId: 'participant-1', participantName: 'Sophie Brown', status: 'Submitted', caregiverName: 'Jane Doe', createdAt: '2026-08-01T00:00:00Z', expiresAt: '2026-09-17T00:00:00Z', submittedAt: '2026-08-02T00:00:00Z' }] : [],
    }))
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    render(
      <MemoryRouter initialEntries={['/participants/participant-1']}>
        <Routes>
          <Route path="/participants/:id" element={<PageWithClient />} />
          <Route path="/caregiver-submissions/:id" element={<div data-testid="review-route" />} />
        </Routes>
      </MemoryRouter>,
    )
    await chooseFromDocuments('Review caregiver form')
    expect(screen.getByTestId('review-route')).toBeInTheDocument()
  })

  it('does not offer it while the form is only a draft', async () => {
    setUserRole('Admin')
    mockUseCaregiverSubmissions.mockImplementation((status?: string) => ({
      data: status === 'Draft' ? [{ id: 'submission-2', participantId: 'participant-1', participantName: 'Sophie Brown', status: 'Draft', caregiverName: null, createdAt: '2026-08-01T00:00:00Z', expiresAt: '2026-09-17T00:00:00Z', submittedAt: null }] : [],
    }))
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    renderAt('participant-1')
    await openDocuments()
    expect(screen.queryByRole('option', { name: 'Review caregiver form' })).not.toBeInTheDocument()
  })
})

// ── Slice 1: seven tabs, the safety header, the Overview card, old-key redirects ─────────────────────────────────────────────────────
function ProbeAndRoutes({ onChange }: { onChange: (v: { path: string; type: string }) => void }) {
  const { search, hash } = useLocation()
  const type = useNavigationType()
  onChange({ path: `${search}${hash}`, type })
  return null
}

function renderWithProbe(url: string) {
  let current = { path: '', type: '' }
  const view = render(
    <MemoryRouter initialEntries={[url]}>
      <ProbeAndRoutes onChange={v => { current = v }} />
      <Routes>
        <Route path="/participants/:id" element={<PageWithClient />} />
        <Route path="/participants/:id/profile" element={<div data-testid="profile-route" />} />
      </Routes>
    </MemoryRouter>,
  )
  return { ...view, probe: () => current }
}

const selectedTabName = () => within(screen.getByRole('tablist', { name: 'Participant sections' })).getAllByRole('tab').filter(t => t.getAttribute('aria-selected') === 'true').map(t => t.textContent)
const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('ParticipantDetailPage — seven tabs (slice 1)', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    mockDeleteMutate.mockReset()
    mockNotes.mockReturnValue({ data: [] })
  })

  it('T4: ?tab=funding as Admin is a current key: Funding & claims is selected and nothing is rewritten', () => {
    setUserRole('Admin')
    const { probe } = renderWithProbe('/participants/p-1?tab=funding')
    expect(selectedTabName()).toEqual([expect.stringMatching(/^Funding & claims/)])
    expect(probe().path).toBe('?tab=funding')
  })

  it('T5: a hash on an empty single section selects its sub-tab, scrolls once and focuses inside the section', async () => {
    setUserRole('Coordinator')
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ medicareNumber: undefined }), isLoading: false })
    renderWithProbe('/participants/p-1?tab=about#key-identifiers')
    const section = document.getElementById('key-identifiers')!
    expect(selectedSub()).toEqual(['Key identifiers'])
    await waitFor(() => expect(section.contains(document.activeElement)).toBe(true))
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('T5b: the 3 s hold on a hash target lets go on pointerdown (scrollbar drag, click), and also on wheel, touchstart and keydown', async () => {
    const callbacks: (() => void)[] = []
    class RO { constructor(cb: () => void) { callbacks.push(cb) } observe() {} disconnect() {} }
    vi.stubGlobal('ResizeObserver', RO)
    try {
      for (const ev of ['pointerdown', 'wheel', 'touchstart', 'keydown']) {
        callbacks.length = 0
        vi.mocked(Element.prototype.scrollIntoView).mockClear()
        setUserRole('Coordinator')
        mockUseParticipant.mockReturnValue({ data: makeParticipant({ medicareNumber: undefined }), isLoading: false })
        const view = renderWithProbe('/participants/p-1?tab=about#key-identifiers')
        await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1))
        callbacks.forEach(cb => cb()) // the page grew while held: snaps back to the target
        expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(2)
        window.dispatchEvent(new Event(ev))
        callbacks.forEach(cb => cb()) // the person took over: no more snapping
        expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(2)
        view.unmount()
      }
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('T6: ?tab=history is Notes & records#history, present and focused for Admin, absent without an error for a Coordinator', async () => {
    setUserRole('Coordinator')
    const first = renderWithProbe('/participants/p-1?tab=history')
    await waitFor(() => expect(first.probe().path).toBe('?tab=records&section=history#history'))
    expect(selectedTabName()).toEqual([expect.stringMatching(/^Notes & records/)])
    expect(selectedSub()).toEqual(['Notes'])
    expect(document.getElementById('history')).toBeNull()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    first.unmount()

    setUserRole('Admin')
    renderWithProbe('/participants/p-1?tab=history')
    await waitFor(() => expect(document.getElementById('history')!.contains(document.activeElement)).toBe(true))
  })

  it.each(Object.entries(OLD_KEY_TARGET).filter(([k]) => k !== 'funding'))('T7: old key ?tab=%s lands on its new tab and section', async (key, target) => {
    setUserRole('Admin')
    const { probe } = renderWithProbe(`/participants/p-1?tab=${key}`)
    const base = target.tab === 'overview' ? '' : `?tab=${target.tab}`
    const want = target.hash ? `${base}${base ? '&' : '?'}section=${target.hash}#${target.hash}` : base
    await waitFor(() => expect(probe().path).toBe(want))
    expect(probe().type).toBe('REPLACE')
    const tabName = NEW_TABS.find(t => t.id === target.tab)!.label
    expect(selectedTabName()).toEqual([expect.stringMatching(new RegExp(`^${tabName}`))])
    if (target.hash) {
      await waitFor(() => expect(document.getElementById(target.hash!)!.contains(document.activeElement)).toBe(true))
      expect(selectedSub()).toEqual([SUB_TABS[target.tab as GroupedTabKey].find(r => r.id === target.hash)!.label])
    }
  })

  it('T8: ?tab=claims as Support Worker has no Funding & claims tab and reads as Overview with no ?tab=', async () => {
    setUserRole('SupportWorker')
    const { probe } = renderWithProbe('/participants/p-1?tab=claims')
    await waitFor(() => expect(selectedTabName()).toEqual(['Overview']))
    expect(screen.queryByRole('tab', { name: /Funding & claims/ })).not.toBeInTheDocument()
    expect(probe().path).not.toContain('tab=')
  })

  it('T9: the strip has seven icon-free tabs in order, a count noun and badge only when the count is above zero, six for a Support Worker', () => {
    setUserRole('SuperAdmin')
    mockNotes.mockReturnValue({ data: [{ isArchived: false }, { isArchived: false }, { isArchived: false }, { isArchived: true }] })
    renderAt('participant-1')
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(7)
    for (const t of tabs) expect(t.querySelector('svg')).toBeNull()
    expect(screen.getByRole('tab', { name: /Notes & records +, 3 notes/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Health & safety' })).toBeInTheDocument()
    cleanup()

    setUserRole('SupportWorker')
    renderAt('participant-1')
    expect(screen.getAllByRole('tab')).toHaveLength(6)
  })

  it('T10: every card keeps a section id on the tab that owns it, and #risks holds both the summary and the entries', () => {
    setUserRole('Admin')
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ serviceStreams: 'CommunityAccessDailyLiving', behaviourRiskSummary: 'x' }), isLoading: false })
    const inventory: Record<string, string[]> = {
      about: ['identity', 'home-and-living', 'ndis-plan', 'services', 'key-identifiers', 'culture-and-rights', 'about-me'],
      health: ['emergency', 'medical', 'health-conditions', 'medications', 'behaviour-and-communication', 'behaviour-support', 'risks', 'restrictive-practices'],
      daily: ['support-needs', 'mobility-and-personal-care', 'equipment-and-overnight', 'daily-living', 'routines', 'meals', 'typical-day', 'transport-and-travel'],
      people: ['contacts', 'roster', 'trips'],
      funding: ['plan-budget', 'claims'],
      records: ['notes', 'consents', 'history'],
    }
    const { unmount: overview } = renderAtTab('participant-1', 'overview')
    expect(document.getElementById('before-you-start')).not.toBeNull()
    overview()
    for (const [tab, ids] of Object.entries(inventory)) {
      // The strip has a sub-tab for every id (a row without a node, or a node without a row, fails here), and each id's panel holds its section.
      const { unmount } = renderAtTab('participant-1', tab)
      expect(within(subStrip()).getAllByRole('tab').map(t => t.id.replace(/^sub-[a-z]+-tab-/, '')), tab).toEqual(ids)
      unmount()
      eachSection(tab, ids, id => {
        expect(document.getElementById(id), `${tab}#${id}`).not.toBeNull()
        if (id === 'risks') {
          const risks = document.getElementById('risks')!
          expect(within(risks).getByRole('heading', { name: 'Risks & Hazards Summary' })).toBeInTheDocument()
          expect(within(risks).getByTestId('risk-entries-section')).toBeInTheDocument()
        }
      })
    }
  })

  it('T8: Health and Daily sub-tabs follow the plan order, and the stream-gated ones go with the stream', () => {
    setUserRole('Admin')
    const order = {
      health: ['emergency', 'medical', 'health-conditions', 'medications', 'behaviour-and-communication', 'behaviour-support', 'risks', 'restrictive-practices'],
      daily: ['support-needs', 'mobility-and-personal-care', 'equipment-and-overnight', 'daily-living', 'routines', 'meals', 'typical-day', 'transport-and-travel'],
    }
    for (const stream of ['CommunityAccessDailyLiving', 'None'] as const) {
      mockUseParticipant.mockReturnValue({ data: makeParticipant({ serviceStreams: stream, behaviourRiskSummary: 'x' }), isLoading: false })
      for (const [tab, expected] of Object.entries(order)) {
        const { unmount } = renderAtTab('participant-1', tab)
        // Tab ids, not aria-controls: only the active tab names its panel.
        const present = within(subStrip()).getAllByRole('tab').map(t => t.id.replace(/^sub-[a-z]+-tab-/, ''))
        expect(present, stream + ' ' + tab).toEqual(expected.filter(id => stream !== 'None' || id !== 'typical-day'))
        // The Earlier checklist needs the stream AND an answered checklist; this participant has none.
        expect(present).not.toContain('community-access-risk')
        unmount()
      }
    }
  })

  describe('T11: critical alerts', () => {
    const critical = (n: number) => Array.from({ length: n }, (_, i) => ({ type: 'c' + i, severity: 'Critical', message: `Critical thing ${i}`, deepLinkTab: 'details', linkTo: null }))
    const warning = { type: 'w', severity: 'Warning', message: 'Warning thing', deepLinkTab: 'routines', linkTo: null }

    it.each(['records', 'about'])('shows the critical alert above the tab strip on %s and keeps the warning off that tab', tab => {
      setUserRole('Admin')
      mockUseParticipantAlerts.mockReturnValue({ data: { alerts: [...critical(1), warning] } })
      renderAtTab('participant-1', tab)
      const row = screen.getByText('Critical thing 0').closest('[role="alert"]')!
      expect(before(row, screen.getByRole('tablist', { name: 'Participant sections' }))).toBe(true)
      expect(screen.queryByText('Warning thing')).not.toBeInTheDocument()
    })

    it('on Overview shows the critical alert once and the warning too', () => {
      setUserRole('Admin')
      mockUseParticipantAlerts.mockReturnValue({ data: { alerts: [...critical(1), warning] } })
      renderAt('participant-1')
      expect(screen.getAllByText('Critical thing 0')).toHaveLength(1)
      expect(screen.getByText('Warning thing')).toBeInTheDocument()
    })

    it('shows all four critical alerts above the tab strip with no more-toggle', () => {
      setUserRole('Admin')
      mockUseParticipantAlerts.mockReturnValue({ data: { alerts: critical(4) } })
      renderAtTab('participant-1', 'records')
      for (let i = 0; i < 4; i++) expect(before(screen.getByText(`Critical thing ${i}`), screen.getByRole('tablist', { name: 'Participant sections' }))).toBe(true)
      expect(screen.queryByText(/more alert/)).not.toBeInTheDocument()
    })
  })

  it('T12: the draft banner is on Overview and not on About', () => {
    setUserRole('Admin')
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ isDraft: true }), isLoading: false })
    const { unmount } = renderAt('participant-1')
    expect(screen.getByRole('status')).toHaveTextContent(/draft/i)
    unmount()
    renderAtTab('participant-1', 'about')
    expect(screen.queryByText(/this participant is a draft/i)).not.toBeInTheDocument()
  })

  describe('T13: the More menu', () => {
    it('gives an Admin the wizard and Archive on an active participant, and no Restore', async () => {
      setUserRole('Admin')
      renderAt('participant-1')
      await userEvent.setup().click(screen.getByRole('button', { name: 'More actions' }))
      expect(screen.getByRole('option', { name: 'Edit full profile (wizard)' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Archive participant' })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: 'Restore participant' })).not.toBeInTheDocument()
    })

    it('gives an Admin Restore and no Archive on an archived participant that is not a draft', async () => {
      setUserRole('Admin')
      mockUseParticipant.mockReturnValue({ data: makeParticipant({ isActive: false }), isLoading: false })
      renderAt('participant-1')
      await userEvent.setup().click(screen.getByRole('button', { name: 'More actions' }))
      expect(screen.getByRole('option', { name: 'Restore participant' })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: 'Archive participant' })).not.toBeInTheDocument()
    })

    it('offers a Coordinator no Archive on an active draft (Onboarding owns that), and Archive on an active non-draft', async () => {
      setUserRole('Coordinator')
      mockUseParticipant.mockReturnValue({ data: makeParticipant({ isDraft: true, isActive: true }), isLoading: false })
      const draft = renderAt('participant-1')
      await userEvent.setup().click(screen.getByRole('button', { name: 'More actions' }))
      expect(screen.getByRole('option', { name: 'Edit full profile (wizard)' })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: 'Archive participant' })).not.toBeInTheDocument()
      draft.unmount()

      mockUseParticipant.mockReturnValue({ data: makeParticipant({ isDraft: false, isActive: true }), isLoading: false })
      renderAt('participant-1')
      await userEvent.setup().click(screen.getByRole('button', { name: 'More actions' }))
      expect(screen.getByRole('option', { name: 'Archive participant' })).toBeInTheDocument()
    })

    it('keeps the "More actions" name when the label collapses to an icon below sm: the text is sr-only there and visible from sm', () => {
      setUserRole('Admin')
      renderAt('participant-1')
      const trigger = screen.getByRole('button', { name: 'More actions' })
      const text = within(trigger).getByText('More actions')
      expect(text).toHaveClass('sr-only', 'sm:not-sr-only')
      expect(trigger).toHaveClass('max-sm:w-[var(--control-h)]', 'max-sm:px-0')
    })

    it.each(['SupportWorker', 'ReadOnly'])('has no More actions for %s', role => {
      setUserRole(role)
      renderAt('participant-1')
      expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument()
    })

    it('opens the profile wizard from the wizard item', async () => {
      setUserRole('Admin')
      renderWithProbe('/participants/p-1')
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: 'More actions' }))
      await user.click(screen.getByRole('option', { name: 'Edit full profile (wizard)' }))
      expect(screen.getByTestId('profile-route')).toBeInTheDocument()
    })
  })

  describe('T14: archive from the More menu', () => {
    async function archive() {
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: 'More actions' }))
      await user.click(screen.getByRole('option', { name: 'Archive participant' }))
      await user.click(screen.getByRole('button', { name: 'Archive' }))
    }

    it('calls the delete with the participant id on confirm', async () => {
      setUserRole('Admin')
      renderAt('participant-1')
      await archive()
      expect(mockDeleteMutate).toHaveBeenCalledWith('participant-1', expect.anything())
    })

    it('puts a refusal above the tab strip', async () => {
      setUserRole('Admin')
      mockDeleteMutate.mockImplementation((_id: string, opts: { onError: (e: Error) => void }) => opts.onError(new Error('Not allowed')))
      renderAt('participant-1')
      await archive()
      const notice = await screen.findByText(/Not allowed|Could not archive/)
      expect(before(notice, screen.getByRole('tablist', { name: 'Participant sections' }))).toBe(true)
    })
  })

  describe('T15: funding gates', () => {
    it('shows the plan budget and the claims to an Admin, one sub-tab each', () => {
      setUserRole('Admin')
      const { unmount } = renderAtTab('participant-1', 'funding')
      expect(subLabels()).toEqual(['Plan budget', 'Claims'])
      expect(document.getElementById('plan-budget')).not.toBeNull()
      unmount()
      renderAtTab('participant-1', 'funding', 'claims')
      expect(document.getElementById('claims')).not.toBeNull()
      expect(document.getElementById('plan-budget')).toBeNull()
    })

    it('shows ReadOnly no plan budget, and a Support Worker no Funding & claims tab', () => {
      setUserRole('ReadOnly')
      renderAtTab('participant-1', 'funding', 'plan-budget')
      expect(document.getElementById('plan-budget')).toBeNull()
      cleanup()
      setUserRole('SupportWorker')
      renderAtTab('participant-1', 'funding')
      expect(screen.queryByRole('tab', { name: /Funding & claims/ })).not.toBeInTheDocument()
      cleanup()
      setUserRole('ReadOnly')
      renderAtTab('participant-1', 'funding')
      expect(screen.queryByRole('tab', { name: /Funding & claims/ })).not.toBeInTheDocument()
    })
  })

  it('T16: the header has no Edit, reads Ratio, carries the updated time and links each flag to its section', () => {
    setUserRole('Admin')
    mockUseParticipant.mockReturnValue({
      data: makeParticipant({ supportRatio: 'OneToTwo', updatedAt: '2026-01-01T00:00:00Z', isAnaphylaxisRisk: true, allergiesDetail: 'Nil' }),
      isLoading: false,
    })
    renderAt('participant-1')
    const strip = screen.getByRole('tablist', { name: 'Participant sections' })
    for (const el of screen.queryAllByRole('button', { name: /^Edit$/ }).concat(screen.queryAllByRole('link', { name: /^Edit$/ }))) expect(before(el, strip)).toBe(false)
    expect(screen.getByText('Ratio 1:2')).toBeInTheDocument()
    expect(screen.queryByText(/Support Ratio:/)).not.toBeInTheDocument()
    expect(document.querySelector('time')).toHaveAttribute('datetime', '2026-01-01T00:00:00Z')
    const flags = within(screen.getByRole('list', { name: 'Safety flags' }))
    expect(flags.getByRole('link', { name: /Anaphylaxis risk/ })).toHaveAttribute('href', '/participants/participant-1?tab=health#medical')
  })

  it('T16: a flag chip clicked from another Health sub-tab selects the Medical sub-tab', async () => {
    setUserRole('Admin')
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ isAnaphylaxisRisk: true, allergiesDetail: 'Nil' }), isLoading: false })
    renderAtTab('participant-1', 'health', 'medications')
    expect(selectedSub()).toEqual(['Medications'])
    await userEvent.setup().click(within(screen.getByRole('list', { name: 'Safety flags' })).getByRole('link', { name: /Anaphylaxis risk/ }))
    await waitFor(() => expect(selectedSub()).toEqual(['Medical']))
  })

  describe('T17: Before you start', () => {
    const answered = { isAnaphylaxisRisk: false, allergiesDetail: 'Nil', chokingRiskMealDetail: 'None', fallsRiskRating: 'Low', behaviourRiskRating: 'Low' } as const

    it('names every unanswered safety field and never says all clear', () => {
      renderAt('participant-1')
      const card = document.getElementById('before-you-start')!
      expect(card).toHaveTextContent('Not recorded: Anaphylaxis risk, Allergies, Choking risk, Falls risk and Behaviour risk')
      expect(card).not.toHaveTextContent('No safety flags')
    })

    it('says only that the profile fields flag nothing when all are answered, even with active risk entries on Health', () => {
      mockRisks.mockReturnValue({ data: [{ isActive: true }, { isActive: true }, { isActive: true }] })
      mockUseParticipant.mockReturnValue({ data: makeParticipant(answered), isLoading: false })
      renderAt('participant-1')
      const card = document.getElementById('before-you-start')!
      expect(card).toHaveTextContent('No safety flags in the profile fields.')
      expect(card).not.toHaveTextContent('Nothing flagged')
    })

    it('shows the allergy text in full', () => {
      mockUseParticipant.mockReturnValue({ data: makeParticipant({ ...answered, allergiesDetail: 'No known allergies except penicillin' }), isLoading: false })
      renderAt('participant-1')
      expect(document.getElementById('before-you-start')).toHaveTextContent('No known allergies except penicillin')
    })
  })

  it('T20: the neutral "Safety details not recorded" chip links to Before you start on every tab, and is gone once all is answered', () => {
    const { unmount } = renderAtTab('participant-1', 'about')
    const chip = within(screen.getByRole('list', { name: 'Safety flags' })).getByRole('link', { name: 'Safety details not recorded' })
    expect(chip).toHaveAttribute('href', '/participants/participant-1?tab=overview#before-you-start')
    unmount()

    mockUseParticipant.mockReturnValue({
      data: makeParticipant({ isAnaphylaxisRisk: false, allergiesDetail: 'Nil', chokingRiskMealDetail: 'None', fallsRiskRating: 'Low', behaviourRiskRating: 'Low' }),
      isLoading: false,
    })
    renderAtTab('participant-1', 'about')
    expect(screen.queryByRole('list', { name: 'Safety flags' })).not.toBeInTheDocument()
    expect(screen.queryByText('Safety details not recorded')).not.toBeInTheDocument()
  })

  it('T21: the Earlier checklist sub-tab needs the stream and an answered checklist', () => {
    renderAtTab('participant-1', 'health', 'community-access-risk')
    expect(subLabels()).not.toContain('Earlier checklist')
    expect(selectedSub()).toEqual(['Emergency'])
    cleanup()

    mockUseParticipant.mockReturnValue({ data: makeParticipant({ serviceStreams: 'CommunityAccessDailyLiving', checklistItems: [makeChecklistItem({ itemType: 'HarmToSelf', value: 'No' })] }), isLoading: false })
    renderAtTab('participant-1', 'health', 'community-access-risk')
    expect(subLabels().at(-1)).toBe('Earlier checklist')
    expect(within(document.getElementById('community-access-risk')!).getByText('Earlier checklist (1)')).toBeInTheDocument()
  })
})

describe('ParticipantDetailPage — masked IDs for screen readers', () => {
  it('keeps the masked NDIS number visible but speaks "Hidden, ends in 7" instead of bullets', () => {
    mockUseParticipant.mockReturnValue({
      data: makeParticipant({ ndisNumber: '••••••••7', maskedNdisNumber: '••••••••7', medicareNumber: '••••••••5' }),
      isLoading: false,
    })
    const { unmount } = renderAtTab('participant-1', 'about', 'ndis-plan')

    const visible = screen.getAllByText('••••••••7')[0]
    expect(visible).toHaveAttribute('aria-hidden', 'true')
    const row = visible.closest('dd') as HTMLElement
    expect(row).toHaveTextContent('••••••••7Hidden, ends in 7')
    expect(within(row).getByText('Hidden, ends in 7')).toHaveClass('sr-only')
    // What a screen reader gets: everything that is not aria-hidden. No bullets in it.
    const spoken = Array.from(row.childNodes).filter(n => !(n instanceof HTMLElement && n.getAttribute('aria-hidden') === 'true')).map(n => n.textContent).join('')
    expect(spoken).toBe('Hidden, ends in 7')
    unmount()
    renderAtTab('participant-1', 'about', 'key-identifiers')
    expect(screen.getByText('Hidden, ends in 5')).toBeInTheDocument()
  })
})

// A card that is being edited keeps its place when a refetch flips `has`: the card would otherwise move to the other parent and remount, losing the draft.
describe('ParticipantDetailPage — an open short card keeps its place', () => {
  const conflict = Object.assign(new Error('409'), {
    response: { status: 409, data: { success: false, code: 'participant-section-changed', errors: ['x'], data: { groupRevisions: { aboutMe: 1, risksHazardsSummary: 1 } } } },
  })
  const tree = () => (
    <MemoryRouter initialEntries={['/participants/participant-1?tab=about&section=about-me']}>
      <Routes><Route path="/participants/:id" element={<PageWithClient />} /></Routes>
    </MemoryRouter>
  )

  async function openAboutMeAndType() {
    setUserRole('Coordinator')
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ groupRevisions: { aboutMe: 0 } as ParticipantDetailDto['groupRevisions'] }), isLoading: false })
    const view = render(tree())
    await userEvent.click(within(document.getElementById('about-me')!).getAllByRole('button', { name: /Edit/ }).at(-1)!)
    await userEvent.type(screen.getByLabelText('Goals'), 'mine')
    return view
  }

  it('PIN1 an open short card survives a has flip', async () => {
    const view = await openAboutMeAndType()
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ goals: 'Theirs', groupRevisions: { aboutMe: 1 } as ParticipantDetailDto['groupRevisions'] }), isLoading: false })
    view.rerender(tree())
    expect(screen.getByLabelText('Goals')).toHaveValue('mine')
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('PIN2 a refused short card survives the refetch that lands', async () => {
    mockPatchMutateAsync.mockRejectedValue(conflict)
    const view = await openAboutMeAndType()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(document.querySelector('[data-save-refused-callout]')).not.toBeNull()
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ goals: 'Theirs', groupRevisions: { aboutMe: 1 } as ParticipantDetailDto['groupRevisions'] }), isLoading: false })
    view.rerender(tree())
    expect(screen.getByLabelText('Goals')).toHaveValue('mine')
    expect(document.querySelector('[data-save-refused-callout]')).not.toBeNull()
    expect(document.querySelector('[data-latest-saved]')).toHaveTextContent('Theirs')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    // Editing is over; the card is still the panel's section.
    expect(within(document.getElementById('about-me')!).getByRole('heading', { name: 'About Me' })).toBeInTheDocument()
  })

  it('PIN3 the Risks & Hazards Summary panel keeps its place too', async () => {
    setUserRole('Coordinator')
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ groupRevisions: { risksHazardsSummary: 0 } as ParticipantDetailDto['groupRevisions'] }), isLoading: false })
    const tree3 = () => (
      <MemoryRouter initialEntries={['/participants/participant-1?tab=health&section=risks']}>
        <Routes><Route path="/participants/:id" element={<PageWithClient />} /></Routes>
      </MemoryRouter>
    )
    const view = render(tree3())
    await userEvent.click(within(document.getElementById('risks-summary')!).getAllByRole('button', { name: /Edit/ }).at(-1)!)
    await userEvent.type(screen.getByLabelText('Behaviour Risk Summary'), 'mine')
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ behaviourRiskSummary: 'Theirs', groupRevisions: { risksHazardsSummary: 1 } as ParticipantDetailDto['groupRevisions'] }), isLoading: false })
    view.rerender(tree3())
    expect(screen.getByLabelText('Behaviour Risk Summary')).toHaveValue('mine')
  })
})

// ── Sub-tabs: each grouped tab shows one section at a time ───────────────────────────────────────────────────────────────
const subStrip = () => screen.getAllByRole('tablist').find(l => l.getAttribute('aria-label') !== 'Participant sections')!
/** The label alone: a chip also carries an aria-hidden numeral and sr-only ", 2 active risks" / ", not recorded". */
const subLabel = (t: Element) => t.textContent!.replace(/,\s.*$/, '').replace(/\d+$/, '')
const subLabels = () => within(subStrip()).getAllByRole('tab').map(subLabel)
const subTab = (label: string | RegExp) => within(subStrip()).getAllByRole('tab').find(t => typeof label === 'string' ? subLabel(t) === label : label.test(subLabel(t)))!
const selectedSub = () => within(subStrip()).getAllByRole('tab').filter(t => t.getAttribute('aria-selected') === 'true').map(subLabel)
/** Each section of a tab in turn: render at that section, run `fn`, unmount. */
function eachSection(tab: string, sections: string[], fn: (section: string) => void) {
  for (const section of sections) { const { unmount } = renderAtTab('participant-1', tab, section); fn(section); unmount() }
}
const everyFlag = {
  isAnaphylaxisRisk: true, allergiesDetail: 'Peanuts', chokingRiskMealDetail: 'Cut small', fallsRiskRating: 'High', behaviourRiskRating: 'High', hasRestrictivePracticeFlag: true,
  serviceStreams: 'CommunityAccessDailyLiving',
} as unknown as Partial<ParticipantDetailDto>
const editedAboutMe = async (role = 'Coordinator') => {
  setUserRole(role)
  mockUseParticipant.mockReturnValue({ data: makeParticipant({ groupRevisions: { aboutMe: 0 } as ParticipantDetailDto['groupRevisions'] }), isLoading: false })
  const user = userEvent.setup()
  const view = renderWithProbe('/participants/p-1?tab=about&section=about-me')
  await user.click(within(document.getElementById('about-me')!).getAllByRole('button', { name: /Edit/ }).at(-1)!)
  return { user, ...view }
}

describe('ParticipantDetailPage — sub-tabs', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    mockNotes.mockReturnValue({ data: [] })
    mockRisks.mockReturnValue({ data: [] })
  })

  it.each([['SupportWorker'], ['Coordinator'], ['Admin']])('b: every tab opens on its first visible sub-tab with only that section (%s)', role => {
    setUserRole(role)
    const first: Record<string, string> = { about: 'identity', health: 'emergency', daily: 'support-needs', people: 'contacts', records: 'notes' }
    for (const [tab, id] of Object.entries(first)) {
      const { unmount } = renderAtTab('participant-1', tab)
      expect(within(subStrip()).getAllByRole('tab')[0], tab).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('tabpanel').querySelectorAll('section[id]'), tab).toHaveLength(1)
      expect(screen.getByRole('tabpanel').querySelector('section[id]')!.id).toBe(id)
      unmount()
    }
  })

  it('b: the sub-tab order is the table, and the strip is named for its tab', () => {
    setUserRole('Admin')
    renderAtTab('participant-1', 'health')
    expect(screen.getByRole('tablist', { name: 'Health & safety sections' })).toBe(subStrip())
    expect(subLabels()).toEqual(['Emergency', 'Medical', 'Conditions', 'Medications', 'Behaviour & communication', 'Behaviour support', 'Risks', 'Restrictive practices'])
  })

  it('c: choosing a sub-tab writes section= with replace, the first one deletes it, the active one does nothing, a main tab drops section and hash', async () => {
    const user = userEvent.setup()
    setUserRole('Admin')
    const { probe } = renderWithProbe('/participants/p-1?tab=health')
    await user.click(subTab('Medications'))
    expect(probe()).toEqual({ path: '?tab=health&section=medications', type: 'REPLACE' })
    expect(selectedSub()).toEqual(['Medications'])
    await user.click(subTab('Medications'))
    expect(probe().path).toBe('?tab=health&section=medications')
    await user.click(subTab('Emergency'))
    expect(probe().path).toBe('?tab=health')
    await user.click(subTab('Risks'))
    await user.click(screen.getByRole('tab', { name: 'Daily support' }))
    expect(probe()).toEqual({ path: '?tab=daily', type: 'REPLACE' })
  })

  it('d: a hash selects the sub-tab, and the next click drops the hash', async () => {
    const user = userEvent.setup()
    setUserRole('Admin')
    const { probe } = renderWithProbe('/participants/p-1?tab=health#medical')
    expect(selectedSub()).toEqual(['Medical'])
    await user.click(subTab('Risks'))
    expect(probe().path).toBe('?tab=health&section=risks')
  })

  it.each([
    ['?tab=health#medical', 'Health & safety', 'Medical', 'medical'],
    ['?tab=daily#meals', 'Daily support', 'Meals & diet', 'meals'],
    ['?tab=daily#mobility-and-personal-care', 'Daily support', 'Mobility & personal care', 'mobility-and-personal-care'],
    ['?tab=health#behaviour-and-communication', 'Health & safety', 'Behaviour & communication', 'behaviour-and-communication'],
    ['?tab=health#restrictive-practices', 'Health & safety', 'Restrictive practices', 'restrictive-practices'],
    ['?tab=about#identity', 'About', 'Identity', 'identity'],
    ['?tab=about#home-and-living', 'About', 'Address & living', 'home-and-living'],
    ['?tab=about#ndis-plan', 'About', 'NDIS & funding', 'ndis-plan'],
    ['?tab=health#risks-summary', 'Health & safety', 'Risks', 'risks-summary'],
    ['?tab=records&section=notes#history', 'Notes & records', 'History', 'history'],
    ['?tab=details', 'About', 'NDIS & funding', 'ndis-plan'],
    ['?tab=contacts', 'People & roster', 'Contacts', 'contacts'],
    ['?tab=bookings', 'People & roster', 'Bookings', 'trips'],
    ['?tab=support', 'Daily support', 'Support needs', 'support-needs'],
    ['?tab=medications', 'Health & safety', 'Medications', 'medications'],
    ['?tab=notes', 'Notes & records', 'Notes', 'notes'],
    ['?tab=routines', 'Daily support', 'Routines', 'routines'],
    ['?tab=restrictive-practices', 'Health & safety', 'Restrictive practices', 'restrictive-practices'],
    ['?tab=claims', 'Funding & claims', 'Claims', 'claims'],
    ['?tab=rostering', 'People & roster', 'Rostering', 'roster'],
    ['?tab=history', 'Notes & records', 'History', 'history'],
  ])('e: %s lands on %s / %s, focuses inside #%s and scrolls once', async (url, mainTab, sub, focusId) => {
    setUserRole('Admin')
    mockUseParticipant.mockReturnValue({ data: makeParticipant(everyFlag), isLoading: false })
    renderWithProbe(`/participants/p-1${url}`)
    await waitFor(() => expect(document.getElementById(focusId)!.contains(document.activeElement)).toBe(true))
    expect(selectedTabName()[0]).toMatch(new RegExp(`^${mainTab}`))
    expect(selectedSub()).toEqual([sub])
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('e: the alerts banner moves to a section with a push, from another sub-tab', async () => {
    setUserRole('Admin')
    mockUseParticipantAlerts.mockReturnValue({ data: { alerts: [{ id: 'a1', severity: 'Critical', message: 'Routine overdue', deepLinkTab: 'routines' }] } })
    const { probe } = renderWithProbe('/participants/p-1?tab=health&section=medications')
    await userEvent.setup().click(screen.getByRole('button', { name: /Routine overdue|routines/i }))
    expect(probe()).toEqual({ path: '?tab=daily&section=routines#routines', type: 'PUSH' })
  })

  it('f: a viewer reaching a flag target on an empty section still lands on it', async () => {
    setUserRole('ReadOnly')
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    for (const [url, sub, id] of [['health#medical', 'Medical', 'medical'], ['daily#meals', 'Meals & diet', 'meals'], ['daily#mobility-and-personal-care', 'Mobility & personal care', 'mobility-and-personal-care'], ['health#behaviour-and-communication', 'Behaviour & communication', 'behaviour-and-communication']]) {
      const view = renderWithProbe(`/participants/p-1?tab=${url}`)
      await waitFor(() => expect(document.getElementById(id)!.contains(document.activeElement)).toBe(true))
      expect(selectedSub()).toEqual([sub])
      view.unmount()
    }
  })

  it('viewer empty: every single section shows its card read-only, never nothing and never a dash', () => {
    setUserRole('ReadOnly')
    mockUseParticipant.mockReturnValue({ data: makeParticipant({ serviceStreams: 'CommunityAccessDailyLiving' } as Partial<ParticipantDetailDto>), isLoading: false })
    for (const [tab, sections] of [
      ['health', ['emergency', 'medical', 'behaviour-and-communication', 'behaviour-support']],
      ['daily', ['support-needs', 'mobility-and-personal-care', 'equipment-and-overnight', 'meals', 'typical-day', 'transport-and-travel']],
      ['about', ['home-and-living', 'key-identifiers', 'culture-and-rights', 'about-me']],
    ] as const) {
      eachSection(tab, [...sections], section => {
        const panel = screen.getByRole('tabpanel')
        expect(panel.querySelector(`section#${section}`), section).not.toBeNull()
        expect(panel.textContent!.trim().length, section).toBeGreaterThan(0)
        expect(panel.textContent, section).not.toContain('—')
        expect(within(panel).queryAllByRole('button', { name: /^(Edit|Add)/ }), section).toHaveLength(0)
        expect(panel.querySelector('details'), section).toBeNull()
      })
    }
  })

  it('an empty section is a quiet sub-tab for everyone, and its card shows Not recorded with Edit for an editor', () => {
    setUserRole('Coordinator')
    mockUseParticipant.mockReturnValue({ data: makeParticipant(), isLoading: false })
    const { unmount } = renderAtTab('participant-1', 'about')
    const quiet = within(subStrip()).getAllByRole('tab').filter(t => t.firstElementChild!.className.includes('border-dashed')).map(subLabel)
    expect(quiet).toEqual(expect.arrayContaining(['Key identifiers']))
    expect(subTab('Key identifiers')).toHaveAccessibleName(/, not recorded$/)
    unmount()
    renderAtTab('participant-1', 'about', 'key-identifiers')
    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getAllByText(/Not recorded/).length).toBeGreaterThan(0)
    expect(within(panel).getAllByRole('button', { name: /Edit|Add/ }).length).toBeGreaterThan(0)
    expect(panel.querySelector('details')).toBeNull()
  })

  it('g: a hidden section falls back to the first visible one without an error', () => {
    for (const [role, tab, section, shown] of [['SupportWorker', 'people', 'roster', 'Contacts'], ['Coordinator', 'records', 'history', 'Notes']]) {
      setUserRole(role)
      const { unmount } = renderAtTab('participant-1', tab, section)
      expect(selectedSub(), role).toEqual([shown])
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      unmount()
    }
  })

  it('h: counts show on the four list sub-tabs only, as a numeral with the spoken noun', () => {
    setUserRole('Admin')
    mockRisks.mockReturnValue({ data: [{ isActive: true }, { isActive: true }, { isActive: false }] })
    mockNotes.mockReturnValue({ data: [{ isArchived: false }, { isArchived: false }, { isArchived: false }, { isArchived: false }] })
    renderAtTab('participant-1', 'health')
    expect(subTab('Risks')).toHaveAccessibleName(/^Risks\s*, 2 active risks$/)
    expect(subTab('Risks').querySelector('[aria-hidden="true"]')).toHaveTextContent('2')
    for (const t of within(subStrip()).getAllByRole('tab').filter(t => !/^Risks/.test(t.textContent!))) expect(t.textContent).not.toMatch(/\d/)
    cleanup()
    renderAtTab('participant-1', 'records')
    expect(subTab('Notes')).toHaveAccessibleName(/^Notes\s*, 4 notes$/)
  })

  it('i: a dirty edit makes a sub-tab switch ask first; Keep editing stays, Discard switches and releases the hold', async () => {
    const { user, probe } = await editedAboutMe()
    await user.type(screen.getByLabelText('Goals'), 'mine')
    await user.click(subTab('Identity'))
    const dialog = screen.getByRole('alertdialog', { name: 'Discard changes?' })
    expect(within(dialog).getByRole('button', { name: 'Keep editing' })).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    expect(selectedSub()).toEqual(['About me'])
    expect(screen.getByLabelText('Goals')).toHaveValue('mine')
    expect(probe().path).toBe('?tab=about&section=about-me')
    await user.click(subTab('Identity'))
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(selectedSub()).toEqual(['Identity'])
    expect(probe().path).toBe('?tab=about')
    await user.click(subTab('Services'))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('i: opening an edit without changing anything switches without asking', async () => {
    const { user } = await editedAboutMe()
    await user.click(subTab('Identity'))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(selectedSub()).toEqual(['Identity'])
  })

  it('j: the same ask for a main tab', async () => {
    const { user, probe } = await editedAboutMe()
    await user.type(screen.getByLabelText('Goals'), 'mine')
    await user.click(screen.getByRole('tab', { name: 'Health & safety' }))
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(selectedTabName()[0]).toMatch(/^About/)
    expect(probe().path).toBe('?tab=about&section=about-me')
    await user.click(screen.getByRole('tab', { name: 'Health & safety' }))
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(selectedTabName()[0]).toMatch(/^Health/)
    expect(probe().path).toBe('?tab=health')
  })

  it('j: an arrow key on the strip with unsaved edits asks first; Keep editing leaves the sub-tab and the URL alone', async () => {
    const { user, probe } = await editedAboutMe()
    await user.type(screen.getByLabelText('Goals'), 'mine')
    subTab('About me').focus()
    await user.keyboard('{ArrowLeft}')
    const dialog = screen.getByRole('alertdialog', { name: 'Discard changes?' })
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    expect(selectedSub()).toEqual(['About me'])
    expect(probe().path).toBe('?tab=about&section=about-me')
  })

  it('j: the Discard button in the dialog is the danger style', async () => {
    const { user } = await editedAboutMe()
    await user.type(screen.getByLabelText('Goals'), 'mine')
    await user.click(subTab('Identity'))
    expect(screen.getByRole('button', { name: 'Discard' }).className).toContain('bg-[var(--color-destructive)]')
  })

  it('d: a hash that is not valid percent-encoding shows the first sub-tab and no error', () => {
    setUserRole('Admin')
    renderWithProbe('/participants/p-1?tab=health#%E0')
    expect(selectedSub()).toEqual(['Emergency'])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('k: the sub-tab panel is a focus stop with a visible ring', () => {
    setUserRole('Admin')
    renderAtTab('participant-1', 'health')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('tabindex', '0')
  })

  it('k: arrows, Home and End move between sub-tabs and write section=; Tab goes into the panel', async () => {
    const user = userEvent.setup()
    setUserRole('Admin')
    const { probe } = renderWithProbe('/participants/p-1?tab=health')
    expect(within(subStrip()).getAllByRole('tab').filter(t => t.tabIndex === 0)).toHaveLength(1)
    subTab('Emergency').focus()
    await user.keyboard('{ArrowRight}')
    expect(probe().path).toBe('?tab=health&section=medical')
    await user.keyboard('{End}')
    expect(probe().path).toBe('?tab=health&section=restrictive-practices')
    await user.keyboard('{Home}')
    expect(probe().path).toBe('?tab=health')
    await user.keyboard('{ArrowLeft}')
    expect(probe().path).toBe('?tab=health&section=restrictive-practices')
    await user.keyboard('{Home}')
    await user.tab()
    expect(screen.getByRole('tabpanel')).toContainElement(document.activeElement as HTMLElement)
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', subTab('Emergency').id)
  })

  it('l: a sub-tab switch brings a scrolled-away strip back under the header; a visible strip does not scroll', async () => {
    const user = userEvent.setup()
    setUserRole('Admin')
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)
    Object.defineProperty(window, 'scrollY', { value: 1000, configurable: true })
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect')
    try {
      renderAtTab('participant-1', 'health')
      rect.mockReturnValue({ top: -300 } as DOMRect)
      await user.click(subTab('Medical'))
      expect(scrollTo).toHaveBeenCalledWith({ top: 1000 - 300 - 56, behavior: 'auto' })
      scrollTo.mockClear()
      rect.mockReturnValue({ top: 120 } as DOMRect)
      await user.click(subTab('Risks'))
      expect(scrollTo).not.toHaveBeenCalled()
    } finally {
      rect.mockRestore()
      vi.unstubAllGlobals()
      Reflect.deleteProperty(window, 'scrollY')
    }
  })
})
