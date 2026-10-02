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
// What POST .../sign-in-account answers when it fails for a reason that is not the address: no advice to try again later.
const NEUTRAL_FAILURE = "Unable to set up the user's sign-in account. If it keeps happening, ask whoever runs the Firebase project."

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

async function createTenant({ firstUser = true, password = '', beforeCreate }: { firstUser?: boolean; password?: string; beforeCreate?: () => void } = {}) {
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
  beforeCreate?.()
  await u.click(screen.getByRole('button', { name: 'Create Tenant' }))
  return { u, onClose }
}

describe('TenantFormPanel create: what became of the first user\'s sign-in account', () => {
  it('stays open in a done state, and Done closes it', async () => {
    const { u, onClose } = await createTenant({ firstUser: false })

    expect(await screen.findByRole('dialog', { name: 'Tenant created' })).toBeInTheDocument()
    expect(screen.getByText('Brightside Care was created.', { selector: 'p' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    await u.click(screen.getByRole('button', { name: 'Done' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('says nothing about a first user, and sends nothing, when none was given', async () => {
    await createTenant({ firstUser: false })

    await screen.findByText('Brightside Care was created.', { selector: 'p' })
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

      expect(await screen.findByText(`${EMAIL} already had a sign-in account, so the password you set wasn't applied.`)).toBeInTheDocument()
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

      expect(await screen.findByText(`${EMAIL} already had a sign-in account, so the password you set wasn't applied.`)).toBeInTheDocument()
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

    expect(await screen.findByText(`No link was sent to ${EMAIL}. Firebase is limiting emails for now. Wait a few minutes, then use Send again.`)).toBeInTheDocument()

    await u.click(screen.getByRole('button', { name: 'Send again' }))

    expect(await screen.findByText(`We've sent ${EMAIL} a link to set their password. It can take a few minutes, so ask them to check spam.`)).toBeInTheDocument()
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(2)
  })

  describe('when the first user\x27s sign-in account could not be set up (the tenant and the user exist)', () => {
    beforeEach(() => {
      mockCreate.mockResolvedValue(created({ firebaseAccount: 'failed' }))
    })

    it('says so, and where to go, and sends no email (there is no account to send to)', async () => {
      await createTenant()

      expect(await screen.findByText("Tenant created, but their sign-in account couldn't be set up. Use Send set-password email in the Users tab.")).toBeInTheDocument()
      expect(screen.getByText('Brightside Care was created.', { selector: 'p' })).toBeInTheDocument()
      expect(sendPasswordResetEmail).not.toHaveBeenCalled()
      expect(screen.queryByText(/We've sent/)).not.toBeInTheDocument()
    })

    it('says the same when a password was typed, because it was not applied either', async () => {
      await createTenant({ password: 'Winter-2026!' })

      expect(await screen.findByText("Tenant created, but their sign-in account couldn't be set up. Use Send set-password email in the Users tab.")).toBeInTheDocument()
      expect(screen.queryByText(/can sign in now/)).not.toBeInTheDocument()
    })

    it('offers the same action right there: the server makes the account, then Firebase sends', async () => {
      mockEnsure.mockResolvedValue({ firebaseAccount: 'created' })
      const { u } = await createTenant()

      await u.click(await screen.findByRole('button', { name: 'Send set-password email' }))

      expect(await screen.findByText(`We've sent ${EMAIL} a link to set their password. It can take a few minutes, so ask them to check spam.`)).toBeInTheDocument()
      expect(mockEnsure).toHaveBeenCalledTimes(1)
      expect(mockEnsure).toHaveBeenCalledWith('user-9')
      expect(sendPasswordResetEmail).toHaveBeenCalledWith(authStub, EMAIL)
    })

    it('a failure there is a warning with Send again, and Send again redoes the account step through the server', async () => {
      mockEnsure.mockRejectedValueOnce({ response: { data: { success: false, errors: [NEUTRAL_FAILURE] } } })
      const { u } = await createTenant()

      await u.click(await screen.findByRole('button', { name: 'Send set-password email' }))
      expect(await screen.findByText(`No link was sent to ${EMAIL}. ${NEUTRAL_FAILURE}`)).toBeInTheDocument()
      expect(sendPasswordResetEmail).not.toHaveBeenCalled()

      mockEnsure.mockResolvedValueOnce({ firebaseAccount: 'created' })
      await u.click(screen.getByRole('button', { name: 'Send again' }))

      expect(await screen.findByText(`We've sent ${EMAIL} a link to set their password. It can take a few minutes, so ask them to check spam.`)).toBeInTheDocument()
      expect(mockEnsure).toHaveBeenCalledTimes(2)
    })

    it('does not offer to send where Firebase is not configured', async () => {
      firebase.auth = null
      await createTenant()

      expect(await screen.findByText("Tenant created, but their sign-in account couldn't be set up. Use Send set-password email in the Users tab.")).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Send set-password email' })).not.toBeInTheDocument()
    })
  })

  describe('what a screen reader user is told, and where focus goes, when the form becomes the done view', () => {
    it('writes the outcome into a status region that was already there, and moves focus to the done message', async () => {
      let region!: HTMLElement
      await createTenant({
        beforeCreate: () => {
          region = screen.getByRole('status')
          expect(region).toBeEmptyDOMElement()
        },
      })

      const heading = await screen.findByText('Brightside Care was created.', { selector: 'p' })

      // The SAME node (a live region created already holding its text is announced unreliably), now holding the whole sentence.
      expect(screen.getByRole('status')).toBe(region)
      expect(region).toHaveTextContent(`Brightside Care was created. We've sent ${EMAIL} a link to set their password. It can take a few minutes, so ask them to check spam.`)
      expect(heading).toHaveFocus()
    })

    it('announces a failure through that same region, once: the visible warning does not announce itself as well', async () => {
      sendPasswordResetEmail.mockRejectedValueOnce(Object.assign(new Error('Firebase: Error (auth/too-many-requests).'), { code: 'auth/too-many-requests' }))
      await createTenant()

      await screen.findByText(`No link was sent to ${EMAIL}. Firebase is limiting emails for now. Wait a few minutes, then use Send again.`)

      expect(screen.getByRole('status')).toHaveTextContent(
        `Brightside Care was created. No link was sent to ${EMAIL}. Firebase is limiting emails for now. Wait a few minutes, then use Send again.`,
      )
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getAllByRole('status')).toHaveLength(1)
    })

    it('announces that the first user\'s account could not be set up, and switches the send button off with aria-disabled (not `disabled`) while it sends', async () => {
      mockCreate.mockResolvedValue(created({ firebaseAccount: 'failed' }))
      const { u } = await createTenant()
      expect(await screen.findByRole('status')).toHaveTextContent(
        "Brightside Care was created. Tenant created, but their sign-in account couldn't be set up. Use Send set-password email in the Users tab.",
      )
      let finishEnsure!: (value: { firebaseAccount: 'created' | 'existing' }) => void
      mockEnsure.mockReturnValue(new Promise(resolve => { finishEnsure = resolve }))

      await u.click(screen.getByRole('button', { name: 'Send set-password email' }))

      const busy = await screen.findByRole('button', { name: 'Sending...' })
      expect(busy).toHaveAttribute('aria-disabled', 'true')
      expect(busy).not.toBeDisabled()
      expect(busy).toHaveFocus()
      await u.click(busy)
      expect(mockEnsure).toHaveBeenCalledTimes(1)

      finishEnsure({ firebaseAccount: 'created' })

      expect(await screen.findByText(`We've sent ${EMAIL} a link to set their password. It can take a few minutes, so ask them to check spam.`)).toBeInTheDocument()
      expect(mockEnsure).toHaveBeenCalledTimes(1)
      // The button that had focus went with the warning, so focus is on the done message rather than the top of the page.
      expect(screen.getByText('Brightside Care was created.', { selector: 'p' })).toHaveFocus()
    })
  })

  it('without Firebase (local dev auth) sends nothing and says nothing about an email', async () => {
    firebase.auth = null
    await createTenant()

    await screen.findByText('Brightside Care was created.', { selector: 'p' })
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
