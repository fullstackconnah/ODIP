import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PrefilledIntakeForm } from './PrefilledIntakeForm'

const { mockSave, mockComplete, mockRefetch, mockDownload } = vi.hoisted(() => ({ mockSave: vi.fn(), mockComplete: vi.fn(), mockRefetch: vi.fn(), mockDownload: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  useSaveParticipantIntake: () => ({ mutateAsync: mockSave, isPending: false }),
  useUpdateParticipant: () => ({ mutateAsync: mockComplete, isPending: false }),
  useParticipantIntakeSnapshots: () => ({ data: [], refetch: mockRefetch }),
  useDownloadParticipantIntakeSnapshotPdf: () => ({ mutate: mockDownload, isPending: false }),
}))

const participant = {
  id: 'participant-1', firstName: 'Jamie', lastName: 'Rivers', preferredName: 'Jay',
  phone: '0400000000', email: 'jamie@example.test', addressStreet: '1 Example St',
  addressSuburb: 'Fremantle', addressState: 'WA', addressPostcode: '6160',
  primaryDiagnosis: 'Autism Spectrum Disorder', medicalSummary: 'Synthetic medical summary',
  mobilityNotes: 'Synthetic mobility note', behaviourRiskSummary: 'Synthetic behaviour note', notes: 'Synthetic note',
  inquiryId: 'inquiry-1', inquirySource: 'Email', inquiryProvenance: 'Hospital referral',
} as never

describe('PrefilledIntakeForm', () => {
  beforeEach(() => {
    mockSave.mockReset()
    mockComplete.mockReset()
  })

  it('hydrates inquiry-prefilled values and exposes every editable intake identity field', () => {
    render(<PrefilledIntakeForm participant={participant} />)
    expect(screen.getByLabelText(/first name/i)).toHaveValue('Jamie')
    expect(screen.getByLabelText(/primary diagnosis/i)).toHaveValue('Autism Spectrum Disorder')
    expect(screen.getByLabelText(/inquiry source/i)).toHaveValue('Email')
    expect(screen.getByLabelText(/^inquiry provenance$/i)).toHaveValue('Hospital referral')
    expect(screen.getByLabelText(/ndis number/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/preferred staff/i)).not.toBeInTheDocument()
    expect(screen.getByText(/not active or bookable/i)).toBeInTheDocument()
  })

  it('uses the constrained Web, Email, or Phone source control and saves its correction with the linked inquiry', async () => {
    mockSave.mockResolvedValue({ success: true })
    const user = userEvent.setup()
    render(<PrefilledIntakeForm participant={participant} />)

    const source = screen.getByLabelText(/inquiry source/i)
    expect(source.tagName).toBe('SELECT')
    await user.selectOptions(source, 'Phone')
    await user.click(screen.getByRole('button', { name: /save incomplete intake/i }))

    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ inquiryId: 'inquiry-1', inquirySource: 'Phone' }),
    }))
  })

  it('saves only the subset DTO and confirms the incomplete draft state', async () => {
    mockSave.mockResolvedValue({ success: true })
    const user = userEvent.setup()
    render(<PrefilledIntakeForm participant={participant} />)
    await user.clear(screen.getByLabelText(/medical summary/i))
    await user.type(screen.getByLabelText(/medical summary/i), 'Updated synthetic summary')
    await user.click(screen.getByRole('button', { name: /save incomplete intake/i }))

    expect(mockSave).toHaveBeenCalledWith({
      id: 'participant-1',
      data: expect.objectContaining({ firstName: 'Jamie', lastName: 'Rivers', medicalSummary: 'Updated synthetic summary', inquiryId: 'inquiry-1', inquirySource: 'Email', inquiryProvenance: 'Hospital referral' }),
    })
    expect(mockSave.mock.calls[0][0].data).not.toHaveProperty('isActive')
    expect(mockSave.mock.calls[0][0].data).not.toHaveProperty('isDraft')
    expect(mockSave.mock.calls[0][0].data).toHaveProperty('ndisNumber')
    expect(await screen.findByRole('status')).toHaveTextContent(/saved as incomplete intake/i)
  })

  it('completes explicitly with a stable idempotency key and leaves the participant a draft', async () => {
    mockComplete.mockResolvedValue({ success: true })
    const user = userEvent.setup()
    render(<PrefilledIntakeForm participant={participant} />)
    await user.click(screen.getByRole('button', { name: /^complete intake$/i }))

    expect(mockComplete).toHaveBeenCalledWith({
      id: 'participant-1',
      data: expect.objectContaining({ isDraft: true, completeIntake: true, completionRequestId: expect.any(String) }),
    })
    expect(await screen.findByRole('status')).toHaveTextContent(/dated immutable audit pdf/i)
    expect(screen.getByText(/not active or bookable/i)).toBeInTheDocument()
  })

  it('keeps the completion key and entered values on completion failure so retry is idempotent', async () => {
    mockComplete.mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce({ success: true })
    const user = userEvent.setup()
    render(<PrefilledIntakeForm participant={participant} />)
    await user.clear(screen.getByLabelText(/phone/i))
    await user.type(screen.getByLabelText(/phone/i), '0411111111')
    await user.click(screen.getByRole('button', { name: /^complete intake$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/network unavailable/i)
    expect(screen.getByLabelText(/phone/i)).toHaveValue('0411111111')
    const retryKey = mockComplete.mock.calls[0][0].data.completionRequestId

    await user.click(screen.getByRole('button', { name: /^complete intake$/i }))
    expect(mockComplete.mock.calls[1][0].data.completionRequestId).toBe(retryKey)
  })

  it('keeps entered values visible and explains the failure when saving fails', async () => {
    mockSave.mockRejectedValue(new Error('Network unavailable'))
    const user = userEvent.setup()
    render(<PrefilledIntakeForm participant={participant} />)
    await user.clear(screen.getByLabelText(/phone/i))
    await user.type(screen.getByLabelText(/phone/i), '0411111111')
    await user.click(screen.getByRole('button', { name: /save incomplete intake/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/network unavailable/i)
    expect(screen.getByLabelText(/phone/i)).toHaveValue('0411111111')
  })

  it('groups all editable values into the four intake review sections', () => {
    render(<PrefilledIntakeForm participant={participant} />)

    expect(screen.getByRole('heading', { name: 'Identity and contact' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Address and living arrangements' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Clinical/support notes' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Inquiry provenance and operational notes' })).toBeInTheDocument()
    expect(screen.getByLabelText(/intake notes/i)).toHaveValue('Synthetic note')
    expect(screen.getByLabelText(/behaviour risk summary/i)).toHaveValue('Synthetic behaviour note')
  })

  it('makes completion the first, primary keyboard action and describes incomplete saving as safe', async () => {
    const user = userEvent.setup()
    render(<PrefilledIntakeForm participant={participant} />)

    const actions = screen.getByLabelText('Intake actions')
    const [complete, save] = screen.getAllByRole('button', { name: /^(complete|save incomplete) intake$/i })
    expect(actions).toContainElement(complete)
    expect(actions).toContainElement(save)
    expect(complete).toHaveClass('bg-[var(--color-primary)]')
    expect(save).toHaveClass('border-[var(--color-primary)]')
    expect(actions).toHaveTextContent(/safely preserves this draft for later/i)

    await user.type(screen.getByLabelText(/intake notes/i), ' updated')
    screen.getByLabelText(/intake notes/i).focus()
    await user.tab()
    expect(complete).toHaveFocus()
    await user.tab()
    expect(save).toHaveFocus()
  })
})
