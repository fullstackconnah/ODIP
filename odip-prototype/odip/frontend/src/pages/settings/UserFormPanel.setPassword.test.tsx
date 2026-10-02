import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UserFormPanel from './UserFormPanel'
import type { AdminUserDto } from '@/api/types'

// A create succeeds, the user exists, and the panel STAYS OPEN in a done state that says what became of the sign-in account and the email:
// closing at once would take the answer away with it, and the answer decides what the admin does next (share a password, wait for a link,
// or send one). Done closes. The create response says whether the Firebase account was made here or already existed.

const { mockCreate, mockUpdate, mockEnsure, sendPasswordResetEmail, firebase } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  // POST /admin/users/{id}/sign-in-account: makes sure the Firebase account exists and says whether it made it.
  mockEnsure: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  // `auth` is null where Firebase is not configured (local dev auth). A getter, so each test can change it.
  firebase: { auth: null as object | null },
}))

vi.mock('@/api/hooks', () => ({
  useAdminTenantsSummary: () => ({ data: [{ id: 'tenant-1', name: 'Sample Support Co' }] }),
  useCreateAdminUser: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateAdminUser: () => ({ mutateAsync: mockUpdate, isPending: false }),
  useEnsureUserSignInAccount: () => ({ mutateAsync: mockEnsure }),
}))
vi.mock('firebase/auth', () => ({ sendPasswordResetEmail }))
vi.mock('@/lib/firebase', () => ({
  get auth() {
    return firebase.auth
  },
}))

const authStub = { name: 'auth-stub' }
const EMAIL = 'new.person@example.com'
const SENT_SET = `We've sent ${EMAIL} a link to set their password. It can take a few minutes, so ask them to check spam.`
const SENT_RESET = `We've sent ${EMAIL} a link to reset their password. It can take a few minutes, so ask them to check spam.`
const NOT_SENT = `No link was sent to ${EMAIL}.`

/** Firebase's own errors carry the reason in `code`. */
const firebaseError = (code: string) => Object.assign(new Error(`Firebase: Error (${code}).`), { code })

/** What the create answers: the new user, and whether the Firebase account was made here or already existed. */
const createdUser = (firebaseAccount: 'created' | 'existing' = 'created'): AdminUserDto => ({
  id: 'new-1', firstName: 'New', lastName: 'Person', fullName: 'New Person', email: EMAIL, username: 'newperson', role: 'Coordinator',
  tenantId: 'tenant-1', tenantName: 'Sample Support Co', isActive: true, createdAt: '2026-01-01T00:00:00Z', lastLoginAt: null, firebaseAccount,
})

const existingUser: AdminUserDto = {
  id: 'user-1', firstName: 'Ann', lastName: 'One', fullName: 'Ann One', email: 'ann@example.com', username: 'ann', role: 'Coordinator',
  tenantId: 'tenant-1', tenantName: 'Sample Support Co', isActive: true, createdAt: '2026-01-01T00:00:00Z', lastLoginAt: null,
}

