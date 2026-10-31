import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { ComponentType } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AxiosAdapter } from 'axios'
import { apiClient } from '@/api/client'
import { UiPreferencesProvider } from '@/hooks/useUiPreferences'
import { navLeaves } from '@/components/layout/navConfig'

/**
 * UI standard 6 (the UI survey, section 10): every routed page renders ONE `h1` (its PageHeader) and names the browser tab.
 * Each page is rendered under a memory data router (useBlocker needs one) at a real URL, with every API read answered by a small fake:
 * a record for the detail URLs below and an empty list for everything else, so a page shows its loaded header, not a loading state.
 */
const ID = 'x1'

// One record serves every detail read: each page reads the few fields its header needs.
const RECORD = {
  id: ID, tripName: 'Coast trip', fullName: 'Alex Example', firstName: 'Alex', lastName: 'Example', propertyName: 'Beach house',
  title: 'Slip in the kitchen', claimReference: 'C-1', participantName: 'Alex Example', participantId: ID, medicationName: 'Paracetamol',
  status: 'Draft', isActive: true, registration: 'ABC123', vehicleName: 'Van', name: 'Example',
  participant: { id: ID, fullName: 'Alex Example' }, reasons: [], returnCount: 0,
  serviceDate: '2026-10-12', startTime: '09:00', endTime: '15:00', nightType: 'None',
  breaks: [], finishBlockers: [], medicationsDue: [], prn: [], riskEntries: [],
}
const DETAIL = new RegExp(`/(trips|participants|staff|accommodation|vehicles|tasks|incidents|complaints|claims|medications|caregiver-submissions|portal/shifts|inquiries)/${ID}$`)

// Reads that wrap the record.
const WRAPPED: [RegExp, unknown][] = [
  [new RegExp(`/staff/${ID}/overview$`), { staff: RECORD, availability: [], recentCompletions: [], recentIncidents: [] }],
  [new RegExp(`/inquiries/${ID}/onboarding$`), { ...RECORD, items: [] }],
  // The dashboard summary is an object, not a list: with the list shape the page crashed on `upcomingTrips` as soon as it arrived (a race this test used to win).
  [/\/dashboard\/summary$/, { upcomingTripCount: 0, activeParticipantCount: 0, outstandingTaskCount: 0, overdueTaskCount: 0, conflictCount: 0, tripsMissingAccommodation: 0, tripsMissingVehicles: 0, tripsMissingStaff: 0, openIncidentCount: 0, qscOverdueCount: 0, upcomingTrips: [] }],
  // Incidents by month is an object (six empty months), not a list.
  [/\/incidents\/trend$/, { today: '2026-10-14', months: ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map(month => ({ month, incidents: 0, rpUses: 0, otherIncidents: 0 })) }],
  // Not connected: the Payroll page reads an object, and its not-connected state is its quiet default.
  [/\/payroll\/periods$/, { connected: false, today: '2026-10-14', periods: [] }],
  // The payslip list is an object ($ keeps /portal/payslips/9001/pdf out).
  [/\/portal\/payslips$/, { status: 'Ready', payslips: [] }],
]

function answer(url: string): unknown {
  if (DETAIL.test(url)) return RECORD
  // An empty list in both shapes: a plain array, and a paged result (items + totalCount).
  return WRAPPED.find(([re]) => re.test(url))?.[1] ?? Object.assign([], { items: [], totalCount: 0 })
}

const fakeApi: AxiosAdapter = async config => ({
  data: { success: true, data: answer(config.url ?? ''), message: null, errors: [] },
  status: 200, statusText: 'OK', headers: {}, config,
})

type Route = { path: string; url: string; load: () => Promise<{ default: ComponentType }> }

