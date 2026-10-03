import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import type { DraftBlock, ServiceAgreementDraftDto, ServiceAgreementDraftLineDto } from '@/api/types'
import { useDemoJourneySimulation, useServiceAgreementDraft } from '@/api/hooks'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { DataTable, type Column } from '@/components/DataTable'
import { StatusBadge } from '@/components/StatusBadge'
import { describeBlock, formatHours } from '@/lib/planBlocks'
import { REASON_COPY, bandLabel, formatServiceDate, friendlyMessage, groupIssues, isRefusal, totalsCaption } from '@/lib/planQuote'
import { plural } from '@/lib/format'
import { formatCurrency } from '@/lib/utils'
import ElectronicSigningEvidencePanel from '@/pages/ElectronicSigningEvidencePanel'
import { FlagBadges } from './PlanMessages'

// Human labels for the small set of statuses this draft workflow currently produces. StatusBadge falls back to its own default styling for a key not present in its
// colour map (neither of these is), which is acceptable here.
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
      <button type="button" onClick={() => simulation.mutate({ participantId, draftId })} disabled={simulation.isPending} className="min-h-[44px] rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 h-[var(--control-h)] text-sm font-medium disabled:opacity-50">{simulation.isPending ? 'Running simulation…' : 'Run Demo-only simulation'}</button>
      {simulation.data && <div role="status" className="rounded border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-sm space-y-1"><strong>{simulation.data.banner}</strong><p>{simulation.data.signing}</p><p>{simulation.data.activation}</p><p>{simulation.data.booking}</p><p className="font-medium">{simulation.data.rateLabel}</p></div>}
      {simulation.isError && <Callout tone="error" className="max-w-prose">{messageFor(simulation.error)}</Callout>}
    </div>
  </details>
}

/** The quantity of a saved line in its own unit: hours, each, nights. */
function savedQuantity(line: ServiceAgreementDraftLineDto): string {
  const quantity = formatHours(line.hours)
  return line.unit === 'E' ? `${quantity} each` : line.unit === 'D' ? plural(line.hours, 'night') : `${quantity} h`
}

function lineColumns(): Column<ServiceAgreementDraftLineDto & { key: string }>[] {
  return [
    { key: 'serviceType', header: 'Support type', wrap: true, render: line => line.band ? `${line.serviceType}, ${bandLabel(line.band)}` : line.serviceType },
    { key: 'itemCode', header: 'Code', render: line => <span className="font-mono text-[13px] tabular-nums">{line.itemCode}</span> },
    { key: 'hours', header: 'Quantity', align: 'right', render: line => <span className="tabular-nums">{savedQuantity(line)}</span> },
    { key: 'unitPrice', header: 'Unit price', align: 'right', render: line => <span className="tabular-nums">{formatCurrency(line.unitPrice)}</span> },
    { key: 'total', header: 'Total', align: 'right', render: line => <span className="tabular-nums">{formatCurrency(line.total)}</span> },
    { key: 'flags', header: 'Flags', wrap: true, render: line => <FlagBadges flags={line.flags ?? 'None'} /> },
    {
      key: 'provenance', header: 'Catalogue provenance',
      render: line => `${line.catalogueVersion} · effective ${line.catalogueEffectiveFrom}${line.catalogueEffectiveTo ? ` to ${line.catalogueEffectiveTo}` : ''}`,
    },
  ]
}

type RevisionCardProps = {
  participantId: string
  draft: ServiceAgreementDraftDto
  onDownload: (id: string) => void
  downloading: boolean
}

const CARD = 'rounded-[var(--radius-md)] border border-[var(--color-border)] p-[var(--card-pad)] flex flex-col gap-[var(--field-gap-y)]'

/**
 * One saved revision, read-only: it is never edited, so a change is always a newer version. The newest is in full. An older one arrives as a summary (what it came to and what a reader
 * must not miss) and its details are read when somebody asks for them, so a long onboarding is not many revisions of blocks, answers and lines on every page load.
 */
export function RevisionCard(props: RevisionCardProps) {
  const { participantId, draft } = props
  const [open, setOpen] = useState(false)
  const detail = useServiceAgreementDraft(participantId, draft.id, draft.isSummary && open)
  if (!draft.isSummary) return <FullRevision {...props} />
  if (open && detail.data) return <FullRevision {...props} draft={detail.data} onCollapse={() => setOpen(false)} />
  return (
    <article className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <strong>Version {draft.version}</strong> <StatusBadge status={draft.status} label={draftStatusLabel(draft.status)} className="ml-2" />
          <p className="text-sm text-[var(--color-muted-foreground)]">{draft.state} · {draft.agreementStartDate} to {draft.agreementEndDate}</p>
          <p className="mt-1 text-sm tabular-nums">
            {draft.blockCount > 0 ? `${plural(draft.blockCount, 'block')} · ` : 'Typed by hand before the plan builder · '}{plural(draft.lineCount, 'line')} · <span className="font-medium">{formatCurrency(draft.total)}</span> over the agreement
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => props.onDownload(draft.id)} disabled={props.downloading}>{props.downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Download draft PDF</Button>
          <Button variant="secondary" aria-expanded={open} onClick={() => setOpen(true)}>Show details</Button>
        </div>
      </div>
      {draft.caveats.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-sm">
          {draft.caveats.map(caveat => <li key={caveat} className="flex items-start gap-1.5"><StatusBadge tone="warning" label="Read" /><span>{caveat}</span></li>)}
        </ul>
      )}
      {open && detail.isLoading && <p role="status" aria-busy="true" className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Reading this version…</p>}
      {open && detail.isError && (
        <Callout tone="error" className="max-w-prose" title="This version could not be read">
          Check your connection and try again.
          <span className="mt-2 block"><Button variant="secondary" size="sm" onClick={() => { void detail.refetch() }}>Try again</Button></span>
        </Callout>
      )}
    </article>
  )
}

