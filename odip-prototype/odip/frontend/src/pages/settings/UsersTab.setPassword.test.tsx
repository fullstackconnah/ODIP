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
  const onNotify = vi.fn()
  render(<UsersTab onAddUser={vi.fn()} onEditUser={vi.fn()} onNotify={onNotify} />)
  return { onNotify, u: userEvent.setup() }
}

/** The "Send set-password email" button in the row that shows `fullName`. */
const sendIn = (fullName: string) => within(screen.getByText(fullName).closest('tr')!).getByRole('button', { name: SEND })

/** Firebase's own errors carry the reason in `code`. */
const firebaseError = (code: string) => Object.assign(new Error(`Firebase: Error (${code}).`), { code })

beforeEach(() => {
  firebase.auth = authStub
  mockEnsure.mockReset().mockResolvedValue({ firebaseAccount: 'created' })
  sendPasswordResetEmail.mockReset().mockResolvedValue(undefined)
})

describe('UsersTab: Send set-password email', () => {
  it('makes sure that row\'s user has an account, then asks Firebase to email them a link, and says it was sent', async () => {
    const { u, onNotify } = renderTab([user(1), user(2)])

    await u.click(sendIn('User Number2'))

    await waitFor(() => expect(onNotify).toHaveBeenCalledWith(
      'success', "We've sent u2@example.com.au a link to set their password. It can take a few minutes, so ask them to check spam.",
    ))
    expect(mockEnsure).toHaveBeenCalledTimes(1)
    expect(mockEnsure).toHaveBeenCalledWith('u2')
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1)
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(authStub, 'u2@example.com.au')
    expect(onNotify).toHaveBeenCalledTimes(1)
  })

  it('does not ask Firebase to send until the account has been made sure of', async () => {
    let finishEnsure!: (value: { firebaseAccount: 'created' | 'existing' }) => void
    mockEnsure.mockReturnValue(new Promise(resolve => { finishEnsure = resolve }))
    const { u, onNotify } = renderTab([user(1)])

    await u.click(sendIn('User Number1'))

    await waitFor(() => expect(mockEnsure).toHaveBeenCalledTimes(1))
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
    expect(onNotify).not.toHaveBeenCalled()

    finishEnsure({ firebaseAccount: 'created' })

    await waitFor(() => expect(sendPasswordResetEmail).toHaveBeenCalledWith(authStub, 'u1@example.com.au'))
  })

  it('says "reset" instead of "set" when the account was already there', async () => {
    mockEnsure.mockResolvedValue({ firebaseAccount: 'existing' })
    const { u, onNotify } = renderTab([user(1)])

    await u.click(sendIn('User Number1'))

    await waitFor(() => expect(onNotify).toHaveBeenCalledWith(
      'success', "We've sent u1@example.com.au a link to reset their password. It can take a few minutes, so ask them to check spam.",
    ))
  })

  it('sends nothing, and says why, when the server could not set the account up', async () => {
    mockEnsure.mockRejectedValue({ response: { data: { success: false, errors: ['This user is inactive, so they cannot be given a sign-in account.'] } } })
    const { u, onNotify } = renderTab([user(1)])

    await u.click(sendIn('User Number1'))

    await waitFor(() => expect(onNotify).toHaveBeenCalledWith(
      'error', 'No link was sent to u1@example.com.au. This user is inactive, so they cannot be given a sign-in account.',
    ))
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
    await waitFor(() => expect(sendIn('User Number1')).toBeEnabled())
  })

  it('says no link was sent, with advice that fits, when Firebase refuses, and a retry then works', async () => {
    sendPasswordResetEmail.mockRejectedValueOnce(firebaseError('auth/too-many-requests'))
    const { u, onNotify } = renderTab([user(1)])

    await u.click(sendIn('User Number1'))

    await waitFor(() => expect(onNotify).toHaveBeenCalledWith(
      'error',
      'No link was sent to u1@example.com.au. Firebase is limiting emails for now. Wait a few minutes, then use Send set-password email on their row.',
    ))
    await waitFor(() => expect(sendIn('User Number1')).toBeEnabled())

    await u.click(sendIn('User Number1'))

    await waitFor(() => expect(onNotify).toHaveBeenLastCalledWith('success', expect.stringContaining("We've sent u1@example.com.au a link")))
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(2)
  })

  it('is switched off while an email is going out, so a second click cannot send another', async () => {
    let finish!: () => void
    sendPasswordResetEmail.mockReturnValue(new Promise<void>(resolve => { finish = resolve }))
    const { u, onNotify } = renderTab([user(1), user(2)])

    await u.click(sendIn('User Number1'))

    await waitFor(() => expect(sendIn('User Number1')).toBeDisabled())
    expect(sendIn('User Number1')).toHaveAttribute('aria-busy', 'true')
    expect(sendIn('User Number2')).toBeDisabled()
    await u.click(sendIn('User Number1'))
    expect(mockEnsure).toHaveBeenCalledTimes(1)
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1)
    expect(onNotify).not.toHaveBeenCalled()

    finish()

    await waitFor(() => expect(onNotify).toHaveBeenCalledTimes(1))
    expect(sendIn('User Number1')).toBeEnabled()
    expect(sendIn('User Number2')).toBeEnabled()
  })

  it('is offered for active users only; every user still has Edit', () => {
    renderTab([user(1), user(2, false), user(3)])

    expect(screen.getAllByRole('button', { name: SEND })).toHaveLength(2)
    expect(within(screen.getByText('User Number2').closest('tr')!).queryByRole('button', { name: SEND })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Edit user' })).toHaveLength(3)
  })

  it('is not offered at all, and nothing is left broken, where Firebase is not configured (local dev auth)', () => {
    firebase.auth = null
    renderTab([user(1), user(2)])

    expect(screen.queryByRole('button', { name: SEND })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Edit user' })).toHaveLength(2)
  })

  it('still sends, and does not break, when no onNotify was given to report the result', async () => {
    mockUseAdminUsers.mockReturnValue({
      data: { items: [user(1)], totalCount: 1, page: 1, pageSize: 20, totalPages: 1, hasNext: false, hasPrevious: false },
      isLoading: false,
    })
    const u = userEvent.setup()
    render(<UsersTab onAddUser={vi.fn()} onEditUser={vi.fn()} />)

    await u.click(sendIn('User Number1'))

    await waitFor(() => expect(sendPasswordResetEmail).toHaveBeenCalledWith(authStub, 'u1@example.com.au'))
    await waitFor(() => expect(sendIn('User Number1')).toBeEnabled())
  })
})
