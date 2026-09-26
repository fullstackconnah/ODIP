import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ServiceAgreementDraftPage from './ServiceAgreementDraftPage'

const { createMutate, drafts } = vi.hoisted(() => ({ createMutate: vi.fn(), drafts: vi.fn() }))
vi.mock('@/api/hooks', () => ({
  useParticipant: () => ({ data: { id: 'p-1', ndisNumber: '430000001', dateOfBirth: '1990-01-02' }, isLoading: false }),
  useServiceAgreementDrafts: () => ({ data: drafts(), isLoading: false }),
  useCreateServiceAgreementDraft: () => ({ mutate: createMutate, isPending: false }),
  useDownloadServiceAgreementDraftPdf: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}))

function renderPage() {
  drafts.mockReturnValue([])
  return render(<MemoryRouter initialEntries={['/participants/p-1/agreement-draft']}><Routes><Route path="/participants/:id/agreement-draft" element={<ServiceAgreementDraftPage />} /></Routes></MemoryRouter>)
}

describe('ServiceAgreementDraftPage', () => {
  it('submits only editable draft inputs and leaves canonical participant identifiers out of the payload', async () => {
    const user = userEvent.setup()
    renderPage()
    fireEvent.change(screen.getByLabelText('Plan start'), { target: { value: '2026-07-01' } })
    fireEvent.change(screen.getByLabelText('Plan end'), { target: { value: '2027-06-30' } })
    fireEvent.change(screen.getByLabelText('Agreement start'), { target: { value: '2026-07-01' } })
    fireEvent.change(screen.getByLabelText('Agreement end'), { target: { value: '2027-06-30' } })
    await user.type(screen.getByLabelText('Representative'), 'A. Representative')
    await user.type(screen.getByLabelText('Support type 1'), 'Daily support')
    await user.type(screen.getByLabelText('Catalogue code 1'), 'configured-code')
    await user.type(screen.getByLabelText('Hours 1'), '2.5')
    await user.click(screen.getByRole('button', { name: 'Create priced draft' }))

    expect(createMutate).toHaveBeenCalledWith({ participantId: 'p-1', data: {
      planStartDate: '2026-07-01', planEndDate: '2027-06-30', agreementStartDate: '2026-07-01', agreementEndDate: '2027-06-30',
      state: 'NSW', serviceTypes: ['Daily support'], representative: 'A. Representative', lines: [{ serviceType: 'Daily support', itemCode: 'configured-code', hours: 2.5 }],
    } }, expect.objectContaining({ onError: expect.any(Function) }))
    expect(screen.getByText(/NDIS number: Recorded on participant/)).toBeInTheDocument()
    expect(screen.queryByDisplayValue('430000001')).not.toBeInTheDocument()
  })

  it('shows a server-priced line and its catalogue provenance without calling it signed', () => {
    drafts.mockReturnValue([{ id: 'd-1', version: 2, status: 'Draft', state: 'NSW', agreementStartDate: '2026-07-01', agreementEndDate: '2027-06-30', lines: [{ serviceType: 'Daily support', itemCode: 'configured-code', hours: 2, unitPrice: 72.34, catalogueVersion: '2026-07', catalogueEffectiveFrom: '2026-07-01', catalogueEffectiveTo: null }] }])
    render(<MemoryRouter initialEntries={['/participants/p-1/agreement-draft']}><Routes><Route path="/participants/:id/agreement-draft" element={<ServiceAgreementDraftPage />} /></Routes></MemoryRouter>)
    expect(screen.getByText('$72.34')).toBeInTheDocument()
    expect(screen.getByText(/2026-07 · effective 2026-07-01/)).toBeInTheDocument()
    expect(screen.getByText(/not signed and not billing authority/i)).toBeInTheDocument()
  })
})