/**
 * One revision in full. A revision made with the plan builder shows its blocks, its lines with their totals and what a person still has to look at as it was when it was saved; one typed
 * by hand before the builder existed shows its lines exactly as they were, and says it can only be rebuilt.
 */
function FullRevision({ participantId, draft, onDownload, downloading, onCollapse }: RevisionCardProps & { onCollapse?: () => void }) {
  const fromBlocks = draft.blocks.length > 0
  const lines = draft.lines.map((line, index) => ({ ...line, key: `${line.itemCode}-${index}` }))
  const pricing = draft.pricing
  const blocks = draft.blocks.map((entry: DraftBlock) => entry.block)
  const unreadable = draft.blocks.filter(entry => entry.unreadable).length
  const issues = groupIssues(pricing?.issues ?? [])
  const caption = pricing ? totalsCaption(pricing).text : ''
  const total = lines.reduce((sum, line) => sum + line.total, 0)

  return <article className={CARD}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <strong>Version {draft.version}</strong> <StatusBadge status={draft.status} label={draftStatusLabel(draft.status)} className="ml-2" />
        <p className="text-sm text-[var(--color-muted-foreground)]">{draft.state} · {draft.agreementStartDate} to {draft.agreementEndDate}</p>
        <details className="mt-1 text-xs text-[var(--color-muted-foreground)]"><summary className="cursor-pointer select-none">Template details</summary><p className="mt-1">Selected source: {draft.templateVersion} · DOCX SHA-256 {draft.templateDocxSha256} · PDF SHA-256 {draft.templatePdfSha256}</p></details>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => onDownload(draft.id)} disabled={downloading}>{downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Download draft PDF</Button>
        {onCollapse && <Button variant="secondary" aria-expanded="true" onClick={onCollapse}>Hide details</Button>}
      </div>
    </div>
    <ElectronicSigningEvidencePanel participantId={participantId} draft={draft} />

    {fromBlocks ? (
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Blocks in this version</h3>
        <ol className="flex flex-col gap-0.5 text-sm">
          {draft.blocks.map((entry, index) => (
            <li key={`${index}-${entry.block.id}`}>
              <span className="tabular-nums text-[var(--color-muted-foreground)]">{index + 1}.</span> {entry.unreadable ? <span className="text-[var(--color-muted-foreground)]">A block that could not be read</span> : describeBlock(entry.block)}
            </li>
          ))}
        </ol>
        {unreadable > 0 && (
          <Callout tone="warning" className="max-w-prose">
            {plural(unreadable, 'block')} of this version could not be read, so the plan it was is not complete here. Its lines, below, are as they were saved. Build the plan again and save it as a new version.
          </Callout>
        )}
      </div>
    ) : (
      lines.length > 0 && <Callout tone="info" className="max-w-prose" title="Typed by hand">This version&apos;s lines were typed by hand before the plan builder existed. They are shown as they were saved and cannot be changed. To rebuild them from support blocks, build the plan above and save it as a new version.</Callout>
    )}

    {lines.length > 0 && (
      <div className="flex flex-col gap-2">
        <DataTable data={lines} keyField="key" columns={lineColumns()} emptyMessage="No lines." />
        {fromBlocks && <p className="text-sm tabular-nums"><span className="font-medium">{formatCurrency(total)}</span> over the agreement{pricing && pricing.totals.holidayOccurrences > 0 ? `, including ${plural(pricing.totals.holidayOccurrences, 'public holiday shift')}` : ''}.</p>}
      </div>
    )}

    {fromBlocks && lines.length === 0 && <p className="text-sm text-[var(--color-muted-foreground)]">Nothing was priced from these blocks, so this version has no lines.</p>}

    {pricing && (issues.length > 0 || caption) && (
      <div className="flex flex-col gap-1 text-sm">
        {caption && <p className="text-[var(--color-muted-foreground)]">As priced when it was saved: {caption}.</p>}
        {issues.length > 0 && (
          <ul className="flex flex-col gap-0.5">
            {issues.map(issue => {
              const where = [issue.count > 1 ? plural(issue.count, 'shift') : '', issue.firstDate ? `from ${formatServiceDate(issue.firstDate)}` : ''].filter(Boolean).join(', ')
              return <li key={`${issue.blockId}-${issue.reason}-${issue.message}`} className="flex items-start gap-1.5"><StatusBadge tone={isRefusal(issue.reason) ? 'danger' : 'warning'} label={isRefusal(issue.reason) ? 'Fix' : 'Review'} /><span>{REASON_COPY[issue.reason]?.title}: {friendlyMessage(issue.message, blocks)}{where ? ` (${where})` : ''}</span></li>
            })}
          </ul>
        )}
      </div>
    )}

    <DraftSimulationPanel participantId={participantId} draftId={draft.id} />
  </article>
}
