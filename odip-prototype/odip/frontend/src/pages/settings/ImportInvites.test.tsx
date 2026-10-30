import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImportInvites from './ImportInvites'

const { invites, sendEmail, counts, record } = vi.hoisted(() => ({ invites: vi.fn(), sendEmail: vi.fn(), counts: vi.fn(() => ({ data: undefined as unknown })), record: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  useImportInvites: () => ({ mutateAsync: invites, isPending: false }),
  useImportInviteCount: () => counts(),
  useRecordInvitesSent: () => ({ mutate: record }),
}))
vi.mock('@/lib/signInEmail', async () => ({
  ...(await vi.importActual<typeof import('@/lib/signInEmail')>('@/lib/signInEmail')),
  sendSetPasswordEmailFor: sendEmail,
}))

afterEach(() => { cleanup(); vi.clearAllMocks(); counts.mockImplementation(() => ({ data: undefined })) })

const withCount = (toInvite: number, invitedBefore = 0, signedIn = 0, cannotInvite = 0) =>
  counts.mockImplementation(() => ({ data: { toInvite, invitedBefore, signedIn, cannotInvite } }))
/** The button, then the confirm's own button (the dialog is an alertdialog). */
const press = async (label: string) => { await userEvent.click(screen.getByRole('button', { name: label })) }
const confirm = async (label: string) => { await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: label })) }

