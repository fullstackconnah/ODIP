import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import StaffCreatePage from './StaffCreatePage'
import type { StaffDetailDto } from '@/api/types'

const {
  mockUseStaffDetail, mockCreateMutateAsync, mockUpdateMutateAsync, mockUsePermissions,
  mockUseCreateStaff, mockUseUpdateStaff,
} = vi.hoisted(() => ({
  mockUseStaffDetail: vi.fn(),
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockUsePermissions: vi.fn(),
  mockUseCreateStaff: vi.fn(),
  mockUseUpdateStaff: vi.fn(),
}))

// Only the API layer and usePermissions are mocked — FormField, Card are the real components,
// so this exercises the actual role-lock/blocked-form wiring.
vi.mock('@/api/hooks', () => ({
  useCreateStaff: mockUseCreateStaff,
  useUpdateStaff: mockUseUpdateStaff,
  useStaffDetail: mockUseStaffDetail,
  useEnsureStaffSignInAccount: () => ({ mutateAsync: vi.fn() }),
  useRecordInvitesSent: () => ({ mutate: vi.fn() }),
}))

vi.mock('@/lib/permissions', () => ({
  usePermissions: mockUsePermissions,
}))

function makeStaff(overrides: Partial<StaffDetailDto> = {}): StaffDetailDto {
  return {
    id: 'staff-1', firstName: 'Priya', lastName: 'Shah', fullName: 'Priya Shah',
    username: 'priya.shah', role: 'SupportWorker', position: 'SupportWorker',
    email: 'priya.shah@odip.com.au', mobile: null, region: null, isDriverEligible: false,
    isFirstAidQualified: false, isMedicationCompetent: false, isManualHandlingCompetent: false,
    isOvernightEligible: false, isActive: true, firstAidExpiryDate: null, driverLicenceExpiryDate: null,
    manualHandlingExpiryDate: null, medicationCompetencyExpiryDate: null, workerScreeningNumber: null,
    workerScreeningExpiryDate: null, hasExpiredQualifications: false, notes: null,
    ...overrides,
  }
}

// StaffCreatePage calls useUnsavedChangesWarning, which uses react-router 7's useBlocker — that
// throws under a plain declarative <MemoryRouter>/<Routes>, so tests need a data router (same
// requirement the retired create-wizard's test suite documents).
function renderEditPage(id: string) {
  const router = createMemoryRouter(
    [
      { path: '/staff/:id/edit', element: <StaffCreatePage /> },
      { path: '/staff', element: <div>Staff list</div> },
    ],
    { initialEntries: [`/staff/${id}/edit`] },
  )
  return render(<RouterProvider router={router} />)
}

function renderCreatePage() {
  const router = createMemoryRouter(
    [
      { path: '/staff/new', element: <StaffCreatePage /> },
      { path: '/staff', element: <div>Staff list</div> },
    ],
    { initialEntries: ['/staff/new'] },
  )
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  mockCreateMutateAsync.mockReset()
  mockUpdateMutateAsync.mockReset()
  mockUpdateMutateAsync.mockResolvedValue({ success: true, data: {} })
  mockCreateMutateAsync.mockResolvedValue({ success: true, data: {} })
  mockUseCreateStaff.mockReturnValue({ mutateAsync: mockCreateMutateAsync, isPending: false, isError: false, error: null })
  mockUseUpdateStaff.mockReturnValue({ mutateAsync: mockUpdateMutateAsync, isPending: false, isError: false, error: null })
})

