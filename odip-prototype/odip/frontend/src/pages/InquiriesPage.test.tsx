import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import InquiriesPage from './InquiriesPage'

const { createMutate, convertMutate, useInquiries } = vi.hoisted(() => ({
  createMutate: vi.fn(),
  convertMutate: vi.fn(),
  useInquiries: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useParticipantInquiries: useInquiries,
  useCreateParticipantInquiry: () => ({ mutate: createMutate, isPending: false }),
  useConvertParticipantInquiry: () => ({ mutate: convertMutate, isPending: false }),
}))

function renderPage(inquiries: unknown[] = []) {
  useInquiries.mockReturnValue({ data: inquiries, isLoading: false })
  const router = createMemoryRouter([
    { path: '/inquiries', element: <InquiriesPage /> },
    { path: '/participants/:id/intake', element: <div>Prefilled intake</div> },
  ], { initialEntries: ['/inquiries'] })
  return render(<RouterProvider router={router} />)
}

describe('InquiriesPage', () => {
  beforeEach(() => {
    createMutate.mockReset()
    convertMutate.mockReset()
    useInquiries.mockReset()
  })

  it('captures the complete internal inquiry payload including source and provenance', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByPlaceholderText('First name'), 'Ada')
    await user.type(screen.getByPlaceholderText('Last name'), 'Lovelace')
    await user.type(screen.getByPlaceholderText('Phone'), '0400 000 001')
    await user.type(screen.getByPlaceholderText('Email'), 'ada@example.test')
    await user.selectOptions(screen.getByRole('combobox'), 'Email')
    await user.type(screen.getByPlaceholderText('Provenance / referral notes'), 'Hospital referral #R-9')
    await user.click(screen.getByRole('button', { name: 'Capture inquiry' }))

    expect(createMutate).toHaveBeenCalledWith({
      firstName: 'Ada', lastName: 'Lovelace', phone: '0400 000 001', email: 'ada@example.test',
      source: 'Email', provenance: 'Hospital referral #R-9',
    }, expect.objectContaining({ onSuccess: expect.any(Function) }))
  })

  it('converts once and launches intake for the returned existing participant id', async () => {
    const user = userEvent.setup()
    renderPage([{ id: 'inquiry-1', firstName: 'Ada', lastName: 'Lovelace', phone: null, email: null, source: 'Web', provenance: null, createdAt: '2026-09-26T00:00:00Z' }])

    await user.click(screen.getByRole('button', { name: 'Convert to intake' }))
    expect(convertMutate).toHaveBeenCalledWith({ id: 'inquiry-1' }, expect.objectContaining({ onSuccess: expect.any(Function) }))
    const onSuccess = convertMutate.mock.calls[0][1].onSuccess as (inquiry: { participantId?: string }) => void
    await act(async () => { onSuccess({ participantId: 'participant-1' }) })

    expect(await screen.findByText('Prefilled intake')).toBeInTheDocument()
  })
})
