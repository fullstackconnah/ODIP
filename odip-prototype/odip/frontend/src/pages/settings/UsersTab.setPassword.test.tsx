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
// The row action says what it will do to whom. Someone who has never signed in is being given a first password ("set"); anyone who
// has is getting a reset. Every row has its own button, so the person's name is part of the name.
const SET = (fullName: string) => `Send set-password email to ${fullName}`
const RESET = (fullName: string) => `Send password reset email to ${fullName}`
const ANY_SEND = /^Send (set-password|password reset) email to /
const EDIT_ANY = /^Edit User Number\d$/

const user = (i: number, isActive = true, lastLoginAt: string | null = null) => ({
  id: `u${i}`, firstName: 'User', lastName: `Number${i}`, fullName: `User Number${i}`, email: `u${i}@example.com.au`, username: `u${i}`,
  role: 'Coordinator', tenantId: 't1', tenantName: 'Sample Support Co', isActive, createdAt: '2026-01-01T00:00:00Z', lastLoginAt,
})

function renderTab(users: ReturnType<typeof user>[]) {
  mockUseAdminUsers.mockReturnValue({
    data: { items: users, totalCount: users.length, page: 1, pageSize: 20, totalPages: 1, hasNext: false, hasPrevious: false },
    isLoading: false,
  })
  render(<UsersTab onAddUser={vi.fn()} onEditUser={vi.fn()} />)
  return userEvent.setup()
}

/** The send button in the row that shows `fullName`, whichever wording it carries. */
const rowOf = (fullName: string) => within(screen.getByRole('table')).getByText(fullName).closest('tr')!
const sendIn = (fullName: string) => within(rowOf(fullName)).getByRole('button', { name: ANY_SEND })

