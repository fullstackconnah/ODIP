import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { InquiriesTable } from './InquiriesPage'

// The Enquiries tab shows the pipeline's first stage only: open enquiries. An enquiry with no participant is "New", one whose intake has started and
// is not complete is "Draft intake". Once the intake is complete the participant is on the Onboarding tab, and once they are finalised they are on the
// Active participants tab, so the enquiry leaves this one (it used to stay, with an "Open onboarding" button that went to a detail page). L2-14 still
// holds: a row says where it has got to and offers the next step that is real. Resuming an intake that is already complete led to the L2-03 data loss.
const mocks = vi.hoisted(() => ({ inquiries: vi.fn(), convert: vi.fn() }))
vi.mock('@/api/hooks', () => ({
  useParticipantInquiries: mocks.inquiries,
  useCreateParticipantInquiry: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateParticipantInquiry: () => ({ mutate: vi.fn(), isPending: false }),
  useConvertParticipantInquiry: () => ({ mutate: mocks.convert, isPending: false }),
}))

const apiError = (message: string) => ({ response: { data: { success: false, errors: [message] } } })

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'inquiry-1', firstName: 'Ava', lastName: 'Ng', phone: '0400000000', email: null, source: 'Phone', provenance: null, createdAt: '2026-09-01',
  participantId: 'p-1', participantIsDraft: true, participantIsActive: false, participantIntakeCompletedAt: null,
  ...overrides,
})
const NO_PARTICIPANT = { participantId: null, participantIsDraft: null, participantIsActive: null }
const INTAKE_DONE = '2026-09-20T03:00:00'
/** A draft intake started in the Intake wizard with no enquiry: the server sends it in the same feed, flagged. */
const directIntake = (overrides: Record<string, unknown> = {}) => row({
  id: 'p-direct', participantId: 'p-direct', firstName: 'Dana', lastName: 'Direct', source: '', phone: '0411111111', email: 'dana@example.test', isDirectIntake: true,
  ...overrides,
})

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/inquiries']}>
      <Routes>
        <Route path="/inquiries" element={<InquiriesTable />} />
        <Route path="/participants/:id/intake" element={<p>Intake wizard destination</p>} />
        <Route path="/participants/new-inquiry" element={<p>Enquiry form destination</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
  mocks.convert.mockReset()
})

describe('InquiriesPage — open enquiries only', () => {
  it('offers Resume intake only while the intake is still incomplete', async () => {
    mocks.inquiries.mockReturnValue({ data: [row()], isLoading: false })
    const user = userEvent.setup()
    renderPage()

    expect(within(screen.getByRole('table')).getByText('Draft intake')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Resume intake' }))
    expect(screen.getByText('Intake wizard destination')).toBeInTheDocument()
  })

  it('still offers Start intake for an enquiry that has no participant yet', () => {
    mocks.inquiries.mockReturnValue({ data: [row(NO_PARTICIPANT)], isLoading: false })
    renderPage()

    expect(screen.getByRole('button', { name: 'Start intake' })).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getByText('New')).toBeInTheDocument()
  })

  it('lists only the open enquiries, New and Draft intake, and leaves out an enquiry whose intake is complete or whose participant is finalised', () => {
    mocks.inquiries.mockReturnValue({
      data: [
        row({ id: 'a', firstName: 'Open', lastName: 'Intake' }),
        row({ id: 'b', firstName: 'Done', lastName: 'Intake', participantIntakeCompletedAt: INTAKE_DONE }),
        row({ id: 'c', firstName: 'Brand', lastName: 'New', ...NO_PARTICIPANT }),
        row({ id: 'd', firstName: 'Fully', lastName: 'Active', participantIsDraft: false, participantIsActive: true, participantIntakeCompletedAt: INTAKE_DONE }),
        row({ id: 'e', firstName: 'Since', lastName: 'Archived', participantIsDraft: false, participantIsActive: false, participantIntakeCompletedAt: INTAKE_DONE }),
      ],
      isLoading: false,
    })
    renderPage()

    expect(screen.getByText('Open Intake')).toBeInTheDocument()
    expect(screen.getByText('Brand New')).toBeInTheDocument()
    expect(screen.queryByText('Done Intake')).not.toBeInTheDocument()
    expect(screen.queryByText('Fully Active')).not.toBeInTheDocument()
    expect(screen.queryByText('Since Archived')).not.toBeInTheDocument()
    // Those stages have moved to other tabs, so this tab has no button that points at them.
    expect(screen.queryByRole('button', { name: /open onboarding|open participant/i })).not.toBeInTheDocument()
    expect(within(screen.getByRole('table')).queryByText(/intake complete/i)).not.toBeInTheDocument()
  })

  it('has no status filter chips: the tab is the filter', () => {
    mocks.inquiries.mockReturnValue({ data: [row(), row({ id: 'b', ...NO_PARTICIPANT })], isLoading: false })
    renderPage()

    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /search enquiries/i })).toBeInTheDocument()
  })

  it('says "No open enquiries", not that none were ever captured, when every enquiry has moved on to onboarding or the register', () => {
    mocks.inquiries.mockReturnValue({
      data: [
        row({ id: 'b', participantIntakeCompletedAt: INTAKE_DONE }),
        row({ id: 'd', participantIsDraft: false, participantIsActive: true, participantIntakeCompletedAt: INTAKE_DONE }),
      ],
      isLoading: false,
    })
    renderPage()

    expect(screen.getByText('No open enquiries')).toBeInTheDocument()
    expect(screen.queryByText('No enquiries captured yet')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New enquiry' })).toBeInTheDocument()
  })
})

