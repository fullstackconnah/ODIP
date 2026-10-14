import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { InquiriesTable } from './InquiriesPage'

const mocks = vi.hoisted(() => ({ inquiries: vi.fn(), confirmVisit: vi.fn(), cancelVisit: vi.fn() }))
vi.mock('@/api/hooks', () => ({
  useParticipantInquiries: mocks.inquiries,
  useConvertParticipantInquiry: () => ({ mutate: vi.fn(), isPending: false }),
  useConfirmIntakeBooking: () => ({ mutateAsync: mocks.confirmVisit, isPending: false }),
  useCancelIntakeBooking: () => ({ mutateAsync: mocks.cancelVisit, isPending: false }),
  useSetIntakeBooking: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useResendIntakeInvite: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useStaff: () => ({ data: [], isLoading: false }),
}))

const UPCOMING = '2030-10-15T23:00:00Z'
const base = { source: 'Phone', createdAt: '2026-09-28T01:10:00Z', participantId: null, timeZoneId: 'Australia/Sydney', email: 'family@example.com' }
const booking = { intakeStartsAt: UPCOMING, intakeDurationMinutes: 90, intakeLocation: '12 Smith St', intakeStaffUserId: 'sam', intakeStaffFirstName: 'Sam', intakeStaffName: 'Sam Lee' }
const rows = [
  { ...base, id: 'empty', firstName: 'Noah', lastName: 'Fitzgerald' },
  { ...base, ...booking, id: 'sent', firstName: 'Priya', lastName: 'Nair', intakeInviteSentAt: '2026-10-14T03:05:00Z' },
  { ...base, ...booking, id: 'unsent', firstName: 'Mei', lastName: 'Tanaka', intakeInviteError: 'NotConfigured' },
  { ...base, ...booking, id: 'confirmed', firstName: 'Liam', lastName: 'Okafor', intakeInviteSentAt: '2026-10-14T03:05:00Z', intakeConfirmedAt: '2026-10-15T01:00:00Z' },
  { ...base, ...booking, id: 'past', firstName: 'Ava', lastName: 'Ng', intakeStartsAt: '2026-01-05T23:00:00Z', intakeInviteSentAt: '2026-01-01T00:00:00Z' },
  { ...base, id: 'p-direct', participantId: 'p-direct', firstName: 'Tomas', lastName: 'Becker', source: '', participantIsDraft: true, isDirectIntake: true },
]

function page() {
  return render(
    <MemoryRouter initialEntries={['/inquiries']}>
      <Routes>
        <Route path="/inquiries" element={<InquiriesTable />} />
        <Route path="/participants/new-inquiry" element={<p>Enquiry form</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator', id: 'dana' }))
  mocks.inquiries.mockReturnValue({ data: rows, isLoading: false, isError: false, refetch: vi.fn() })
  mocks.confirmVisit.mockReset()
  mocks.cancelVisit.mockReset()
})

describe('the Intake column', () => {
  // Fix round 1 (SHAPE section 6): from md up the pinned Actions cluster stays on one row; only the phone card may wrap it.
  it('keeps the desktop actions on one row', () => {
    page()

    const cluster = screen.getByRole('button', { name: 'Start intake for Noah Fitzgerald' }).parentElement!
    expect(cluster).toHaveClass('flex-wrap', 'md:flex-nowrap')
  })

  it('shows each state in words, never colour alone', () => {
    page()

    expect(screen.getByRole('button', { name: 'Book intake for Noah Fitzgerald' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Wed 16 Oct( 2030)?, 10:00 am · Sam, intake visit for Priya Nair$/ })).toBeInTheDocument()
    expect(screen.getAllByText('Not confirmed')).toHaveLength(2) // Priya (sent) and Mei (not sent)
    expect(screen.getByText('Confirmed')).toBeInTheDocument() // Liam
    expect(screen.getByText('Past')).toBeInTheDocument() // Ava: no line 2 once the visit has happened
    expect(screen.getAllByText('Invite sent')).toHaveLength(2) // Priya and Liam
    expect(screen.getByText("Invite not sent: email isn't set up yet")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Book intake for Tomas Becker/ })).not.toBeInTheDocument() // a direct intake has no enquiry to book
    expect(screen.getByRole('button', { name: 'Edit enquiry for Noah Fitzgerald' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start intake for Noah Fitzgerald' })).toBeInTheDocument()
  })

  it('offers no booking to a read-only viewer: line 1 is text, not a button', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
    page()

    expect(screen.queryByRole('button', { name: /^Book intake/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /intake visit for Priya Nair/ })).not.toBeInTheDocument()
    expect(screen.getAllByText(/ · Sam$/).length).toBe(4)
  })

  it('opens the panel from Book intake and gives focus back to the row on close', async () => {
    const user = userEvent.setup()
    page()

    await user.click(screen.getByRole('button', { name: 'Book intake for Noah Fitzgerald' }))
    expect(screen.getByRole('dialog', { name: 'Intake visit for Noah Fitzgerald' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Book intake for Noah Fitzgerald' })).toHaveFocus())
  })
})

describe('the phone menu', () => {
  it('appears only on a booked row, and marks a visit confirmed with a notice', async () => {
    const user = userEvent.setup()
    mocks.confirmVisit.mockResolvedValue({})
    page()

    expect(screen.queryByRole('button', { name: 'More actions for Noah Fitzgerald' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'More actions for Priya Nair' }))
    await user.click(screen.getByRole('option', { name: 'Mark confirmed' }))

    expect(mocks.confirmVisit).toHaveBeenCalledWith({ id: 'sent', confirmed: true })
    expect(await screen.findByText("Priya Nair's intake visit is marked confirmed.")).toBeInTheDocument()
    expect(screen.queryByText('Enquiry form')).not.toBeInTheDocument() // the item's click never reached the row (it would open the form)
  })

  it('offers only Reschedule and Edit enquiry for a past visit', async () => {
    const user = userEvent.setup()
    page()

    await user.click(screen.getByRole('button', { name: 'More actions for Ava Ng' }))

    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Reschedule', 'Edit enquiry'])
  })

  it('cancels behind a confirm dialog and says when the cancellation email could not go', async () => {
    const user = userEvent.setup()
    mocks.cancelVisit.mockResolvedValue({ inquiry: { ...rows[1], intakeStartsAt: null }, cancellationEmail: 'NotConfigured' })
    page()

    await user.click(screen.getByRole('button', { name: 'More actions for Priya Nair' }))
    await user.click(screen.getByRole('option', { name: 'Cancel visit' }))
    const dialog = screen.getByRole('alertdialog', { name: "Cancel Priya Nair's intake visit?" })
    expect(dialog).toHaveTextContent(/We'll email Priya a cancellation for Wed 16 Oct( 2030)?, 10:00 am, and the visit comes off Sam's schedule\./)
    await user.click(screen.getByRole('button', { name: 'Cancel visit' }))

    expect(mocks.cancelVisit).toHaveBeenCalledWith('sent')
    expect(await screen.findByText('Intake visit cancelled, email not sent')).toBeInTheDocument()
    expect(screen.getByText("Email isn't set up yet, so Priya Nair wasn't told. Let them know another way.")).toBeInTheDocument()
  })
})
