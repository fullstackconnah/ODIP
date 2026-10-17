import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
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
  useCloseInquiry: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReopenInquiry: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

const UPCOMING = '2030-10-15T23:00:00Z'
const base = { source: 'Phone', createdAt: '2026-09-28T01:10:00Z', participantId: null, timeZoneId: 'Australia/Sydney', email: 'family@example.com', contactIsParticipant: true, hasAddress: true }
const booking = { intakeStartsAt: UPCOMING, intakeDurationMinutes: 90, intakeLocation: '12 Smith St', intakeStaffUserId: 'sam', intakeStaffFirstName: 'Sam', intakeStaffName: 'Sam Lee' }
const rows = [
  { ...base, id: 'empty', firstName: 'Noah', lastName: 'Fitzgerald' },
  { ...base, ...booking, id: 'sent', firstName: 'Priya', lastName: 'Nair', intakeInviteSentAt: '2026-10-14T03:05:00Z', updatedAt: '2026-10-14T03:05:01.123456Z' },
  { ...base, ...booking, id: 'unsent', firstName: 'Mei', lastName: 'Tanaka', intakeInviteError: 'NotConfigured' },
  { ...base, ...booking, id: 'confirmed', firstName: 'Liam', lastName: 'Okafor', intakeInviteSentAt: '2026-10-14T03:05:00Z', intakeConfirmedAt: '2026-10-15T01:00:00Z' },
  { ...base, ...booking, id: 'past', firstName: 'Ava', lastName: 'Ng', intakeStartsAt: '2026-01-05T23:00:00Z', intakeInviteSentAt: '2026-01-01T00:00:00Z' },
  { ...base, id: 'p-direct', participantId: 'p-direct', firstName: 'Tomas', lastName: 'Becker', source: '', participantIsDraft: true, isDirectIntake: true },
]

function page(entry: string | { pathname: string; state: unknown } = '/inquiries') {
  const client = new QueryClient()
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/inquiries" element={<InquiriesTable />} />
          <Route path="/participants/new-inquiry" element={<p>Enquiry form</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...view, client }
}

const changed = { isAxiosError: true, response: { status: 409, data: { success: false, errors: ['Someone else just changed this visit. Reload and try again.'] } } }

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

  // Fix round 2 (FINISH review 2): two lines in every row. Line 1 is the visit alone; the reply badge leads line 2, beside what the invite did, so a
  // long line 1 never pushes the badge onto a line of its own (it used to, on Priya's phone card only).
  it('puts the reply badge on line 2, beside the invite fact', () => {
    page()

    const line1 = screen.getByRole('button', { name: /intake visit for Priya Nair$/ })
    const badge = within(line1.parentElement!).getByText('Not confirmed')
    expect(line1).not.toContainElement(badge)
    expect(badge.closest('[data-intake-line2]')).toHaveTextContent('Invite sent')
    const pastBadge = screen.getByText('Past') // a past visit's line 2 is the badge alone
    expect(pastBadge.closest('[data-intake-line2]')).toHaveTextContent(/^Past$/)
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
  it('holds the visit actions only on a booked row (elsewhere just Close enquiry), and marks a visit confirmed with a notice', async () => {
    const user = userEvent.setup()
    mocks.confirmVisit.mockResolvedValue({})
    page()

    // A row with no booking has one menu, with Close enquiry alone (spec addendum E1); a booked row's phone menu comes first.
    await user.click(screen.getByRole('button', { name: 'More actions for Noah Fitzgerald' }))
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Close enquiry'])
    await user.keyboard('{Escape}')
    await user.click(screen.getAllByRole('button', { name: 'More actions for Priya Nair' })[0])
    await user.click(screen.getByRole('option', { name: 'Mark confirmed' }))

    expect(mocks.confirmVisit).toHaveBeenCalledWith({ id: 'sent', confirmed: true, expectedUpdatedAt: '2026-10-14T03:05:01.123456Z' })
    expect(await screen.findByText("Priya Nair's intake visit is marked confirmed.")).toBeInTheDocument()
    expect(screen.queryByText('Enquiry form')).not.toBeInTheDocument() // the item's click never reached the row (it would open the form)
  })

  it('offers only Reschedule and Edit enquiry for a past visit', async () => {
    const user = userEvent.setup()
    page()

    await user.click(screen.getAllByRole('button', { name: 'More actions for Ava Ng' })[0])

    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Reschedule', 'Edit enquiry', 'Close enquiry'])
  })

  it('cancels behind a confirm dialog and says when the cancellation email could not go', async () => {
    const user = userEvent.setup()
    mocks.cancelVisit.mockResolvedValue({ inquiry: { ...rows[1], intakeStartsAt: null }, cancellationEmail: 'NotConfigured' })
    page()

    await user.click(screen.getAllByRole('button', { name: 'More actions for Priya Nair' })[0])
    await user.click(screen.getByRole('option', { name: 'Cancel visit' }))
    const dialog = screen.getByRole('alertdialog', { name: "Cancel Priya Nair's intake visit?" })
    expect(dialog).toHaveTextContent(/We'll email Priya a cancellation for Wed 16 Oct( 2030)?, 10:00 am, and the visit comes off Sam's schedule\./)
    // Fix round 2: the date and time never break across lines ("10:00" / "am"), as on line 1.
    expect(dialog.textContent).toMatch(/16\u00a0Oct(\u00a02030)?,\u00a010/)
    expect(dialog.textContent).toContain('10:00\u00a0am')
    await user.click(screen.getByRole('button', { name: 'Cancel visit' }))

    // The table's Cancel sends the version the row holds, so a stale list is a 409 and nobody is emailed.
    expect(mocks.cancelVisit).toHaveBeenCalledWith({ id: 'sent', expectedUpdatedAt: '2026-10-14T03:05:01.123456Z' })
    expect(await screen.findByText('Intake visit cancelled, email not sent')).toBeInTheDocument()
    expect(screen.getByText("Email isn't set up yet, so Priya wasn't told. Let them know another way.")).toBeInTheDocument()
  })
})

