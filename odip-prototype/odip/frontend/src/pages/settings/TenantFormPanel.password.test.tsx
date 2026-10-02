import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TenantFormPanel from './TenantFormPanel'

// The tenant's first user: a typed password is a live credential (the account is verified from the start), so it is held to 12 characters
// and the Generate button draws from Web Crypto. It used to be Math.random().toString(36), which is not a security source.

const { mockCreate, firebase } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  // `auth` is null where Firebase is not configured (local dev auth). A getter, so each test can change it.
  firebase: { auth: null as object | null },
}))

vi.mock('@/api/hooks/admin', () => ({
  useCreateTenantWithSetup: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateTenant: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEnsureUserSignInAccount: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock('@/lib/firebase', () => ({
  get auth() {
    return firebase.auth
  },
}))

beforeEach(() => {
  firebase.auth = { name: 'auth-stub' }
  mockCreate.mockReset().mockResolvedValue({})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function openFirstUser() {
  const u = userEvent.setup()
  render(<TenantFormPanel isOpen onClose={vi.fn()} />)
  await u.type(screen.getByPlaceholderText('e.g. Acme Travel Co'), 'Brightside Care')
  await u.type(screen.getByPlaceholderText('e.g. acme.com.au'), 'brightside.example.com')
  await u.click(screen.getByRole('button', { name: /initial admin user/i }))
  return u
}

const password = () => screen.getByLabelText('Password') as HTMLInputElement
const createButton = () => screen.getByRole('button', { name: 'Create Tenant' })

describe('TenantFormPanel: the first user\'s password', () => {
  it('draws Generate as a Button, so it carries the shared focus ring and the height of the field beside it', async () => {
    await openFirstUser()

    expect(screen.getByRole('button', { name: 'Generate' })).toHaveClass(
      'focus:ring-[var(--color-ring)]', 'h-[var(--control-h)]', 'border', 'bg-[var(--color-card)]',
    )
  })

  it('generates with crypto.getRandomValues (14+ characters), never Math.random', async () => {
    const realCrypto = globalThis.crypto
    const getRandomValues = vi.fn((buffer: Uint32Array) => realCrypto.getRandomValues(buffer))
    vi.stubGlobal('crypto', { getRandomValues })
    const mathRandom = vi.spyOn(Math, 'random')
    const u = await openFirstUser()

    await u.click(screen.getByRole('button', { name: 'Generate' }))

    expect(password().value.length).toBeGreaterThanOrEqual(14)
    expect(getRandomValues).toHaveBeenCalled()
    expect(mathRandom).not.toHaveBeenCalled()
  })

  it('says so, and leaves the field empty, when the browser has no Web Crypto to generate with', async () => {
    vi.stubGlobal('crypto', undefined)
    const u = await openFirstUser()

    await u.click(screen.getByRole('button', { name: 'Generate' }))

    expect(screen.getByText("Couldn't generate a password in this browser. Type one instead.")).toBeInTheDocument()
    expect(password()).toHaveValue('')
  })

  it('will not create with a typed password under 12 characters, and says so', async () => {
    const u = await openFirstUser()

    await u.type(password(), 'abcdefghijk') // 11

    expect(createButton()).toBeDisabled()
    expect(screen.getByText('Use at least 12 characters.')).toBeInTheDocument()
    expect(password()).toHaveAttribute('aria-invalid', 'true')

    await u.type(password(), 'l') // 12

    expect(createButton()).toBeEnabled()
    expect(screen.queryByText('Use at least 12 characters.')).not.toBeInTheDocument()
    expect(screen.getByText('At least 12 characters. Ask them to change it with Forgot password after they first sign in.')).toBeInTheDocument()
    expect(screen.queryByText(/Leave it blank/)).not.toBeInTheDocument()
  })

  it('says, before anything is typed, that leaving it blank means they are emailed a link to set their own', async () => {
    await openFirstUser()

    expect(screen.getByText("Optional. Leave it blank and we'll email them a link to set their own.")).toBeInTheDocument()
    expect(password()).toHaveAttribute('placeholder', 'Min 12 characters')
  })

  it('promises no email where Firebase is not configured (local dev auth)', async () => {
    firebase.auth = null
    await openFirstUser()

    expect(screen.getByText('Optional.')).toBeInTheDocument()
    expect(screen.queryByText(/email them/)).not.toBeInTheDocument()
  })

  it('sends the whole first-user body, with the password as typed, when it is long enough', async () => {
    const u = await openFirstUser()
    await u.type(screen.getByLabelText('First Name'), 'Jane')
    await u.type(screen.getByLabelText('Last Name'), 'Smith')
    await u.type(screen.getByLabelText('Email'), 'jane.smith@brightside.example.com')
    await u.type(screen.getByLabelText('Username'), 'jane.smith')
    await u.type(password(), 'Winter-2026!')

    await u.click(createButton())

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(mockCreate).toHaveBeenCalledWith({
      name: 'Brightside Care',
      emailDomain: 'brightside.example.com',
      providerSettings: null,
      initialUser: {
        firstName: 'Jane', lastName: 'Smith', email: 'jane.smith@brightside.example.com', username: 'jane.smith', role: 'Admin', password: 'Winter-2026!',
      },
    })
  })
})
