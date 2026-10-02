import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import StaffDetailPage from './StaffDetailPage'
import type { StaffOverviewDto, StaffDetailDto } from '@/api/types/staff'

// "Send set-password email" on the staff page: staff added through the staff form have a user row and no Firebase account until something
// makes one, so the action makes sure of the account (POST /staff/{id}/sign-in-account) and only then asks Firebase to send the link.

const { mockUseStaffOverview, mockEnsure, sendPasswordResetEmail, firebase } = vi.hoisted(() => ({
  mockUseStaffOverview: vi.fn(),
  mockEnsure: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  // `auth` is null where Firebase is not configured (local dev auth). A getter, so each test can change it.
  firebase: { auth: null as object | null },
}))

vi.mock('@/api/hooks', () => ({
  useStaffOverview: mockUseStaffOverview,
  useSettings: () => ({ data: { qualificationWarningDays: 30 } }),
  useEnsureStaffSignInAccount: () => ({ mutateAsync: mockEnsure }),
}))
vi.mock('firebase/auth', () => ({ sendPasswordResetEmail }))
vi.mock('@/lib/firebase', () => ({
  get auth() {
    return firebase.auth
  },
}))

const authStub = { name: 'auth-stub' }
const SEND = 'Send set-password email'

/** The notices region at the top of the page: one live region, there from the first render. */
const region = () => screen.getByRole('status')

function makeStaff(overrides: Partial<StaffDetailDto> = {}): StaffDetailDto {
  return {
    id: 'staff-1', firstName: 'Alex', lastName: 'Rivera', fullName: 'Alex Rivera', username: 'alex',
    role: 'SupportWorker', position: 'SupportWorker', email: 'alex@example.com', mobile: null,
    region: 'North', isDriverEligible: false, isFirstAidQualified: false, isMedicationCompetent: false,
    isManualHandlingCompetent: false, isOvernightEligible: false, isActive: true,
    firstAidExpiryDate: null, driverLicenceExpiryDate: null, manualHandlingExpiryDate: null,
    medicationCompetencyExpiryDate: null, workerScreeningNumber: null, workerScreeningExpiryDate: null,
    hasExpiredQualifications: false, notes: null,
    ...overrides,
  } as StaffDetailDto
}

