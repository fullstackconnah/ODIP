import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UserFormPanel from './UserFormPanel'
import type { AdminUserDto } from '@/api/types'

const { mockCreate, mockUpdate, sendPasswordResetEmail, firebase } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  // `auth` is null where Firebase is not configured (local dev auth). A getter, so each test can change it.
  firebase: { auth: null as object | null },
}))

vi.mock('@/api/hooks', () => ({
  useAdminTenantsSummary: () => ({ data: [{ id: 'tenant-1', name: 'Sample Support Co' }] }),
  useCreateAdminUser: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateAdminUser: () => ({ mutateAsync: mockUpdate, isPending: false }),
}))
vi.mock('firebase/auth', () => ({ sendPasswordResetEmail }))
vi.mock('@/lib/firebase', () => ({
  get auth() {
    return firebase.auth
  },
}))

const authStub = { name: 'auth-stub' }
const EMAIL = 'new.person@example.com'
const SUCCESS = `User created. We've emailed ${EMAIL} a link to set their password (check spam if it doesn't arrive).`
const EMAIL_FAILED = "User created, but the set-password email couldn't be sent. Use 'Send set-password email' to try again."

const existingUser: AdminUserDto = {
  id: 'user-1', firstName: 'Ann', lastName: 'One', fullName: 'Ann One', email: 'ann@example.com', username: 'ann', role: 'Coordinator',
  tenantId: 'tenant-1', tenantName: 'Sample Support Co', isActive: true, createdAt: '2026-01-01T00:00:00Z', lastLoginAt: null,
}

