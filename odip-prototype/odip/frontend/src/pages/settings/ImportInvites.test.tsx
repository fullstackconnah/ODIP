import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImportInvites from './ImportInvites'

const { invites, sendEmail } = vi.hoisted(() => ({ invites: vi.fn(), sendEmail: vi.fn() }))

vi.mock('@/api/hooks', () => ({ useImportInvites: () => ({ mutateAsync: invites, isPending: false }) }))
vi.mock('@/lib/signInEmail', async () => ({
  ...(await vi.importActual<typeof import('@/lib/signInEmail')>('@/lib/signInEmail')),
  sendSetPasswordEmailFor: sendEmail,
}))

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('ImportInvites', () => {
  it('sets up each account, sends each link, and says what happened to each person, failures first', async () => {
    invites.mockResolvedValue({ left: 0, invites: [
      { staffId: 's1', name: 'Jo Ng', email: 'jo@example.com', firebaseAccount: 'created', error: null },
      { staffId: 's2', name: 'Al Wu', email: 'al@example.com', firebaseAccount: null, error: 'Unable to set up the account.' },
    ] })
    sendEmail.mockResolvedValue({ ok: true, email: 'jo@example.com', account: 'created' })
    render(<ImportInvites batchId="b1" count={2} />)

    await userEvent.click(screen.getByRole('button', { name: 'Send sign-in invites (2)' }))

    expect(invites).toHaveBeenCalledWith({ batchId: 'b1', from: 0 })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail).toHaveBeenCalledWith('jo@example.com', 'created')
    expect(await screen.findByText('Sign-in invites: 1 sent, 1 not sent')).toBeInTheDocument()
    const lines = screen.getAllByRole('listitem').map(li => li.textContent)
    expect(lines[0]).toMatch(/No link was sent to al@example\.com\. Unable to set up the account\./)
    expect(lines[1]).toMatch(/We've sent jo@example.com a link to set their password/)
  })

  it('says so when everyone has signed in already, and shows a refused request', async () => {
    invites.mockResolvedValueOnce({ invites: [], left: 0 })
    render(<ImportInvites batchId="b1" count={1} />)
    await userEvent.click(screen.getByRole('button', { name: 'Send sign-in invites (1)' }))
    expect(await screen.findByText('Everyone in this import has signed in already, so no invites were sent.')).toBeInTheDocument()

    invites.mockRejectedValueOnce({ response: { status: 404, data: { success: false, errors: ['Staff import not found.'] } } })
    await userEvent.click(screen.getByRole('button', { name: 'Send sign-in invites (1)' }))
    expect(await screen.findByText('Staff import not found.')).toBeInTheDocument()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('hands the results to the page when it shows them elsewhere', async () => {
    invites.mockResolvedValue({ invites: [], left: 0 })
    const onResult = vi.fn()
    const { container } = render(<ImportInvites batchId="b1" count={1} onResult={onResult} />)
    await userEvent.click(screen.getByRole('button', { name: 'Send sign-in invites (1)' }))
    expect(onResult).toHaveBeenCalledWith({ outcomes: [], left: 0 })
    expect(within(container).queryByText(/no invites were sent/)).toBeNull()
  })

  it('sends the rest from where the last press stopped, and says how many are left', async () => {
    sendEmail.mockImplementation(async (email: string) => ({ ok: true, email, account: 'created' }))
    invites.mockResolvedValueOnce({ left: 50, invites: [{ staffId: 's1', name: 'Jo Ng', email: 'jo@example.com', firebaseAccount: 'created', error: null }] })
    render(<ImportInvites batchId="b1" count={51} />)

    await userEvent.click(screen.getByRole('button', { name: 'Send sign-in invites (51)' }))
    expect(await screen.findByText('50 more still to invite: press Send sign-in invites again.')).toBeInTheDocument()

    invites.mockResolvedValueOnce({ left: 0, invites: [{ staffId: 's2', name: 'Al Wu', email: 'al@example.com', firebaseAccount: 'existing', error: null }] })
    await userEvent.click(screen.getByRole('button', { name: 'Send sign-in invites (50)' }))
    expect(invites).toHaveBeenLastCalledWith({ batchId: 'b1', from: 1 })
    expect(await screen.findByText(/al@example.com/)).toBeInTheDocument()
    expect(screen.queryByText(/more still to invite/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Send sign-in invites (51)' })).toBeInTheDocument()
  })
})