function renderPage(staff: Partial<StaffDetailDto> = {}, role = 'Admin') {
  localStorage.setItem('odip_user', JSON.stringify({ role }))
  const overview: StaffOverviewDto = {
    staff: makeStaff(staff), availability: [], upcomingShifts: [], upcomingTripAssignments: [], recentIncidents: [], recentCompletions: [],
  }
  mockUseStaffOverview.mockReturnValue({ data: overview, isLoading: false })
  render(
    <MemoryRouter initialEntries={['/staff/staff-1']}>
      <Routes>
        <Route path="/staff/:id" element={<StaffDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
  return userEvent.setup()
}

/** Firebase's own errors carry the reason in `code`. */
const firebaseError = (code: string) => Object.assign(new Error(`Firebase: Error (${code}).`), { code })

beforeEach(() => {
  firebase.auth = authStub
  mockEnsure.mockReset().mockResolvedValue({ firebaseAccount: 'created' })
  sendPasswordResetEmail.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  localStorage.clear()
})

describe('StaffDetailPage: Send set-password email', () => {
  it.each(['Admin', 'Coordinator', 'SuperAdmin'])('is offered to a %s for an active staff member with an email', role => {
    renderPage({}, role)

    expect(screen.getByRole('button', { name: SEND })).toBeInTheDocument()
  })

  it.each(['SupportWorker', 'ReadOnly'])('is not offered to a %s, whom the server would refuse', role => {
    renderPage({}, role)

    expect(screen.queryByRole('button', { name: SEND })).not.toBeInTheDocument()
  })

  it('is not offered for an inactive staff member', () => {
    renderPage({ isActive: false })
    expect(screen.queryByRole('button', { name: SEND })).not.toBeInTheDocument()
  })

  it('is not offered for a staff member with no email', () => {
    renderPage({ email: '' })
    expect(screen.queryByRole('button', { name: SEND })).not.toBeInTheDocument()
  })

  it('is not offered, and nothing is left broken, where Firebase is not configured (local dev auth)', () => {
    firebase.auth = null
    renderPage()

    expect(screen.queryByRole('button', { name: SEND })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /edit/i })).toBeInTheDocument()
  })

  it('makes sure this staff member has an account, then asks Firebase to email the link, and says it was sent', async () => {
    const u = renderPage()

    await u.click(screen.getByRole('button', { name: SEND }))

    expect(await within(region()).findByText("We've sent alex@example.com a link to set their password. It can take a few minutes, so ask them to check spam."))
      .toBeInTheDocument()
    expect(within(region()).getByText('Alex Rivera')).toBeInTheDocument()
    expect(mockEnsure).toHaveBeenCalledTimes(1)
    expect(mockEnsure).toHaveBeenCalledWith('staff-1')
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1)
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(authStub, 'alex@example.com')
  })

  it('does not ask Firebase to send until the server has made sure of the account', async () => {
    let finishEnsure!: (value: { firebaseAccount: 'created' | 'existing' }) => void
    mockEnsure.mockReturnValue(new Promise(resolve => { finishEnsure = resolve }))
    const u = renderPage()

    await u.click(screen.getByRole('button', { name: SEND }))

    await waitFor(() => expect(mockEnsure).toHaveBeenCalledTimes(1))
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: SEND })).toHaveAttribute('aria-disabled', 'true')

    finishEnsure({ firebaseAccount: 'created' })

    await waitFor(() => expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('button', { name: SEND })).not.toHaveAttribute('aria-disabled'))
  })

  it('is switched off with aria-disabled, not `disabled`, while it sends: keyboard focus stays on the button, and a second click sends nothing more', async () => {
    sendPasswordResetEmail.mockReturnValue(new Promise<void>(() => {}))
    const u = renderPage()

    await u.click(screen.getByRole('button', { name: SEND }))

    await waitFor(() => expect(screen.getByRole('button', { name: SEND })).toHaveAttribute('aria-disabled', 'true'))
    const send = screen.getByRole('button', { name: SEND })
    expect(send).not.toBeDisabled()
    expect(send).toHaveAttribute('aria-busy', 'true')
    expect(send).toHaveClass('aria-disabled:opacity-50', 'aria-disabled:cursor-not-allowed')
    expect(send).toHaveFocus()

    await u.click(send)

    expect(mockEnsure).toHaveBeenCalledTimes(1)
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1)
  })

  it('says "reset" when the account was already there', async () => {
    mockEnsure.mockResolvedValue({ firebaseAccount: 'existing' })
    const u = renderPage()

    await u.click(screen.getByRole('button', { name: SEND }))

    expect(await within(region()).findByText("We've sent alex@example.com a link to reset their password. It can take a few minutes, so ask them to check spam."))
      .toBeInTheDocument()
  })

  it('sends nothing, and says why, when the server could not set the account up', async () => {
    mockEnsure.mockRejectedValue({ response: { data: { success: false, errors: ['This staff member is inactive, so they cannot be given a sign-in account.'] } } })
    const u = renderPage()

    await u.click(screen.getByRole('button', { name: SEND }))

    expect(await within(region()).findByText(
      'No link was sent to alex@example.com. This staff member is inactive, so they cannot be given a sign-in account.',
    )).toBeInTheDocument()
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
  })

  it('says no link was sent, with advice that fits, when Firebase refuses', async () => {
    sendPasswordResetEmail.mockRejectedValue(firebaseError('auth/invalid-email'))
    const u = renderPage()

    await u.click(screen.getByRole('button', { name: SEND }))

    expect(await within(region()).findByText(
      "No link was sent to alex@example.com. That doesn't look like a valid email address. Correct it, then use Send set-password email on this page.",
    )).toBeInTheDocument()
  })

  it('has its notices region from the first render, empty until something is said, and at the TOP of the page', () => {
    renderPage()

    expect(region()).toBeEmptyDOMElement()
    // Above the tabs: where the person who acted is already looking, not below the fold.
    expect(region().compareDocumentPosition(screen.getByRole('tablist')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('after the only notice is dismissed, focus goes back to the send button that raised it, not to the top of the page', async () => {
    sendPasswordResetEmail.mockRejectedValueOnce(firebaseError('auth/network-request-failed'))
    const u = renderPage()
    await u.click(screen.getByRole('button', { name: SEND }))
    const dismiss = await within(region()).findByRole('button', { name: 'Dismiss notice about Alex Rivera' })

    await u.click(dismiss)

    expect(within(region()).queryByText(/No link was sent/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: SEND })).toHaveFocus()
  })

  it('a later send that works replaces the failure about the same person: the problem it reported is over', async () => {
    sendPasswordResetEmail.mockRejectedValueOnce(firebaseError('auth/network-request-failed'))
    const u = renderPage()

    await u.click(screen.getByRole('button', { name: SEND }))
    expect(await within(region()).findByText(/No link was sent to alex@example.com/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: SEND })).not.toHaveAttribute('aria-disabled'))

    await u.click(screen.getByRole('button', { name: SEND }))

    expect(await within(region()).findByText(/We've sent alex@example.com a link to set their password/)).toBeInTheDocument()
    expect(within(region()).queryByText(/No link was sent to alex@example.com/)).not.toBeInTheDocument()
  })

  it('a failure stays until it is dismissed, and Dismiss removes only that notice', async () => {
    sendPasswordResetEmail.mockRejectedValueOnce(firebaseError('auth/network-request-failed'))
    const u = renderPage()

    await u.click(screen.getByRole('button', { name: SEND }))
    const failure = await within(region()).findByText(/No link was sent to alex@example.com/)
    expect(failure).toBeInTheDocument()

    await u.click(within(region()).getByRole('button', { name: 'Dismiss notice about Alex Rivera' }))

    expect(within(region()).queryByText(/No link was sent to alex@example.com/)).not.toBeInTheDocument()
  })
})
