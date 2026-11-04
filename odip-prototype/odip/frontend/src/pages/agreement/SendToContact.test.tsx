import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { AgreementContactDto, AgreementShareRowDto } from '@/api/types'
import { SendToContact } from './SendToContact'
import { ShareStatus } from './ShareStatus'

const { sendMutate, sendState } = vi.hoisted(() => ({ sendMutate: vi.fn(), sendState: { current: { isPending: false } as { isPending: boolean } } }))
vi.mock('@/api/hooks', () => ({ useSendAgreement: () => ({ mutate: sendMutate, ...sendState.current }) }))

const guardian: AgreementContactDto = { personId: 'c-1', name: 'Jo Lee', roles: 'Guardian', email: 'jo@example.com', isDefault: true }
const nominee: AgreementContactDto = { personId: 'c-2', name: 'Sam Ng', roles: 'Plan nominee', isDefault: false }
const participant: AgreementContactDto = { name: 'Marcus Tran', roles: 'Participant', email: 'marcus@example.com', isDefault: false }

const share = (changes: Partial<AgreementShareRowDto> = {}): AgreementShareRowDto => ({
  id: 's-1', draftId: 'd-2', draftVersion: 2, recipientName: 'Jo Lee', recipientEmail: 'jo@example.com', sentByName: 'Alex', sentAt: '2026-11-03T01:00:00Z', expiresAt: '2026-12-03T01:00:00Z', ...changes,
})

function setUp(contacts: AgreementContactDto[], shares: AgreementShareRowDto[] = []) {
  const onSent = vi.fn()
  render(
    <MemoryRouter>
      <SendToContact participantId="p-1" draftId="d-2" version={2} contacts={contacts} shares={shares} onSent={onSent} />
    </MemoryRouter>,
  )
  return { onSent }
}

beforeEach(() => {
  sendMutate.mockReset()
  sendState.current = { isPending: false }
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T10:00:00Z') })
})

describe('SendToContact: the dialog', () => {
  it('picks the default contact and says where the email goes and how long the link lasts', async () => {
    setUp([nominee, guardian, participant])
    await userEvent.setup({ advanceTimers: () => {} }).click(screen.getByRole('button', { name: 'Send to a contact' }))

    const dialog = screen.getByRole('dialog', { name: 'Send this agreement to a contact' })
    expect(within(dialog).getByRole('combobox', { name: 'Send to' })).toHaveValue('c-1')
    expect(within(dialog).getByText('The email goes to jo@example.com.')).toBeInTheDocument()
    expect(within(dialog).getByText(/works for 30 days/)).toBeInTheDocument()
  })

  it('lists a contact with no email, disabled, and never sends to them', async () => {
    setUp([guardian, nominee])
    await userEvent.setup({ advanceTimers: () => {} }).click(screen.getByRole('button', { name: 'Send to a contact' }))

    const option = screen.getByRole('option', { name: /Sam Ng.*No email recorded/ })
    expect(option).toBeDisabled()
  })

  it('says so, with a way to the profile, when no contact has an email, and cannot send', async () => {
    setUp([nominee])
    await userEvent.setup({ advanceTimers: () => {} }).click(screen.getByRole('button', { name: 'Send to a contact' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/None of the contacts has an email recorded/)).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'Open the participant' })).toHaveAttribute('href', '/participants/p-1')
    expect(within(dialog).getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('sends the chosen person and the version seen, and the participant as no person', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} })
    setUp([guardian, participant])
    await user.click(screen.getByRole('button', { name: 'Send to a contact' }))
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(sendMutate.mock.calls[0][0]).toEqual({ participantId: 'p-1', draftId: 'd-2', personId: 'c-1', expectedVersion: 2 })

    await user.selectOptions(screen.getByRole('combobox', { name: 'Send to' }), 'participant')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(sendMutate.mock.calls[1][0]).toEqual({ participantId: 'p-1', draftId: 'd-2', personId: undefined, expectedVersion: 2 })
  })

  it('holds the dialog and the button while the send is on its way', async () => {
    sendState.current = { isPending: true }
    const user = userEvent.setup({ advanceTimers: () => {} })
    setUp([guardian])
    await user.click(screen.getByRole('button', { name: 'Send to a contact' }))

    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })

  it('closes and tells the page when it went', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} })
    const { onSent } = setUp([guardian])
    await user.click(screen.getByRole('button', { name: 'Send to a contact' }))
    sendMutate.mockImplementation((_vars, options) => options.onSuccess({ sent: true }))
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(onSent).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each([
    ['NotConfigured', "Email isn't set up for your organisation yet. Ask your administrator."],
    ['Failed', "The email didn't go. Try again, or check with your administrator."],
  ])('stays open and says %s in plain words', async (error, words) => {
    const user = userEvent.setup({ advanceTimers: () => {} })
    const { onSent } = setUp([guardian])
    await user.click(screen.getByRole('button', { name: 'Send to a contact' }))
    sendMutate.mockImplementation((_vars, options) => options.onSuccess({ sent: false, error }))
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(screen.getByText(words)).toBeInTheDocument()
    expect(onSent).not.toHaveBeenCalled()
  })

  it("shows the server's own words for a refusal, and a way to Settings when the organisation has no contact details", async () => {
    const user = userEvent.setup({ advanceTimers: () => {} })
    setUp([guardian])
    await user.click(screen.getByRole('button', { name: 'Send to a contact' }))
    const said = "Add your organisation's contact email or phone in Settings first, so the person knows where to reply."
    sendMutate.mockImplementation((_vars, options) => options.onError({ response: { status: 409, data: { errors: [said] } } }))
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(screen.getByText(said)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Settings' })).toHaveAttribute('href', '/settings?section=organisation')
  })

  it('offers Send again when the link has expired', () => {
    setUp([guardian], [share({ expiresAt: '2026-11-04T09:00:00Z' })])

    expect(screen.getByRole('button', { name: 'Send again' })).toBeInTheDocument()
  })
})

describe('ShareStatus: the line', () => {
  it('says who it was sent to and that it has not been opened', () => {
    render(<ShareStatus shares={[share()]} />)
    expect(screen.getByRole('status')).toHaveTextContent('Sent to Jo Lee on 3 Nov 2026 · not opened yet')
  })

  it('says when it was opened', () => {
    render(<ShareStatus shares={[share({ openedAt: '2026-11-04T02:00:00Z' })]} />)
    expect(screen.getByRole('status')).toHaveTextContent('Sent to Jo Lee on 3 Nov 2026 · opened 4 Nov 2026')
  })

  it('says the link has expired', () => {
    render(<ShareStatus shares={[share({ expiresAt: '2026-11-04T09:00:00Z' })]} />)
    expect(screen.getByRole('status')).toHaveTextContent('The link sent to Jo Lee on 3 Nov 2026 has expired.')
  })

  it('shows nothing for a send that failed or a link that was revoked, and the newest live one otherwise', () => {
    const { rerender } = render(<ShareStatus shares={[share({ sendError: 'Failed' }), share({ id: 's-0', revokedAt: '2026-11-03T05:00:00Z' })]} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    rerender(<ShareStatus shares={[share({ id: 's-2', recipientName: 'Sam Ng', sendError: 'Failed' }), share()]} />)
    expect(screen.getByRole('status')).toHaveTextContent('Sent to Jo Lee')
  })
})