describe('StaffCreatePage account-role lock (Coordinator editing an Admin)', () => {
  beforeEach(() => {
    mockUsePermissions.mockReturnValue({ isCoordinator: true })
    const staff = makeStaff({ role: 'Admin', mobile: '0400 000 000' })
    mockUseStaffDetail.mockReturnValue({ data: staff, isLoading: false, refetch: vi.fn().mockResolvedValue({ data: staff }) })
  })

  it('renders the role field disabled, showing the target\'s actual current role', async () => {
    renderEditPage('staff-1')

    // GEN-1: Account Role migrated from a native <select> to Dropdown (variant="form") via
    // Controller, which doesn't forward FormField's aria-labelledby clone to the render-prop
    // child (same gap TaskCreatePage.test.tsx documents for its Owner picker) — so the trigger
    // is queried by its own visible text (the current value's label) instead of getByLabelText.
    const roleButton = await screen.findByRole('button', { name: 'Admin' })
    expect(roleButton).toBeDisabled()
    expect(screen.getByText(/only an admin can change this role/i)).toBeInTheDocument()
  })

  it('still allows editing and saving other fields (Mobile), with the role unchanged in the payload', async () => {
    const user = userEvent.setup()
    renderEditPage('staff-1')

    const mobileInput = await screen.findByLabelText(/mobile/i)
    await user.clear(mobileInput)
    await user.type(mobileInput, '0411 222 333')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1)
    const call = mockUpdateMutateAsync.mock.calls[0][0]
    expect(call.id).toBe('staff-1')
    expect(call.data.mobile).toBe('0411 222 333')
    // The role the disabled select displayed round-trips unchanged — the backend only rejects a
    // role PROMOTION, not this same-role edit of the record's other fields.
    expect(call.data.role).toBe('Admin')
  })
})

describe('StaffCreatePage account-role options (create mode)', () => {
  it('hides Admin and SuperAdmin from a Coordinator\'s options', async () => {
    const user = userEvent.setup()
    mockUsePermissions.mockReturnValue({ isCoordinator: true })
    renderCreatePage()

    // GEN-1: Dropdown renders its option list in a portal only while open, and — since Controller
    // doesn't forward FormField's aria-labelledby clone to the render-prop child (see the
    // disabled-role test above) — the trigger can't be queried by label either. Both Position and
    // Account Role default to the same 'Support Worker' text, so scope by the field's own label
    // element instead of relying on the trigger's accessible name being unique.
    const roleField = (await screen.findByText(/Account Role/)).parentElement!
    await user.click(within(roleField).getByRole('button'))
    const optionNames = screen.getAllByRole('option').map(o => o.textContent)
    expect(optionNames).not.toContain('Admin')
    expect(optionNames).not.toContain('SuperAdmin')
    expect(optionNames).toContain('Support Worker')
    expect(optionNames).toContain('Coordinator')
    expect(optionNames).toContain('Read Only')
  })

  it('offers Admin (but never SuperAdmin) to a non-Coordinator actor', async () => {
    const user = userEvent.setup()
    mockUsePermissions.mockReturnValue({ isCoordinator: false })
    renderCreatePage()

    const roleField = (await screen.findByText(/Account Role/)).parentElement!
    await user.click(within(roleField).getByRole('button'))
    const optionNames = screen.getAllByRole('option').map(o => o.textContent)
    expect(optionNames).toContain('Admin')
    expect(optionNames).not.toContain('SuperAdmin')
  })
})

