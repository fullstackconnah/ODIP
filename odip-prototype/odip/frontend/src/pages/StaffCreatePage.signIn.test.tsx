import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import StaffCreatePage from './StaffCreatePage'
import type { StaffDetailDto } from '@/api/types'

// A staff member created through this form gets a user row and, until something makes one, no Firebase sign-in account. So after the create
// the page makes sure the account exists (POST /staff/{id}/sign-in-account), asks Firebase to email the link, and says which of those
// happened; it stays on the page to say it, because navigating away would take the answer with it.

const { mockCreate, mockUpdate, mockEnsure, mockUseStaffDetail, sendPasswordResetEmail, firebase } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockEnsure: vi.fn(),
  mockUseStaffDetail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  // `auth` is null where Firebase is not configured (local dev auth). A getter, so each test can change it.
  firebase: { auth: null as object | null },
}))

vi.mock('@/api/hooks', () => ({
  useCreateStaff: () => ({ mutateAsync: mockCreate, isPending: false, isError: false, error: null }),
  useUpdateStaff: () => ({ mutateAsync: mockUpdate, isPending: false, isError: false, error: null }),
  useStaffDetail: mockUseStaffDetail,
  useEnsureStaffSignInAccount: () => ({ mutateAsync: mockEnsure }),
}))
vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ isCoordinator: false }) }))
vi.mock('firebase/auth', () => ({ sendPasswordResetEmail }))
vi.mock('@/lib/firebase', () => ({
  get auth() {
    return firebase.auth
  },
}))

const authStub = { name: 'auth-stub' }

function createdStaff(overrides: Partial<StaffDetailDto> = {}): StaffDetailDto {
  return {
    id: 'new-1', firstName: 'Sam', lastName: 'Staff', fullName: 'Sam Staff', username: 'sam.staff', role: 'SupportWorker', position: 'SupportWorker',
    email: 'sam.staff@acme.example.com', mobile: null, region: null, isDriverEligible: false, isFirstAidQualified: false, isMedicationCompetent: false,
    isManualHandlingCompetent: false, isOvernightEligible: false, isActive: true, firstAidExpiryDate: null, driverLicenceExpiryDate: null,
    manualHandlingExpiryDate: null, medicationCompetencyExpiryDate: null, workerScreeningNumber: null, workerScreeningExpiryDate: null,
    hasExpiredQualifications: false, notes: null,
    ...overrides,
  }
}

// StaffCreatePage calls useUnsavedChangesWarning (react-router 7's useBlocker), which needs a data router.
function renderCreatePage() {
  const router = createMemoryRouter(
    [
      { path: '/staff/new', element: <StaffCreatePage /> },
      { path: '/staff/:id/edit', element: <StaffCreatePage /> },
      { path: '/staff', element: <div>Staff list</div> },
    ],
    { initialEntries: ['/staff/new'] },
  )
  render(<RouterProvider router={router} />)
  return { router, u: userEvent.setup() }
}

async function fillAndCreate(u: ReturnType<typeof userEvent.setup>) {
  await u.type(screen.getByLabelText(/first name/i), 'Sam')
  await u.type(screen.getByLabelText(/last name/i), 'Staff')
  await u.type(screen.getByLabelText(/^email/i), 'Sam.Staff@Acme.Example.com')
  await u.click(screen.getByRole('button', { name: 'Create Staff Member' }))
}

/** Firebase's own errors carry the reason in `code`. */
const firebaseError = (code: string) => Object.assign(new Error(`Firebase: Error (${code}).`), { code })

beforeEach(() => {
  firebase.auth = authStub
  mockCreate.mockReset().mockResolvedValue({ success: true, data: createdStaff() })
  mockUpdate.mockReset().mockResolvedValue({ success: true, data: createdStaff() })
  mockEnsure.mockReset().mockResolvedValue({ firebaseAccount: 'created' })
  mockUseStaffDetail.mockReset().mockReturnValue({ data: undefined, isLoading: false })
  sendPasswordResetEmail.mockReset().mockResolvedValue(undefined)
})

