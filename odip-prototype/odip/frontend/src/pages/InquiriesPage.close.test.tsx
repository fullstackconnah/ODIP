import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { InquiriesTable } from './InquiriesPage'

const mocks = vi.hoisted(() => ({ inquiries: vi.fn(), close: vi.fn(), reopen: vi.fn() }))
vi.mock('@/api/hooks', () => ({
  useParticipantInquiries: mocks.inquiries,
  useConvertParticipantInquiry: () => ({ mutate: vi.fn(), isPending: false }),
  useConfirmIntakeBooking: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelIntakeBooking: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetIntakeBooking: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useResendIntakeInvite: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useStaff: () => ({ data: [], isLoading: false }),
  useCloseInquiry: () => ({ mutateAsync: mocks.close, isPending: false }),
  useReopenInquiry: () => ({ mutateAsync: mocks.reopen, isPending: false }),
}))

const UPCOMING = '2030-10-15T23:00:00Z'
const base = { source: 'Phone', createdAt: '2026-09-28T01:10:00Z', participantId: null, timeZoneId: 'Australia/Sydney', email: 'ana@example.com', contactIsParticipant: true, hasAddress: true }
const open = [
  { ...base, id: 'new', firstName: 'Noah', lastName: 'Fitzgerald' },
  { ...base, id: 'booked', firstName: 'Ana', lastName: 'Lopez', intakeStartsAt: UPCOMING, intakeDurationMinutes: 90, intakeStaffUserId: 'kim', intakeStaffFirstName: 'Kim', intakeStaffName: 'Kim Lee', intakeInviteSentAt: '2026-10-14T03:05:00Z', updatedAt: '2026-10-15T02:00:00.123456Z' },
  { ...base, id: 'draft', participantId: 'p-1', participantIsDraft: true, firstName: 'Mei', lastName: 'Tanaka' },
  { ...base, id: 'p-direct', participantId: 'p-direct', participantIsDraft: true, isDirectIntake: true, firstName: 'Tomas', lastName: 'Becker', source: '' },
]
const closed = [{ ...base, id: 'gone', firstName: 'Ivy', lastName: 'Park', closedAt: '2026-10-16T01:00:00Z', closeOutcome: 'NotGoingAhead', closeNote: 'Chose a provider closer to home', updatedAt: '2026-10-16T01:00:00.654321Z' }]

function Probe() {
  const location = useLocation()
  return <p data-testid="url">{`${location.pathname}${location.search}`}</p>
}

