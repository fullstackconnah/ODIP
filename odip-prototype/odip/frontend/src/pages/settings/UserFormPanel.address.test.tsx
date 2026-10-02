import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UserFormPanel from './UserFormPanel'
import type { AdminUserDto } from '@/api/types'

// Any address can sign in, so an address at neither the tenant's own domain nor a common email provider (a typo, another organisation's) is a live
// login for whoever owns it. The server refuses the first attempt (400, code AddressNeedsConfirmation); the panel asks the admin to check the
// address and, on "Use this address", sends the same request again with the confirmation. It holds no list of providers itself.

const { mockCreate, firebase } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  // `auth` is null where Firebase is not configured (local dev auth): no email is sent, so the done view stays simple.
  firebase: { auth: null as object | null },
}))

vi.mock('@/api/hooks', () => ({
  useAdminTenantsSummary: () => ({ data: [{ id: 'tenant-1', name: 'Sample Support Co' }] }),
  useCreateAdminUser: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateAdminUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEnsureUserSignInAccount: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('firebase/auth', () => ({ sendPasswordResetEmail: vi.fn() }))
vi.mock('@/lib/firebase', () => ({
  get auth() {
    return firebase.auth
  },
}))

const EMAIL = 'new.person@gmial.com'
const SENTENCE = `${EMAIL} is not at sample.example.com or a common email provider. The sign-in link goes to whoever owns this address. Check it is right.`

/** What the server answers when it wants the address checked first. */
const confirmationRequest = () => ({ response: { status: 400, data: { success: false, errors: [SENTENCE], code: 'AddressNeedsConfirmation' } } })

const createdUser: AdminUserDto = {
  id: 'new-1', firstName: 'New', lastName: 'Person', fullName: 'New Person', email: EMAIL, username: 'newperson', role: 'Coordinator',
  tenantId: 'tenant-1', tenantName: 'Sample Support Co', isActive: true, createdAt: '2026-01-01T00:00:00Z', lastLoginAt: null, firebaseAccount: 'created',
}

const body = (extra: object = {}) => ({
  tenantId: 'tenant-1', firstName: 'New', lastName: 'Person', email: EMAIL, username: 'newperson', role: 'Coordinator', password: undefined, ...extra,
})

beforeEach(() => {
  firebase.auth = null
  mockCreate.mockReset().mockRejectedValueOnce(confirmationRequest()).mockResolvedValue(createdUser)
})

async function submitCreate() {
  const onClose = vi.fn()
  const u = userEvent.setup()
  render(<UserFormPanel isOpen onClose={onClose} defaultTenantId="tenant-1" />)
  await u.type(screen.getByLabelText(/first name/i), 'New')
  await u.type(screen.getByLabelText(/last name/i), 'Person')
  await u.type(screen.getByLabelText(/^email/i), EMAIL)
  await u.type(screen.getByLabelText(/username/i), 'newperson')
  await u.click(screen.getByRole('button', { name: 'Role *' }))
  await u.click(await screen.findByRole('option', { name: 'Coordinator' }))
  await u.click(screen.getByRole('button', { name: 'Create User' }))
  return { u, onClose }
}

const dialog = () => screen.findByRole('alertdialog', { name: 'Check this address' })

describe('UserFormPanel create: an address the server wants checked', () => {
  it('asks the admin to check it, in the server\'s words, instead of showing an error', async () => {
    await submitCreate()

    const asking = await dialog()
    expect(within(asking).getByText(SENTENCE)).toBeInTheDocument()
    expect(within(asking).getByRole('button', { name: 'Use this address' })).toBeInTheDocument()
    expect(within(asking).getByRole('button', { name: 'Go back' })).toBeInTheDocument()
    // It is a question, not a failure: nothing is shown as an error, and only the first request has gone.
    expect(screen.queryByText('Failed to save user.')).not.toBeInTheDocument()
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockCreate.mock.calls[0][0]).toEqual(body())
    expect(mockCreate.mock.calls[0][0].addressConfirmed).toBeUndefined()
  })

  it('sends the same request again with the confirmation when the admin says to use the address, and then says the user was created', async () => {
    const { u } = await submitCreate()

    await u.click(within(await dialog()).getByRole('button', { name: 'Use this address' }))

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2))
    expect(mockCreate.mock.calls[1][0]).toEqual(body({ addressConfirmed: true }))
    expect(await screen.findByText('New Person was created.', { selector: 'p' })).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('sends nothing more, and keeps what was typed, when the admin goes back to check the address', async () => {
    const { u, onClose } = await submitCreate()

    await u.click(within(await dialog()).getByRole('button', { name: 'Go back' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/^email/i)).toHaveValue(EMAIL)
    expect(screen.getByLabelText(/first name/i)).toHaveValue('New')
    expect(screen.getByRole('button', { name: 'Create User' })).toBeEnabled()
  })

  it('does not carry a confirmation over to a later attempt: after going back and changing the address it asks afresh', async () => {
    const { u } = await submitCreate()
    await u.click(within(await dialog()).getByRole('button', { name: 'Go back' }))
    mockCreate.mockRejectedValueOnce(confirmationRequest())

    await u.click(screen.getByRole('button', { name: 'Create User' }))

    expect(await dialog()).toBeInTheDocument()
    expect(mockCreate).toHaveBeenCalledTimes(2)
    expect(mockCreate.mock.calls[1][0].addressConfirmed).toBeUndefined()
  })

  it('still shows any other refusal as the error it is, with no question', async () => {
    mockCreate.mockReset().mockRejectedValue({ response: { status: 400, data: { success: false, errors: ['Invalid role. SuperAdmin cannot be assigned.'] } } })

    await submitCreate()

    expect(await screen.findByText('Invalid role. SuperAdmin cannot be assigned.')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})
