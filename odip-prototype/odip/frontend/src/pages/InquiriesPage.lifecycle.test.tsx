import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import InquiriesPage from './InquiriesPage'

// L2-14: the Enquiries tab said "Draft intake" with a "Resume intake" button for every converted enquiry, for ever, because the list
// carried nothing about the participant it became. The API now sends the participant's state; the tab says where each enquiry has got to
// and offers the next step that is real. Resuming an intake that is already complete led to the L2-03 data loss.
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/inquiries']}>
      <Routes>
        <Route path="/inquiries" element={<InquiriesPage />} />
        <Route path="/participants/:id/intake" element={<p>Intake wizard destination</p>} />
        <Route path="/onboarding/:id" element={<p>Onboarding detail destination</p>} />
        <Route path="/participants/:id" element={<p>Participant detail destination</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
  mocks.convert.mockReset()
})

describe('InquiriesPage — what each converted enquiry has become', () => {
  it('offers Resume intake only while the intake is still incomplete', async () => {
    mocks.inquiries.mockReturnValue({ data: [row()], isLoading: false })
    const user = userEvent.setup()
    renderPage()

    expect(within(screen.getByRole('table')).getByText('Draft intake')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Resume intake' }))
    expect(screen.getByText('Intake wizard destination')).toBeInTheDocument()
  })

  it('says "Intake complete" and points at the onboarding record, not at the intake wizard, once the intake is complete', async () => {
    mocks.inquiries.mockReturnValue({ data: [row({ participantIntakeCompletedAt: '2026-09-20T03:00:00' })], isLoading: false })
    const user = userEvent.setup()
    renderPage()

    expect(screen.queryByRole('button', { name: 'Resume intake' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('table')).getByText('Intake complete')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open onboarding' }))
    expect(screen.getByText('Onboarding detail destination')).toBeInTheDocument()
  })

  it('says "Participant" and opens their record once they are finalised, and never offers to resume an intake', async () => {
    mocks.inquiries.mockReturnValue({
      data: [row({ participantIsDraft: false, participantIsActive: true, participantIntakeCompletedAt: '2026-09-20T03:00:00' })],
      isLoading: false,
    })
    const user = userEvent.setup()
    renderPage()

    expect(screen.queryByRole('button', { name: 'Resume intake' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('table')).getByText('Participant')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open participant' }))
    expect(screen.getByText('Participant detail destination')).toBeInTheDocument()
  })

  it('still offers Start intake for an enquiry that has no participant yet', () => {
    mocks.inquiries.mockReturnValue({ data: [row({ participantId: null, participantIsDraft: null, participantIsActive: null })], isLoading: false })
    renderPage()

    expect(screen.getByRole('button', { name: 'Start intake' })).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getByText('New')).toBeInTheDocument()
  })

  it('counts and filters by the real state: Draft intake counts only the enquiries whose intake is still open', async () => {
    mocks.inquiries.mockReturnValue({
      data: [
        row({ id: 'a', firstName: 'Open', lastName: 'Intake' }),
        row({ id: 'b', firstName: 'Done', lastName: 'Intake', participantIntakeCompletedAt: '2026-09-20T03:00:00' }),
        row({ id: 'c', firstName: 'Brand', lastName: 'New', participantId: null, participantIsDraft: null, participantIsActive: null }),
      ],
      isLoading: false,
    })
    const user = userEvent.setup()
    renderPage()

    expect(screen.getByRole('radio', { name: 'All (3)' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'New (1)' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Draft intake (1)' })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Draft intake (1)' }))
    expect(screen.getByText('Open Intake')).toBeInTheDocument()
    expect(screen.queryByText('Done Intake')).not.toBeInTheDocument()
  })
})

describe('InquiriesPage — Start intake failures', () => {
  it('shows the server\'s own reason, not a fixed sentence', async () => {
    mocks.inquiries.mockReturnValue({ data: [row({ participantId: null, participantIsDraft: null, participantIsActive: null })], isLoading: false })
    mocks.convert.mockImplementation((_vars: unknown, options: { onError: (error: unknown) => void }) => options.onError(apiError('Inquiry has already been converted.')))
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Start intake' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Inquiry has already been converted.')
  })
})
