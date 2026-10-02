import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TenantFormPanel from './TenantFormPanel'
import type { TenantCreatedDto } from '@/api/types'

// A tenant create with a first user answers with that user's id and what became of their Firebase sign-in account. The panel stays open in a
// done state that says so: a password typed for an account that already existed was NOT applied, and the first user needs a way in.

const { mockCreate, mockEnsure, sendPasswordResetEmail, firebase } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  // POST /admin/users/{id}/sign-in-account: makes sure the Firebase account exists and says whether it made it.
  mockEnsure: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  // `auth` is null where Firebase is not configured (local dev auth). A getter, so each test can change it.
  firebase: { auth: null as object | null },
}))

vi.mock('@/api/hooks/admin', () => ({
  useCreateTenantWithSetup: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateTenant: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEnsureUserSignInAccount: () => ({ mutateAsync: mockEnsure }),
}))
vi.mock('firebase/auth', () => ({ sendPasswordResetEmail }))
vi.mock('@/lib/firebase', () => ({
  get auth() {
    return firebase.auth
  },
}))

const authStub = { name: 'auth-stub' }
const EMAIL = 'jane.smith@brightside.example.com'

const created = (overrides: Partial<TenantCreatedDto> = {}): TenantCreatedDto => ({
  id: 'tenant-9', name: 'Brightside Care', emailDomain: 'brightside.example.com', isActive: true, createdAt: '2026-01-01T00:00:00Z', userCount: 1,
  initialUserId: 'user-9', firebaseAccount: 'created', ...overrides,
})

