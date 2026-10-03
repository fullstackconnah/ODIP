import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ElectronicSigningEvidencePanel from './ElectronicSigningEvidencePanel'

const { snapshotMutate, evidenceMutate } = vi.hoisted(() => ({ snapshotMutate: vi.fn(), evidenceMutate: vi.fn() }))
vi.mock('@/api/hooks', () => ({
  useCreateElectronicSigningSnapshot: () => ({ mutate: snapshotMutate, isPending: false }),
  useSubmitElectronicSigningEvidence: () => ({ mutate: evidenceMutate, isPending: false }),
}))

const draft = { id: 'draft-1', participantId: 'p-1', version: 4, status: 'UnapprovedDraft', templateVersion: 'ODIP-Service-Agreement-Blank-DRAFT-2026-09-27', templateDocxSha256: 'docx-hash', templatePdfSha256: 'pdf-hash', state: 'NSW' as const, planStartDate: '2026-07-01', planEndDate: '2027-06-30', blocks: [], agreementStartDate: '2026-07-01', agreementEndDate: '2027-06-30', lines: [], isSummary: false, blockCount: 0, lineCount: 0, total: 0, caveats: [] }

describe('ElectronicSigningEvidencePanel', () => {
  it('does not expose signing actions or call mutation hooks for an unapproved agreement source', () => {
    render(<ElectronicSigningEvidencePanel participantId="p-1" draft={draft} />)

    expect(screen.getByText(/agreement template is approved/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /display immutable document/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /record pendingverification evidence/i })).not.toBeInTheDocument()
    expect(snapshotMutate).not.toHaveBeenCalled()
    expect(evidenceMutate).not.toHaveBeenCalled()
  })

  it('keeps the approved-future source path explicit and submits every required attestation field as pending verification evidence', async () => {
    const user = userEvent.setup()
    snapshotMutate.mockImplementation((_request, options) => options.onSuccess({ id: 'snapshot-1', draftId: 'draft-1', draftVersion: 4, documentJson: '{\n  "complete": true\n}', documentHash: 'abc123', status: 'PendingVerification' }))
    render(<ElectronicSigningEvidencePanel participantId="p-1" draft={{ ...draft, status: 'ApprovedForElectronicSigning' }} />)
    await user.click(screen.getByRole('button', { name: /display immutable document/i }))
    expect(screen.getByLabelText('Complete immutable document JSON')).toHaveTextContent('"complete": true')
    expect(screen.getByText('SHA-256: abc123')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/signer full name/i), 'Ada Signer')
    fireEvent.change(screen.getByLabelText(/capacity or authority/i), { target: { value: 'Authorised guardian' } })
    await user.click(screen.getByLabelText(/authorised representative/i))
    await user.click(screen.getByLabelText(/complete immutable document displayed above/i))
    await user.click(screen.getByLabelText(/consent to using this electronic evidence method/i))
    await user.click(screen.getByLabelText(/intend this attestation/i))
    await user.click(screen.getByRole('button', { name: /record pendingverification evidence/i }))

    expect(evidenceMutate).toHaveBeenCalledWith(expect.objectContaining({ participantId: 'p-1', snapshotId: 'snapshot-1', data: expect.objectContaining({ signerName: 'Ada Signer', signerCapacity: 'Authorised guardian', isAuthorisedRepresentative: true, documentWasDisplayed: true, consentToElectronicMethod: true, intendsToSign: true, idempotencyKey: expect.any(String) }) }), expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }))
  })

  it('exposes every attestation as a labelled checkbox with a real hit target', async () => {
    render(<ElectronicSigningEvidencePanel participantId="p-1" draft={{ ...draft, status: 'ApprovedForElectronicSigning' }} />)
    await userEvent.setup().click(screen.getByRole('button', { name: /display immutable document/i }))

    const checkboxes = [
      screen.getByRole('checkbox', { name: /authorised representative rather than the participant/i }),
      screen.getByRole('checkbox', { name: /complete immutable document displayed above/i }),
      screen.getByRole('checkbox', { name: /consent to using this electronic evidence method/i }),
      screen.getByRole('checkbox', { name: /intend this attestation to record my signing intent/i }),
    ]
    for (const checkbox of checkboxes) {
      expect(checkbox).not.toBeChecked()
      const row = checkbox.closest('label')
      expect(row).toHaveClass('min-h-[var(--control-h)]')
    }
  })
})