/** A send is under way: every send button says so with aria-disabled (never `disabled`, which can drop keyboard focus). */
const isBusy = (button: HTMLElement) => button.getAttribute('aria-disabled') === 'true'

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
    await waitFor(() => expect(isBusy(sendIn('User Number1'))).toBe(false))
  })

  it('says no link was sent, with advice that fits, when Firebase refuses, and a retry then works', async () => {
    sendPasswordResetEmail.mockRejectedValueOnce(firebaseError('auth/too-many-requests'))
    const u = renderTab([user(1)])

    await u.click(sendIn('User Number1'))

    expect(await within(region()).findByText(
      'No link was sent to u1@example.com.au. Firebase is limiting emails for now. Wait a few minutes, then use Send set-password email on their row.',
    )).toBeInTheDocument()
    await waitFor(() => expect(isBusy(sendIn('User Number1'))).toBe(false))

    await u.click(sendIn('User Number1'))

    expect(await within(region()).findByText(sentTo(1))).toBeInTheDocument()
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(2)
  })

  it('is switched off while an email is going out, so a second click cannot send another', async () => {
    let finish!: () => void
    sendPasswordResetEmail.mockReturnValue(new Promise<void>(resolve => { finish = resolve }))
    const u = renderTab([user(1), user(2)])

    await u.click(sendIn('User Number1'))

    await waitFor(() => expect(isBusy(sendIn('User Number1'))).toBe(true))
    expect(sendIn('User Number1')).toHaveAttribute('aria-busy', 'true')
    expect(isBusy(sendIn('User Number2'))).toBe(true)
    expect(sendIn('User Number2')).not.toHaveAttribute('aria-busy')
    // The click still arrives (aria-disabled does not stop events), so it is the guard in the handler that holds it back.
    await u.click(sendIn('User Number1'))
    await u.click(sendIn('User Number2'))
    expect(mockEnsure).toHaveBeenCalledTimes(1)
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1)
    expect(region()).toBeEmptyDOMElement()

    finish()

    expect(await within(region()).findByText(sentTo(1))).toBeInTheDocument()
    expect(isBusy(sendIn('User Number1'))).toBe(false)
    expect(isBusy(sendIn('User Number2'))).toBe(false)
    expect(sendIn('User Number1')).not.toHaveAttribute('aria-busy')
  })

  it('is switched off with aria-disabled, not `disabled`, so the button that was clicked keeps keyboard focus while it sends', async () => {
    sendPasswordResetEmail.mockReturnValue(new Promise<void>(() => {}))
    const u = renderTab([user(1), user(2)])

    await u.click(sendIn('User Number1'))

    await waitFor(() => expect(isBusy(sendIn('User Number1'))).toBe(true))
    for (const name of ['User Number1', 'User Number2']) {
      expect(sendIn(name)).not.toBeDisabled()
      expect(sendIn(name)).toHaveClass('aria-disabled:opacity-50', 'aria-disabled:cursor-not-allowed')
    }
    expect(sendIn('User Number1')).toHaveFocus()
  })

  it('is labelled with the person it will email, and by their history: "set" for someone who has never signed in, "reset" for someone who has', () => {
    renderTab([user(1), user(2, true, '2026-09-01T00:00:00Z')])

    const first = within(rowOf('User Number1')).getByRole('button', { name: SET('User Number1') })
    const second = within(rowOf('User Number2')).getByRole('button', { name: RESET('User Number2') })
    // An icon-only control: the same words are its tooltip, so a mouse user is told what it does too.
    expect(first).toHaveAttribute('title', SET('User Number1'))
    expect(second).toHaveAttribute('title', RESET('User Number2'))
    expect(within(rowOf('User Number1')).queryByRole('button', { name: /password reset email/ })).not.toBeInTheDocument()
    expect(within(rowOf('User Number2')).queryByRole('button', { name: /set-password email/ })).not.toBeInTheDocument()
  })

  it('points a failure at the button that row really has: "Send password reset email" for someone who has signed in', async () => {
    sendPasswordResetEmail.mockRejectedValueOnce(firebaseError('auth/too-many-requests'))
    const u = renderTab([user(1, true, '2026-09-01T00:00:00Z')])

    await u.click(sendIn('User Number1'))

    expect(await within(region()).findByText(
      'No link was sent to u1@example.com.au. Firebase is limiting emails for now. Wait a few minutes, then use Send password reset email on their row.',
    )).toBeInTheDocument()
  })

  it('puts the row actions in a RowActions cluster, as icon-only ghost Buttons: shown on row hover or focus, 24px squares with a touch-sized hit area', () => {
    renderTab([user(1)])

    const row = rowOf('User Number1')
    const send = within(row).getByRole('button', { name: SET('User Number1') })
    const edit = within(row).getByRole('button', { name: 'Edit User Number1' })

    for (const button of [send, edit]) {
      // Button, iconOnly: the --control-h-sm square with its 44px tap area, and the shared focus ring.
      expect(button).toHaveClass('w-[var(--control-h-sm)]', 'h-[var(--control-h-sm)]', 'before:min-h-[var(--tap-min)]', 'focus:ring-[var(--color-ring)]')
      // Button, ghost: muted at rest, accent wash on hover.
      expect(button).toHaveClass('hover:bg-[var(--color-accent)]')
      // RowActions: opacity-only reveal keyed to the row, with the touch gap.
      expect(button.parentElement).toHaveClass('group-hover/row:opacity-100', 'pointer-coarse:gap-2')
    }
    // Both live in the same cluster, so they share its spacing instead of each hand-rolling a gap.
    expect(send.parentElement).toBe(edit.parentElement)
  })

  it('names the person on every Edit button, as it does on the send button: a table of identical "Edit user" buttons says nothing', () => {
    renderTab([user(1), user(2)])

    for (const name of ['User Number1', 'User Number2']) {
      const edit = within(rowOf(name)).getByRole('button', { name: `Edit ${name}` })
      expect(edit).toHaveAttribute('title', `Edit ${name}`)
    }
    expect(screen.queryByRole('button', { name: 'Edit user' })).not.toBeInTheDocument()
  })

  it('is offered for active users only; every user still has Edit', () => {
    renderTab([user(1), user(2, false), user(3)])

    expect(screen.getAllByRole('button', { name: ANY_SEND })).toHaveLength(2)
    expect(within(rowOf('User Number2')).queryByRole('button', { name: ANY_SEND })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: EDIT_ANY })).toHaveLength(3)
  })

  it('is not offered at all, and nothing is left broken, where Firebase is not configured (local dev auth)', () => {
    firebase.auth = null
    renderTab([user(1), user(2)])

    expect(screen.queryByRole('button', { name: ANY_SEND })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: EDIT_ANY })).toHaveLength(2)
  })
})

