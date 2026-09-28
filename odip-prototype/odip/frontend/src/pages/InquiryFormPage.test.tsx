import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import InquiryFormPage from './InquiryFormPage'

const mocks = vi.hoisted(() => ({
  inquiries: vi.fn(),
  create: { mutate: vi.fn(), isPending: false },
  update: { mutate: vi.fn(), isPending: false },
}))

vi.mock('@/api/hooks', () => ({
  useParticipantInquiries: mocks.inquiries,
  useCreateParticipantInquiry: () => mocks.create,
  useUpdateParticipantInquiry: () => mocks.update,
}))

function page(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/participants/new-inquiry" element={<InquiryFormPage />} />
        <Route path="/participants" element={<p>Enquiries tab destination</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
  mocks.inquiries.mockReturnValue({ data: [], isLoading: false, isError: false })
  mocks.create.mutate.mockReset()
  mocks.update.mutate.mockReset()
  mocks.create.isPending = false
  mocks.update.isPending = false
})

describe('InquiryFormPage', () => {
  it('renders an empty create-mode form with required first and last name fields and a back link', () => {
    page('/participants/new-inquiry')
    const firstName = screen.getByLabelText(/First name/)
    expect(firstName).toBeRequired()
    expect(firstName).toHaveAttribute('autocomplete', 'given-name')
    const lastName = screen.getByLabelText(/Last name/)
    expect(lastName).toBeRequired()
    expect(screen.getByRole('button', { name: 'Capture enquiry' })).toBeInTheDocument()
    // Back link routes back to the enquiries tab via the hub.
    expect(screen.getByRole('link', { name: /Back to enquiries/i })).toHaveAttribute('href', '/participants?tab=enquiries')
  })

  it('submits the captured details to the create mutation and navigates to the enquiries tab on success', async () => {
    const user = userEvent.setup()
    mocks.create.mutate.mockImplementation((_data: unknown, options: { onSuccess: () => void }) => options.onSuccess())
    page('/participants/new-inquiry')

    await user.type(screen.getByLabelText(/First name/), 'Ava')
    await user.type(screen.getByLabelText(/Last name/), 'Ng')
    await user.type(screen.getByLabelText('Phone'), '0400000000')
    await user.type(screen.getByLabelText('Email'), 'ava@example.com')
    await user.click(screen.getByRole('button', { name: 'Capture enquiry' }))

    await waitFor(() => expect(mocks.create.mutate).toHaveBeenCalledTimes(1))
    expect(mocks.create.mutate.mock.calls[0][0]).toMatchObject({
      firstName: 'Ava',
      lastName: 'Ng',
      phone: '0400000000',
      email: 'ava@example.com',
      source: 'Phone',
    })
    expect(screen.getByText('Enquiries tab destination')).toBeInTheDocument()
  })

  it('prefills the form with the existing row when ?id=<inquiry-id> is supplied and routes the submit to the update mutation', async () => {
    const user = userEvent.setup()
    mocks.inquiries.mockReturnValue({
      data: [{
        id: 'inquiry-42',
        firstName: 'Rowan',
        lastName: 'Blake',
        phone: '0400 000 999',
        email: 'rowan@example.com',
        source: 'Web',
        provenance: 'Self referral',
        participantId: null,
      }],
      isLoading: false,
    })
    mocks.update.mutate.mockImplementation((_data: unknown, options: { onSuccess: () => void }) => options.onSuccess())
    page('/participants/new-inquiry?id=inquiry-42')

    // Hydration runs in a useEffect — wait for the controlled input value to settle.
    await waitFor(() => expect(screen.getByLabelText(/First name/)).toHaveValue('Rowan'))
    expect(screen.getByLabelText(/Last name/)).toHaveValue('Blake')
    expect(screen.getByLabelText('Phone')).toHaveValue('0400 000 999')
    expect(screen.getByLabelText('Email')).toHaveValue('rowan@example.com')

    await user.click(screen.getByRole('button', { name: 'Save enquiry' }))
    await waitFor(() => expect(mocks.update.mutate).toHaveBeenCalledTimes(1))
    const [updateArg] = mocks.update.mutate.mock.calls[0]
    expect(updateArg).toMatchObject({
      id: 'inquiry-42',
      data: expect.objectContaining({
        firstName: 'Rowan',
        lastName: 'Blake',
        phone: '0400 000 999',
        email: 'rowan@example.com',
        source: 'Web',
      }),
    })
    expect(screen.getByText('Enquiries tab destination')).toBeInTheDocument()
  })

  it('surfaces the inline error banner when the create mutation rejects', async () => {
    const user = userEvent.setup()
    mocks.create.mutate.mockImplementation((_data: unknown, options: { onError: () => void }) => options.onError())
    page('/participants/new-inquiry')
    await user.type(screen.getByLabelText(/First name/), 'Ava')
    await user.type(screen.getByLabelText(/Last name/), 'Ng')
    await user.click(screen.getByRole('button', { name: 'Capture enquiry' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/could not capture this enquiry/i)
  })
})