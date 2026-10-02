import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UsersTab from './UsersTab'

const { mockUseAdminUsers, mockEnsure, sendPasswordResetEmail, firebase } = vi.hoisted(() => ({
  mockUseAdminUsers: vi.fn(),
  // POST /admin/users/{id}/sign-in-account: makes sure the Firebase account exists and says whether it made it.
  mockEnsure: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  // `auth` is null where Firebase is not configured (local dev auth). A getter, so each test can change it.
  firebase: { auth: null as object | null },
}))

vi.mock('@/api/hooks', () => ({
  useAdminUsers: mockUseAdminUsers,
  useAdminTenantsSummary: () => ({ data: [] }),
  useEnsureUserSignInAccount: () => ({ mutateAsync: mockEnsure }),
}))
vi.mock('firebase/auth', () => ({ sendPasswordResetEmail }))
vi.mock('@/lib/firebase', () => ({
  get auth() {
    return firebase.auth
  },
}))

const authStub = { name: 'auth-stub' }
const SEND = 'Send set-password email'

const user = (i: number, isActive = true) => ({
  id: `u${i}`, firstName: 'User', lastName: `Number${i}`, fullName: `User Number${i}`, email: `u${i}@example.com.au`, username: `u${i}`,
  role: 'Coordinator', tenantId: 't1', tenantName: 'Sample Support Co', isActive, createdAt: '2026-01-01T00:00:00Z', lastLoginAt: null,
})

function renderTab(users: ReturnType<typeof user>[]) {
  mockUseAdminUsers.mockReturnValue({
    data: { items: users, totalCount: users.length, page: 1, pageSize: 20, totalPages: 1, hasNext: false, hasPrevious: false },
    isLoading: false,
  })
  render(<UsersTab onAddUser={vi.fn()} onEditUser={vi.fn()} />)
  return userEvent.setup()
}

/** The "Send set-password email" button in the row that shows `fullName`. */
const rowOf = (fullName: string) => within(screen.getByRole('table')).getByText(fullName).closest('tr')!
const sendIn = (fullName: string) => within(rowOf(fullName)).getByRole('button', { name: SEND })

/** The notices region above the table: one live region, there from the first render. */
const region = () => screen.getByRole('status')

/** Firebase's own errors carry the reason in `code`. */
const firebaseError = (code: string) => Object.assign(new Error(`Firebase: Error (${code}).`), { code })

const sentTo = (n: number, verb = 'set') => `We've sent u${n}@example.com.au a link to ${verb} their password. It can take a few minutes, so ask them to check spam.`

beforeEach(() => {
  firebase.auth = authStub
  mockEnsure.mockReset().mockResolvedValue({ firebaseAccount: 'created' })
  sendPasswordResetEmail.mockReset().mockResolvedValue(undefined)
})

describe('UsersTab: Send set-password email', () => {
  it('makes sure that row\'s user has an account, then asks Firebase to email them a link, and says so in the notices above the table', async () => {
    const u = renderTab([user(1), user(2)])

    await u.click(sendIn('User Number2'))

    expect(await within(region()).findByText(sentTo(2))).toBeInTheDocument()
    expect(within(region()).getByText('User Number2')).toBeInTheDocument()
    expect(mockEnsure).toHaveBeenCalledTimes(1)
    expect(mockEnsure).toHaveBeenCalledWith('u2')
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1)
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(authStub, 'u2@example.com.au')
  })

  it('has its notices region from the first render, empty until something is said', () => {
    renderTab([user(1)])

    expect(region()).toBeEmptyDOMElement()
  })

  it('does not ask Firebase to send until the account has been made sure of', async () => {
    let finishEnsure!: (value: { firebaseAccount: 'created' | 'existing' }) => void
    mockEnsure.mockReturnValue(new Promise(resolve => { finishEnsure = resolve }))
    const u = renderTab([user(1)])

    await u.click(sendIn('User Number1'))

    await waitFor(() => expect(mockEnsure).toHaveBeenCalledTimes(1))
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
    expect(region()).toBeEmptyDOMElement()

    finishEnsure({ firebaseAccount: 'created' })

    await waitFor(() => expect(sendPasswordResetEmail).toHaveBeenCalledWith(authStub, 'u1@example.com.au'))
  })

  it('says "reset" instead of "set" when the account was already there', async () => {
    mockEnsure.mockResolvedValue({ firebaseAccount: 'existing' })
    const u = renderTab([user(1)])

    await u.click(sendIn('User Number1'))

    expect(await within(region()).findByText(sentTo(1, 'reset'))).toBeInTheDocument()
  })

  it('sends nothing, and says why, when the server could not set the account up', async () => {
    mockEnsure.mockRejectedValue({ response: { data: { success: false, errors: ['This user is inactive, so they cannot be given a sign-in account.'] } } })
    const u = renderTab([user(1)])

    await u.click(sendIn('User Number1'))

    expect(await within(region()).findByText('No link was sent to u1@example.com.au. This user is inactive, so they cannot be given a sign-in account.')).toBeInTheDocument()
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
    await waitFor(() => expect(sendIn('User Number1')).toBeEnabled())
  })

  it('says no link was sent, with advice that fits, when Firebase refuses, and a retry then works', async () => {
    sendPasswordResetEmail.mockRejectedValueOnce(firebaseError('auth/too-many-requests'))
    const u = renderTab([user(1)])

    await u.click(sendIn('User Number1'))

    expect(await within(region()).findByText(
      'No link was sent to u1@example.com.au. Firebase is limiting emails for now. Wait a few minutes, then use Send set-password email on their row.',
    )).toBeInTheDocument()
    await waitFor(() => expect(sendIn('User Number1')).toBeEnabled())

    await u.click(sendIn('User Number1'))

    expect(await within(region()).findByText(sentTo(1))).toBeInTheDocument()
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(2)
  })

  it('is switched off while an email is going out, so a second click cannot send another', async () => {
    let finish!: () => void
    sendPasswordResetEmail.mockReturnValue(new Promise<void>(resolve => { finish = resolve }))
    const u = renderTab([user(1), user(2)])

    await u.click(sendIn('User Number1'))

    await waitFor(() => expect(sendIn('User Number1')).toBeDisabled())
    expect(sendIn('User Number1')).toHaveAttribute('aria-busy', 'true')
    expect(sendIn('User Number2')).toBeDisabled()
    await u.click(sendIn('User Number1'))
    expect(mockEnsure).toHaveBeenCalledTimes(1)
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1)
    expect(region()).toBeEmptyDOMElement()

    finish()

    expect(await within(region()).findByText(sentTo(1))).toBeInTheDocument()
    expect(sendIn('User Number1')).toBeEnabled()
    expect(sendIn('User Number2')).toBeEnabled()
  })

  it('is offered for active users only; every user still has Edit', () => {
    renderTab([user(1), user(2, false), user(3)])

    expect(screen.getAllByRole('button', { name: SEND })).toHaveLength(2)
    expect(within(rowOf('User Number2')).queryByRole('button', { name: SEND })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Edit user' })).toHaveLength(3)
  })

  it('is not offered at all, and nothing is left broken, where Firebase is not configured (local dev auth)', () => {
    firebase.auth = null
    renderTab([user(1), user(2)])

    expect(screen.queryByRole('button', { name: SEND })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Edit user' })).toHaveLength(2)
  })
})

