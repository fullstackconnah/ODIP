import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntakeBookingPanel } from './IntakeBookingPanel'
import type { ParticipantInquiryDto } from '@/api/types/inquiries'

const mocks = vi.hoisted(() => ({ save: vi.fn(), confirm: vi.fn(), resend: vi.fn() }))
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
  email: 'priya.nair@example.com.au', timeZoneId: 'Australia/Sydney', ...overrides,
})
const bookedRow = (overrides: Partial<ParticipantInquiryDto> = {}) => newRow({
  intakeStartsAt: START, intakeDurationMinutes: 90, intakeLocation: '12 Smith St', intakeStaffUserId: 'sam', intakeStaffFirstName: 'Sam',
  intakeStaffName: 'Sam Lee', intakeNotes: 'Gate code', intakeInviteSentAt: '2026-10-14T03:05:00Z', intakeInviteError: null, ...overrides,
})

function panel(row: ParticipantInquiryDto) {
  const onClose = vi.fn()
  const onRequestCancel = vi.fn()
  render(<IntakeBookingPanel row={row} onClose={onClose} onRequestCancel={onRequestCancel} />)
  return { onClose, onRequestCancel }
}

async function fillNewBooking(user: ReturnType<typeof userEvent.setup>) {
  fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2030-10-16' } })
  fireEvent.change(screen.getByLabelText(/^Start time/), { target: { value: '10:00' } })
  await user.type(screen.getByLabelText(/^Where/), 'Library')
}

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator', id: 'dana', fullName: 'Dana Smith' }))
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
      data: { startsAt: START, durationMinutes: 90, location: 'Library', staffUserId: 'dana', notes: null },
    })
    expect(await screen.findByText("Invite not sent: email isn't set up yet. The visit is still booked, so let Noah know another way.")).toBeInTheDocument()
    expect(screen.getByText("Intake visit booked. Invite not sent: email isn't set up yet.")).toBeInTheDocument() // the live region
    expect(screen.queryByRole('button', { name: 'Send invite' })).not.toBeInTheDocument()
  })

  it('keeps every value and says why when the server refuses', async () => {
    const user = userEvent.setup()
    mocks.save.mockRejectedValue({ isAxiosError: true, response: { status: 400, data: { errors: { staffUserId: ["Dana can't do intakes. Choose an active coordinator or admin."] } } } })
    panel(newRow())
    await fillNewBooking(user)

    await user.click(screen.getByRole('button', { name: 'Send invite' }))

    expect(await screen.findByText("Couldn't book the visit")).toBeInTheDocument()
    expect(screen.getAllByText("Dana can't do intakes. Choose an active coordinator or admin.").length).toBeGreaterThan(0)
    expect(screen.getByLabelText(/^Date/)).toHaveValue('2030-10-16')
    expect(screen.getByLabelText(/^Start time/)).toHaveValue('10:00')
    expect(screen.getByLabelText(/^Where/)).toHaveValue('Library')
  })

  it('says the connection failed and keeps the entries', async () => {
    const user = userEvent.setup()
    mocks.save.mockRejectedValue({ isAxiosError: true })
    panel(newRow())
    await fillNewBooking(user)

    await user.click(screen.getByRole('button', { name: 'Send invite' }))

    expect(await screen.findByText("Couldn't reach ODIP. Check your connection and try again. Your entries are kept.")).toBeInTheDocument()
    expect(screen.getByLabelText(/^Where/)).toHaveValue('Library')
  })

  it('asks for the email when the enquiry has none, and sends it with the booking', async () => {
    const user = userEvent.setup()
    mocks.save.mockResolvedValue(bookedRow({ email: 'noah@example.com' }))
    panel(newRow({ email: null }))
    await waitFor(() => expect(screen.getByLabelText(/^Noah's email/)).toHaveFocus())
    await fillNewBooking(user)

    await user.click(screen.getByRole('button', { name: 'Send invite' }))
    expect(screen.getByText("Add Noah's email to send the invite.")).toBeInTheDocument()
    expect(mocks.save).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText(/^Noah's email/), 'noah@example.com')
    await user.click(screen.getByRole('button', { name: 'Send invite' }))
    expect(mocks.save).toHaveBeenCalledWith({
      id: 'inq-1',
      data: { startsAt: START, durationMinutes: 90, location: 'Library', staffUserId: 'dana', notes: null, contactEmail: 'noah@example.com' },
    })
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
    expect(screen.getByText('Not confirmed yet. Mark it when Noah replies or calls.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Save notes|Send updated invite/ })).not.toBeInTheDocument() // nothing changed yet
    await user.clear(screen.getByLabelText(/^Notes for your team/))
    await user.type(screen.getByLabelText(/^Notes for your team/), 'Gate code 4321')
    await user.click(screen.getByRole('button', { name: 'Save notes' }))

    expect(mocks.save).toHaveBeenCalledWith({
      id: 'inq-1',
      data: { startsAt: START, durationMinutes: 90, location: '12 Smith St', staffUserId: 'sam', notes: 'Gate code 4321' },
    })
    expect(await screen.findByText('Notes saved.')).toBeInTheDocument()
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
    await user.type(screen.getByLabelText(/^Noah's email/), 'noah@example.com')
    await user.click(screen.getByRole('button', { name: 'Send updated invite' }))

    expect(mocks.save).toHaveBeenCalledWith({
      id: 'inq-1',
      data: { startsAt: START, durationMinutes: 90, location: '12 Smith St', staffUserId: 'sam', notes: 'Gate code', contactEmail: 'noah@example.com' },
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
    mocks.resend.mockResolvedValue(bookedRow({ intakeInviteSentAt: '2026-10-14T04:00:00Z' }))
    mocks.confirm.mockResolvedValue(bookedRow({ intakeConfirmedAt: '2026-10-15T01:00:00Z' }))
    panel(bookedRow({ intakeInviteError: 'Failed' }))

    expect(screen.getByText("Invite not sent: the email couldn't be sent. The visit is still booked.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Send again' }))
    expect(mocks.resend).toHaveBeenCalledWith('inq-1')
    expect(await screen.findByText('Invite sent again to priya.nair@example.com.au.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Mark confirmed' }))
    expect(mocks.confirm).toHaveBeenCalledWith({ id: 'inq-1', confirmed: true })
    expect(await screen.findByText('Marked confirmed.')).toBeInTheDocument()
    expect(screen.getByText('Confirmed. Marked on Thu 15 Oct.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark not confirmed' })).toBeInTheDocument()
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
