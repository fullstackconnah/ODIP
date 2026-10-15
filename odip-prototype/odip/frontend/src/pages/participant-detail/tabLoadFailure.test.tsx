import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import type { ComponentType } from 'react'
import ContactsTab from './ContactsTab'
import NotesTab from './NotesTab'
import RoutinesTab from './RoutinesTab'
import RestrictivePracticesTab from './RestrictivePracticesTab'
import MedicationsTab from './MedicationsTab'
import RiskEntriesSection from './RiskEntriesSection'
import ParticipantHealthConditionsSection from './ParticipantHealthConditionsSection'
import ParticipantAdlAssessmentsSection from './ParticipantAdlAssessmentsSection'
import ParticipantConsentsSection from './ParticipantConsentsSection'
import RosteringTab from './RosteringTab'
import ClaimsTab from './ClaimsTab'
import BookingsTab from './BookingsTab'
import CaregiverSubmissionsPage from '../caregiver-admin/CaregiverSubmissionsPage'

// L5-04: a failed (or paused, offline) request rendered as an empty record. Restrictive Practices said "No restrictive practices recorded",
// Contacts "No contacts recorded", Medications "No active medications" for a person who is on a psychotropic, with "Add ..." as the offered
// action. "None recorded" may only appear after a request that SUCCEEDED and came back empty.
const { mockApiGet } = vi.hoisted(() => ({ mockApiGet: vi.fn() }))

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  // apiGetWithDefault reads its list through the same mock, so a row served by it fails and answers like the rest.
  return { ...actual, apiGet: mockApiGet, apiGetWithDefault: async (url: string, fallback: unknown) => (await mockApiGet(url)) ?? fallback }
})

const apiError = (status: number) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { success: false, errors: ['boom'] } } })

type Tab = { name: string; Component: ComponentType<{ participantId: string | undefined }>; path: string; noun: RegExp; none: RegExp }
const TABS: Tab[] = [
  { name: 'Contacts', Component: ContactsTab, path: '/participants/p1/contact-roles', noun: /contacts/i, none: /no contacts recorded/i },
  { name: 'Notes', Component: NotesTab, path: '/participants/p1/notes', noun: /notes/i, none: /no notes yet/i },
  { name: 'Routines', Component: RoutinesTab, path: '/participants/p1/routines', noun: /routines/i, none: /no routines yet/i },
  { name: 'Restrictive practices', Component: RestrictivePracticesTab, path: '/participants/p1/restrictive-practices', noun: /restrictive practices/i, none: /no restrictive practices recorded/i },
  { name: 'Medications', Component: MedicationsTab, path: '/participants/p1/medications', noun: /medication list/i, none: /no active medications/i },
  // L5-04 left these nine on `{ data = [], isLoading }`: a failed or paused request read as an empty record.
  { name: 'Recent administrations', Component: MedicationsTab, path: '/participants/p1/administrations', noun: /administration list/i, none: /no administrations recorded in the last 14 days/i },
  { name: 'Risks', Component: RiskEntriesSection, path: '/participants/p1/risk-entries', noun: /risk list/i, none: /no risks recorded/i },
  { name: 'Health conditions', Component: ParticipantHealthConditionsSection, path: '/participants/p1/health-conditions', noun: /health condition list/i, none: /no health conditions recorded/i },
  { name: 'ADL assessments', Component: ParticipantAdlAssessmentsSection, path: '/participants/p1/adl-assessments', noun: /ADL assessment list/i, none: /no personal adls recorded/i },
  { name: 'Consents', Component: ParticipantConsentsSection, path: '/participants/p1/consents', noun: /consent list/i, none: /no consents recorded/i },
  { name: 'Rostering', Component: ({ participantId }) => <RosteringTab participantId={participantId!} />, path: '/participants/p1/rostering', noun: /rostering details/i, none: /no staff assigned/i },
  { name: 'Claims', Component: ({ participantId }) => <ClaimsTab participantId={participantId!} canWrite={false} />, path: '/participants/p1/claims', noun: /claim list/i, none: /no claims yet/i },
  { name: 'Bookings', Component: BookingsTab, path: '/participants/p1/bookings', noun: /booking list/i, none: /no bookings/i },
  { name: 'Caregiver forms', Component: () => <CaregiverSubmissionsPage />, path: '/caregiver-submissions?status=Submitted', noun: /caregiver form list/i, none: /no submitted caregiver forms/i },
]

function renderTab(Component: Tab['Component']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><Component participantId="p1" /></MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Every request answers with `[]`, except the tab's own list, which `failing` makes a 500. */
function serve(path: string, failing: boolean) {
  mockApiGet.mockImplementation(async (url: string) => {
    if (failing && url === path) throw apiError(500)
    return []
  })
}

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
})

afterEach(() => {
  localStorage.clear()
  mockApiGet.mockReset()
  onlineManager.setOnline(true)
})

describe.each(TABS)('$name tab — a failed or paused request is not an empty record', ({ Component, path, noun, none }) => {
  it('says the list could not be loaded, with a retry, and never shows the "none recorded" copy', async () => {
    serve(path, true)
    renderTab(Component)

    expect(await screen.findByRole('alert')).toHaveTextContent(new RegExp(`couldn't load this ${noun.source}`, 'i'))
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(screen.queryByText(none)).not.toBeInTheDocument()
  })

  it('shows the "none recorded" copy once a retry succeeds with an empty list', async () => {
    serve(path, true)
    renderTab(Component)
    await screen.findByRole('alert')

    serve(path, false)
    await userEvent.setup().click(screen.getByRole('button', { name: /try again/i }))

    expect(await screen.findByText(none)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows loading, not "none recorded", while the browser reports offline and the request has not run', async () => {
    serve(path, false)
    onlineManager.setOnline(false)
    renderTab(Component)

    expect(await screen.findByRole('status')).toHaveTextContent(/loading/i)
    expect(screen.queryByText(none)).not.toBeInTheDocument()
  })
})