const ROUTES: Route[] = [
  { path: '/', url: '/', load: () => import('@/pages/DashboardPage') },
  { path: '/trips', url: '/trips', load: () => import('@/pages/TripsPage') },
  { path: '/trips/new', url: '/trips/new', load: () => import('@/pages/TripCreatePage') },
  { path: '/trips/:id', url: `/trips/${ID}`, load: () => import('@/pages/TripDetailPage') },
  { path: '/schedule', url: '/schedule', load: () => import('@/pages/SchedulePage') },
  { path: '/participants', url: '/participants', load: () => import('@/pages/ParticipantsHubPage') },
  { path: '/onboarding/:id', url: `/onboarding/${ID}`, load: () => import('@/pages/OnboardingDetailPage') },
  { path: '/participants/new-inquiry', url: '/participants/new-inquiry', load: () => import('@/pages/InquiryFormPage') },
  { path: '/participants/:id', url: `/participants/${ID}`, load: () => import('@/pages/ParticipantDetailPage') },
  { path: '/participants/:id/agreement-draft', url: `/participants/${ID}/agreement-draft`, load: () => import('@/pages/ServiceAgreementDraftPage') },
  { path: '/caregiver-submissions', url: '/caregiver-submissions', load: () => import('@/pages/caregiver-admin/CaregiverSubmissionsPage') },
  { path: '/caregiver-submissions/:id', url: `/caregiver-submissions/${ID}`, load: () => import('@/pages/caregiver-admin/CaregiverSubmissionReviewPage') },
  { path: '/accommodation', url: '/accommodation', load: () => import('@/pages/AccommodationPage') },
  { path: '/accommodation/new', url: '/accommodation/new', load: () => import('@/pages/AccommodationCreatePage') },
  { path: '/accommodation/:id', url: `/accommodation/${ID}`, load: () => import('@/pages/AccommodationDetailPage') },
  { path: '/accommodation/:id/edit', url: `/accommodation/${ID}/edit`, load: () => import('@/pages/AccommodationCreatePage') },
  { path: '/vehicles', url: '/vehicles', load: () => import('@/pages/VehiclesPage') },
  { path: '/vehicles/new', url: '/vehicles/new', load: () => import('@/pages/VehicleCreatePage') },
  { path: '/vehicles/:id/edit', url: `/vehicles/${ID}/edit`, load: () => import('@/pages/VehicleCreatePage') },
  { path: '/staff', url: '/staff', load: () => import('@/pages/StaffPage') },
  { path: '/staff/new', url: '/staff/new', load: () => import('@/pages/StaffCreatePage') },
  { path: '/staff/:id/edit', url: `/staff/${ID}/edit`, load: () => import('@/pages/StaffCreatePage') },
  { path: '/staff/:id', url: `/staff/${ID}`, load: () => import('@/pages/StaffDetailPage') },
  { path: '/tasks', url: '/tasks', load: () => import('@/pages/TasksPage') },
  { path: '/tasks/new', url: '/tasks/new', load: () => import('@/pages/TaskCreatePage') },
  { path: '/tasks/:id/edit', url: `/tasks/${ID}/edit`, load: () => import('@/pages/TaskCreatePage') },
  { path: '/incidents', url: '/incidents', load: () => import('@/pages/IncidentsPage') },
  { path: '/incidents/new', url: '/incidents/new', load: () => import('@/pages/IncidentCreatePage') },
  { path: '/incidents/:id/edit', url: `/incidents/${ID}/edit`, load: () => import('@/pages/IncidentCreatePage') },
  { path: '/incidents/:id', url: `/incidents/${ID}`, load: () => import('@/pages/IncidentDetailPage') },
  { path: '/complaints', url: '/complaints', load: () => import('@/pages/ComplaintsPage') },
  { path: '/complaints/new', url: '/complaints/new', load: () => import('@/pages/ComplaintFormPage') },
  { path: '/complaints/:id', url: `/complaints/${ID}`, load: () => import('@/pages/ComplaintFormPage') },
  { path: '/bookings', url: '/bookings', load: () => import('@/pages/BookingsPage') },
  { path: '/settings', url: '/settings', load: () => import('@/pages/SettingsPage') },
  { path: '/settings/import/:kind', url: '/settings/import/participants', load: () => import('@/pages/settings/ImportWizardPage') },
  { path: '/qualifications', url: '/qualifications', load: () => import('@/pages/QualificationsPage') },
  { path: '/claims', url: '/claims', load: () => import('@/pages/claims-hub/ClaimsHubPage') },
  { path: '/claims/:id', url: `/claims/${ID}`, load: () => import('@/pages/ClaimDetailPage') },
  { path: '/agreements', url: '/agreements', load: () => import('@/pages/AgreementsPage') },
  { path: '/budgets', url: '/budgets', load: () => import('@/pages/BudgetsPage') },
  { path: '/invoices', url: '/invoices', load: () => import('@/pages/InvoicesPage') },
  { path: '/rostering', url: '/rostering', load: () => import('@/pages/rostering/RosterBoardPage') },
  { path: '/rostering/patterns', url: '/rostering/patterns', load: () => import('@/pages/rostering/PatternsPage') },
  { path: '/rostering/compatibility', url: '/rostering/compatibility', load: () => import('@/pages/rostering/CompatibilityPage') },
  { path: '/rostering/leave', url: '/rostering/leave', load: () => import('@/pages/rostering/LeaveApprovalsPage') },
  { path: '/rostering/completions', url: '/rostering/completions', load: () => import('@/pages/rostering/CompletionReviewPage') },
  { path: '/rostering/payroll', url: '/rostering/payroll', load: () => import('@/pages/rostering/PayrollPage') },
  { path: '/reports', url: '/reports', load: () => import('@/pages/reports/ReportsPage') },
  { path: '/medications', url: '/medications', load: () => import('@/pages/MedicationsPage') },
  { path: '/medications/new', url: `/medications/new?participantId=${ID}`, load: () => import('@/pages/MedicationFormPage') },
  { path: '/medications/:id/edit', url: `/medications/${ID}/edit`, load: () => import('@/pages/MedicationFormPage') },
  { path: '/portal', url: '/portal', load: () => import('@/pages/portal/PortalShiftsPage') },
  { path: '/portal/shifts/:id', url: `/portal/shifts/${ID}`, load: () => import('@/pages/portal/PortalShiftDetailPage') },
  { path: '/portal/witness-approvals', url: '/portal/witness-approvals', load: () => import('@/pages/portal/PortalWitnessApprovalsPage') },
  { path: '/portal/leave', url: '/portal/leave', load: () => import('@/pages/portal/PortalLeavePage') },
  { path: '/portal/payslips', url: '/portal/payslips', load: () => import('@/pages/portal/PortalPayslipsPage') },
  { path: '/accessibility', url: '/accessibility', load: () => import('@/pages/AccessibilityPage') },
  { path: '*', url: '/no-such-page', load: () => import('@/pages/NotFoundPage') },
]

