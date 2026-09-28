import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Download, FileText, Loader2, Plus, Trash2 } from 'lucide-react'
import { useCreateServiceAgreementDraft, useDemoJourneySimulation, useDownloadServiceAgreementDraftPdf, useParticipant, useServiceAgreementDrafts } from '@/api/hooks'
import type { AgreementState, CreateServiceAgreementDraftDto } from '@/api/types'
import { FormField } from '@/components/FormField'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { formatCurrency } from '@/lib/utils'
import ElectronicSigningEvidencePanel from './ElectronicSigningEvidencePanel'

const states: AgreementState[] = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA']
type DraftLineForm = { serviceType: string; itemCode: string; hours: string }

// Human labels for the small set of statuses this draft workflow currently produces. StatusBadge
// falls back to its own default styling for a key not present in its colour map (neither of these
// is), which is acceptable here — see report.
const DRAFT_STATUS_LABELS: Record<string, string> = {
  UnapprovedDraft: 'Unapproved draft',
  ApprovedForElectronicSigning: 'Approved for e-signing',
}

function draftStatusLabel(status: string) {
  return DRAFT_STATUS_LABELS[status] ?? status
}

function messageFor(error: unknown) {
  if (typeof error === 'object' && error && 'response' in error) {
    const data = (error as { response?: { data?: { message?: string; errors?: string[] } } }).response?.data
    return data?.errors?.[0] || data?.message || 'The server could not price this draft. Check the state, effective dates and configured catalogue code.'
  }
  return 'The server could not price this draft. Check the state, effective dates and configured catalogue code.'
}

/** Each card owns its mutation state so results cannot cross draft versions. */
function DraftSimulationPanel({ participantId, draftId }: { participantId: string; draftId: string }) {
  const simulation = useDemoJourneySimulation()

  return <details className="rounded-lg border-2 border-[var(--color-warning)] bg-[var(--color-warning-container)]/20" aria-label={`Demo-only journey simulation for draft ${draftId}`}>
    <summary className="min-h-[44px] flex items-center px-4 py-2 cursor-pointer select-none font-semibold text-[var(--color-on-warning-container)]">Demo-only simulation</summary>
    <div className="px-4 pb-4 space-y-3">
      <h3 className="font-semibold">SIMULATED — NOT A LEGAL AGREEMENT / NO CLAIM</h3>
      <p className="text-sm">Demo-only, dev-auth walkthrough: simulated signing → activation → booking. It creates no signature evidence, participant activation, booking, billable event, invoice, or claim.</p>
      <button type="button" onClick={() => simulation.mutate({ participantId, draftId })} disabled={simulation.isPending} className="min-h-[44px] rounded border border-[var(--color-border)] px-3 py-2 text-sm font-medium disabled:opacity-50">{simulation.isPending ? 'Running simulation…' : 'Run Demo-only simulation'}</button>
      {simulation.data && <div role="status" className="rounded border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-sm space-y-1"><strong>{simulation.data.banner}</strong><p>{simulation.data.signing}</p><p>{simulation.data.activation}</p><p>{simulation.data.booking}</p><p className="font-medium">{simulation.data.rateLabel}</p></div>}
      {simulation.isError && <p role="alert" className="text-sm text-[var(--color-destructive)]">{messageFor(simulation.error)}</p>}
    </div>
  </details>
}

