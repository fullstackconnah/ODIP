import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import InquiriesPage from './InquiriesPage'

const { createMutate, updateMutate, convertMutate, navigate, useInquiries } = vi.hoisted(() => ({
  createMutate: vi.fn(),
  updateMutate: vi.fn(),
  convertMutate: vi.fn(),
  navigate: vi.fn(),
  useInquiries: vi.fn(),
}))

vi.mock('react-router-dom', async importOriginal => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}))

vi.mock('@/api/hooks', () => ({
  useParticipantInquiries: useInquiries,
  useCreateParticipantInquiry: () => ({ mutate: createMutate, isPending: false }),
  useUpdateParticipantInquiry: () => ({ mutate: updateMutate, isPending: false }),
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
    updateMutate.mockReset()
    convertMutate.mockReset()
    navigate.mockReset()
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

    await user.click(screen.getByRole('button', { name: 'Start intake' }))
    expect(convertMutate).toHaveBeenCalledWith({ id: 'inquiry-1' }, expect.objectContaining({ onSuccess: expect.any(Function) }))
    const onSuccess = convertMutate.mock.calls[0][1].onSuccess as (inquiry: { participantId?: string }) => void
    await act(async () => { onSuccess({ participantId: 'participant-1' }) })

    expect(navigate).toHaveBeenCalledWith('/participants/participant-1/intake')
  })

  it('shows create failure feedback while preserving the entered inquiry', async () => {
    createMutate.mockImplementation((_data, { onError }) => onError(new Error('request failed')))
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByPlaceholderText('First name'), 'Ada')
    await user.type(screen.getByPlaceholderText('Last name'), 'Lovelace')
    await user.click(screen.getByRole('button', { name: 'Capture inquiry' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not capture this inquiry. Check the details and try again.')
    expect(screen.getByPlaceholderText('First name')).toHaveValue('Ada')
    expect(screen.getByPlaceholderText('Last name')).toHaveValue('Lovelace')
  })

  it('shows convert failure feedback without navigating away', async () => {
    convertMutate.mockImplementation((_data, { onError }) => onError(new Error('request failed')))
    const user = userEvent.setup()
    renderPage([{ id: 'inquiry-1', firstName: 'Ada', lastName: 'Lovelace', phone: null, email: null, source: 'Web', provenance: null, createdAt: '2026-09-26T00:00:00Z' }])

    await user.click(screen.getByRole('button', { name: 'Start intake' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not start intake. Please try again.')
    expect(navigate).not.toHaveBeenCalled()
  })
})