beforeEach(() => {
  firebase.auth = authStub
  mockCreate.mockReset().mockResolvedValue(created())
  mockEnsure.mockReset().mockResolvedValue({ firebaseAccount: 'existing' })
  sendPasswordResetEmail.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function createTenant({ firstUser = true, password = '' }: { firstUser?: boolean; password?: string } = {}) {
  const onClose = vi.fn()
  const u = userEvent.setup()
  render(<TenantFormPanel isOpen onClose={onClose} />)
  await u.type(screen.getByPlaceholderText('e.g. Acme Travel Co'), 'Brightside Care')
  await u.type(screen.getByPlaceholderText('e.g. acme.com.au'), 'brightside.example.com')
  if (firstUser) {
    await u.click(screen.getByRole('button', { name: /initial admin user/i }))
    await u.type(screen.getByLabelText('First Name'), 'Jane')
    await u.type(screen.getByLabelText('Last Name'), 'Smith')
    await u.type(screen.getByLabelText('Email'), EMAIL)
    await u.type(screen.getByLabelText('Username'), 'jane.smith')
    if (password) await u.type(screen.getByLabelText('Password'), password)
  }
  await u.click(screen.getByRole('button', { name: 'Create Tenant' }))
  return { u, onClose }
}

describe('TenantFormPanel create: what became of the first user\'s sign-in account', () => {
  it('stays open in a done state, and Done closes it', async () => {
    const { u, onClose } = await createTenant({ firstUser: false })

    expect(await screen.findByRole('dialog', { name: 'Tenant created' })).toBeInTheDocument()
    expect(screen.getByText('Brightside Care was created.')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    await u.click(screen.getByRole('button', { name: 'Done' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('says nothing about a first user, and sends nothing, when none was given', async () => {
    await createTenant({ firstUser: false })

    await screen.findByText('Brightside Care was created.')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/sign in|password|email/i)).not.toBeInTheDocument()
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
  })

  it('a typed password reached the account the app made: they can sign in with it, and no email goes', async () => {
    await createTenant({ password: 'Winter-2026!' })

    expect(await screen.findByText(
      'Jane Smith can sign in now with the temporary password you set. Share it with them securely, and ask them to change it with Forgot password after they first sign in.',
    )).toBeInTheDocument()
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      initialUser: expect.objectContaining({ email: EMAIL, password: 'Winter-2026!' }),
    }))
  })

  describe('when the first user\'s sign-in account already existed', () => {
    beforeEach(() => {
      mockCreate.mockResolvedValue(created({ firebaseAccount: 'existing' }))
    })

    it('says the typed password was NOT applied, instead of claiming they can sign in with it, and sends nothing yet', async () => {
      await createTenant({ password: 'Winter-2026!' })

      expect(await screen.findByRole('alert')).toHaveTextContent(`${EMAIL} already had a sign-in account, so the password you set wasn't applied.`)
      expect(screen.queryByText(/can sign in now/)).not.toBeInTheDocument()
      expect(sendPasswordResetEmail).not.toHaveBeenCalled()
    })

    it('offers Send set-password email right there: the server makes sure of the account, then Firebase sends, worded "reset"', async () => {
      const { u } = await createTenant({ password: 'Winter-2026!' })

      await u.click(await screen.findByRole('button', { name: 'Send set-password email' }))

      expect(await screen.findByText(`We've sent ${EMAIL} a link to reset their password. It can take a few minutes, so ask them to check spam.`)).toBeInTheDocument()
      expect(mockEnsure).toHaveBeenCalledTimes(1)
      expect(mockEnsure).toHaveBeenCalledWith('user-9')
      expect(sendPasswordResetEmail).toHaveBeenCalledWith(authStub, EMAIL)
    })

    it('does not offer to send where Firebase is not configured', async () => {
      firebase.auth = null
      await createTenant({ password: 'Winter-2026!' })

      expect(await screen.findByRole('alert')).toHaveTextContent("so the password you set wasn't applied.")
      expect(screen.queryByRole('button', { name: 'Send set-password email' })).not.toBeInTheDocument()
    })
  })

  it('emails the first user a link when no password was typed, worded "set" for an account the app made', async () => {
    await createTenant()

    expect(await screen.findByText(`We've sent ${EMAIL} a link to set their password. It can take a few minutes, so ask them to check spam.`)).toBeInTheDocument()
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1)
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(authStub, EMAIL)
    // The server already made the account in the create, so there is no ensure step to run.
    expect(mockEnsure).not.toHaveBeenCalled()
  })

  it('says "reset" when the first user\'s account was already there and no password was typed', async () => {
    mockCreate.mockResolvedValue(created({ firebaseAccount: 'existing' }))

    await createTenant()

    expect(await screen.findByText(`We've sent ${EMAIL} a link to reset their password. It can take a few minutes, so ask them to check spam.`)).toBeInTheDocument()
  })

  it('says no link was sent, names the address, and offers Send again right there, when Firebase refuses', async () => {
    sendPasswordResetEmail.mockRejectedValueOnce(Object.assign(new Error('Firebase: Error (auth/too-many-requests).'), { code: 'auth/too-many-requests' }))
    const { u } = await createTenant()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      `No link was sent to ${EMAIL}. Firebase is limiting emails for now. Wait a few minutes, then use Send again.`,
    )

    await u.click(screen.getByRole('button', { name: 'Send again' }))

    expect(await screen.findByText(/We've sent jane.smith@brightside.example.com a link to set their password/)).toBeInTheDocument()
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(2)
  })

  it('without Firebase (local dev auth) sends nothing and says nothing about an email', async () => {
    firebase.auth = null
    await createTenant()

    await screen.findByText('Brightside Care was created.')
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText(/email/i)).not.toBeInTheDocument())
  })

  it('a rejected create shows the error, keeps what was typed, stays on the form, and sends nothing', async () => {
    mockCreate.mockRejectedValue({ response: { data: { errors: ['A tenant with this email domain already exists'] } } })
    await createTenant()

    expect(await screen.findByText('A tenant with this email domain already exists')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('e.g. Acme Travel Co')).toHaveValue('Brightside Care')
    expect(screen.getByLabelText('Email')).toHaveValue(EMAIL)
    expect(screen.getByRole('dialog', { name: 'New Tenant' })).toBeInTheDocument()
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
  })
})
