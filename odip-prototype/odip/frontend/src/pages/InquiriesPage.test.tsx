import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { InquiriesTable } from './InquiriesPage'

const mocks = vi.hoisted(() => ({ inquiries: vi.fn(), create: vi.fn(), update: vi.fn(), convert: vi.fn(), refetch: vi.fn() }))
vi.mock('@/api/hooks', () => ({
  useParticipantInquiries: mocks.inquiries,
  useCreateParticipantInquiry: () => ({ mutate: mocks.create, isPending: false }),
  useUpdateParticipantInquiry: () => ({ mutate: mocks.update, isPending: false }),
  useConvertParticipantInquiry: () => ({ mutate: mocks.convert, isPending: false }),
}))

const inquiry = (overrides: Record<string, unknown> = {}) => ({ id: 'inquiry-1', firstName: 'Ava', lastName: 'Ng', phone: '0400000000', email: null, source: 'Phone', provenance: 'Referral', participantId: null, ...overrides })
function page() {
  return render(
    <MemoryRouter initialEntries={['/inquiries']}>
      <Routes>
        <Route path="/inquiries" element={<InquiriesTable />} />
        <Route path="/participants/:id/intake" element={<p>Draft intake destination</p>} />
        <Route path="/participants/new-inquiry" element={<p>New inquiry form</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
  mocks.inquiries.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: mocks.refetch })
  mocks.convert.mockReset()
  mocks.refetch.mockReset()
})

describe('InquiriesPage lifecycle handoff', () => {
  it('shows the empty state with a New enquiry CTA that routes to /participants/new-inquiry', async () => {
    const user = userEvent.setup()
    page()
    expect(screen.getByText('No open enquiries')).toBeInTheDocument()
    expect(screen.queryByLabelText(/First name/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'New enquiry' }))
    // Inline capture has been replaced by a routed page; the standalone /inquiries
    // route no longer mounts the form fields itself.
    expect(screen.getByText('New inquiry form')).toBeInTheDocument()
  })

  it('renders Start intake for an unconverted inquiry and routes to intake after successful conversion', async () => {
    const user = userEvent.setup()
    mocks.inquiries.mockReturnValue({ data: [inquiry()], isLoading: false })
    mocks.convert.mockImplementation((_data: unknown, options: { onSuccess: (value: unknown) => void }) => options.onSuccess(inquiry({ participantId: 'draft-9' })))
    page()
    await user.click(screen.getByRole('button', { name: 'Start intake' }))
    expect(mocks.convert).toHaveBeenCalledWith({ id: 'inquiry-1' }, expect.any(Object))
    expect(screen.getByText('Draft intake destination')).toBeInTheDocument()
  })

  it('renders Resume intake for a converted inquiry and keeps inquiry editing separate', async () => {
    const user = userEvent.setup()
    mocks.inquiries.mockReturnValue({ data: [inquiry({ participantId: 'draft-3' })], isLoading: false })
    page()
    expect(screen.getByRole('button', { name: 'Edit enquiry' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start intake' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Resume intake' }))
    expect(screen.getByText('Draft intake destination')).toBeInTheDocument()
  })

  it('uses the named lifecycle capability to suppress all mutation controls for unavailable roles', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
    mocks.inquiries.mockReturnValue({ data: [inquiry()], isLoading: false })
    page()
    expect(screen.getByRole('status')).toHaveTextContent(/cannot capture, edit, or start/i)
    expect(screen.queryByRole('button', { name: /capture enquiry|edit enquiry|start intake/i })).not.toBeInTheDocument()
  })

  it('keeps loading visible and announces conversion errors', async () => {
    mocks.inquiries.mockReturnValue({ data: [], isLoading: true })
    page()
    expect(screen.getByText('Loading...')).toBeInTheDocument()

    const user = userEvent.setup()
    mocks.inquiries.mockReturnValue({ data: [inquiry()], isLoading: false })
    mocks.convert.mockImplementation((_data: unknown, options: { onError: () => void }) => options.onError())
    page()
    await user.click(screen.getByRole('button', { name: 'Start intake' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Could not start intake. Please try again.')
  })

  it('shows a retry-able error banner instead of the empty state when the fetch fails', async () => {
    mocks.inquiries.mockReturnValue({ data: [], isLoading: false, isError: true, refetch: mocks.refetch })
    const user = userEvent.setup()
    page()
    expect(screen.getByRole('alert')).toHaveTextContent(/could not load enquiries/i)
    expect(screen.queryByText('No open enquiries')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(mocks.refetch).toHaveBeenCalledOnce()
  })

  it('filters enquiries by search term, and offers a reset when nothing matches', async () => {
    mocks.inquiries.mockReturnValue({ data: [
      { id: 'e-1', firstName: 'Dana', lastName: 'Reyes', phone: '0400 000 111', email: 'dana@example.com', source: 'Phone', provenance: 'GP referral', participantId: null, createdAt: '2026-09-01' },
      { id: 'e-2', firstName: 'Rowan', lastName: 'Blake', phone: '0400 000 222', email: 'rowan@example.com', source: 'Web', provenance: '', participantId: 'p-9', createdAt: '2026-09-02' },
    ], isLoading: false })
    const user = userEvent.setup()
    page()

    expect(screen.getByText('Dana Reyes')).toBeInTheDocument()
    expect(screen.getByText('Rowan Blake')).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: /search enquiries/i }), 'rowan')
    expect(screen.queryByText('Dana Reyes')).not.toBeInTheDocument()
    expect(screen.getByText('Rowan Blake')).toBeInTheDocument()

    await user.clear(screen.getByRole('textbox', { name: /search enquiries/i }))
    expect(screen.getByText('Dana Reyes')).toBeInTheDocument()
    expect(screen.getByText('Rowan Blake')).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: /search enquiries/i }), 'no such person')
    expect(screen.getByText('No enquiries match your search')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getByText('Dana Reyes')).toBeInTheDocument()
  })

  const LONG_PROVENANCE = "Referral from a long GP letter about mobility supports and behaviours. Referral from a long GP letter about mobility supports and behaviours. Referral from a long GP letter about mobility supports and behaviours. Referral from a long GP letter about mobility supports and behaviours."

  it('leads each row with the primary action and caps the Provenance cell', () => {
    mocks.inquiries.mockReturnValue({ data: [
      { id: 'q-1', firstName: 'Row', lastName: 'Order', phone: '0400', source: 'Phone', provenance: LONG_PROVENANCE, participantId: 'p-1' },
    ], isLoading: false })
    page()
    const resume = screen.getByRole('button', { name: 'Resume intake' })
    const editBtn = screen.getByRole('button', { name: 'Edit enquiry' })
    // the primary CTA must precede the outlined secondary in DOM reading order
    expect(resume.compareDocumentPosition(editBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // provenance is truncated and carries the full text for hover
    const prov = screen.getByTitle(LONG_PROVENANCE)
    expect(prov).toHaveClass('truncate', 'max-w-[280px]')
  })
})