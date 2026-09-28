import { useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useCreateElectronicSigningSnapshot, useSubmitElectronicSigningEvidence } from '@/api/hooks'
import type { ElectronicSigningSnapshotDto, ServiceAgreementDraftDto } from '@/api/types'
import { FormField } from '@/components/FormField'

type Props = { participantId: string; draft: ServiceAgreementDraftDto }

function errorMessage(error: unknown) {
  if (typeof error === 'object' && error && 'response' in error) {
    const data = (error as { response?: { data?: { message?: string; errors?: string[] } } }).response?.data
    return data?.errors?.[0] || data?.message || 'The evidence request could not be completed.'
  }
  return 'The evidence request could not be completed.'
}

function newIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Development-only capture: it creates no signed agreement, approval, billing authority, or scheduling permission. */
export default function ElectronicSigningEvidencePanel({ participantId, draft }: Props) {
  const createSnapshot = useCreateElectronicSigningSnapshot()
  const submitEvidence = useSubmitElectronicSigningEvidence()
  const [snapshot, setSnapshot] = useState<ElectronicSigningSnapshotDto | null>(null)
  const [signerName, setSignerName] = useState('')
  const [signerCapacity, setSignerCapacity] = useState('Participant')
  const [isAuthorisedRepresentative, setIsAuthorisedRepresentative] = useState(false)
  const [documentWasDisplayed, setDocumentWasDisplayed] = useState(false)
  const [consentToElectronicMethod, setConsentToElectronicMethod] = useState(false)
  const [intendsToSign, setIntendsToSign] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const idempotencyKey = useRef(newIdempotencyKey())
  const evidencePermitted = draft.status === 'ApprovedForElectronicSigning'

  const showDocument = () => {
    if (!evidencePermitted) return
    setError(null)
    setSuccess(null)
    createSnapshot.mutate({ participantId, draftId: draft.id, draftVersion: draft.version }, {
      onSuccess: value => setSnapshot(value),
      onError: failure => setError(errorMessage(failure)),
    })
  }

  const submit = () => {
    if (!evidencePermitted) return
    if (!snapshot) return
    setError(null)
    setSuccess(null)
    if (!signerName.trim() || !signerCapacity.trim() || !documentWasDisplayed || !consentToElectronicMethod || !intendsToSign) {
      setError('Enter the signer name and capacity, then acknowledge the displayed document, electronic method, and intent.')
      return
    }
    submitEvidence.mutate({
      participantId,
      snapshotId: snapshot.id,
      data: { idempotencyKey: idempotencyKey.current, signerName: signerName.trim(), signerCapacity: signerCapacity.trim(), isAuthorisedRepresentative, documentWasDisplayed, consentToElectronicMethod, intendsToSign },
    }, {
      onSuccess: evidence => {
        setSuccess(`Evidence captured as ${evidence.status}. It is not an approval and cannot enable scheduling.`)
        idempotencyKey.current = newIdempotencyKey()
      },
      onError: failure => setError(errorMessage(failure)),
    })
  }

  return <section aria-labelledby={`signing-evidence-${draft.id}`} className="rounded-xl border border-[var(--color-warning)]/50 bg-[var(--color-warning-container)]/20 p-4 space-y-4">
    <div>
      <h3 id={`signing-evidence-${draft.id}`} className="font-semibold">In-app electronic signing evidence</h3>
      <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">Records signing evidence for review. It stays pending verification and doesn't create a signed agreement, approval, billing authority or permission to schedule.</p>
    </div>
    {!evidencePermitted && <p role="status" className="text-sm text-[var(--color-muted-foreground)]">Signing evidence can't be recorded until this agreement template is approved.</p>}
    {evidencePermitted && !snapshot && <button type="button" onClick={showDocument} disabled={createSnapshot.isPending} className="inline-flex items-center gap-2 rounded border border-[var(--color-border)] px-3 py-2 text-sm font-medium disabled:opacity-50">
      {createSnapshot.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Display immutable document before recording evidence
    </button>}
    {evidencePermitted && snapshot && <>
      <div className="rounded border border-[var(--color-border)] bg-[var(--color-card)] p-3">
        <p className="text-sm font-medium">Immutable document version {snapshot.draftVersion}</p>
        <p className="mt-1 break-all text-xs text-[var(--color-muted-foreground)]">SHA-256: {snapshot.documentHash}</p>
        <pre aria-label="Complete immutable document JSON" className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--color-muted)] p-3 text-xs text-[var(--color-foreground)]">{snapshot.documentJson}</pre>
      </div>
      <fieldset className="space-y-3" disabled={submitEvidence.isPending}>
        <legend className="text-sm font-medium">Signer attestation</legend>
        <div className="grid gap-3 md:grid-cols-2">
          <FormField label="Signer full name" required>
            <input value={signerName} onChange={event => setSignerName(event.target.value)} />
          </FormField>
          <FormField label="Capacity or authority" required>
            <input value={signerCapacity} onChange={event => setSignerCapacity(event.target.value)} />
          </FormField>
        </div>
        <FormField label="I am an authorised representative rather than the participant." layout="checkbox">
          <input type="checkbox" className="w-4 h-4 rounded border-[var(--color-border)]" checked={isAuthorisedRepresentative} onChange={event => setIsAuthorisedRepresentative(event.target.checked)} />
        </FormField>
        <FormField label="I acknowledge that the complete immutable document displayed above was shown to me." layout="checkbox">
          <input type="checkbox" className="w-4 h-4 rounded border-[var(--color-border)]" checked={documentWasDisplayed} onChange={event => setDocumentWasDisplayed(event.target.checked)} />
        </FormField>
        <FormField label="I consent to using this electronic evidence method." layout="checkbox">
          <input type="checkbox" className="w-4 h-4 rounded border-[var(--color-border)]" checked={consentToElectronicMethod} onChange={event => setConsentToElectronicMethod(event.target.checked)} />
        </FormField>
        <FormField label="I intend this attestation to record my signing intent." layout="checkbox">
          <input type="checkbox" className="w-4 h-4 rounded border-[var(--color-border)]" checked={intendsToSign} onChange={event => setIntendsToSign(event.target.checked)} />
        </FormField>
      </fieldset>
      <button type="button" onClick={submit} disabled={submitEvidence.isPending} className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-primary)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
        {submitEvidence.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Record PendingVerification evidence
      </button>
    </>}
    {error && <p role="alert" className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-sm text-[var(--color-destructive)]">{error}</p>}
    {success && <p role="status" className="text-sm">{success}</p>}
  </section>
}
