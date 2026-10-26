import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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

    expect(invites).toHaveBeenCalledWith({ batchId: 'b1' })
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
    invites.mockResolvedValueOnce({ left: 50, next: 's1', invites: [{ staffId: 's1', name: 'Jo Ng', email: 'jo@example.com', firebaseAccount: 'created', error: null }] })
    render(<ImportInvites batchId="b1" count={51} />)

    await userEvent.click(screen.getByRole('button', { name: 'Send sign-in invites (51)' }))
    expect(await screen.findByText('50 more still to invite: press Send sign-in invites again.')).toBeInTheDocument()

    invites.mockResolvedValueOnce({ left: 0, invites: [{ staffId: 's2', name: 'Al Wu', email: 'al@example.com', firebaseAccount: 'existing', error: null }] })
    await userEvent.click(screen.getByRole('button', { name: 'Send sign-in invites (50)' }))
    expect(invites).toHaveBeenLastCalledWith({ batchId: 'b1', after: 's1' })
    expect(await screen.findByText(/al@example.com/)).toBeInTheDocument()
    expect(screen.queryByText(/more still to invite/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Send sign-in invites (51)' })).toBeInTheDocument()
  })

  it('says all of them were sent when every link went', async () => {
    invites.mockResolvedValue({ left: 0, invites: [{ staffId: 's1', name: 'Jo Ng', email: 'jo@example.com', firebaseAccount: 'created', error: null }] })
    sendEmail.mockResolvedValue({ ok: true, email: 'jo@example.com', account: 'created' })
    render(<ImportInvites batchId="b1" count={1} />)
    await userEvent.click(screen.getByRole('button', { name: 'Send sign-in invites (1)' }))
    expect(await screen.findByText('Sign-in invites: all 1 sent')).toBeInTheDocument()
  })
})

