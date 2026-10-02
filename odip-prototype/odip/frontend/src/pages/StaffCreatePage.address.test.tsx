import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import StaffCreatePage from './StaffCreatePage'
import type { StaffDetailDto } from '@/api/types'

// Any address can sign in, so an address at neither the tenant's own domain nor a common email provider (a typo, another organisation's) is a live
// login for whoever owns it. For a new staff member, and for an edit that CHANGES the address, the server refuses the first attempt (400, code
// AddressNeedsConfirmation); the page asks the admin to check the address and, on "Use this address", sends the same request again with the
// confirmation. It holds no list of providers itself.

const { mockCreate, mockUpdate, mockReset, mockUseStaffDetail, firebase } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  // The mutation's own reset: a real mutation is in an error state after the 400, and the page's red banner must not show a QUESTION as a failure.
  mockReset: vi.fn(),
  mockUseStaffDetail: vi.fn(),
  // `auth` is null where Firebase is not configured (local dev auth): no email step follows a create, so it just goes back to the list.
  firebase: { auth: null as object | null },
}))

vi.mock('@/api/hooks', () => ({
  useCreateStaff: () => ({ mutateAsync: mockCreate, isPending: false, isError: false, error: null, reset: mockReset }),
  useUpdateStaff: () => ({ mutateAsync: mockUpdate, isPending: false, isError: false, error: null, reset: mockReset }),
  useStaffDetail: mockUseStaffDetail,
  useEnsureStaffSignInAccount: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ isCoordinator: false }) }))
vi.mock('firebase/auth', () => ({ sendPasswordResetEmail: vi.fn() }))
vi.mock('@/lib/firebase', () => ({
  get auth() {
    return firebase.auth
  },
}))

const SENTENCE =
  'sam.staff@gmial.com is not at acme.example.com or a common email provider. The sign-in link goes to whoever owns this address. Check it is right.'

/** What the server answers when it wants the address checked first. */
const confirmationRequest = () => ({ response: { status: 400, data: { success: false, errors: [SENTENCE], code: 'AddressNeedsConfirmation' } } })

const staff = (overrides: Partial<StaffDetailDto> = {}): StaffDetailDto => ({
  id: 's1', firstName: 'Sam', lastName: 'Staff', fullName: 'Sam Staff', username: 'sam.staff', role: 'SupportWorker', position: 'SupportWorker',
  email: 'sam.staff@acme.example.com', mobile: null, region: null, isDriverEligible: false, isFirstAidQualified: false, isMedicationCompetent: false,
  isManualHandlingCompetent: false, isOvernightEligible: false, isActive: true, firstAidExpiryDate: null, driverLicenceExpiryDate: null,
  manualHandlingExpiryDate: null, medicationCompetencyExpiryDate: null, workerScreeningNumber: null, workerScreeningExpiryDate: null,
  hasExpiredQualifications: false, notes: null, ...overrides,
})

beforeEach(() => {
  firebase.auth = null
  mockCreate.mockReset().mockRejectedValueOnce(confirmationRequest()).mockResolvedValue({ success: true, data: staff({ id: 'new-1' }) })
  mockUpdate.mockReset().mockRejectedValueOnce(confirmationRequest()).mockResolvedValue({ success: true, data: staff() })
  mockReset.mockReset()
  mockUseStaffDetail.mockReset().mockReturnValue({ data: undefined, isLoading: false })
})

// StaffCreatePage calls useUnsavedChangesWarning (react-router 7's useBlocker), which needs a data router.
function renderPage(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/staff/new', element: <StaffCreatePage /> },
      { path: '/staff/:id/edit', element: <StaffCreatePage /> },
      { path: '/staff', element: <div>Staff list</div> },
    ],
    { initialEntries: [path] },
  )
  render(<RouterProvider router={router} />)
  return userEvent.setup()
}

const dialog = () => screen.findByRole('alertdialog', { name: 'Check this address' })

