import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntakeBookingPanel } from './IntakeBookingPanel'
import type { ParticipantInquiryDto } from '@/api/types/inquiries'

const mocks = vi.hoisted(() => ({ save: vi.fn(), confirm: vi.fn(), resend: vi.fn(), get: vi.fn() }))
vi.mock('@/api/client', () => ({ apiGet: mocks.get }))
vi.mock('@/api/hooks', () => ({
  useStaff: () => ({
    data: [
      { id: 'dana', fullName: 'Dana Smith', role: 'Coordinator', isActive: true },
      { id: 'sam', fullName: 'Sam Lee', role: 'Admin', isActive: true },
    ],
    isLoading: false,
  }),
  useSetIntakeBooking: () => ({ mutateAsync: mocks.save, isPending: false }),
  useConfirmIntakeBooking: () => ({ mutateAsync: mocks.confirm, isPending: false }),
  useResendIntakeInvite: () => ({ mutateAsync: mocks.resend, isPending: false }),
}))

// 10:00 am on 16 Oct 2030 in Sydney (AEDT, +11).
const START = '2030-10-15T23:00:00Z'
const newRow = (overrides: Partial<ParticipantInquiryDto> = {}): ParticipantInquiryDto => ({
  id: 'inq-1', firstName: 'Noah', lastName: 'Fitzgerald', source: 'Phone', createdAt: '2026-09-28T01:10:00Z',
  email: 'priya.nair@example.com.au', contactFirstName: 'Sarah', contactLastName: 'Walsh', timeZoneId: 'Australia/Sydney', updatedAt: 'v1', ...overrides,
})
const bookedRow = (overrides: Partial<ParticipantInquiryDto> = {}) => newRow({
  intakeStartsAt: START, intakeDurationMinutes: 90, intakeLocation: '12 Smith St', intakeStaffUserId: 'sam', intakeStaffFirstName: 'Sam',
  intakeStaffName: 'Sam Lee', intakeNotes: 'Gate code', intakeInviteSentAt: '2026-10-14T03:05:00Z', intakeInviteError: null, ...overrides,
})

// The page hands the panel the list's row; a rerender with a newer row is the list refetching after a refused write.
function panel(row: ParticipantInquiryDto) {
  const onClose = vi.fn()
  const onRequestCancel = vi.fn()
  const client = new QueryClient()
  const ui = (r: ParticipantInquiryDto) => <QueryClientProvider client={client}><IntakeBookingPanel row={r} onClose={onClose} onRequestCancel={onRequestCancel} /></QueryClientProvider>
  const { rerender } = render(ui(row))
  return { onClose, onRequestCancel, client, refreshTo: (r: ParticipantInquiryDto) => rerender(ui(r)) }
}

async function fillNewBooking(user: ReturnType<typeof userEvent.setup>) {
  fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2030-10-16' } })
  fireEvent.change(screen.getByLabelText(/^Start time/), { target: { value: '10:00' } })
  await user.type(screen.getByLabelText(/^Where/), 'Library')
}

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator', id: 'dana', fullName: 'Dana Smith' }))
  mocks.get.mockReset()
  mocks.save.mockReset()
  mocks.confirm.mockReset()
  mocks.resend.mockReset()
})