describe('ImportInvites', () => {
  it('sets up each account, sends each link, and says what happened to each person, failures first', async () => {
    withCount(2)
    invites.mockResolvedValue({ left: 0, invites: [
      { staffId: 's1', name: 'Jo Ng', email: 'jo@example.com', firebaseAccount: 'created', error: null },
      { staffId: 's2', name: 'Al Wu', email: 'al@example.com', firebaseAccount: null, error: 'Unable to set up the account.' },
    ] })
    sendEmail.mockResolvedValue({ ok: true, email: 'jo@example.com', account: 'created' })
    render(<ImportInvites batchId="b1" count={2} />)

    await press('Send sign-in invites (2)')
    expect(invites).not.toHaveBeenCalled()
    await confirm('Send 2 invites')

    expect(invites).toHaveBeenCalledWith({ batchId: 'b1' })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail).toHaveBeenCalledWith('jo@example.com', 'created')
    expect(await screen.findByText('Sign-in invites: 1 sent, 1 not sent')).toBeInTheDocument()
    const lines = screen.getAllByRole('listitem').map(li => li.textContent)
    expect(lines[0]).toMatch(/No link was sent to al@example\.com\. Unable to set up the account\./)
    expect(lines[1]).toMatch(/We've sent jo@example.com a link to set their password/)
  })

  it('says so when nobody was sent to, and shows a refused request', async () => {
    withCount(1)
    invites.mockResolvedValueOnce({ invites: [], left: 0 })
    render(<ImportInvites batchId="b1" count={1} />)
    await press('Send sign-in invites (1)')
    await confirm('Send 1 invite')
    expect(await screen.findByText('Everyone in this import has signed in or been invited, so no invites were sent.')).toBeInTheDocument()

    invites.mockRejectedValueOnce({ response: { status: 404, data: { success: false, errors: ['Staff import not found.'] } } })
    await press('Send sign-in invites (1)')
    await confirm('Send 1 invite')
    expect(await screen.findByText('Staff import not found.')).toBeInTheDocument()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('hands the results to the page when it shows them elsewhere', async () => {
    withCount(1)
    invites.mockResolvedValue({ invites: [], left: 0 })
    const onResult = vi.fn()
    const { container } = render(<ImportInvites batchId="b1" count={1} onResult={onResult} />)
    await press('Send sign-in invites (1)')
    await confirm('Send 1 invite')
    expect(onResult).toHaveBeenCalledWith({ outcomes: [], left: 0 })
    expect(within(container).queryByText(/no invites were sent/)).toBeNull()
  })

  it('sends the rest from where the last press stopped, and says how many are left', async () => {
    withCount(51)
    sendEmail.mockImplementation(async (email: string) => ({ ok: true, email, account: 'created' }))
    invites.mockResolvedValueOnce({ left: 50, next: 's1', invites: [{ staffId: 's1', name: 'Jo Ng', email: 'jo@example.com', firebaseAccount: 'created', error: null }] })
    render(<ImportInvites batchId="b1" count={51} />)

    await press('Send sign-in invites (51)')
    await confirm('Send 51 invites')
    expect(await screen.findByText('50 more still to invite: press Send sign-in invites again.')).toBeInTheDocument()

    // While a cursor is held the label counts what is left after it, not the server's count.
    invites.mockResolvedValueOnce({ left: 0, invites: [{ staffId: 's2', name: 'Al Wu', email: 'al@example.com', firebaseAccount: 'existing', error: null }] })
    await press('Send sign-in invites (50)')
    await confirm('Send 50 invites')
    expect(invites).toHaveBeenLastCalledWith({ batchId: 'b1', after: 's1' })
    expect(await screen.findByText(/al@example.com/)).toBeInTheDocument()
    expect(screen.queryByText(/more still to invite/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Send sign-in invites (51)' })).toBeInTheDocument()
  })

  it('says all of them were sent when every link went', async () => {
    withCount(1)
    invites.mockResolvedValue({ left: 0, invites: [{ staffId: 's1', name: 'Jo Ng', email: 'jo@example.com', firebaseAccount: 'created', error: null }] })
    sendEmail.mockResolvedValue({ ok: true, email: 'jo@example.com', account: 'created' })
    render(<ImportInvites batchId="b1" count={1} />)
    await press('Send sign-in invites (1)')
    await confirm('Send 1 invite')
    expect(await screen.findByText('Sign-in invites: all 1 sent')).toBeInTheDocument()
  })

  it('confirm states the counts, and Cancel sends nothing', async () => {
    withCount(3, 2, 1)
    render(<ImportInvites batchId="b1" count={9} />)
    await press('Send sign-in invites (3)')
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent("3 staff haven't been invited yet.")
    expect(dialog).toHaveTextContent("2 were invited before but haven't signed in, so they're skipped.")
    expect(within(dialog).getByRole('button', { name: 'Send 3 invites' })).toBeEnabled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(invites).not.toHaveBeenCalled()
  })

  it('uses the singular for one person, and names who cannot be invited', async () => {
    withCount(1, 1, 0, 2)
    render(<ImportInvites batchId="b1" count={1} />)
    await press('Send sign-in invites (1)')
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent("1 staff member hasn't been invited yet.")
    expect(dialog).toHaveTextContent("1 was invited before but hasn't signed in, so that person is skipped.")
    expect(dialog).toHaveTextContent("2 can't be invited: archived, or no email address.")
    expect(within(dialog).getByRole('button', { name: 'Send 1 invite' })).toBeEnabled()
  })

  it('ticking the box adds the invited before, and only then does the request ask for them', async () => {
    withCount(3, 2, 1)
    invites.mockResolvedValue({ left: 0, invites: [] })
    render(<ImportInvites batchId="b1" count={3} />)
    await press('Send sign-in invites (3)')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Also send again to the 2 invited before' }))
    await confirm('Send 5 invites')
    expect(invites).toHaveBeenCalledWith({ batchId: 'b1', includeInvitedBefore: true })
  })

  it('only the invited before: the confirm waits for the box', async () => {
    withCount(0, 2, 0)
    render(<ImportInvites batchId="b1" count={2} />)
    await press('Send sign-in invites (0)')
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByRole('button', { name: 'Send 0 invites' })).toBeDisabled()
    await userEvent.click(within(dialog).getByRole('checkbox'))
    expect(within(dialog).getByRole('button', { name: 'Send 2 invites' })).toBeEnabled()
  })

  it('nobody left disables the button and says why', async () => {
    withCount(0, 0, 4, 1)
    render(<ImportInvites batchId="b1" count={4} />)
    expect(screen.getByRole('button', { name: 'Send sign-in invites (0)' })).toBeDisabled()
    expect(screen.getByText(/Everyone in this import has signed in or been invited\./)).toBeInTheDocument()
    expect(screen.getByText(/1 can't be invited: archived, or no email address\./)).toBeInTheDocument()
    expect(invites).not.toHaveBeenCalled()
  })

  it('more than 100 caps the label and says the rest follow', async () => {
    withCount(150)
    render(<ImportInvites batchId="b1" count={150} />)
    await press('Send sign-in invites (150)')
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByRole('button', { name: 'Send 100 invites' })).toBeInTheDocument()
    expect(dialog).toHaveTextContent('They go 100 at a time: press Send sign-in invites again for the rest.')
  })

  it('count not available: keeps the old label, confirms with the plain question, and still sends (skipping the invited)', async () => {
    counts.mockImplementation(() => ({ data: undefined }))
    invites.mockResolvedValue({ left: 0, invites: [] })
    render(<ImportInvites batchId="b1" count={4} />)
    await press('Send sign-in invites (4)')
    expect(screen.getByRole('alertdialog')).toHaveTextContent("Send sign-in invites to staff in this import who haven't signed in?")
    await confirm('Send invites')
    expect(invites).toHaveBeenCalledWith({ batchId: 'b1' })
  })

  it('a count that arrives while the confirm is open does not change its words', async () => {
    counts.mockImplementation(() => ({ data: undefined }))
    const view = render(<ImportInvites batchId="b1" count={4} />)
    await press('Send sign-in invites (4)')
    withCount(9, 2)
    view.rerender(<ImportInvites batchId="b1" count={4} />)
    expect(screen.getByRole('alertdialog')).toHaveTextContent("Send sign-in invites to staff in this import who haven't signed in?")
    expect(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Send invites' })).toBeInTheDocument()
  })

  it('records only the people whose link went', async () => {
    withCount(2)
    invites.mockResolvedValue({ left: 0, invites: [
      { staffId: 's1', name: 'Jo Ng', email: 'jo@example.com', firebaseAccount: 'created', error: null },
      { staffId: 's2', name: 'Al Wu', email: 'al@example.com', firebaseAccount: 'created', error: null },
    ] })
    sendEmail.mockImplementation(async (email: string) => (email === 'al@example.com' ? { ok: false, email, reason: 'other' } : { ok: true, email, account: 'created' }))
    render(<ImportInvites batchId="b1" count={2} />)
    await press('Send sign-in invites (2)')
    await confirm('Send 2 invites')
    await screen.findByText('Sign-in invites: 1 sent, 1 not sent')
    expect(record).toHaveBeenCalledTimes(1)
    expect(record).toHaveBeenCalledWith(['s1'])
  })

  it('records nothing when every send failed', async () => {
    withCount(1)
    invites.mockResolvedValue({ left: 0, invites: [{ staffId: 's1', name: 'Jo Ng', email: 'jo@example.com', firebaseAccount: 'created', error: null }] })
    sendEmail.mockResolvedValue({ ok: false, email: 'jo@example.com', reason: 'other' })
    render(<ImportInvites batchId="b1" count={1} />)
    await press('Send sign-in invites (1)')
    await confirm('Send 1 invite')
    await screen.findByText('Sign-in invites: 0 sent, 1 not sent')
    expect(record).not.toHaveBeenCalled()
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

  it('records each page of the run, only the people whose link went, and never asks for the invited', async () => {
    invites.mockResolvedValueOnce(page(0, 2, 2, 'id2')).mockResolvedValueOnce(page(2, 2))
    sendEmail.mockImplementation(async (email: string) => (email === 'p1@example.com' ? { ok: false, email, reason: 'other' } : ok(email)))
    render(<ImportInvites batchId="r1" count={4} auto />)
    await announced('Sign-in invites: 3 sent, 1 not sent')
    expect(record.mock.calls.map(c => c[0]).sort()).toEqual([['s0'], ['s2', 's3']])
    expect(invites.mock.calls.every(c => !('includeInvitedBefore' in c[0]))).toBe(true)
  })

  it('a rate limit pause still records what was sent so far', async () => {
    sendEmail.mockImplementation(async (email: string) => (email === 'p1@example.com' ? { ok: false, email, reason: 'too-many-requests' } : ok(email)))
    invites.mockResolvedValueOnce(page(0, 3))
    render(<ImportInvites batchId="r2" count={3} auto />)
    await announced(/Sending paused/)
    expect(record).toHaveBeenCalledWith(['s0'])
  })

  it('nothing sent, nothing recorded; a retry records the people who now succeed', async () => {
    invites.mockResolvedValue({ left: 0, next: null, invites: [person(1)] })
    sendEmail.mockImplementation(async (email: string) => ({ ok: false, email, reason: 'other' }))
    render(<ImportInvites batchId="r3" count={1} auto />)
    await announced('Sign-in invites: 0 sent, 1 not sent')
    expect(record).not.toHaveBeenCalled()
    sendEmail.mockReset(); sendEmail.mockImplementation(ok)
    await userEvent.click(screen.getByRole('button', { name: 'Try the 1 again' }))
    await announced('Sign-in invites: all 1 sent')
    expect(record).toHaveBeenCalledWith(['s1'])
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
    await press('Send sign-in invites (1)')
    await confirm('Send invites')
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
    await press('Send sign-in invites (2)')
    await confirm('Send invites')
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