async function fillAndCreate(u: ReturnType<typeof userEvent.setup>) {
  await u.type(screen.getByLabelText(/first name/i), 'Sam')
  await u.type(screen.getByLabelText(/last name/i), 'Staff')
  await u.type(screen.getByLabelText(/^email/i), 'Sam.Staff@Gmial.com')
  await u.click(screen.getByRole('button', { name: 'Create Staff Member' }))
}

describe('StaffCreatePage create: an address the server wants checked', () => {
  it('asks the admin to check it, in the server\'s words, and clears the mutation\'s error so no red banner shows a question as a failure', async () => {
    const u = renderPage('/staff/new')

    await fillAndCreate(u)

    const asking = await dialog()
    expect(within(asking).getByText(SENTENCE)).toBeInTheDocument()
    expect(within(asking).getByRole('button', { name: 'Use this address' })).toBeInTheDocument()
    expect(within(asking).getByRole('button', { name: 'Go back' })).toBeInTheDocument()
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockCreate.mock.calls[0][0].addressConfirmed).toBeUndefined()
    expect(mockReset).toHaveBeenCalled()
  })

  it('sends the same request again with the confirmation when the admin says to use the address', async () => {
    const u = renderPage('/staff/new')
    await fillAndCreate(u)

    await u.click(within(await dialog()).getByRole('button', { name: 'Use this address' }))

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2))
    expect(mockCreate.mock.calls[1][0]).toEqual(expect.objectContaining({
      firstName: 'Sam', lastName: 'Staff', email: 'Sam.Staff@Gmial.com', position: 'SupportWorker', role: 'SupportWorker', addressConfirmed: true,
    }))
    expect(await screen.findByText('Staff list')).toBeInTheDocument()
  })

  it('sends nothing more, and keeps what was typed, when the admin goes back to check the address', async () => {
    const u = renderPage('/staff/new')
    await fillAndCreate(u)

    await u.click(within(await dialog()).getByRole('button', { name: 'Go back' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText(/^email/i)).toHaveValue('Sam.Staff@Gmial.com')
    expect(screen.getByRole('button', { name: 'Create Staff Member' })).toBeEnabled()
  })

  it('does not carry the confirmation over: a later attempt after a confirmed one that failed asks afresh', async () => {
    mockCreate.mockReset()
      .mockRejectedValueOnce(confirmationRequest())
      .mockRejectedValueOnce({ response: { status: 409, data: { success: false, errors: ['A user with this email already exists.'] } } })
      .mockRejectedValueOnce(confirmationRequest())
    const u = renderPage('/staff/new')
    await fillAndCreate(u)
    await u.click(within(await dialog()).getByRole('button', { name: 'Use this address' }))
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create Staff Member' })).toBeEnabled())

    await u.click(screen.getByRole('button', { name: 'Create Staff Member' }))

    expect(await dialog()).toBeInTheDocument()
    expect(mockCreate).toHaveBeenCalledTimes(3)
    expect(mockCreate.mock.calls[2][0].addressConfirmed).toBeUndefined()
  })
})

describe('StaffCreatePage edit: a changed address the server wants checked', () => {
  it('asks the admin to check the new address, and on "Use this address" sends the update again with the confirmation', async () => {
    mockUseStaffDetail.mockReturnValue({ data: staff(), isLoading: false })
    const u = renderPage('/staff/s1/edit')
    const email = await screen.findByLabelText(/^email/i)
    await waitFor(() => expect(email).toHaveValue('sam.staff@acme.example.com'))

    await u.clear(email)
    await u.type(email, 'sam.staff@gmial.com')
    await u.click(screen.getByRole('button', { name: 'Save Changes' }))

    const asking = await dialog()
    expect(within(asking).getByText(SENTENCE)).toBeInTheDocument()
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate.mock.calls[0][0].data.addressConfirmed).toBeUndefined()

    await u.click(within(asking).getByRole('button', { name: 'Use this address' }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2))
    expect(mockUpdate.mock.calls[1][0]).toEqual({ id: 's1', data: expect.objectContaining({ email: 'sam.staff@gmial.com', addressConfirmed: true, isActive: true }) })
    expect(await screen.findByText('Staff list')).toBeInTheDocument()
  })
})
