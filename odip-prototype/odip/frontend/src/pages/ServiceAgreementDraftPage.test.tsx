import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import * as React from 'react'
import ServiceAgreementDraftPage from './ServiceAgreementDraftPage'

const { createMutate, drafts, snapshotMutate, evidenceMutate, simulationMutate } = vi.hoisted(() => ({ createMutate: vi.fn(), drafts: vi.fn(), snapshotMutate: vi.fn(), evidenceMutate: vi.fn(), simulationMutate: vi.fn() }))
vi.mock('@/api/hooks', () => ({
  useParticipant: () => ({ data: { id: 'p-1', ndisNumber: '430000001', dateOfBirth: '1990-01-02' }, isLoading: false }),
  useServiceAgreementDrafts: () => ({ data: drafts(), isLoading: false }),
  useCreateServiceAgreementDraft: () => ({ mutate: createMutate, isPending: false }),
  useDownloadServiceAgreementDraftPdf: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useCreateElectronicSigningSnapshot: () => ({ mutate: snapshotMutate, isPending: false }),
  useSubmitElectronicSigningEvidence: () => ({ mutate: evidenceMutate, isPending: false }),
  useDemoJourneySimulation: () => {
    const [result, setResult] = React.useState<{ data?: { banner: string; signing: string; activation: string; booking: string; rateLabel: string }; error?: { response: { data: { message: string } } } }>({})
    return {
      mutate: ({ participantId, draftId }: { participantId: string; draftId: string }) => {
        simulationMutate({ participantId, draftId })
        setResult(draftId === 'd-old'
          ? { error: { response: { data: { message: 'Only the newest draft can run the simulation.' } } } }
          : { data: { banner: 'Simulation complete for newest', signing: 'Synthetic signing', activation: 'Synthetic activation', booking: 'Synthetic booking', rateLabel: 'Synthetic rate $72.34' } })
      },
      isPending: false,
      isError: !!result.error,
      error: result.error,
      data: result.data,
    }
  },
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

  // L1-11: the banner said the identifiers "are not copied into this draft", but the draft stores a snapshot of the NDIS number and the date of
  // birth and its PDF prints both, readable by every authenticated role. The banner now says what happens.
  it('says the NDIS number and date of birth ARE snapshotted into the draft and printed on its PDF, not that they are not copied', () => {
    renderPage()

    const banner = screen.getByText(/Participant identifiers/).closest('p') as HTMLElement
    expect(banner).toHaveTextContent(/snapshot/i)
    expect(banner).toHaveTextContent(/PDF/)
    expect(banner).not.toHaveTextContent(/not copied/i)
    expect(screen.queryByText(/not copied into this draft/i)).not.toBeInTheDocument()
  })

  it('shows the selected unapproved source version and server-priced line without calling it signed', () => {
    drafts.mockReturnValue([{ id: 'd-1', version: 2, status: 'UnapprovedDraft', templateVersion: 'ODIP-Service-Agreement-Blank-DRAFT-2026-09-27', templateDocxSha256: 'docx-hash', templatePdfSha256: 'pdf-hash', state: 'NSW', agreementStartDate: '2026-07-01', agreementEndDate: '2027-06-30', lines: [{ serviceType: 'Daily support', itemCode: 'configured-code', hours: 2, unitPrice: 72.34, catalogueVersion: '2026-07', catalogueEffectiveFrom: '2026-07-01', catalogueEffectiveTo: null }] }])
    render(<MemoryRouter initialEntries={['/participants/p-1/agreement-draft']}><Routes><Route path="/participants/:id/agreement-draft" element={<ServiceAgreementDraftPage />} /></Routes></MemoryRouter>)
    expect(screen.getByText('$72.34')).toBeInTheDocument()
    expect(screen.getByText(/2026-07 · effective 2026-07-01/)).toBeInTheDocument()
    expect(screen.getByText(/not signed and not billing authority/i)).toBeInTheDocument()
    expect(screen.getByText(/Selected source: ODIP-Service-Agreement-Blank-DRAFT-2026-09-27/)).toBeInTheDocument()
    expect(screen.getByText(/DOCX SHA-256 docx-hash · PDF SHA-256 pdf-hash/)).toBeInTheDocument()
    expect(screen.getByText('SIMULATED — NOT A LEGAL AGREEMENT / NO CLAIM')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Run Demo-only simulation' }))
    expect(simulationMutate).toHaveBeenCalledWith({ participantId: 'p-1', draftId: 'd-1' })
  })

  it('keeps the demo simulation collapsed inside a details element, closed by default', () => {
    drafts.mockReturnValue([{ id: 'd-1', version: 2, status: 'UnapprovedDraft', templateVersion: 'v', templateDocxSha256: 'a', templatePdfSha256: 'b', state: 'NSW', agreementStartDate: '2026-07-01', agreementEndDate: '2027-06-30', lines: [] }])
    render(<MemoryRouter initialEntries={['/participants/p-1/agreement-draft']}><Routes><Route path="/participants/:id/agreement-draft" element={<ServiceAgreementDraftPage />} /></Routes></MemoryRouter>)
    const summary = screen.getByText('Demo-only simulation')
    const details = summary.closest('details')
    expect(details).not.toBeNull()
    expect(details).not.toHaveAttribute('open')
    expect(summary.tagName).toBe('SUMMARY')
  })

  it('attributes demo simulation success and rejection to their respective draft cards', () => {
    drafts.mockReturnValue([
      { id: 'd-old', version: 1, status: 'UnapprovedDraft', templateVersion: 'draft-v1', templateDocxSha256: 'old-docx', templatePdfSha256: 'old-pdf', state: 'NSW', agreementStartDate: '2026-07-01', agreementEndDate: '2027-06-30', lines: [] },
      { id: 'd-new', version: 2, status: 'UnapprovedDraft', templateVersion: 'draft-v2', templateDocxSha256: 'new-docx', templatePdfSha256: 'new-pdf', state: 'NSW', agreementStartDate: '2026-07-01', agreementEndDate: '2027-06-30', lines: [] },
    ])
    render(<MemoryRouter initialEntries={['/participants/p-1/agreement-draft']}><Routes><Route path="/participants/:id/agreement-draft" element={<ServiceAgreementDraftPage />} /></Routes></MemoryRouter>)
    const oldCard = screen.getByLabelText('Demo-only journey simulation for draft d-old')
    const newCard = screen.getByLabelText('Demo-only journey simulation for draft d-new')

    fireEvent.click(screen.getAllByRole('button', { name: 'Run Demo-only simulation' })[0])
    expect(oldCard).toHaveTextContent('Only the newest draft can run the simulation.')
    expect(newCard).not.toHaveTextContent('Only the newest draft can run the simulation.')

    fireEvent.click(screen.getAllByRole('button', { name: 'Run Demo-only simulation' })[1])
    expect(newCard).toHaveTextContent('Simulation complete for newest')
    expect(oldCard).not.toHaveTextContent('Simulation complete for newest')
    expect(simulationMutate).toHaveBeenCalledWith({ participantId: 'p-1', draftId: 'd-old' })
    expect(simulationMutate).toHaveBeenCalledWith({ participantId: 'p-1', draftId: 'd-new' })
  })
})