// Not rendered here, each for a reason. Their own tests cover their document title.
const ALLOWED: Record<string, string> = {
  '/login': 'pre-auth shell with its own h1 and sign-in panel, outside the app layout',
  '/caregiver/:token': 'public caregiver form: no app shell, its own h1 per wizard step',
  '/participants/new': 'intake wizard: its own h1 shell per step (its test checks the tab title)',
  '/participants/:id/intake': 'intake wizard: its own h1 shell per step (its test checks the tab title)',
  '/participants/:id/profile': 'profile wizard: its own h1 shell per step (its test checks the tab title)',
  // Redirects render no page of their own.
  '/inquiries': 'redirect to /participants?tab=enquiries',
  '/onboarding': 'redirect to /participants?tab=onboarding',
  '/participants/:id/edit': 'redirect to the profile wizard',
  '/account': 'redirect to /settings/profile',
  '/signin/microsoft': 'pre-auth Microsoft landing: a status line that posts once then navigates; outside the app layout',
}

// These titles were renamed (or their nav label was) so the two match; this keeps them there.
const RENAMED_TO_NAV_LABEL = [
  '/incidents', '/complaints', '/schedule', '/qualifications', '/rostering', '/portal', '/portal/payslips',
  '/trips', '/rostering/patterns', '/rostering/compatibility', '/rostering/leave', '/rostering/completions', '/rostering/payroll', '/reports',
]