describe('UsersTab: the notices above the table', () => {
  it('an error is not replaced by a later success: both stay, until the error is dismissed', async () => {
    sendPasswordResetEmail.mockRejectedValueOnce(firebaseError('auth/network-request-failed'))
    const u = renderTab([user(1), user(2)])

    await u.click(sendIn('User Number1'))
    expect(await within(region()).findByText(/No link was sent to u1@example.com.au/)).toBeInTheDocument()
    await waitFor(() => expect(isBusy(sendIn('User Number2'))).toBe(false))

    await u.click(sendIn('User Number2'))

    expect(await within(region()).findByText(sentTo(2))).toBeInTheDocument()
    // The failure for the first person is still there, unacknowledged.
    expect(within(region()).getByText(/No link was sent to u1@example.com.au/)).toBeInTheDocument()

    await u.click(within(region()).getByRole('button', { name: 'Dismiss notice about User Number1' }))

    expect(within(region()).queryByText(/No link was sent to u1@example.com.au/)).not.toBeInTheDocument()
    expect(within(region()).getByText(sentTo(2))).toBeInTheDocument()
  })

  it('after the only notice is dismissed, focus goes back to the send button of the person it was about, not to the top of the page', async () => {
    sendPasswordResetEmail.mockRejectedValueOnce(firebaseError('auth/network-request-failed'))
    const u = renderTab([user(1), user(2)])
    await u.click(sendIn('User Number2'))
    const dismiss = await within(region()).findByRole('button', { name: 'Dismiss notice about User Number2' })

    await u.click(dismiss)

    expect(within(region()).queryByText(/No link was sent/)).not.toBeInTheDocument()
    expect(sendIn('User Number2')).toHaveFocus()
  })

  it('with several notices, dismissing one moves focus to the Dismiss button of the next one', async () => {
    sendPasswordResetEmail.mockRejectedValue(firebaseError('auth/network-request-failed'))
    const u = renderTab([user(1), user(2)])
    await u.click(sendIn('User Number1'))
    await within(region()).findByText(/No link was sent to u1@example.com.au/)
    await waitFor(() => expect(isBusy(sendIn('User Number1'))).toBe(false))
    await u.click(sendIn('User Number2'))
    await within(region()).findByText(/No link was sent to u2@example.com.au/)

    // Newest first: Number2 above Number1. Dismissing the first hands focus to the second's Dismiss button.
    await u.click(within(region()).getByRole('button', { name: 'Dismiss notice about User Number2' }))

    expect(within(region()).getByRole('button', { name: 'Dismiss notice about User Number1' })).toHaveFocus()
  })

  it('holds at most three, newest first, dropping the oldest success', async () => {
    const u = renderTab([user(1), user(2), user(3), user(4)])

    for (const n of [1, 2, 3, 4]) {
      await u.click(sendIn(`User Number${n}`))
      await within(region()).findByText(sentTo(n))
      await waitFor(() => expect(isBusy(sendIn(`User Number${n}`))).toBe(false))
    }

    const titles = within(region()).getAllByText(/^User Number\d$/).map(el => el.textContent)
    expect(titles).toEqual(['User Number4', 'User Number3', 'User Number2'])
    expect(within(region()).queryByText(sentTo(1))).not.toBeInTheDocument()
  })

  it('keeps an old error through three newer successes, because the cap counts successes only', async () => {
    sendPasswordResetEmail.mockRejectedValueOnce(firebaseError('auth/network-request-failed'))
    const u = renderTab([user(1), user(2), user(3), user(4)])

    await u.click(sendIn('User Number1'))
    await within(region()).findByText(/No link was sent to u1@example.com.au/)
    await waitFor(() => expect(isBusy(sendIn('User Number1'))).toBe(false))
    for (const n of [2, 3, 4]) {
      await u.click(sendIn(`User Number${n}`))
      await within(region()).findByText(sentTo(n))
      await waitFor(() => expect(isBusy(sendIn(`User Number${n}`))).toBe(false))
    }

    // The old error, and the three newest successes: nothing was removed to make room, because errors are not counted against the cap.
    expect(within(region()).getAllByText(/^User Number\d$/).map(el => el.textContent)).toEqual(['User Number4', 'User Number3', 'User Number2', 'User Number1'])
    expect(within(region()).getByText(/No link was sent to u1@example.com.au/)).toBeInTheDocument()
  })

  it("replaces a person's earlier failure when a retry for them works, and leaves everyone else's failure alone", async () => {
    sendPasswordResetEmail.mockRejectedValueOnce(firebaseError('auth/network-request-failed')).mockRejectedValueOnce(firebaseError('auth/network-request-failed'))
    const u = renderTab([user(1), user(2)])
    await u.click(sendIn('User Number1'))
    await within(region()).findByText(/No link was sent to u1@example.com.au/)
    await waitFor(() => expect(isBusy(sendIn('User Number1'))).toBe(false))
    await u.click(sendIn('User Number2'))
    await within(region()).findByText(/No link was sent to u2@example.com.au/)
    await waitFor(() => expect(isBusy(sendIn('User Number2'))).toBe(false))

    await u.click(sendIn('User Number1'))

    expect(await within(region()).findByText(sentTo(1))).toBeInTheDocument()
    // Their own failure is superseded: it is over. Number2's is not, and stays until dismissed.
    expect(within(region()).queryByText(/No link was sent to u1@example.com.au/)).not.toBeInTheDocument()
    expect(within(region()).getByText(/No link was sent to u2@example.com.au/)).toBeInTheDocument()
  })

  it('says a second failure for the same person once, not twice, so retries during an outage do not pile up', async () => {
    sendPasswordResetEmail.mockRejectedValue(firebaseError('auth/network-request-failed'))
    const u = renderTab([user(1)])
    await u.click(sendIn('User Number1'))
    await within(region()).findByText(/No link was sent to u1@example.com.au/)
    await waitFor(() => expect(isBusy(sendIn('User Number1'))).toBe(false))

    await u.click(sendIn('User Number1'))
    await waitFor(() => expect(sendPasswordResetEmail).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(isBusy(sendIn('User Number1'))).toBe(false))

    expect(within(region()).getAllByText(/No link was sent to u1@example.com.au/)).toHaveLength(1)
  })
})
