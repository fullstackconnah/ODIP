import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TenantFormPanel from './TenantFormPanel'
import type { TenantCreatedDto } from '@/api/types'

// A tenant's first user: any address can sign in, so one at neither the NEW tenant's domain nor a common email provider is a live login for whoever
// owns it. The server refuses the first attempt (400, code AddressNeedsConfirmation) before the tenant, the user or an account exists; the panel asks
// the admin to check the address and, on "Use this address", sends the same request again with the confirmation inside the first user.

const { mockCreate, firebase } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  // `auth` is null where Firebase is not configured (local dev auth): no email is sent, so the done view stays simple.
  firebase: { auth: null as object | null },
}))

vi.mock('@/api/hooks/admin', () => ({
  useCreateTenantWithSetup: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateTenant: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEnsureUserSignInAccount: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('firebase/auth', () => ({ sendPasswordResetEmail: vi.fn() }))
vi.mock('@/lib/firebase', () => ({
  get auth() {
    return firebase.auth
  },
}))

const EMAIL = 'jane.smith@brightside.example.org'
const SENTENCE = `${EMAIL} is not at brightside.example.com or a common email provider. The sign-in link goes to whoever owns this address. Check it is right.`

/** What the server answers when it wants the address checked first. */
const confirmationRequest = () => ({ response: { status: 400, data: { success: false, errors: [SENTENCE], code: 'AddressNeedsConfirmation' } } })

const created: TenantCreatedDto = {
  id: 'tenant-9', name: 'Brightside Care', emailDomain: 'brightside.example.com', isActive: true, createdAt: '2026-01-01T00:00:00Z', userCount: 1,
  initialUserId: 'user-9', firebaseAccount: 'created',
}

const firstUser = (extra: object = {}) => ({
  firstName: 'Jane', lastName: 'Smith', email: EMAIL, username: 'jane.smith', role: 'Admin', password: undefined, ...extra,
})

beforeEach(() => {
  firebase.auth = null
  mockCreate.mockReset().mockRejectedValueOnce(confirmationRequest()).mockResolvedValue(created)
})

async function submitTenantWithFirstUser() {
  const onClose = vi.fn()
  const u = userEvent.setup()
  render(<TenantFormPanel isOpen onClose={onClose} />)
  await u.type(screen.getByPlaceholderText('e.g. Acme Travel Co'), 'Brightside Care')
  await u.type(screen.getByPlaceholderText('e.g. acme.com.au'), 'brightside.example.com')
  await u.click(screen.getByRole('button', { name: /initial admin user/i }))
  await u.type(screen.getByLabelText('First Name'), 'Jane')
  await u.type(screen.getByLabelText('Last Name'), 'Smith')
  await u.type(screen.getByLabelText('Email'), EMAIL)
  await u.type(screen.getByLabelText('Username'), 'jane.smith')
  await u.click(screen.getByRole('button', { name: 'Create Tenant' }))
  return { u, onClose }
}

const dialog = () => screen.findByRole('alertdialog', { name: 'Check this address' })

describe('TenantFormPanel create: a first user address the server wants checked', () => {
  it('asks the admin to check it, in the server\'s words, instead of showing an error', async () => {
    await submitTenantWithFirstUser()

    const asking = await dialog()
    expect(within(asking).getByText(SENTENCE)).toBeInTheDocument()
    expect(within(asking).getByRole('button', { name: 'Use this address' })).toBeInTheDocument()
    expect(within(asking).getByRole('button', { name: 'Go back' })).toBeInTheDocument()
    expect(screen.queryByText('Failed to save tenant.')).not.toBeInTheDocument()
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockCreate.mock.calls[0][0].initialUser).toEqual(firstUser())
    expect(mockCreate.mock.calls[0][0].initialUser.addressConfirmed).toBeUndefined()
  })

  it('sends the same request again with the confirmation in the first user, and then says the tenant was created', async () => {
    const { u } = await submitTenantWithFirstUser()

    await u.click(within(await dialog()).getByRole('button', { name: 'Use this address' }))

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2))
    expect(mockCreate.mock.calls[1][0]).toEqual({
      name: 'Brightside Care', emailDomain: 'brightside.example.com', providerSettings: null, initialUser: firstUser({ addressConfirmed: true }),
    })
    expect(await screen.findByText('Brightside Care was created.', { selector: 'p' })).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('sends nothing more, and keeps what was typed, when the admin goes back to check the address', async () => {
    const { u, onClose } = await submitTenantWithFirstUser()

    await u.click(within(await dialog()).getByRole('button', { name: 'Go back' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Email')).toHaveValue(EMAIL)
    expect(screen.getByPlaceholderText('e.g. acme.com.au')).toHaveValue('brightside.example.com')
    expect(screen.getByRole('button', { name: 'Create Tenant' })).toBeEnabled()
  })

  it('still shows any other refusal as the error it is, with no question', async () => {
    mockCreate.mockReset().mockRejectedValue({ response: { status: 409, data: { success: false, errors: ['A tenant with this email domain already exists'] } } })

    await submitTenantWithFirstUser()

    expect(await screen.findByText('A tenant with this email domain already exists')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})