function page() {
  return render(
    <MemoryRouter initialEntries={['/participants?tab=enquiries']}>
      <Routes>
        <Route path="/participants" element={<><InquiriesTable /><Probe /></>} />
        <Route path="/participants/new-inquiry" element={<p>Enquiry form</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator', id: 'dana' }))
  mocks.inquiries.mockImplementation((view = 'open') => ({ data: view === 'closed' ? closed : open, isLoading: false, isError: false, refetch: vi.fn() }))
  mocks.close.mockReset()
  mocks.reopen.mockReset()
})

describe('closing an enquiry from the table', () => {
  it('Close is offered only on rows that can close', async () => {
    const user = userEvent.setup()
    page()

    await user.click(screen.getByRole('button', { name: 'More actions for Noah Fitzgerald' }))
    expect(screen.getByRole('option', { name: 'Close enquiry' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('button', { name: 'More actions for Mei Tanaka' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'More actions for Tomas Becker' })).not.toBeInTheDocument()
  })

  it('a role without lifecycle rights gets no menu', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'SupportWorker', id: 'sw' }))
    page()
    expect(screen.queryByRole('button', { name: /^More actions for/ })).not.toBeInTheDocument()
  })

  it('Close sends the outcome and note, then a notice whose Dismiss takes focus', async () => {
    mocks.close.mockResolvedValue({ inquiry: { ...open[1], closeOutcome: 'NotGoingAhead' }, cancellationEmail: 'Sent' })
    const user = userEvent.setup()
    page()

    await user.click(screen.getAllByRole('button', { name: 'More actions for Ana Lopez' })[0])
    await user.click(screen.getByRole('option', { name: 'Close enquiry' }))
    const dialog = screen.getByRole('alertdialog', { name: "Close Ana Lopez's enquiry?" })
    const said = dialog.textContent?.replaceAll(' ', ' ')
    expect(said).toContain('Closing cancels the intake visit on Wed 16 Oct 2030, 10:00 am.')
    expect(said).toContain("We'll email Ana a cancellation, and it comes off Kim's schedule.")
    await user.selectOptions(within(dialog).getByLabelText(/^Why is it closing/), 'Not going ahead (their decision)')
    await user.type(within(dialog).getByLabelText(/^Note/), 'Chose another provider')
    await user.click(within(dialog).getByRole('button', { name: 'Close enquiry' }))

    // The version the table loaded goes with it, so a booking or edit since then makes the close a 409 (verify C1).
    expect(mocks.close).toHaveBeenCalledWith({ id: 'booked', data: { outcome: 'NotGoingAhead', note: 'Chose another provider', expectedUpdatedAt: '2026-10-15T02:00:00.123456Z' } })
    expect(await screen.findByText("Ana Lopez's enquiry is closed: Not going ahead. Their intake visit is cancelled and Ana was emailed.")).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dismiss notice about Enquiry closed' })).toHaveFocus())
  })

  it('Close needs an outcome', async () => {
    const user = userEvent.setup()
    page()

    await user.click(screen.getByRole('button', { name: 'More actions for Noah Fitzgerald' }))
    await user.click(screen.getByRole('option', { name: 'Close enquiry' }))
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Close enquiry' }))

    expect(within(dialog).getByText("Choose why it's closing.")).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/^Why is it closing/)).toHaveFocus()
    expect(mocks.close).not.toHaveBeenCalled()
  })

  it('a refused close keeps the dialog with the server\'s sentence', async () => {
    mocks.close.mockRejectedValue({ isAxiosError: true, response: { status: 409, data: { success: false, errors: ["Intake has started for Noah, so this enquiry can't be closed."], code: 'inquiry-converted' } } })
    const user = userEvent.setup()
    page()

    await user.click(screen.getByRole('button', { name: 'More actions for Noah Fitzgerald' }))
    await user.click(screen.getByRole('option', { name: 'Close enquiry' }))
    const dialog = screen.getByRole('alertdialog')
    await user.selectOptions(within(dialog).getByLabelText(/^Why is it closing/), 'Other')
    await user.click(within(dialog).getByRole('button', { name: 'Close enquiry' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent("Intake has started for Noah, so this enquiry can't be closed.")
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })
})

describe('the Open and Closed views', () => {
  it('Open | Closed lives in the URL, and the Closed view shows outcome, note and date', async () => {
    const user = userEvent.setup()
    page()

    await user.click(screen.getByRole('radio', { name: 'Closed' }))

    expect(screen.getByTestId('url')).toHaveTextContent('/participants?tab=enquiries&view=closed')
    expect(mocks.inquiries).toHaveBeenLastCalledWith('closed')
    const row = screen.getByRole('row', { name: /Ivy Park/ })
    expect(row).toHaveTextContent('Not going ahead')
    expect(row).toHaveTextContent('Chose a provider closer to home')
    expect(row).toHaveTextContent('Fri 16 Oct')
    await user.type(screen.getByPlaceholderText(/Search enquiries/), 'closer to home')
    expect(screen.getByRole('row', { name: /Ivy Park/ })).toBeInTheDocument()
    // Finish review 2: the no-match state names the view it is in.
    await user.clear(screen.getByPlaceholderText(/Search enquiries/))
    await user.type(screen.getByPlaceholderText(/Search enquiries/), 'nobody matches this')
    expect(screen.getByText('Try a different search term, or clear the search to see every closed enquiry.')).toBeInTheDocument()
  })

  it('Reopen from the Closed view: the dialog, then a notice whose Open enquiry link takes focus', async () => {
    mocks.reopen.mockResolvedValue({ ...closed[0], closedAt: null, closeOutcome: null, closeNote: null })
    const user = userEvent.setup()
    page()
    await user.click(screen.getByRole('radio', { name: 'Closed' }))

    await user.click(screen.getByRole('button', { name: 'Reopen Ivy Park' }))
    const dialog = screen.getByRole('alertdialog', { name: "Reopen Ivy Park's enquiry?" })
    expect(dialog).toHaveTextContent('Its other contacts were deleted when it closed, so add them again, and book a new intake visit if you need one.')
    await user.click(within(dialog).getByRole('button', { name: 'Reopen enquiry' }))

    expect(mocks.reopen).toHaveBeenCalledWith({ id: 'gone', expectedUpdatedAt: '2026-10-16T01:00:00.654321Z' })
    expect(await screen.findByText('Ivy Park is back on the Open list.')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Open enquiry' })
    expect(link).toHaveAttribute('href', '/participants/new-inquiry?id=gone')
    await waitFor(() => expect(link).toHaveFocus())
  })

  it('An empty Closed view says so', async () => {
    mocks.inquiries.mockImplementation((view = 'open') => ({ data: view === 'closed' ? [] : open, isLoading: false, isError: false, refetch: vi.fn() }))
    const user = userEvent.setup()
    page()
    await user.click(screen.getByRole('radio', { name: 'Closed' }))

    expect(screen.getByText('No closed enquiries')).toBeInTheDocument()
    expect(screen.getByText('Enquiries you close show here, with why and when. You can reopen one.')).toBeInTheDocument()
  })
})

describe('the Closed view for a role without lifecycle rights', () => {
  it('has no Note column (SHAPE section 11: outcome and date only) and no Reopen', async () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'SupportWorker', id: 'sw' }))
    const user = userEvent.setup()
    page()
    await user.click(screen.getByRole('radio', { name: 'Closed' }))

    expect(screen.getByRole('columnheader', { name: /Outcome/ })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /^Note/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Reopen/ })).not.toBeInTheDocument()
  })
})