describe('ImportInvites: auto (invites as part of the staff import)', () => {
  const person = (i: number, o: object = {}) => ({ staffId: `s${i}`, name: `P ${i}`, email: `p${i}@example.com`, firebaseAccount: 'created', error: null, ...o })
  const page = (from: number, n: number, left = 0, next: string | null = null) => ({ invites: Array.from({ length: n }, (_, k) => person(from + k)), left, next })
  const sentTo = () => sendEmail.mock.calls.map(c => c[0])
  const ok = async (email: string) => ({ ok: true, email, account: 'created' })
  // The run's one live region carries the line; the visible Callout does not announce itself as well.
  const announced = (text: string | RegExp) => waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(text))
  afterEach(() => sessionStorage.clear())

  it('loops past 100 with no press', async () => {
    sendEmail.mockImplementation(ok)
    invites.mockResolvedValueOnce(page(0, 100, 20, 'id100')).mockResolvedValueOnce(page(100, 20))
    render(<ImportInvites batchId="b1" count={120} auto />)

    await announced('Sign-in invites: all 120 sent')
    expect(invites.mock.calls.map(c => c[0])).toEqual([{ batchId: 'b1' }, { batchId: 'b1', after: 'id100' }])
    expect(sendEmail).toHaveBeenCalledTimes(120)
  })

  it('runs once per batch: a remount shows the manual button and sends nothing more', async () => {
    sendEmail.mockImplementation(ok)
    invites.mockResolvedValue(page(0, 1))
    const first = render(<ImportInvites batchId="b2" count={1} auto />)
    await announced('Sign-in invites: all 1 sent')
    first.unmount()
    render(<ImportInvites batchId="b2" count={1} auto />)

    expect(screen.getByRole('button', { name: 'Send sign-in invites (1)' })).toBeInTheDocument()
    expect(invites).toHaveBeenCalledTimes(1)
  })

  it('a rate limit pauses with the person at the head, and Send the rest carries on in order', async () => {
    let limited = false
    sendEmail.mockImplementation(async (email: string) => {
      if (email === 'p59@example.com' && !limited) { limited = true; return { ok: false, email, reason: 'too-many-requests' } }
      return ok(email)
    })
    invites.mockResolvedValueOnce(page(0, 100, 5, 'id100')).mockResolvedValueOnce(page(100, 5))
    render(<ImportInvites batchId="b3" count={105} auto />)

    await announced(/Sending paused: the email service asked us to slow down. 46 still to invite./)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(invites).toHaveBeenCalledTimes(1)
    sendEmail.mockClear()
    await userEvent.click(screen.getByRole('button', { name: 'Send the rest (46)' }))

    await announced('Sign-in invites: all 105 sent')
    expect(sentTo()[0]).toBe('p59@example.com')
    expect(sentTo().slice(0, 41)).toEqual(Array.from({ length: 41 }, (_, k) => `p${59 + k}@example.com`))
    expect(invites.mock.calls[1][0]).toEqual({ batchId: 'b3', after: 'id100' })
  })

  it('Try the failures again re-sends only those with an account and never asks the server again', async () => {
    invites.mockResolvedValue({ left: 0, next: null, invites: [person(1), person(2, { firebaseAccount: null, error: 'No account.' }), person(3)] })
    sendEmail.mockImplementation(async (email: string) => (email === 'p1@example.com' ? { ok: false, email, reason: 'other' } : ok(email)))
    render(<ImportInvites batchId="b4" count={3} auto />)
    await announced('Sign-in invites: 1 sent, 2 not sent')
    sendEmail.mockReset(); sendEmail.mockImplementation(ok)

    await userEvent.click(screen.getByRole('button', { name: 'Try the 1 again' }))

    expect(sentTo()).toEqual(['p1@example.com'])
    expect(invites).toHaveBeenCalledTimes(1)
    await announced('Sign-in invites: 2 sent, 1 not sent')
    expect(screen.getByText(/Fix their email on the Staff page, then send from Import history\./)).toBeInTheDocument()
  })

  it('manual mode is unchanged: nothing on mount, one press is one page', async () => {
    invites.mockResolvedValue(page(0, 1))
    sendEmail.mockImplementation(ok)
    render(<ImportInvites batchId="b5" count={1} />)
    expect(invites).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Send sign-in invites (1)' }))
    expect(invites).toHaveBeenCalledTimes(1)
  })

  it('reports onSendingChange true then false around a run', async () => {
    invites.mockResolvedValue(page(0, 1))
    sendEmail.mockImplementation(ok)
    const seen = vi.fn()
    render(<ImportInvites batchId="b6" count={1} auto onSendingChange={seen} />)
    await announced('Sign-in invites: all 1 sent')
    expect(seen.mock.calls.map(c => c[0])).toEqual([true, false])
  })

  it('keeps one live region for the whole run: its text goes from sending to the finished title, and the Callouts do not announce again', async () => {
    invites.mockResolvedValue({ left: 0, next: null, invites: [person(1), person(2)] })
    sendEmail.mockImplementation(async (email: string) => (email === 'p1@example.com' ? { ok: false, email, reason: 'other' } : ok(email)))
    render(<ImportInvites batchId="b8" count={2} auto />)
    const region = screen.getByRole('status')
    expect(region).toHaveTextContent(/^Sending sign-in invites: [0-9] of 2$/)
    await announced('Sign-in invites: 1 sent, 1 not sent')
    expect(screen.getByRole('status')).toBe(region)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('finished: failures are listed, Try again sits under them, the sent lines are behind a closed disclosure', async () => {
    invites.mockResolvedValue({ left: 0, next: null, invites: [person(1), person(2), person(3)] })
    sendEmail.mockImplementation(async (email: string) => (email === 'p1@example.com' ? { ok: false, email, reason: 'other' } : ok(email)))
    render(<ImportInvites batchId="b9" count={3} auto />)
    await announced('Sign-in invites: 2 sent, 1 not sent')

    const summary = screen.getByText('Show the 2 sent')
    const details = summary.closest('details')!
    expect(details).not.toHaveAttribute('open')
    expect(within(details).getAllByRole('listitem')).toHaveLength(2)
    const failedLine = screen.getAllByRole('listitem').find(li => /p1@example.com/.test(li.textContent ?? ''))!
    expect(details.contains(failedLine)).toBe(false)
    const retry = screen.getByRole('button', { name: 'Try the 1 again' })
    expect(retry.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(failedLine.compareDocumentPosition(retry) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('auto-run failure lines do not point at a Send button that is not there; manual ones still do', async () => {
    invites.mockResolvedValue({ left: 0, next: null, invites: [person(1), person(2)] })
    sendEmail.mockImplementation(async (email: string) => (email === 'p1@example.com' ? { ok: false, email, reason: 'network' } : { ok: false, email, reason: 'other' }))
    const auto = render(<ImportInvites batchId="b10" count={2} auto />)
    await announced('Sign-in invites: 0 sent, 2 not sent')
    const lines = screen.getAllByRole('listitem').map(li => li.textContent ?? '')
    expect(lines).toHaveLength(2)
    for (const line of lines) expect(line).not.toContain('Send sign-in invites')
    expect(lines.join(' ')).toContain('No link was sent to p2@example.com.')
    auto.unmount()

    render(<ImportInvites batchId="b11" count={2} />)
    await userEvent.click(screen.getByRole('button', { name: 'Send sign-in invites (2)' }))
    expect((await screen.findAllByText(/Send sign-in invites again/)).length).toBe(2)
  })

  it('Try the failures again counts its own batch, and the list still merges the earlier sent ones', async () => {
    invites.mockResolvedValue({ left: 0, next: null, invites: [person(1), person(2), person(3)] })
    sendEmail.mockImplementation(async (email: string) => (email === 'p2@example.com' ? ok(email) : { ok: false, email, reason: 'other' }))
    render(<ImportInvites batchId="b12" count={3} auto />)
    await announced('Sign-in invites: 1 sent, 2 not sent')
    let releaseSecond!: () => void
    sendEmail.mockReset()
    sendEmail.mockImplementation((email: string) => (email === 'p3@example.com'
      ? new Promise(resolve => { releaseSecond = () => resolve({ ok: true, email, account: 'created' }) })
      : ok(email)))

    await userEvent.click(screen.getByRole('button', { name: 'Try the 2 again' }))

    await announced('Sending sign-in invites: 1 of 2')
    expect(screen.getByText('Sending sign-in invites: 1 of 2', { selector: 'p' })).toBeInTheDocument()
    releaseSecond()
    await announced('Sign-in invites: all 3 sent')
  })

  it('a failed page request shows the problem and reports not sending', async () => {
    invites.mockRejectedValue({ response: { status: 500, data: { success: false, errors: ['Down.'] } } })
    const seen = vi.fn()
    render(<ImportInvites batchId="b7" count={2} auto onSendingChange={seen} />)
    expect(await screen.findByText('Down.')).toBeInTheDocument()
    expect(seen).toHaveBeenLastCalledWith(false)
  })
})