export default function ServiceAgreementDraftPage() {
  const { id: participantId } = useParams<{ id: string }>()
  const participant = useParticipant(participantId)
  const drafts = useServiceAgreementDrafts(participantId)
  const create = useCreateServiceAgreementDraft()
  const download = useDownloadServiceAgreementDraftPdf()
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<AgreementState>('NSW')
  const [planStartDate, setPlanStartDate] = useState('')
  const [planEndDate, setPlanEndDate] = useState('')
  const [agreementStartDate, setAgreementStartDate] = useState('')
  const [agreementEndDate, setAgreementEndDate] = useState('')
  const [representative, setRepresentative] = useState('')
  const [lines, setLines] = useState<DraftLineForm[]>([{ serviceType: '', itemCode: '', hours: '' }])

  const canonicalIdentifiers = useMemo(() => ({
    ndis: participant.data?.ndisNumber ? 'Recorded on participant' : 'Not recorded on participant',
    dob: participant.data?.dateOfBirth || 'Not recorded on participant',
  }), [participant.data])

  if (participant.isLoading || drafts.isLoading) return <div className="flex items-center justify-center h-64 text-[var(--color-muted-foreground)]">Loading...</div>
  if (participant.isError || drafts.isError) return <div role="alert" className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm">Could not load this participant's service agreement drafts. Please try again.</div>
  if (!participantId || !participant.data) return <div className="text-center py-12">Participant not found</div>

  const updateLine = (index: number, patch: Partial<DraftLineForm>) => setLines(current => current.map((line, i) => i === index ? { ...line, ...patch } : line))
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    const parsedLines = lines.map(line => ({ serviceType: line.serviceType.trim(), itemCode: line.itemCode.trim(), hours: Number(line.hours) }))
    if (!planStartDate || !planEndDate || !agreementStartDate || !agreementEndDate || parsedLines.some(line => !line.serviceType || !line.itemCode || !Number.isFinite(line.hours) || line.hours <= 0)) {
      setError('Enter plan and agreement dates, plus a support type, configured catalogue code and positive hours for every line.')
      return
    }
    const serviceTypes = [...new Set(parsedLines.map(line => line.serviceType))]
    const data: CreateServiceAgreementDraftDto = { planStartDate, planEndDate, agreementStartDate, agreementEndDate, state, serviceTypes, representative: representative.trim() || undefined, lines: parsedLines }
    create.mutate({ participantId, data }, { onError: failure => setError(messageFor(failure)) })
  }

  return <div className="space-y-6 animate-fade-in max-w-6xl">
    <div className="flex items-start gap-4">
      <Link to={`/participants/${participantId}`} className="mt-1 p-2 rounded-lg hover:bg-[var(--color-accent)] transition-colors">
        <ArrowLeft className="w-5 h-5" />
      </Link>
      <div className="flex-1">
        <PageHeader title="Service agreement draft" subtitle={participant.data.fullName} />
      </div>
    </div>

    <div role="note" className="rounded-xl border border-[var(--color-warning)]/40 bg-[var(--color-warning-container)] p-4 text-sm text-[var(--color-on-warning-container)] space-y-2">
      <p><strong>Draft only</strong> — not approved for signing or use. It can't be used to activate the participant, roster shifts, invoice or claim.</p>
      <p><strong>Participant identifiers stay in the participant record.</strong> NDIS number: {canonicalIdentifiers.ndis}; date of birth: {canonicalIdentifiers.dob}. <Link className="underline font-medium" to={`/participants/${participantId}/profile`}>View or edit participant details</Link>. They are not copied into this draft.</p>
    </div>

    <form onSubmit={submit} className="space-y-6">
      <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 space-y-4">
        <h2 className="font-semibold">Draft details</h2>
        <div className="grid md:grid-cols-3 gap-4">
          <FormField label="State">
            <select value={state} onChange={e => setState(e.target.value as AgreementState)}>{states.map(value => <option key={value} value={value}>{value}</option>)}</select>
          </FormField>
          <FormField label="Plan start">
            <input type="date" value={planStartDate} onChange={e => setPlanStartDate(e.target.value)} />
          </FormField>
          <FormField label="Plan end">
            <input type="date" value={planEndDate} onChange={e => setPlanEndDate(e.target.value)} />
          </FormField>
          <FormField label="Agreement start">
            <input type="date" value={agreementStartDate} onChange={e => setAgreementStartDate(e.target.value)} />
          </FormField>
          <FormField label="Agreement end">
            <input type="date" value={agreementEndDate} onChange={e => setAgreementEndDate(e.target.value)} />
          </FormField>
          <FormField label="Representative">
            <input value={representative} maxLength={500} onChange={e => setRepresentative(e.target.value)} />
          </FormField>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 space-y-4">
        <div><h2 className="font-semibold">Proposed support lines</h2><p className="text-sm text-[var(--color-muted-foreground)]">Use an approved NDIS catalogue code. The price is looked up automatically; codes without a current price are rejected.</p></div>
        {lines.map((line, index) => <div key={index} className="grid md:grid-cols-[1fr_1fr_10rem_auto] gap-3 items-end">
          <FormField label={`Support type ${index + 1}`}>
            <input value={line.serviceType} onChange={e => updateLine(index, { serviceType: e.target.value })} />
          </FormField>
          <FormField label={`Catalogue code ${index + 1}`}>
            <input value={line.itemCode} onChange={e => updateLine(index, { itemCode: e.target.value })} />
          </FormField>
          <FormField label={`Hours ${index + 1}`}>
            <input type="number" min="0.01" step="0.01" value={line.hours} onChange={e => updateLine(index, { hours: e.target.value })} />
          </FormField>
          <button type="button" aria-label={`Remove line ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines(current => current.filter((_, i) => i !== index))} className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-[var(--color-destructive)] hover:bg-[var(--color-accent)] disabled:opacity-40"><Trash2 className="w-5 h-5" /></button>
        </div>)}
        <button type="button" onClick={() => setLines(current => [...current, { serviceType: '', itemCode: '', hours: '' }])} className="inline-flex items-center gap-2 text-sm font-medium"><Plus className="w-4 h-4" /> Add support line</button>
      </section>
      {error && <p role="alert" className="text-sm text-[var(--color-destructive)]">{error}</p>}
      <button type="submit" disabled={create.isPending} className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2 font-medium text-white disabled:opacity-50">{create.isPending && <Loader2 className="w-4 h-4 animate-spin" />}{create.isPending ? 'Pricing draft…' : 'Create priced draft'}</button>
    </form>

    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 space-y-4">
      <h2 className="font-semibold">Draft versions</h2>
      {(drafts.data ?? []).length === 0 ? <p className="text-sm text-[var(--color-muted-foreground)]">No draft versions yet.</p> : (drafts.data ?? []).map(draft => <article key={draft.id} className="rounded-lg border border-[var(--color-border)] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><strong>Version {draft.version}</strong> <StatusBadge status={draft.status} label={draftStatusLabel(draft.status)} className="ml-2" /><p className="text-sm text-[var(--color-muted-foreground)]">{draft.state} · {draft.agreementStartDate} to {draft.agreementEndDate}</p><details className="mt-1 text-xs text-[var(--color-muted-foreground)]"><summary className="cursor-pointer select-none">Template details</summary><p className="mt-1">Selected source: {draft.templateVersion} · DOCX SHA-256 {draft.templateDocxSha256} · PDF SHA-256 {draft.templatePdfSha256}</p></details></div><button type="button" onClick={() => download.mutate({ participantId, id: draft.id })} disabled={download.isPending} className="inline-flex items-center gap-2 rounded border border-[var(--color-border)] px-3 py-2 text-sm disabled:opacity-50">{download.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Download draft PDF</button></div>
        <ElectronicSigningEvidencePanel participantId={participantId} draft={draft} />
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-[var(--color-muted-foreground)]"><th>Support type</th><th>Code</th><th>Hours</th><th>Unit price</th><th>Catalogue provenance</th></tr></thead><tbody>{draft.lines.map((line, i) => <tr key={`${line.itemCode}-${i}`} className="border-t border-[var(--color-border)]"><td className="py-2">{line.serviceType}</td><td>{line.itemCode}</td><td>{line.hours}</td><td>{formatCurrency(line.unitPrice)}</td><td>{line.catalogueVersion} · effective {line.catalogueEffectiveFrom}{line.catalogueEffectiveTo ? ` to ${line.catalogueEffectiveTo}` : ''}</td></tr>)}</tbody></table></div>
        <DraftSimulationPanel participantId={participantId} draftId={draft.id} />
      </article>)}
      {download.isError && <p role="alert" className="text-sm text-[var(--color-destructive)]">Could not download this draft PDF. Try again.</p>}
      <p className="text-xs text-[var(--color-muted-foreground)] flex gap-2"><FileText className="w-4 h-4 shrink-0" /> Draft PDFs are informational only — not signed and not billing authority.</p>
    </section>
  </div>
}