// PP-85 — a failed save now shows the backend's specific message (e.g. the email-conflict 409)
// instead of the generic "Failed to create/update staff member" banner.
describe('StaffCreatePage — PP-85 specific save-failure message', () => {
  it('shows the backend\'s conflict message when creating with a duplicate email', async () => {
    const user = userEvent.setup()
    mockUsePermissions.mockReturnValue({ isCoordinator: false })
    mockCreateMutateAsync.mockRejectedValue({
      response: { data: { success: false, errors: ['A user with this email already exists.'] } },
    })
    mockUseCreateStaff.mockReturnValue({ mutateAsync: mockCreateMutateAsync, isPending: false, isError: true, error: { response: { data: { errors: ['A user with this email already exists.'] } } } })
    renderCreatePage()

    await user.type(screen.getByLabelText(/First Name/), 'Jordan')
    await user.type(screen.getByLabelText(/Last Name/), 'Blake')
    await user.type(screen.getByLabelText(/Email/), 'jordan.blake@odip.com.au')
    await user.click(screen.getByRole('button', { name: /create staff member/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('A user with this email already exists.')
  })

  it('falls back to the generic message when the error carries no specific text', async () => {
    const user = userEvent.setup()
    mockUsePermissions.mockReturnValue({ isCoordinator: false })
    mockCreateMutateAsync.mockRejectedValue(new Error('network down'))
    mockUseCreateStaff.mockReturnValue({ mutateAsync: mockCreateMutateAsync, isPending: false, isError: true, error: new Error('network down') })
    renderCreatePage()

    await user.type(screen.getByLabelText(/First Name/), 'Jordan')
    await user.type(screen.getByLabelText(/Last Name/), 'Blake')
    await user.type(screen.getByLabelText(/Email/), 'jordan.blake@odip.com.au')
    await user.click(screen.getByRole('button', { name: /create staff member/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to create staff member/i)
  })
})

describe('StaffCreatePage editing a SuperAdmin target', () => {
  beforeEach(() => {
    mockUsePermissions.mockReturnValue({ isCoordinator: false })
    mockUseStaffDetail.mockReturnValue({ data: makeStaff({ role: 'SuperAdmin' }), isLoading: false })
  })

  it('blocks the edit entirely with a clear message instead of a submitable form', async () => {
    renderEditPage('staff-1')

    expect(await screen.findByRole('alert')).toHaveTextContent(/can't be edited here/i)
    expect(screen.getByText(/managed in settings/i)).toBeInTheDocument()

    // No form at all — not just a disabled submit button.
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/account role/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/mobile/i)).not.toBeInTheDocument()

    expect(mockUpdateMutateAsync).not.toHaveBeenCalled()
    // One Back: the icon left of the title, no second text link in the card.
    expect(screen.getAllByRole('link', { name: /back to staff/i })).toHaveLength(1)
  })
})

// The one Back standard (UI survey s.1): the icon BackButton left of the title, named for where it goes.
describe('StaffCreatePage — Back', () => {
  it('is the icon Back before the title, a real link to /staff', () => {
    renderCreatePage()

    const back = screen.getByRole('link', { name: /back to staff/i })
    expect(back).toHaveAttribute('href', '/staff')
    expect(back).toHaveClass('min-w-[var(--tap-min)]')
    expect(back.compareDocumentPosition(screen.getByRole('heading', { level: 1 })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

// STAFF-7: editing an id the server does not know says so, instead of a blank form that would PUT to it.
describe('StaffCreatePage — editing an unknown staff member', () => {
  it('says it is loading while the record loads', () => {
    mockUseStaffDetail.mockReturnValue({ data: undefined, isLoading: true, isError: false })
    renderEditPage('missing')
    expect(screen.getByRole('status')).toHaveTextContent('Loading staff member…')
  })

  it('says the staff member was not found on a 404, with no form', () => {
    mockUseStaffDetail.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: { response: { status: 404 } } })
    renderEditPage('missing')
    expect(screen.getByText('Staff member not found')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })
})

// The page has no Active control, so Save sends the flag the staff member has now: a deactivation made elsewhere since the page loaded stays.
describe('StaffCreatePage — saving an edit keeps the current active flag', () => {
  it('sends the isActive the record has at save time, not the one it loaded with', async () => {
    const user = userEvent.setup()
    mockUsePermissions.mockReturnValue({ isCoordinator: true })
    const refetch = vi.fn().mockResolvedValue({ data: makeStaff({ isActive: false }) })
    mockUseStaffDetail.mockReturnValue({ data: makeStaff({ isActive: true }), isLoading: false, refetch })
    renderEditPage('staff-1')

    const mobileInput = await screen.findByLabelText(/mobile/i)
    await user.type(mobileInput, '0411 222 333')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(refetch).toHaveBeenCalledTimes(1)
    expect(mockUpdateMutateAsync).toHaveBeenCalledWith({ id: 'staff-1', data: expect.objectContaining({ mobile: '0411 222 333', isActive: false }) })
  })
})

describe('StaffCreatePage — the pre-save re-read of an edit', () => {
  it('reads "Saving…" and stays disabled while the re-read is pending, then sends the update', async () => {
    const user = userEvent.setup()
    mockUsePermissions.mockReturnValue({ isCoordinator: true })
    let release: (v: { data: ReturnType<typeof makeStaff> }) => void = () => {}
    const refetch = vi.fn().mockReturnValue(new Promise(resolve => { release = resolve }))
    mockUseStaffDetail.mockReturnValue({ data: makeStaff({ isActive: true }), isLoading: false, refetch })
    renderEditPage('staff-1')

    await user.type(await screen.findByLabelText(/mobile/i), '0411 222 333')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    const busy = await screen.findByRole('button', { name: 'Saving…' })
    expect(busy).toBeDisabled()
    expect(mockUpdateMutateAsync).not.toHaveBeenCalled()

    release({ data: makeStaff({ isActive: true }) })
    await waitFor(() => expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1))
  })
})