beforeEach(() => {
  firebase.auth = authStub
  mockCreate.mockReset().mockResolvedValue(undefined)
  mockUpdate.mockReset().mockResolvedValue(undefined)
  sendPasswordResetEmail.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function renderCreate() {
  const onClose = vi.fn()
  const onNotify = vi.fn()
  render(<UserFormPanel isOpen onClose={onClose} defaultTenantId="tenant-1" onNotify={onNotify} />)
  return { onClose, onNotify, u: userEvent.setup() }
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

/** The whole body the API validates, with the password the test expects (none by default). */
const createBody = (password?: string) => ({
  tenantId: 'tenant-1', firstName: 'New', lastName: 'Person', email: EMAIL, username: 'newperson', role: 'Coordinator', password,
})

describe('UserFormPanel create: the emailed set-password link', () => {
  it('sends no password, and only once the create has succeeded emails the new user a link to set one', async () => {
    const { u, onClose, onNotify } = renderCreate()
    let finishCreate!: () => void
    mockCreate.mockReturnValue(new Promise<void>(resolve => { finishCreate = resolve }))
    await fillRequiredFields(u)

    await u.click(createButton())

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(mockCreate.mock.calls[0][0]).toEqual(createBody())
    expect(mockCreate.mock.calls[0][0].password).toBeUndefined()
    // The email is for an account that exists: nothing goes out while the create is still in flight.
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
    expect(onNotify).not.toHaveBeenCalled()

    finishCreate()

    await waitFor(() => expect(sendPasswordResetEmail).toHaveBeenCalledWith(authStub, EMAIL))
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('success', SUCCESS))
    expect(onNotify).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('still closes, and says the email failed and how to resend it, when Firebase cannot send it', async () => {
    sendPasswordResetEmail.mockRejectedValue(new Error('auth/network-request-failed'))
    const { u, onClose, onNotify } = renderCreate()
    await fillRequiredFields(u)

    await u.click(createButton())

    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', EMAIL_FAILED))
    expect(onNotify).toHaveBeenCalledTimes(1)
    // The user exists, so this is not "Failed to save user", and creating again would only be refused as a duplicate.
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows who will be emailed while the default is in force, and not once a temporary password replaces it', async () => {
    const { u } = renderCreate()
    expect(screen.getByText("We'll email the user a link to set their password.")).toBeInTheDocument()

    await u.type(screen.getByLabelText(/^email/i), EMAIL)
    expect(screen.getByText(`We'll email ${EMAIL} a link to set their password.`)).toBeInTheDocument()

    await u.click(disclosure())
    expect(screen.queryByText(/We'll email/)).not.toBeInTheDocument()
  })

  it('a rejected create shows the error, keeps what was typed, and emails and announces nothing', async () => {
    mockCreate.mockRejectedValue({ response: { data: { message: 'A user with this email already exists' } } })
    const { u, onClose, onNotify } = renderCreate()
    await fillRequiredFields(u)

    await u.click(createButton())

    expect(await screen.findByText('A user with this email already exists')).toBeInTheDocument()
    expect(screen.getByLabelText(/first name/i)).toHaveValue('New')
    expect(screen.getByLabelText(/last name/i)).toHaveValue('Person')
    expect(screen.getByLabelText(/^email/i)).toHaveValue(EMAIL)
    expect(screen.getByLabelText(/username/i)).toHaveValue('newperson')
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
    expect(onNotify).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('without Firebase (local dev auth) sends no email, says nothing about one, and still creates the user', async () => {
    firebase.auth = null
    const { u, onClose, onNotify } = renderCreate()
    expect(screen.queryByText(/We'll email/)).not.toBeInTheDocument()
    await fillRequiredFields(u)

    await u.click(createButton())

    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('success', 'User created.'))
    expect(mockCreate.mock.calls[0][0]).toEqual(createBody())
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('UserFormPanel create: a temporary password instead', () => {
  it('is closed by default, and closing it again drops what was typed so it is not sent', async () => {
    const { u, onNotify } = renderCreate()
    expect(disclosure()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByLabelText('Temporary password')).not.toBeInTheDocument()

    await u.click(disclosure())
    expect(disclosure()).toHaveAttribute('aria-expanded', 'true')
    await u.type(screen.getByLabelText('Temporary password'), 'hunter22')
    await u.click(disclosure())
    expect(screen.queryByLabelText('Temporary password')).not.toBeInTheDocument()

    await fillRequiredFields(u)
    await u.click(createButton())

    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('success', SUCCESS))
    expect(mockCreate.mock.calls[0][0]).toEqual(createBody())
    expect(mockCreate.mock.calls[0][0].password).toBeUndefined()
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(authStub, EMAIL)
  })

  it('generates with crypto.getRandomValues (14+ characters, never Math.random), sends it with the create, and emails nothing', async () => {
    const realCrypto = globalThis.crypto
    const getRandomValues = vi.fn((buffer: Uint32Array) => realCrypto.getRandomValues(buffer))
    vi.stubGlobal('crypto', { getRandomValues })
    const mathRandom = vi.spyOn(Math, 'random')
    const { u, onClose, onNotify } = renderCreate()
    await fillRequiredFields(u)

    await u.click(disclosure())
    await u.click(screen.getByRole('button', { name: 'Generate' }))

    const password = (screen.getByLabelText('Temporary password') as HTMLInputElement).value
    expect(password.length).toBeGreaterThanOrEqual(14)
    expect(getRandomValues).toHaveBeenCalled()
    expect(mathRandom).not.toHaveBeenCalled()

    await u.click(createButton())

    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('success', 'User created with a temporary password.'))
    expect(mockCreate.mock.calls[0][0]).toEqual(createBody(password))
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
    expect(onNotify).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('sends a password typed by hand the same way, with no email, even when Firebase is configured', async () => {
    const { u, onNotify } = renderCreate()
    await fillRequiredFields(u)

    await u.click(disclosure())
    await u.type(screen.getByLabelText('Temporary password'), 'Winter-2026')
    await u.click(createButton())

    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('success', 'User created with a temporary password.'))
    expect(mockCreate.mock.calls[0][0]).toEqual(createBody('Winter-2026'))
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
  })

  it('will not create with a password under the 6 characters Firebase needs, and says so', async () => {
    const { u } = renderCreate()
    await fillRequiredFields(u)

    await u.click(disclosure())
    await u.type(screen.getByLabelText('Temporary password'), 'abcde')
    expect(createButton()).toBeDisabled()
    expect(screen.getByText('Use at least 6 characters.')).toBeInTheDocument()

    await u.type(screen.getByLabelText('Temporary password'), 'f')
    expect(createButton()).toBeEnabled()
    expect(screen.queryByText('Use at least 6 characters.')).not.toBeInTheDocument()
  })

  it('says so, and leaves the field empty, when the browser has no Web Crypto to generate with', async () => {
    vi.stubGlobal('crypto', undefined)
    const { u } = renderCreate()

    await u.click(disclosure())
    await u.click(screen.getByRole('button', { name: 'Generate' }))

    expect(screen.getByText("Couldn't generate a password in this browser. Type one instead.")).toBeInTheDocument()
    expect(screen.getByLabelText('Temporary password')).toHaveValue('')
  })
})

describe('UserFormPanel edit', () => {
  it('has no password section, emails nothing and announces nothing: a saved edit just closes', async () => {
    const onClose = vi.fn()
    const onNotify = vi.fn()
    const u = userEvent.setup()
    render(<UserFormPanel isOpen onClose={onClose} user={existingUser} onNotify={onNotify} />)
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
    expect(onNotify).not.toHaveBeenCalled()
  })

  it('a rejected save shows the error and keeps the edit, and does not close', async () => {
    mockUpdate.mockRejectedValue({ response: { data: { errors: ['A user with this username already exists'] } } })
    const onClose = vi.fn()
    const u = userEvent.setup()
    render(<UserFormPanel isOpen onClose={onClose} user={existingUser} onNotify={vi.fn()} />)

    await u.type(screen.getByLabelText(/first name/i), 'ie')
    await u.click(screen.getByRole('button', { name: 'Save Changes' }))

    expect(await screen.findByText('A user with this username already exists')).toBeInTheDocument()
    expect(screen.getByLabelText(/first name/i)).toHaveValue('Annie')
    expect(onClose).not.toHaveBeenCalled()
  })
})