describe('when a colleague changed the visit', () => {
  it("the table's Mark confirmed says why it was refused", async () => {
    const user = userEvent.setup()
    mocks.confirmVisit.mockRejectedValue(changed)
    page()

    await user.click(screen.getAllByRole('button', { name: 'More actions for Priya Nair' })[0])
    await user.click(screen.getByRole('option', { name: 'Mark confirmed' }))

    expect(await screen.findByText('Someone else just changed this visit. Reload and try again.')).toBeInTheDocument()
  })

  it('a refused cancel shows the new visit in the dialog, and the next press sends its version', async () => {
    const user = userEvent.setup()
    // The list is a live query, as in the app: a refetch after the refusal changes the row under the open dialog.
    mocks.inquiries.mockImplementation(() => ({ ...useQuery({ queryKey: ['participant-inquiries'], queryFn: async () => rows, initialData: rows, staleTime: Infinity }), refetch: vi.fn() }))
    mocks.cancelVisit.mockRejectedValueOnce(changed)
    mocks.cancelVisit.mockResolvedValue({ inquiry: { ...rows[1], intakeStartsAt: null }, cancellationEmail: 'NoInvite' })
    const { client } = page()

    await user.click(screen.getAllByRole('button', { name: 'More actions for Priya Nair' })[0])
    await user.click(screen.getByRole('option', { name: 'Cancel visit' }))
    await user.click(screen.getByRole('button', { name: 'Cancel visit' }))
    await within(screen.getByRole('alertdialog')).findByText('Someone else just changed this visit. Reload and try again.')
    expect(mocks.cancelVisit).toHaveBeenLastCalledWith({ id: 'sent', expectedUpdatedAt: '2026-10-14T03:05:01.123456Z' })

    // The colleague moved the visit to Thu 17 Oct and the list refetched.
    act(() => { client.setQueryData(['participant-inquiries'], rows.map(r => (r.id === 'sent' ? { ...r, updatedAt: 'v9', intakeStartsAt: '2030-10-16T23:00:00Z' } : r))) })
    await waitFor(() => expect(screen.getByRole('alertdialog').textContent).toMatch(/17 Oct/))
    await user.click(screen.getByRole('button', { name: 'Cancel visit' }))

    expect(mocks.cancelVisit).toHaveBeenLastCalledWith({ id: 'sent', expectedUpdatedAt: 'v9' })
    expect(await screen.findByText('Intake visit cancelled')).toBeInTheDocument()
  })
})

describe("the enquiry form's summary", () => {
  it("shows the enquiry form's summary once, as a notice about that row", async () => {
    const enquiryNotice = { tone: 'success', title: 'Enquiry captured', message: 'Ana Lopez is on the Enquiries list.', subject: 'new' }
    page({ pathname: '/inquiries', state: { enquiryNotice } })

    expect(await screen.findByText('Enquiry captured')).toBeInTheDocument()
    expect(screen.getAllByText('Ana Lopez is on the Enquiries list.')).toHaveLength(1)
  })
})
