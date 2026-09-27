import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import InquiriesPage from './InquiriesPage'

const mocks = vi.hoisted(() => ({ inquiries: vi.fn(), create: vi.fn(), update: vi.fn(), convert: vi.fn() }))
vi.mock('@/api/hooks', () => ({
  useParticipantInquiries: mocks.inquiries,
  useCreateParticipantInquiry: () => ({ mutate: mocks.create, isPending: false }),
  useUpdateParticipantInquiry: () => ({ mutate: mocks.update, isPending: false }),
  useConvertParticipantInquiry: () => ({ mutate: mocks.convert, isPending: false }),
}))

const inquiry = (overrides: Record<string, unknown> = {}) => ({ id: 'inquiry-1', firstName: 'Ava', lastName: 'Ng', phone: '0400000000', email: null, source: 'Phone', provenance: 'Referral', participantId: null, ...overrides })
function page() { return render(<MemoryRouter initialEntries={['/inquiries']}><Routes><Route path="/inquiries" element={<InquiriesPage />} /><Route path="/participants/:id/intake" element={<p>Draft intake destination</p>} /></Routes></MemoryRouter>) }

beforeEach(() => { localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' })); mocks.inquiries.mockReturnValue({ data: [], isLoading: false }); mocks.convert.mockReset() })

describe('InquiriesPage lifecycle handoff', () => {
  it('renders FormField-labelled compact capture controls and the empty state', () => {
    page()
    expect(screen.getByText('No inquiries captured yet')).toBeInTheDocument()
    const firstName = screen.getByLabelText(/First name/)
    expect(firstName).toHaveAttribute('autocomplete', 'given-name')
    expect(firstName).toHaveAttribute('aria-required', 'true')
    expect(firstName).toHaveClass('focus:ring-2', 'px-4', 'py-2.5')
    expect(screen.getByLabelText('Phone')).toHaveAttribute('autocomplete', 'tel')
    expect(screen.getByLabelText('Source')).toHaveClass('focus:ring-2', 'px-4', 'py-2.5')
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
    expect(screen.getByRole('button', { name: 'Edit inquiry' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start intake' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Resume intake' }))
    expect(screen.getByText('Draft intake destination')).toBeInTheDocument()
  })

  it('uses the named lifecycle capability to suppress all mutation controls for unavailable roles', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
    mocks.inquiries.mockReturnValue({ data: [inquiry()], isLoading: false })
    page()
    expect(screen.getByRole('status')).toHaveTextContent(/cannot capture, edit, or start/i)
    expect(screen.queryByRole('button', { name: /capture inquiry|edit inquiry|start intake/i })).not.toBeInTheDocument()
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
})