describe('IntakeBookingPanel: a new booking', () => {
  it('sends the whole body, with the signed-in coordinator going by default, and then shows what the email did', async () => {
    const user = userEvent.setup()
    mocks.save.mockResolvedValue(bookedRow({ intakeStaffUserId: 'dana', intakeStaffFirstName: 'Dana', intakeLocation: 'Library', intakeNotes: null, intakeInviteSentAt: null, intakeInviteError: 'NotConfigured' }))
    panel(newRow())

    expect(screen.getByRole('dialog', { name: 'Intake visit for Noah Fitzgerald' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText(/^Date/)).toHaveFocus())
    expect(screen.getByText('priya.nair@example.com.au')).toBeInTheDocument()
    await fillNewBooking(user)
    expect(screen.getByText('Ends 11:30 am')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Send invite' }))

    expect(mocks.save).toHaveBeenCalledWith({
      id: 'inq-1',
      data: { startsAt: START, durationMinutes: 90, location: 'Library', staffUserId: 'dana', notes: null, expectedUpdatedAt: 'v1' },
    })
    expect(await screen.findByText("Invite not sent: email isn't set up yet. The visit is still booked, so let Sarah know another way.")).toBeInTheDocument()
    expect(screen.getByText("Intake visit booked. Invite not sent: email isn't set up yet.")).toBeInTheDocument() // the live region
    expect(screen.queryByRole('button', { name: 'Send invite' })).not.toBeInTheDocument()
  })

  it('keeps every value and says why when the server refuses', async () => {
    const user = userEvent.setup()
    mocks.save.mockRejectedValue({ isAxiosError: true, response: { status: 400, data: { errors: { staffUserId: ["Dana can't do intakes. Choose an active coordinator or admin."] } } } })
    panel(newRow())
    await fillNewBooking(user)
    fireEvent.change(screen.getByLabelText(/^How long/), { target: { value: '120' } })
    await user.type(screen.getByLabelText(/^Notes for your team/), 'Side gate')

    await user.click(screen.getByRole('button', { name: 'Send invite' }))

    expect(await screen.findByText("Couldn't book the visit")).toBeInTheDocument()
    expect(screen.getAllByText("Dana can't do intakes. Choose an active coordinator or admin.").length).toBeGreaterThan(0)
    expect(screen.getByLabelText(/^Date/)).toHaveValue('2030-10-16')
    expect(screen.getByLabelText(/^Start time/)).toHaveValue('10:00')
    expect(screen.getByLabelText(/^Where/)).toHaveValue('Library')
    expect(screen.getByLabelText(/^How long/)).toHaveValue('120')
    expect(screen.getByLabelText(/^Notes for your team/)).toHaveValue('Side gate')
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ staffUserId: 'dana', durationMinutes: 120, notes: 'Side gate' }) }))
    // Fix round 1: the refused field takes focus showing the chosen person, its list closed.
    const staff = screen.getByRole('combobox', { name: /^Who's going/ })
    expect(staff).toHaveFocus()
    expect(staff).toHaveValue('Dana Smith (you)')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('says the connection failed and keeps the entries', async () => {
    const user = userEvent.setup()
    mocks.save.mockRejectedValue({ isAxiosError: true })
    panel(newRow())
    await fillNewBooking(user)

    await user.click(screen.getByRole('button', { name: 'Send invite' }))

    expect(await screen.findByText("Couldn't reach Bunya Support. Check your connection and try again. Your entries are kept.")).toBeInTheDocument()
    expect(screen.getByLabelText(/^Where/)).toHaveValue('Library')
  })

  // L7: the email is optional. Without one the visit is booked and nobody is emailed.
  it('with no email the field is optional, the button is Book visit, and the body has no contactEmail', async () => {
    const user = userEvent.setup()
    mocks.save.mockResolvedValue(bookedRow({ email: null, intakeInviteSentAt: null }))
    panel(newRow({ email: null }))
    const email = screen.getByLabelText(/^Sarah's email/)
    await waitFor(() => expect(email).toHaveFocus())
    expect(email).not.toHaveAttribute('required')
    expect(screen.getByText('Optional. With it, we send the invite and save the address to the enquiry.')).toBeInTheDocument()
    expect(screen.getByText('Pick a time. With no email, the visit is booked without an invite.')).toBeInTheDocument()
    await fillNewBooking(user)

    await user.click(screen.getByRole('button', { name: 'Book visit' }))
    expect(mocks.save).toHaveBeenCalledWith({ id: 'inq-1', data: { startsAt: START, durationMinutes: 90, location: 'Library', staffUserId: 'dana', notes: null, expectedUpdatedAt: 'v1' } })
    expect(await screen.findByText('Intake visit booked. No invite sent: Sarah has no email.')).toBeInTheDocument() // the live region
  })

  it('with an email typed the button is Send invite, and it is sent with the booking', async () => {
    const user = userEvent.setup()
    mocks.save.mockResolvedValue(bookedRow({ email: 'sarah@example.com' }))
    panel(newRow({ email: null }))
    await fillNewBooking(user)
    await user.type(screen.getByLabelText(/^Sarah's email/), 'sarah@example.com')
    await user.click(screen.getByRole('button', { name: 'Send invite' }))
    expect(mocks.save).toHaveBeenCalledWith({
      id: 'inq-1',
      data: { startsAt: START, durationMinutes: 90, location: 'Library', staffUserId: 'dana', notes: null, contactEmail: 'sarah@example.com', expectedUpdatedAt: 'v1' },
    })
  })

  it('labels the email by who it is for, or "Main contact\'s email" with no name; a converted row has no email field', () => {
    panel(newRow({ email: null, contactFirstName: null, contactLastName: null }))
    expect(screen.getByLabelText(/^Main contact's email/)).toBeInTheDocument()
    cleanup()
    panel(newRow({ email: null, participantId: 'p-1' }))
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument()
  })

  // D: a converted enquiry's email can't be fixed (D7), so one that can't take an invite books as no email.
  it('a converted enquiry whose email cannot take an invite: Book visit, the note says why, nothing is sent to the email', async () => {
    const user = userEvent.setup()
    mocks.save.mockResolvedValue(bookedRow({ email: 'a b@c.d', participantId: 'p-1', intakeInviteSentAt: null }))
    panel(newRow({ email: 'a b@c.d', participantId: 'p-1' }))
    expect(screen.getByText("Pick a time. The email on file can't take an invite, so the visit is booked without one.")).toBeInTheDocument()
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === "No invite will go out: the email on file, a b@c.d, can't take one.")).toBeInTheDocument()
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument()
    await fillNewBooking(user)
    await user.click(screen.getByRole('button', { name: 'Book visit' }))
    expect(mocks.save).toHaveBeenCalledWith({ id: 'inq-1', data: { startsAt: START, durationMinutes: 90, location: 'Library', staffUserId: 'dana', notes: null, expectedUpdatedAt: 'v1' } })
    expect(await screen.findByText("Intake visit booked. No invite sent: the email on file can't take an invite.")).toBeInTheDocument() // the live region
  })

  it('booked, converted, unsendable email: the result line says why, there is no Send again, and a change is Save changes', async () => {
    const user = userEvent.setup()
    panel(bookedRow({ email: 'a b@c.d', participantId: 'p-1', intakeInviteSentAt: null }))
    expect(screen.getByText("No invite sent: the email on file, a b@c.d, can't take an invite. Let Sarah know another way.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send again' })).not.toBeInTheDocument()
    expect(screen.queryByText(/No invite will go out/)).not.toBeInTheDocument() // the warning says it once
    expect(screen.getByText("The email can't be changed here: the enquiry is the participant's record now.")).toBeInTheDocument()
    await user.clear(screen.getByLabelText(/^Where/))
    await user.type(screen.getByLabelText(/^Where/), 'Library')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
  })

  it('a stored email that cannot take the invite: the server\'s sentence in the refusal', async () => {
    const user = userEvent.setup()
    const sentence = "This email can't take the invite. Check it on the enquiry, or clear it there to book without one."
    mocks.save.mockRejectedValue({ isAxiosError: true, response: { status: 400, data: { errors: { contactEmail: [sentence] } } } })
    panel(newRow({ email: 'a b@c.d' }))
    await fillNewBooking(user)
    await user.click(screen.getByRole('button', { name: 'Send invite' }))
    expect(await screen.findByText("Couldn't book the visit")).toBeInTheDocument()
    expect(screen.getAllByText(sentence).length).toBeGreaterThan(0)
  })

  // A double click, or a second press while the first is still sending, must not send a second invite.
  it('sends once however many times Send invite is pressed while it is sending', async () => {
    const user = userEvent.setup()
    mocks.save.mockReturnValue(new Promise(() => {}))
    panel(newRow())
    await fillNewBooking(user)

    await user.click(screen.getByRole('button', { name: 'Send invite' }))
    await user.click(screen.getByRole('button', { name: /Send invite|Sending/ }))

    expect(mocks.save).toHaveBeenCalledTimes(1)
  })
})

describe('IntakeBookingPanel: the booked view', () => {
  it('shows the stored outcome and the confirmation line, and saves notes alone without emailing', async () => {
    const user = userEvent.setup()
    mocks.save.mockResolvedValue(bookedRow({ intakeNotes: 'Gate code 4321' }))
    panel(bookedRow())

    expect(screen.getByText(/^Invite sent to priya.nair@example.com.au on Wed 14 Oct( 2026)?, 2:05 pm\.$/)).toBeInTheDocument()
    expect(screen.getByText('Not confirmed yet. Mark it when Sarah replies or calls.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Save notes|Send updated invite/ })).not.toBeInTheDocument() // nothing changed yet
    await user.clear(screen.getByLabelText(/^Notes for your team/))
    await user.type(screen.getByLabelText(/^Notes for your team/), 'Gate code 4321')
    await user.click(screen.getByRole('button', { name: 'Save notes' }))

    expect(mocks.save).toHaveBeenCalledWith({
      id: 'inq-1',
      data: { startsAt: START, durationMinutes: 90, location: '12 Smith St', staffUserId: 'sam', notes: 'Gate code 4321', expectedUpdatedAt: 'v1' },
    })
    expect(await screen.findByText('Notes saved.')).toBeInTheDocument()
  })

  it('booked with no email: the result line says so, there is no Send again, and a change is Save changes', async () => {
    const user = userEvent.setup()
    panel(bookedRow({ email: null, intakeInviteSentAt: null }))
    expect(screen.getByText('No invite sent: Sarah has no email. Let them know another way.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send again' })).not.toBeInTheDocument()
    await user.clear(screen.getByLabelText(/^Where/))
    await user.type(screen.getByLabelText(/^Where/), 'Library')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
  })

  it('offers Send updated invite once something the invite says has changed', async () => {
    const user = userEvent.setup()
    panel(bookedRow())

    await user.clear(screen.getByLabelText(/^Where/))
    await user.type(screen.getByLabelText(/^Where/), 'Library')

    expect(screen.getByRole('button', { name: 'Send updated invite' })).toBeInTheDocument()
  })

  it('sends the updated invite to an email typed in for a booked visit whose enquiry lost its address', async () => {
    const user = userEvent.setup()
    mocks.save.mockResolvedValue(bookedRow({ email: 'noah@example.com' }))
    panel(bookedRow({ email: null }))

    expect(screen.queryByRole('button', { name: 'Send again' })).not.toBeInTheDocument() // nowhere to send it yet
    expect(screen.queryByRole('button', { name: /Send updated invite|Save notes/ })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText(/^Sarah's email/), 'noah@example.com')
    await user.click(screen.getByRole('button', { name: 'Send updated invite' }))

    expect(mocks.save).toHaveBeenCalledWith({
      id: 'inq-1',
      data: { startsAt: START, durationMinutes: 90, location: '12 Smith St', staffUserId: 'sam', notes: 'Gate code', contactEmail: 'noah@example.com', expectedUpdatedAt: 'v1' },
    })
  })

  it('keeps every edited value when a reschedule is refused', async () => {
    const user = userEvent.setup()
    mocks.save.mockRejectedValue({ isAxiosError: true, response: { status: 400, data: { errors: { staffUserId: ["Sam can't do intakes. Choose an active coordinator or admin."] } } } })
    panel(bookedRow())
    fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2030-10-17' } })
    await user.clear(screen.getByLabelText(/^Where/))
    await user.type(screen.getByLabelText(/^Where/), 'Library')

    await user.click(screen.getByRole('button', { name: 'Send updated invite' }))

    expect(await screen.findByText("Couldn't save the changes")).toBeInTheDocument()
    expect(screen.getByLabelText(/^Date/)).toHaveValue('2030-10-17')
    expect(screen.getByLabelText(/^Where/)).toHaveValue('Library')
  })

  it('sends again and marks confirmed, announcing each', async () => {
    const user = userEvent.setup()
    mocks.resend.mockResolvedValue(bookedRow({ intakeInviteSentAt: '2026-10-14T04:00:00Z', updatedAt: 'v2' }))
    mocks.confirm.mockResolvedValue(bookedRow({ intakeConfirmedAt: '2026-10-15T01:00:00Z', updatedAt: 'v3' }))
    panel(bookedRow({ intakeInviteError: 'Failed' }))

    expect(screen.getByText("Invite not sent: the email couldn't be sent. The visit is still booked.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Send again' }))
    expect(mocks.resend).toHaveBeenCalledWith({ id: 'inq-1', expectedUpdatedAt: 'v1' })
    expect(await screen.findByText('Invite sent again to priya.nair@example.com.au.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Mark confirmed' }))
    // Chained: each write carries the version the panel was last answered with, not the one it opened on.
    expect(mocks.confirm).toHaveBeenCalledWith({ id: 'inq-1', confirmed: true, expectedUpdatedAt: 'v2' })
    expect(await screen.findByText('Marked confirmed.')).toBeInTheDocument()
    expect(screen.getByText('Confirmed. Marked on Thu 15 Oct.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark not confirmed' })).toBeInTheDocument()
  })

  it('chains the version through a save: the next write after it sends what the save was answered with', async () => {
    const user = userEvent.setup()
    mocks.save.mockResolvedValue(bookedRow({ intakeNotes: 'Gate code 4321', updatedAt: 'v2' }))
    mocks.confirm.mockResolvedValue(bookedRow({ updatedAt: 'v3' }))
    panel(bookedRow())
    await user.clear(screen.getByLabelText(/^Notes for your team/))
    await user.type(screen.getByLabelText(/^Notes for your team/), 'Gate code 4321')
    await user.click(screen.getByRole('button', { name: 'Save notes' }))
    await screen.findByText('Notes saved.')

    await user.click(screen.getByRole('button', { name: 'Mark confirmed' }))

    expect(mocks.confirm).toHaveBeenCalledWith({ id: 'inq-1', confirmed: true, expectedUpdatedAt: 'v2' })
  })

  // A colleague changed the visit after this panel loaded: the server's 409 shows in the panel's refusal alert, the edits stay, and focus moves to it.
  describe('when a colleague changed the visit', () => {
    const changed = { isAxiosError: true, response: { status: 409, data: { success: false, errors: ['Someone else just changed this visit. Reload and try again.'] } } }

    it.each([
      ['Send updated invite', 'save'],
      ['Send again', 'resend'],
      ['Mark confirmed', 'confirm'],
    ] as const)('shows the refusal for %s and keeps what was typed', async (button, action) => {
      const user = userEvent.setup()
      mocks[action].mockRejectedValue(changed)
      panel(bookedRow({ intakeInviteError: 'Failed' }))
      await user.clear(screen.getByLabelText(/^Where/))
      await user.type(screen.getByLabelText(/^Where/), 'Library')

      await user.click(screen.getByRole('button', { name: button }))

      const alert = await screen.findByText('Someone else just changed this visit. Reload and try again.')
      expect(alert.closest('[tabindex="-1"]')).toHaveFocus()
      expect(screen.getByLabelText(/^Where/)).toHaveValue('Library')
    })

    it.each([
      ['Send updated invite', 'save', "Couldn't save the changes"],
      ['Send again', 'resend', "The invite wasn't sent"],
      ['Mark confirmed', 'confirm', "The visit wasn't changed"],
    ] as const)('titles the refusal for %s by what it was', async (button, action, title) => {
      const user = userEvent.setup()
      mocks[action].mockRejectedValue(changed)
      panel(bookedRow({ intakeInviteError: 'Failed' }))
      await user.type(screen.getByLabelText(/^Where/), ' Library')

      await user.click(screen.getByRole('button', { name: button }))

      expect(await screen.findByText(title)).toBeInTheDocument()
    })

    it('Reload takes the new version and booking, keeps what was typed, and the next Save sends the new version', async () => {
      const user = userEvent.setup()
      mocks.save.mockRejectedValueOnce(changed)
      const { refreshTo } = panel(bookedRow())
      await user.clear(screen.getByLabelText(/^Notes for your team/))
      await user.type(screen.getByLabelText(/^Notes for your team/), 'Gate code 4321')
      await user.click(screen.getByRole('button', { name: 'Save notes' }))
      await screen.findByText('Someone else just changed this visit. Reload and try again.')

      // The colleague moved the visit to 11:00 and the list refetched.
      refreshTo(bookedRow({ updatedAt: 'v9', intakeStartsAt: '2030-10-16T00:00:00Z' }))
      mocks.get.mockResolvedValue(bookedRow({ updatedAt: 'v9', intakeStartsAt: '2030-10-16T00:00:00Z' }))
      mocks.save.mockResolvedValue(bookedRow({ updatedAt: 'v10', intakeStartsAt: '2030-10-16T00:00:00Z', intakeNotes: 'Gate code 4321' }))
      await user.click(screen.getByRole('button', { name: 'Reload' }))

      expect(screen.queryByText('Someone else just changed this visit. Reload and try again.')).not.toBeInTheDocument()
      expect(screen.getByLabelText(/^Start time/)).toHaveValue('11:00')
      expect(screen.getByLabelText(/^Notes for your team/)).toHaveValue('Gate code 4321')
      expect(screen.getByRole('button', { name: 'Save notes' })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Save notes' }))

      expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ expectedUpdatedAt: 'v9', notes: 'Gate code 4321' }) }))
      expect(await screen.findByText('Notes saved.')).toBeInTheDocument()
    })

    it('Reload after a refused Send again shows the new visit and the next Send again sends its version', async () => {
      const user = userEvent.setup()
      mocks.resend.mockRejectedValueOnce(changed)
      const { refreshTo } = panel(bookedRow({ intakeInviteError: 'Failed' }))
      await user.click(screen.getByRole('button', { name: 'Send again' }))
      await screen.findByText("The invite wasn't sent")

      refreshTo(bookedRow({ updatedAt: 'v9', intakeLocation: 'Library', intakeInviteError: 'Failed' }))
      mocks.get.mockResolvedValue(bookedRow({ updatedAt: 'v9', intakeLocation: 'Library', intakeInviteError: 'Failed' }))
      mocks.resend.mockResolvedValue(bookedRow({ updatedAt: 'v10', intakeLocation: 'Library' }))
      await user.click(screen.getByRole('button', { name: 'Reload' }))
      expect(screen.getByLabelText(/^Where/)).toHaveValue('Library') // nothing was typed, so the form shows the colleague's visit
      await user.click(screen.getByRole('button', { name: 'Send again' }))

      expect(mocks.resend).toHaveBeenLastCalledWith({ id: 'inq-1', expectedUpdatedAt: 'v9' })
    })

    it('Reload retries a failed refresh without losing refusal or typed edits, then adopts a successful fresh version', async () => {
      const user = userEvent.setup()
      mocks.save.mockRejectedValueOnce(changed)
      panel(bookedRow())
      await user.type(screen.getByLabelText(/^Notes for your team/), ' typed')
      await user.click(screen.getByRole('button', { name: 'Save notes' }))
      await screen.findByText('Someone else just changed this visit. Reload and try again.')
      let rejectRefresh!: (error: Error) => void
      mocks.get.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectRefresh = reject }))
      await user.click(screen.getByRole('button', { name: 'Reload' }))
      expect(mocks.get).toHaveBeenCalledWith('/inquiries/inq-1')
      fireEvent.click(screen.getByRole('button', { name: 'Reloading…' }))
      expect(mocks.get).toHaveBeenCalledTimes(1)
      expect(mocks.save).toHaveBeenCalledTimes(1)
      expect(mocks.resend).not.toHaveBeenCalled()
      expect(mocks.confirm).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Reloading…' })).toHaveAttribute('aria-disabled', 'true')
      expect(screen.getByLabelText(/^Notes for your team/)).toHaveValue('Gate code typed')
      expect(screen.queryByText('Reloaded. Showing the latest changes.')).not.toBeInTheDocument()
      rejectRefresh(new Error('offline'))
      expect(await screen.findByText(/Couldn.t reload/)).toBeInTheDocument()
      expect(screen.getByText('Someone else just changed this visit. Reload and try again.')).toBeInTheDocument()
      expect(screen.getByLabelText(/^Notes for your team/)).toHaveValue('Gate code typed')
      mocks.get.mockResolvedValueOnce(bookedRow({ updatedAt: 'v9', intakeLocation: 'Library' }))
      await user.click(screen.getByRole('button', { name: 'Reload' }))
      await screen.findByText('Reloaded. Showing the latest changes.')
      expect(screen.getByLabelText(/^Where/)).toHaveValue('Library')
      expect(screen.getByLabelText(/^Notes for your team/)).toHaveValue('Gate code typed')
      mocks.save.mockResolvedValueOnce(bookedRow({ updatedAt: 'v10' }))
      await user.click(screen.getByRole('button', { name: 'Save notes' }))
      expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ expectedUpdatedAt: 'v9', notes: 'Gate code typed' }) }))
    })

    it('Reload waits while the list is still refetching', async () => {
      const user = userEvent.setup()
      mocks.confirm.mockRejectedValueOnce(changed)
      const { client } = panel(bookedRow())
      const pending = client.fetchQuery({ queryKey: ['participant-inquiries'], queryFn: () => new Promise(() => {}) })
      void pending.catch(() => {})
      await user.click(screen.getByRole('button', { name: 'Mark confirmed' }))

      const reload = await screen.findByRole('button', { name: 'Reload' })
      expect(reload).toHaveAttribute('aria-disabled', 'true')
      await user.click(reload)
      expect(screen.getByText('Someone else just changed this visit. Reload and try again.')).toBeInTheDocument()
    })

    it('keeps an unrelated409 refusal without offering version reload', async () => {
      const user = userEvent.setup()
      mocks.resend.mockRejectedValue({ isAxiosError: true, response: { status: 409, data: { success: false, errors: ["This visit has already happened, so there's no invite to send."] } } })
      panel(bookedRow())
      await user.click(screen.getByRole('button', { name: 'Send again' }))
      expect(await screen.findByText("This visit has already happened, so there's no invite to send.")).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument()
      expect(mocks.get).not.toHaveBeenCalled()
    })
    it('a busy staff member (a 409 with a field reason) is shown on its field, with no Reload', async () => {
      const user = userEvent.setup()
      mocks.save.mockRejectedValue({ isAxiosError: true, response: { status: 409, data: { success: false, errors: { staffUserId: ['Sam is busy then.'] } } } })
      panel(bookedRow())
      await user.type(screen.getByLabelText(/^Where/), ' Library')
      await user.click(screen.getByRole('button', { name: 'Send updated invite' }))

      expect((await screen.findAllByText('Sam is busy then.')).length).toBeGreaterThan(0)
      expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument()
    })
  })

  it('hands Cancel visit to the page, which owns the dialog', async () => {
    const user = userEvent.setup()
    const { onRequestCancel } = panel(bookedRow())

    await user.click(screen.getByRole('button', { name: 'Cancel visit' }))

    expect(onRequestCancel).toHaveBeenCalledWith(expect.objectContaining({ id: 'inq-1', intakeStartsAt: START }))
  })

  it('keeps a past visit as a record: no Send again, no confirmation line, no Cancel visit', () => {
    panel(bookedRow({ intakeStartsAt: '2026-01-05T23:00:00Z' }))

    expect(screen.getByText("This visit's time has passed. To book another time, change the date and time.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send again' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark confirmed' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel visit' })).not.toBeInTheDocument()
  })
})