describe('UsersTab: the notices above the table', () => {
  it('an error is not replaced by a later success: both stay, until the error is dismissed', async () => {
    sendPasswordResetEmail.mockRejectedValueOnce(firebaseError('auth/network-request-failed'))
    const u = renderTab([user(1), user(2)])

    await u.click(sendIn('User Number1'))
    expect(await within(region()).findByText(/No link was sent to u1@example.com.au/)).toBeInTheDocument()
    await waitFor(() => expect(sendIn('User Number2')).toBeEnabled())

    await u.click(sendIn('User Number2'))

    expect(await within(region()).findByText(sentTo(2))).toBeInTheDocument()
    // The failure for the first person is still there, unacknowledged.
    expect(within(region()).getByText(/No link was sent to u1@example.com.au/)).toBeInTheDocument()

    await u.click(within(region()).getByRole('button', { name: 'Dismiss notice about User Number1' }))

    expect(within(region()).queryByText(/No link was sent to u1@example.com.au/)).not.toBeInTheDocument()
    expect(within(region()).getByText(sentTo(2))).toBeInTheDocument()
  })

  it('holds at most three, newest first, dropping the oldest success', async () => {
    const u = renderTab([user(1), user(2), user(3), user(4)])

    for (const n of [1, 2, 3, 4]) {
      await u.click(sendIn(`User Number${n}`))
      await within(region()).findByText(sentTo(n))
      await waitFor(() => expect(sendIn(`User Number${n}`)).toBeEnabled())
    }

    const titles = within(region()).getAllByText(/^User Number\d$/).map(el => el.textContent)
    expect(titles).toEqual(['User Number4', 'User Number3', 'User Number2'])
    expect(within(region()).queryByText(sentTo(1))).not.toBeInTheDocument()
  })

  it('keeps an old error through three newer successes, because a success never removes one', async () => {
    sendPasswordResetEmail.mockRejectedValueOnce(firebaseError('auth/network-request-failed'))
    const u = renderTab([user(1), user(2), user(3), user(4)])

    await u.click(sendIn('User Number1'))
    await within(region()).findByText(/No link was sent to u1@example.com.au/)
    await waitFor(() => expect(sendIn('User Number1')).toBeEnabled())
    for (const n of [2, 3, 4]) {
      await u.click(sendIn(`User Number${n}`))
      await within(region()).findByText(sentTo(n))
      await waitFor(() => expect(sendIn(`User Number${n}`)).toBeEnabled())
    }

    // Three held: the old error, and the two newest successes. The oldest success made room.
    expect(within(region()).getAllByText(/^User Number\d$/).map(el => el.textContent)).toEqual(['User Number4', 'User Number3', 'User Number1'])
    expect(within(region()).getByText(/No link was sent to u1@example.com.au/)).toBeInTheDocument()
    expect(within(region()).queryByText(sentTo(2))).not.toBeInTheDocument()
  })
})