let previousAdapter: typeof apiClient.defaults.adapter
beforeAll(() => {
  previousAdapter = apiClient.defaults.adapter
  apiClient.defaults.adapter = fakeApi
})
beforeEach(() => {
  localStorage.setItem('odip_token', 'test-token')
  localStorage.setItem('odip_user', JSON.stringify({ id: 'u1', role: 'Admin', fullName: 'Sam Admin' }))
  document.title = ''
})
afterEach(() => {
  cleanup()
  localStorage.clear()
})
afterAll(() => { apiClient.defaults.adapter = previousAdapter })

async function renderAt({ path, url, load }: Route) {
  const { default: Page } = await load()
  const router = createMemoryRouter([{ path, element: <Page /> }], { initialEntries: [url] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <UiPreferencesProvider>
        <RouterProvider router={router} />
      </UiPreferencesProvider>
    </QueryClientProvider>,
  )
}

describe('every routed page has one h1 and a tab title (UI standard 6)', () => {
  it('covers every route in App.tsx, or names why it does not', () => {
    const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'App.tsx'), 'utf-8')
    const paths = [...app.matchAll(/<Route path="([^"]+)"/g)].map(m => m[1])
    const covered = new Set([...ROUTES.map(r => r.path), ...Object.keys(ALLOWED)])
    expect(paths.filter(p => !covered.has(p))).toEqual([])
  })

  it.each(ROUTES.map(r => [r.url, r] as const))('%s', async (_url, route) => {
    await renderAt(route)
    await screen.findByRole('heading', { level: 1 }, { timeout: 10_000 })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(document.title).toMatch(/^Bunya Support · \S/)
  }, 20_000)

  it.each(RENAMED_TO_NAV_LABEL)('titles %s with its nav label', async url => {
    await renderAt(ROUTES.find(r => r.url === url)!)
    const label = navLeaves.find(leaf => leaf.to === url)!.label
    expect(await screen.findByRole('heading', { level: 1, name: label }, { timeout: 10_000 })).toBeInTheDocument()
    expect(document.title).toBe(`Bunya Support · ${label}`)
  }, 20_000)

  // A list whose header has a create action does not repeat it in its empty state (every list here is empty).
  // Not /participants: its Active tab's empty "Add participant" opens direct intake, a different action from the header's "New enquiry".
  it.each([
    ['/staff', 'No staff members yet'], ['/tasks', 'No tasks yet'], ['/incidents', 'No incidents reported'],
    ['/rostering/patterns', 'No recurring patterns yet'], ['/trips', 'No trips yet'], ['/vehicles', 'No vehicles found'],
    ['/accommodation', 'No properties yet'],
  ])(
    'offers %s one create action, in the header, when the list is empty',
    async (url, empty) => {
      await renderAt(ROUTES.find(r => r.url === url)!)
      await screen.findByText(empty, {}, { timeout: 10_000 })
      const creates = screen.queryAllByRole('link').concat(screen.queryAllByRole('button'))
        .filter(el => /^\W*(new|add|create|set up|report)\b/i.test(el.textContent ?? ''))
      expect(creates.map(el => el.textContent?.trim())).toHaveLength(1)
    },
    20_000,
  )

  it('titles the trip create page "New trip", like the Trips header action', async () => {
    await renderAt(ROUTES.find(r => r.url === '/trips/new')!)
    expect(await screen.findByRole('heading', { level: 1, name: 'New trip' }, { timeout: 10_000 })).toBeInTheDocument()
  }, 20_000)
})