describe('StaffCreatePage: the sign-in email after a create', () => {
  it('says beforehand who will be emailed a link, naming the address as it is typed', async () => {
    const { u } = renderCreatePage()
    expect(screen.getByText("We'll email the new staff member a link to set their password.")).toBeInTheDocument()

    await u.type(screen.getByLabelText(/^email/i), 'sam.staff@acme.example.com')

    expect(screen.getByText("We'll email sam.staff@acme.example.com a link to set their password.")).toBeInTheDocument()
  })

  it('promises nothing where Firebase is not configured (local dev auth)', () => {
    firebase.auth = null
    renderCreatePage()

    expect(screen.queryByText(/We'll email/)).not.toBeInTheDocument()
  })

  it('makes sure the NEW staff member has an account, then asks Firebase to send, and stays to say it went', async () => {
    const { u } = renderCreatePage()

    await fillAndCreate(u)

    expect(await screen.findByText("We've sent sam.staff@acme.example.com a link to set their password. It can take a few minutes, so ask them to check spam."))
      .toBeInTheDocument()
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      firstName: 'Sam', lastName: 'Staff', email: 'Sam.Staff@Acme.Example.com', position: 'SupportWorker', role: 'SupportWorker',
    }))
    expect(mockEnsure).toHaveBeenCalledTimes(1)
    expect(mockEnsure).toHaveBeenCalledWith('new-1')
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1)
    // The address the server stored (lower-case), not the one that was typed.
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(authStub, 'sam.staff@acme.example.com')
    // It stays, so the answer is not taken away by a navigation; Done leaves.
    expect(screen.queryByText('Staff list')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Done' })).toHaveAttribute('href', '/staff')
  })

  it('does not ask Firebase to send until the server has made sure of the account', async () => {
    let finishEnsure!: (value: { firebaseAccount: 'created' | 'existing' }) => void
    mockEnsure.mockReturnValue(new Promise(resolve => { finishEnsure = resolve }))
    const { u } = renderCreatePage()

    await fillAndCreate(u)

    await waitFor(() => expect(mockEnsure).toHaveBeenCalledTimes(1))
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()

    finishEnsure({ firebaseAccount: 'created' })

    await waitFor(() => expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1))
  })

  it('says "reset" when the server found an account that was already there', async () => {
    mockEnsure.mockResolvedValue({ firebaseAccount: 'existing' })
    const { u } = renderCreatePage()

    await fillAndCreate(u)

    expect(await screen.findByText("We've sent sam.staff@acme.example.com a link to reset their password. It can take a few minutes, so ask them to check spam."))
      .toBeInTheDocument()
  })

  it('says no link was sent, names the address, and offers to send again, when Firebase refuses', async () => {
    sendPasswordResetEmail.mockRejectedValueOnce(firebaseError('auth/too-many-requests'))
    const { u } = renderCreatePage()

    await fillAndCreate(u)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No link was sent to sam.staff@acme.example.com. Firebase is limiting emails for now. Wait a few minutes, then use Send set-password email on their staff page again.',
    )
    expect(screen.queryByText(/We've sent/)).not.toBeInTheDocument()

    await u.click(screen.getByRole('button', { name: 'Send again' }))

    expect(await screen.findByText(/We've sent sam.staff@acme.example.com a link to set their password/)).toBeInTheDocument()
    expect(mockEnsure).toHaveBeenCalledTimes(2)
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(2)
  })

  it('says why, and sends nothing, when the server could not set the account up', async () => {
    mockEnsure.mockRejectedValue({ response: { data: { success: false, errors: ['Addresses at platform.example.com are reserved for platform administrators.'] } } })
    const { u } = renderCreatePage()

    await fillAndCreate(u)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No link was sent to sam.staff@acme.example.com. Addresses at platform.example.com are reserved for platform administrators.',
    )
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
  })

  it('sends nothing for a staff member who came back inactive, and goes back to the list as before', async () => {
    mockCreate.mockResolvedValue({ success: true, data: createdStaff({ isActive: false }) })
    const { u } = renderCreatePage()

    await fillAndCreate(u)

    expect(await screen.findByText('Staff list')).toBeInTheDocument()
    expect(mockEnsure).not.toHaveBeenCalled()
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
  })

  it('goes back to the list as before, and sends nothing, where Firebase is not configured', async () => {
    firebase.auth = null
    const { u } = renderCreatePage()

    await fillAndCreate(u)

    expect(await screen.findByText('Staff list')).toBeInTheDocument()
    expect(mockEnsure).not.toHaveBeenCalled()
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
  })

  it('a rejected create shows the error, keeps what was typed, and makes no account and sends no email', async () => {
    mockCreate.mockRejectedValue({ response: { data: { errors: ['A user with this email already exists.'] } } })
    const { u } = renderCreatePage()

    await fillAndCreate(u)

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(screen.getByLabelText(/first name/i)).toHaveValue('Sam')
    expect(screen.getByLabelText(/^email/i)).toHaveValue('Sam.Staff@Acme.Example.com')
    expect(mockEnsure).not.toHaveBeenCalled()
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
    expect(screen.queryByText('Staff list')).not.toBeInTheDocument()
  })
})