describe('InquiriesPage — a draft intake started without an enquiry', () => {
  it('is listed as an intake in progress, which can be resumed', async () => {
    mocks.inquiries.mockReturnValue({ data: [directIntake()], isLoading: false })
    const user = userEvent.setup()
    renderPage()

    const table = screen.getByRole('table')
    expect(within(table).getByText('Dana Direct')).toBeInTheDocument()
    expect(within(table).getByText('Draft intake')).toBeInTheDocument()
    expect(within(table).getByText('0411111111')).toBeInTheDocument()
    // No enquiry was captured, and the cell says so instead of showing an empty source.
    expect(within(table).getByText('Direct intake')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Resume intake' }))
    expect(screen.getByText('Intake wizard destination')).toBeInTheDocument()
  })

  it('cannot be edited as an enquiry, because there is no enquiry record behind it', () => {
    mocks.inquiries.mockReturnValue({ data: [directIntake(), row({ id: 'real', firstName: 'Real', lastName: 'Enquiry', ...NO_PARTICIPANT })], isLoading: false })
    renderPage()

    // One Edit enquiry button, for the real enquiry only.
    expect(screen.getAllByRole('button', { name: 'Edit enquiry' })).toHaveLength(1)
    const directRow = screen.getByText('Dana Direct').closest('tr') as HTMLElement
    expect(within(directRow).queryByRole('button', { name: 'Edit enquiry' })).not.toBeInTheDocument()
  })

  it('is found by the same search as an enquiry', async () => {
    mocks.inquiries.mockReturnValue({ data: [directIntake(), row({ id: 'real', firstName: 'Real', lastName: 'Enquiry', ...NO_PARTICIPANT })], isLoading: false })
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByRole('textbox', { name: /search enquiries/i }), 'dana')

    expect(screen.getByText('Dana Direct')).toBeInTheDocument()
    expect(screen.queryByText('Real Enquiry')).not.toBeInTheDocument()
  })
})

describe('InquiriesPage — Start intake failures', () => {
  it('shows the server\'s own reason, not a fixed sentence', async () => {
    mocks.inquiries.mockReturnValue({ data: [row(NO_PARTICIPANT)], isLoading: false })
    mocks.convert.mockImplementation((_vars: unknown, options: { onError: (error: unknown) => void }) => options.onError(apiError('Inquiry has already been converted.')))
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Start intake' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Inquiry has already been converted.')
  })
})
