import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Download, FileText, Loader2, Plus, Trash2 } from 'lucide-react'
import { useCreateServiceAgreementDraft, useDownloadServiceAgreementDraftPdf, useParticipant, useServiceAgreementDrafts } from '@/api/hooks'
import type { AgreementState, CreateServiceAgreementDraftDto } from '@/api/types'
import ElectronicSigningEvidencePanel from './ElectronicSigningEvidencePanel'

const states: AgreementState[] = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA']
type DraftLineForm = { serviceType: string; itemCode: string; hours: string }

function messageFor(error: unknown) {
  if (typeof error === 'object' && error && 'response' in error) {
    const data = (error as { response?: { data?: { message?: string; errors?: string[] } } }).response?.data
    return data?.errors?.[0] || data?.message || 'The server could not price this draft. Check the state, effective dates and configured catalogue code.'
  }
  return 'The server could not price this draft. Check the state, effective dates and configured catalogue code.'
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
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-sm text-[var(--color-muted-foreground)]"><Link className="underline" to={`/participants/${participantId}`}>Participant</Link> / Agreement draft</p>
        <h1 className="text-2xl font-bold mt-1">Unapproved ODIP agreement draft</h1>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">UNAPPROVED / NOT FOR SIGNING OR LIVE USE. This provisional version cannot authorise evidence approval, active readiness, roster, invoice or claim transitions.</p>
      </div>
      <Link to={`/participants/${participantId}`} className="px-4 py-2 rounded-lg border border-[var(--color-border)] text-sm hover:bg-[var(--color-accent)]">Back to participant</Link>
    </div>

    <div role="note" className="rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning-container)] p-4 text-sm text-[var(--color-on-warning-container)]">
      <strong>Participant identifiers stay in the participant record.</strong> NDIS number: {canonicalIdentifiers.ndis}; date of birth: {canonicalIdentifiers.dob}. <Link className="underline font-medium" to={`/participants/${participantId}/profile`}>View or edit participant details</Link>. They are not copied into this draft.
    </div>

    <form onSubmit={submit} className="space-y-6">
      <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 space-y-4">
        <h2 className="font-semibold">Draft details</h2>
        <div className="grid md:grid-cols-3 gap-4">
          <label className="text-sm">State<select aria-label="State" value={state} onChange={e => setState(e.target.value as AgreementState)} className="mt-1 w-full rounded border border-[var(--color-border)] bg-transparent p-2">{states.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="text-sm">Plan start<input aria-label="Plan start" type="date" value={planStartDate} onChange={e => setPlanStartDate(e.target.value)} className="mt-1 w-full rounded border border-[var(--color-border)] bg-transparent p-2" /></label>
          <label className="text-sm">Plan end<input aria-label="Plan end" type="date" value={planEndDate} onChange={e => setPlanEndDate(e.target.value)} className="mt-1 w-full rounded border border-[var(--color-border)] bg-transparent p-2" /></label>
          <label className="text-sm">Agreement start<input aria-label="Agreement start" type="date" value={agreementStartDate} onChange={e => setAgreementStartDate(e.target.value)} className="mt-1 w-full rounded border border-[var(--color-border)] bg-transparent p-2" /></label>
          <label className="text-sm">Agreement end<input aria-label="Agreement end" type="date" value={agreementEndDate} onChange={e => setAgreementEndDate(e.target.value)} className="mt-1 w-full rounded border border-[var(--color-border)] bg-transparent p-2" /></label>
          <label className="text-sm md:col-span-1">Representative (optional)<input aria-label="Representative" value={representative} maxLength={500} onChange={e => setRepresentative(e.target.value)} className="mt-1 w-full rounded border border-[var(--color-border)] bg-transparent p-2" /></label>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 space-y-4">
        <div><h2 className="font-semibold">Proposed support lines</h2><p className="text-sm text-[var(--color-muted-foreground)]">Enter only an approved, configured catalogue code. The server resolves the effective unit price and rejects unavailable or ambiguous pricing.</p></div>
        {lines.map((line, index) => <div key={index} className="grid md:grid-cols-[1fr_1fr_10rem_auto] gap-3 items-end">
          <label className="text-sm">Support type<input aria-label={`Support type ${index + 1}`} value={line.serviceType} onChange={e => updateLine(index, { serviceType: e.target.value })} className="mt-1 w-full rounded border border-[var(--color-border)] bg-transparent p-2" /></label>
          <label className="text-sm">Catalogue code<input aria-label={`Catalogue code ${index + 1}`} value={line.itemCode} onChange={e => updateLine(index, { itemCode: e.target.value })} className="mt-1 w-full rounded border border-[var(--color-border)] bg-transparent p-2" /></label>
          <label className="text-sm">Hours<input aria-label={`Hours ${index + 1}`} type="number" min="0.01" step="0.01" value={line.hours} onChange={e => updateLine(index, { hours: e.target.value })} className="mt-1 w-full rounded border border-[var(--color-border)] bg-transparent p-2" /></label>
          <button type="button" aria-label={`Remove line ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines(current => current.filter((_, i) => i !== index))} className="mb-0.5 p-2 text-[var(--color-destructive)] disabled:opacity-40"><Trash2 className="w-5 h-5" /></button>
        </div>)}
        <button type="button" onClick={() => setLines(current => [...current, { serviceType: '', itemCode: '', hours: '' }])} className="inline-flex items-center gap-2 text-sm font-medium"><Plus className="w-4 h-4" /> Add support line</button>
      </section>
      {error && <p role="alert" className="text-sm text-[var(--color-destructive)]">{error}</p>}
      <button type="submit" disabled={create.isPending} className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2 font-medium text-white disabled:opacity-50">{create.isPending && <Loader2 className="w-4 h-4 animate-spin" />}{create.isPending ? 'Pricing draft…' : 'Create priced draft'}</button>
    </form>

    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 space-y-4">
      <h2 className="font-semibold">Server-priced draft versions</h2>
      {(drafts.data ?? []).length === 0 ? <p className="text-sm text-[var(--color-muted-foreground)]">No draft versions yet.</p> : (drafts.data ?? []).map(draft => <article key={draft.id} className="rounded-lg border border-[var(--color-border)] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><strong>Version {draft.version}</strong> <span className="ml-2 text-sm">{draft.status}</span><p className="text-sm text-[var(--color-muted-foreground)]">{draft.state} · {draft.agreementStartDate} to {draft.agreementEndDate}</p><p className="mt-1 text-xs text-[var(--color-muted-foreground)]">Selected source: {draft.templateVersion} · DOCX SHA-256 {draft.templateDocxSha256} · PDF SHA-256 {draft.templatePdfSha256}</p></div><button type="button" onClick={() => download.mutate({ participantId, id: draft.id })} disabled={download.isPending} className="inline-flex items-center gap-2 rounded border border-[var(--color-border)] px-3 py-2 text-sm disabled:opacity-50">{download.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Download draft PDF</button></div>
        <ElectronicSigningEvidencePanel participantId={participantId} draft={draft} />
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-[var(--color-muted-foreground)]"><th>Support type</th><th>Code</th><th>Hours</th><th>Server unit price</th><th>Catalogue provenance</th></tr></thead><tbody>{draft.lines.map((line, i) => <tr key={`${line.itemCode}-${i}`} className="border-t border-[var(--color-border)]"><td className="py-2">{line.serviceType}</td><td>{line.itemCode}</td><td>{line.hours}</td><td>${line.unitPrice}</td><td>{line.catalogueVersion} · effective {line.catalogueEffectiveFrom}{line.catalogueEffectiveTo ? ` to ${line.catalogueEffectiveTo}` : ''}</td></tr>)}</tbody></table></div>
      </article>)}
      {download.isError && <p role="alert" className="text-sm text-[var(--color-destructive)]">Could not download this draft PDF. Try again.</p>}
      <p className="text-xs text-[var(--color-muted-foreground)] flex gap-2"><FileText className="w-4 h-4 shrink-0" /> Draft PDFs are informational only — not signed and not billing authority.</p>
    </section>
  </div>
}