beforeEach(() => {
  firebase.auth = authStub
  mockCreate.mockReset().mockResolvedValue(createdUser())
  mockUpdate.mockReset().mockResolvedValue(undefined)
  mockEnsure.mockReset().mockResolvedValue({ firebaseAccount: 'existing' })
  sendPasswordResetEmail.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function renderCreate() {
  const onClose = vi.fn()
  render(<UserFormPanel isOpen onClose={onClose} defaultTenantId="tenant-1" />)
  return { onClose, u: userEvent.setup() }
}

async function fillRequiredFields(u: ReturnType<typeof userEvent.setup>) {
  await u.type(screen.getByLabelText(/first name/i), 'New')
  await u.type(screen.getByLabelText(/last name/i), 'Person')
  await u.type(screen.getByLabelText(/^email/i), EMAIL)
  await u.type(screen.getByLabelText(/username/i), 'newperson')
  await u.click(screen.getByRole('button', { name: 'Role *' }))
  await u.click(await screen.findByRole('option', { name: 'Coordinator' }))
}

const createButton = () => screen.getByRole('button', { name: 'Create User' })
const disclosure = () => screen.getByRole('button', { name: 'Set a temporary password instead' })
const doneButton = () => screen.getByRole('button', { name: 'Done' })

/** The whole body the API validates, with the password the test expects (none by default). */
const createBody = (password?: string) => ({
  tenantId: 'tenant-1', firstName: 'New', lastName: 'Person', email: EMAIL, username: 'newperson', role: 'Coordinator', password,
})

describe('UserFormPanel create: the emailed set-password link', () => {
  it('sends no password, and only once the create has succeeded emails the new user a link, then stays open to say so', async () => {
    const { u, onClose } = renderCreate()
    let finishCreate!: (user: AdminUserDto) => void
    mockCreate.mockReturnValue(new Promise<AdminUserDto>(resolve => { finishCreate = resolve }))
    await fillRequiredFields(u)

    await u.click(createButton())

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(mockCreate.mock.calls[0][0]).toEqual(createBody())
    expect(mockCreate.mock.calls[0][0].password).toBeUndefined()
    // The email is for an account that exists: nothing goes out while the create is still in flight.
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()

    finishCreate(createdUser())

    expect(await screen.findByText(SENT_SET)).toBeInTheDocument()
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1)
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(authStub, EMAIL)
    expect(screen.getByRole('dialog', { name: 'User created' })).toBeInTheDocument()
    expect(screen.getByText('New Person was created.')).toBeInTheDocument()
    // It stays: the answer is not taken away by a close. Done closes.
    expect(onClose).not.toHaveBeenCalled()

    await u.click(doneButton())

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('says "reset" instead of "set" when the create found a sign-in account that was already there', async () => {
    mockCreate.mockResolvedValue(createdUser('existing'))
    const { u } = renderCreate()
    await fillRequiredFields(u)

    await u.click(createButton())

    expect(await screen.findByText(SENT_RESET)).toBeInTheDocument()
  })

  it('says no link was sent, names the address, and offers Send again right there, when Firebase refuses', async () => {
    sendPasswordResetEmail.mockRejectedValueOnce(firebaseError('auth/too-many-requests'))
    const { u, onClose } = renderCreate()
    await fillRequiredFields(u)

    await u.click(createButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(`${NOT_SENT} Firebase is limiting emails for now. Wait a few minutes, then use Send again.`)
    expect(screen.queryByText(/We've sent/)).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    await u.click(within(alert).getByRole('button', { name: 'Send again' }))

    expect(await screen.findByText(SENT_SET)).toBeInTheDocument()
    // The user exists, so sending again must not create them again.
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(2)
  })

  it('says where to retry, and never claims a link went, when Firebase fails for a reason it has no special advice for', async () => {
    sendPasswordResetEmail.mockRejectedValue(new Error('boom'))
    const { u } = renderCreate()
    await fillRequiredFields(u)

    await u.click(createButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(`${NOT_SENT} To try again, use Send again.`)
    expect(alert.textContent).not.toMatch(/we've sent|in a moment/i)
  })

  it('shows who will be emailed while the default is in force, and not once a temporary password replaces it', async () => {
    const { u } = renderCreate()
    expect(screen.getByText("We'll email the user a link to set their password.")).toBeInTheDocument()

    await u.type(screen.getByLabelText(/^email/i), EMAIL)
    expect(screen.getByText(`We'll email ${EMAIL} a link to set their password.`)).toBeInTheDocument()

    await u.click(disclosure())
    expect(screen.queryByText(/We'll email/)).not.toBeInTheDocument()
  })

  it('a rejected create shows the error, keeps what was typed, stays on the form, and emails nothing', async () => {
    mockCreate.mockRejectedValue({ response: { data: { message: 'A user with this email already exists' } } })
    const { u, onClose } = renderCreate()
    await fillRequiredFields(u)

    await u.click(createButton())

    expect(await screen.findByText('A user with this email already exists')).toBeInTheDocument()
    expect(screen.getByLabelText(/first name/i)).toHaveValue('New')
    expect(screen.getByLabelText(/last name/i)).toHaveValue('Person')
    expect(screen.getByLabelText(/^email/i)).toHaveValue(EMAIL)
    expect(screen.getByLabelText(/username/i)).toHaveValue('newperson')
    expect(screen.getByRole('dialog', { name: 'New User' })).toBeInTheDocument()
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('without Firebase (local dev auth) sends no email, says nothing about one, and still says the user was created', async () => {
    firebase.auth = null
    const { u } = renderCreate()
    expect(screen.queryByText(/We'll email/)).not.toBeInTheDocument()
    await fillRequiredFields(u)

    await u.click(createButton())

    expect(await screen.findByText('New Person was created.')).toBeInTheDocument()
    expect(mockCreate.mock.calls[0][0]).toEqual(createBody())
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/email/i)).not.toBeInTheDocument()
  })
})

describe('UserFormPanel create: a temporary password instead', () => {
  it('is closed by default, and closing it again drops what was typed so it is not sent', async () => {
    const { u } = renderCreate()
    expect(disclosure()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByLabelText('Temporary password')).not.toBeInTheDocument()

    await u.click(disclosure())
    expect(disclosure()).toHaveAttribute('aria-expanded', 'true')
    await u.type(screen.getByLabelText('Temporary password'), 'hunter22hunter22')
    await u.click(disclosure())
    expect(screen.queryByLabelText('Temporary password')).not.toBeInTheDocument()

    await fillRequiredFields(u)
    await u.click(createButton())

    expect(await screen.findByText(SENT_SET)).toBeInTheDocument()
    expect(mockCreate.mock.calls[0][0]).toEqual(createBody())
    expect(mockCreate.mock.calls[0][0].password).toBeUndefined()
  })

  it('generates with crypto.getRandomValues (14+ characters, never Math.random), sends it with the create, and emails nothing', async () => {
    const realCrypto = globalThis.crypto
    const getRandomValues = vi.fn((buffer: Uint32Array) => realCrypto.getRandomValues(buffer))
    vi.stubGlobal('crypto', { getRandomValues })
    const mathRandom = vi.spyOn(Math, 'random')
    const { u, onClose } = renderCreate()
    await fillRequiredFields(u)

    await u.click(disclosure())
    await u.click(screen.getByRole('button', { name: 'Generate' }))

    const password = (screen.getByLabelText('Temporary password') as HTMLInputElement).value
    expect(password.length).toBeGreaterThanOrEqual(14)
    expect(getRandomValues).toHaveBeenCalled()
    expect(mathRandom).not.toHaveBeenCalled()

    await u.click(createButton())

    expect(await screen.findByText(
      'New Person can sign in now with the temporary password you set. Share it with them securely, and ask them to change it with Forgot password after they first sign in.',
    )).toBeInTheDocument()
    expect(mockCreate.mock.calls[0][0]).toEqual(createBody(password))
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('sends a password typed by hand the same way, with no email, even when Firebase is configured', async () => {
    const { u } = renderCreate()
    await fillRequiredFields(u)

    await u.click(disclosure())
    await u.type(screen.getByLabelText('Temporary password'), 'Winter-2026!')
    await u.click(createButton())

    expect(await screen.findByText(/can sign in now with the temporary password you set/)).toBeInTheDocument()
    expect(mockCreate.mock.calls[0][0]).toEqual(createBody('Winter-2026!'))
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
  })

  it('will not create with a password under 12 characters, and says so (a typed password is a live credential: the account is verified)', async () => {
    const { u } = renderCreate()
    await fillRequiredFields(u)

    await u.click(disclosure())
    await u.type(screen.getByLabelText('Temporary password'), 'abcdefghijk') // 11
    expect(createButton()).toBeDisabled()
    expect(screen.getByText('Use at least 12 characters.')).toBeInTheDocument()
    expect(screen.getByLabelText('Temporary password')).toHaveAttribute('aria-invalid', 'true')

    await u.type(screen.getByLabelText('Temporary password'), 'l') // 12
    expect(createButton()).toBeEnabled()
    expect(screen.queryByText('Use at least 12 characters.')).not.toBeInTheDocument()
  })

  it('tells the admin the minimum and what to ask the person to do once they have signed in', async () => {
    const { u } = renderCreate()

    await u.click(disclosure())

    expect(screen.getByText('At least 12 characters. Ask them to change it with Forgot password after they first sign in.')).toBeInTheDocument()
    expect(screen.getByLabelText('Temporary password')).toHaveAttribute('placeholder', 'Min 12 characters')
  })

  it('says so, and leaves the field empty, when the browser has no Web Crypto to generate with', async () => {
    vi.stubGlobal('crypto', undefined)
    const { u } = renderCreate()

    await u.click(disclosure())
    await u.click(screen.getByRole('button', { name: 'Generate' }))

    expect(screen.getByText("Couldn't generate a password in this browser. Type one instead.")).toBeInTheDocument()
    expect(screen.getByLabelText('Temporary password')).toHaveValue('')
  })

  describe('when the sign-in account already existed', () => {
    async function createWithPasswordOnAnExistingAccount() {
      mockCreate.mockResolvedValue(createdUser('existing'))
      const view = renderCreate()
      await fillRequiredFields(view.u)
      await view.u.click(disclosure())
      await view.u.type(screen.getByLabelText('Temporary password'), 'Winter-2026!')
      await view.u.click(createButton())
      return view
    }

    it('says the password was NOT applied, instead of claiming they can sign in with it, and sends nothing yet', async () => {
      await createWithPasswordOnAnExistingAccount()

      const warning = await screen.findByRole('alert')
      expect(warning).toHaveTextContent(`${EMAIL} already had a sign-in account, so the password you set wasn't applied.`)
      expect(screen.queryByText(/can sign in now/)).not.toBeInTheDocument()
      expect(sendPasswordResetEmail).not.toHaveBeenCalled()
    })

    it('offers Send set-password email right there: the server makes sure of the account, then Firebase sends, worded "reset"', async () => {
      const { u } = await createWithPasswordOnAnExistingAccount()

      await u.click(await screen.findByRole('button', { name: 'Send set-password email' }))

      expect(await screen.findByText(SENT_RESET)).toBeInTheDocument()
      expect(mockEnsure).toHaveBeenCalledTimes(1)
      expect(mockEnsure).toHaveBeenCalledWith('new-1')
      expect(sendPasswordResetEmail).toHaveBeenCalledWith(authStub, EMAIL)
    })

    it('does not offer to send where Firebase is not configured', async () => {
      firebase.auth = null
      await createWithPasswordOnAnExistingAccount()

      expect(await screen.findByRole('alert')).toHaveTextContent("so the password you set wasn't applied.")
      expect(screen.queryByRole('button', { name: 'Send set-password email' })).not.toBeInTheDocument()
    })
  })
})

describe('UserFormPanel edit', () => {
  it('has no password section, emails nothing and has no done state: a saved edit just closes', async () => {
    const onClose = vi.fn()
    const u = userEvent.setup()
    render(<UserFormPanel isOpen onClose={onClose} user={existingUser} />)
    expect(screen.queryByRole('button', { name: 'Set a temporary password instead' })).not.toBeInTheDocument()
    expect(screen.queryByText(/We'll email/)).not.toBeInTheDocument()

    await u.type(screen.getByLabelText(/first name/i), 'ie')
    await u.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(mockUpdate).toHaveBeenCalledWith({
      id: 'user-1',
      data: { firstName: 'Annie', lastName: 'One', email: 'ann@example.com', username: 'ann', role: 'Coordinator', isActive: true },
    })
    expect(mockCreate).not.toHaveBeenCalled()
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
  })

  it('a rejected save shows the error and keeps the edit, and does not close', async () => {
    mockUpdate.mockRejectedValue({ response: { data: { errors: ['A user with this username already exists'] } } })
    const onClose = vi.fn()
    const u = userEvent.setup()
    render(<UserFormPanel isOpen onClose={onClose} user={existingUser} />)

    await u.type(screen.getByLabelText(/first name/i), 'ie')
    await u.click(screen.getByRole('button', { name: 'Save Changes' }))

    expect(await screen.findByText('A user with this username already exists')).toBeInTheDocument()
    expect(screen.getByLabelText(/first name/i)).toHaveValue('Annie')
    expect(onClose).not.toHaveBeenCalled()
  })
})
