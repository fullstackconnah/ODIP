import { useEffect, useRef, useState, type Ref } from 'react'
import { Link } from 'react-router-dom'
import { Download, Loader2 } from 'lucide-react'
import type { DraftApprovalDto, DraftBlock, ServiceAgreementDraftDto, ServiceAgreementDraftLineDto } from '@/api/types'
import { useDemoJourneySimulation, usePlanPricingSettings, useServiceAgreementDraft } from '@/api/hooks'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { TAP_FLOOR } from '@/components/tapArea'
import { DataTable, type Column } from '@/components/DataTable'
import { StatusBadge } from '@/components/StatusBadge'
import { describeBlock, formatHours, type PlanStepKey } from '@/lib/planBlocks'
import { REASON_COPY, addDays, bandLabel, formatServiceDate, friendlyMessage, groupIssues, isRefusal, totalsCaption } from '@/lib/planQuote'
import { joinList, plural } from '@/lib/format'
import { usePermissions } from '@/lib/permissions'
import { rosterLink } from '@/lib/rosterLinks'
import { extractErrorMessage, formatCurrency, formatWithTimeZone } from '@/lib/utils'
import ElectronicSigningEvidencePanel from '@/pages/ElectronicSigningEvidencePanel'
import { ApprovalDialog } from './ApprovalDialog'
import { FlagBadges } from './PlanMessages'

// Human labels for the small set of statuses this draft workflow currently produces. StatusBadge falls back to its own default styling for a key not present in its
// colour map (neither of these is), which is acceptable here.
const DRAFT_STATUS_LABELS: Record<string, string> = {
  // The template's own e-signing state, named for what it is: approving a revision for rostering is a different thing, and the header says both.
  UnapprovedDraft: 'Not approved for e-signing',
  ApprovedForElectronicSigning: 'Approved for e-signing',
}

function draftStatusLabel(status: string) {
  return DRAFT_STATUS_LABELS[status] ?? status
}

/** Each card owns its mutation state so results cannot cross draft versions. */
function DraftSimulationPanel({ participantId, draftId }: { participantId: string; draftId: string }) {
  const simulation = useDemoJourneySimulation()

  return <details className="rounded-lg border-2 border-[var(--color-warning)] bg-[var(--color-warning-container)]/20" aria-label={`Demo-only journey simulation for draft ${draftId}`}>
    <summary className="min-h-[44px] flex items-center px-4 py-2 cursor-pointer select-none font-semibold text-[var(--color-on-warning-container)]">Demo-only simulation</summary>
    <div className="px-4 pb-4 space-y-3">
      <h3 className="font-semibold">SIMULATED — NOT A LEGAL AGREEMENT / NO CLAIM</h3>
      <p className="text-sm">Demo-only, dev-auth walkthrough: simulated signing → activation → booking. It creates no signature evidence, participant activation, booking, billable event, invoice, or claim.</p>
      <Button variant="secondary" onClick={() => simulation.mutate({ participantId, draftId })} disabled={simulation.isPending}>{simulation.isPending ? 'Running simulation…' : 'Run Demo-only simulation'}</Button>
      {simulation.data && <div role="status" className="rounded border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-sm space-y-1"><strong>{simulation.data.banner}</strong><p>{simulation.data.signing}</p><p>{simulation.data.activation}</p><p>{simulation.data.booking}</p><p className="font-medium">{simulation.data.rateLabel}</p></div>}
      {simulation.isError && <Callout tone="error" className="max-w-prose">{extractErrorMessage(simulation.error, 'The server could not price this draft. Check the state, effective dates and configured catalogue code.')}</Callout>}
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
  /** This is the participant's newest revision: the only one that can be approved for rostering. */
  isNewest?: boolean
  /** A reason approval was refused is about a block: take the person to it, at the step that fixes it (the page owns the plan the blocks are in). */
  onGoToBlock?: (blockId: string, step: PlanStepKey) => void
  /** The next revision that was approved after this one, when there is one: its approval ended this one's patterns the day before it starts. */
  replacedBy?: ReplacedBy
}

/** The revision whose approval replaced another's: the version, when it was approved, and the day its agreement starts (the old patterns end the day before). */
export type ReplacedBy = { version: number; approvedAt: string; agreementStartDate: string }

const DATE_PARTS = { day: 'numeric', month: 'short', year: 'numeric' } as const

/**
 * The version number and the two statuses a revision can carry, each said for what it is: approved for rostering (green, once somebody has approved it: or "Replaced", when a later revision's
 * approval has taken its place) and the template's own e-signing state, which approving for rostering does not touch.
 */
function RevisionTitle({ draft, replaced }: { draft: ServiceAgreementDraftDto; replaced: boolean }) {
  // The version and its badges are one wrapping row, and each badge is one unit (nowrap): on a phone a badge that does not fit moves whole to the next line, where an inline pill used to split at the hyphen of "e-signing".
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <strong>Version {draft.version}</strong>
      {draft.approval && (replaced
        ? <StatusBadge tone="neutral" label="Replaced" className="whitespace-nowrap" />
        : <StatusBadge tone="success" label="Approved for rostering" className="whitespace-nowrap" />)}
      <StatusBadge status={draft.status} label={draftStatusLabel(draft.status)} className="whitespace-nowrap" />
    </div>
  )
}

/**
 * Who approved a revision for rostering and what that made. It is not the e-signing status beside the version number (the template's state, the same on every revision): approving
 * makes the weekly roster patterns and the unfilled shifts, and the agreement is still not signed. It is a group a person can be sent to (focus goes to it when an approval has just been made, the
 * button and the dialog having gone), and it says when a later approval has replaced it, so a list of revisions never reads as if the old patterns were still live.
 */
function ApprovalNote({ participantId, approval, replacedBy, noteRef }: { participantId: string; approval: DraftApprovalDto; replacedBy?: ReplacedBy; noteRef?: Ref<HTMLDivElement> }) {
  const on = formatWithTimeZone(approval.approvedAt, undefined, DATE_PARTS)
  const patterns = plural(approval.patternsCreated, 'weekly pattern')
  const name = `Approved for rostering by ${approval.approvedByName} on ${on}`
  const link = approval.firstShiftDate
    ? <Link className={`font-medium underline ${TAP_FLOOR}`} to={rosterLink(approval.firstShiftDate, participantId, { unfilled: true })}>Open on the roster</Link>
    : <Link className={`font-medium underline ${TAP_FLOOR}`} to="/rostering/patterns">Open the shift patterns</Link>
  return (
    // scroll-mt/-mb: when focus scrolls the page to the note, it stops clear of the sticky header and the phone's bottom bar (on a phone the first line was left under the header).
    <div ref={noteRef} tabIndex={-1} role="group" aria-label={name} className="scroll-mt-20 scroll-mb-24 max-w-prose rounded-[var(--radius-md)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]">
      <Callout tone="success" title={name}>
        <p>
          {approval.shiftsCreated > 0 && approval.horizonEnd
            ? `${patterns}, unfilled shifts to ${formatServiceDate(approval.horizonEnd)}.`
            // "Added each day" is the daily top-up's work: while the server has it off (an older one does not say, and it was on) the card promises nothing of the kind.
            : `${patterns}. ${approval.topUpEnabled !== false ? "Unfilled shifts are added each day, once the participant is active and the agreement's dates come near." : 'No unfilled shifts were made.'}`}
        </p>
        {replacedBy
          ? <p className="mt-1">Replaced by version {replacedBy.version} on {formatWithTimeZone(replacedBy.approvedAt, undefined, DATE_PARTS)}: these patterns end on {formatServiceDate(addDays(replacedBy.agreementStartDate, -1))}.</p>
          : <p className="mt-1">{link}</p>}
        <p className="mt-1 text-[13px]">Separate from signing: the agreement itself is not signed.</p>
      </Callout>
    </div>
  )
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
  const summary = useRef<HTMLElement>(null)
  const folded = useRef(false)
  // Show details and Hide details are one control in two cards, and pressing either one unmounts the card it is in: focus falls to the top of the page. It goes to the other one (review N7).
  useEffect(() => {
    if (open || !folded.current) return
    folded.current = false
    summary.current?.querySelector<HTMLElement>('button[aria-expanded]')?.focus()
  }, [open])
  if (!draft.isSummary) return <FullRevision {...props} />
  if (open && detail.data) return <FullRevision {...props} draft={detail.data} onCollapse={() => { folded.current = true; setOpen(false) }} />
  return (
    <article ref={summary} className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <RevisionTitle draft={draft} replaced={props.replacedBy !== undefined} />
          <p className="text-sm text-[var(--color-muted-foreground)]">{draft.state} · {formatServiceDate(draft.agreementStartDate)} to {formatServiceDate(draft.agreementEndDate)}</p>
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
      {draft.approval && <ApprovalNote participantId={participantId} approval={draft.approval} replacedBy={props.replacedBy} />}
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
function FullRevision({ participantId, draft, onDownload, downloading, onCollapse, isNewest = false, onGoToBlock, replacedBy }: RevisionCardProps & { onCollapse?: () => void }) {
  const card = useRef<HTMLElement>(null)
  const note = useRef<HTMLDivElement>(null)
  const dialogWasOpen = useRef(false)
  const [approving, setApproving] = useState(false)
  const { canManageParticipantLifecycle, isSuperAdmin, isAdmin, isCoordinator } = usePermissions()
  const collapsible = onCollapse !== undefined
  // Opened by a person (it has Hide details): the Show details they pressed went with the summary, so focus is on the page. It goes to Hide details, unless it has been put somewhere else meanwhile
  // (the version can take a moment to read, and somebody may have moved on). The newest revision, in full from the start, is not opened by anybody and takes nothing (review N7).
  useEffect(() => {
    if (!collapsible) return
    const active = document.activeElement
    if (active && active !== document.body) return
    card.current?.querySelector<HTMLElement>('button[aria-expanded="true"]')?.focus()
  }, [collapsible])
  // The approval appears (the drafts are read again) while the dialog is open: the button and the dialog are gone with it, and focus would fall to the top of the page. It goes to the approval, which says
  // what was made. A revision that is approved when the page loads takes nothing.
  useEffect(() => { if (approving) dialogWasOpen.current = true }, [approving])
  useEffect(() => {
    if (!draft.approval || !dialogWasOpen.current) return
    dialogWasOpen.current = false
    note.current?.focus()
  }, [draft.approval])
  // A dialog closed without an approval (Cancel, Escape, a way to a block) was not on the way to one: when the approval turns up later, made by somebody else and read by a refetch, it must not pull focus here.
  const closeWithoutApproving = () => { dialogWasOpen.current = false; setApproving(false) }
  const fromBlocks = draft.blocks.length > 0
  const lines = draft.lines.map((line, index) => ({ ...line, key: `${line.itemCode}-${index}` }))
  const pricing = draft.pricing
  const blocks = draft.blocks.map((entry: DraftBlock) => entry.block)
  const unreadable = draft.blocks.filter(entry => entry.unreadable).length
  const issues = groupIssues(pricing?.issues ?? [])
  const caption = pricing ? totalsCaption(pricing).text : ''
  const total = lines.reduce((sum, line) => sum + line.total, 0)

  // Only the newest revision that was built from blocks and has not been approved can be approved. The organisation says which roles may (Admin and Coordinator until it says otherwise); the screen
  // follows that list when it has it and leaves the server to decide while it is still loading. A SuperAdmin acting for an organisation always may.
  const approvable = isNewest && fromBlocks && !draft.approval && canManageParticipantLifecycle
  const notReady = draft.pricing?.needsReview === true
  const approverRoles = usePlanPricingSettings(approvable).data?.approverRoles
  const mayApprove = isSuperAdmin || !approverRoles || (isAdmin && approverRoles.includes('Admin')) || (isCoordinator && approverRoles.includes('Coordinator'))

  return <article ref={card} className={CARD}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <RevisionTitle draft={draft} replaced={replacedBy !== undefined} />
        <p className="text-sm text-[var(--color-muted-foreground)]">{draft.state} · {formatServiceDate(draft.agreementStartDate)} to {formatServiceDate(draft.agreementEndDate)}</p>
        <details className="mt-1 text-xs text-[var(--color-muted-foreground)]"><summary className="cursor-pointer select-none">Template details</summary><p className="mt-1">Selected source: {draft.templateVersion} · DOCX SHA-256 {draft.templateDocxSha256} · PDF SHA-256 {draft.templatePdfSha256}</p></details>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => onDownload(draft.id)} disabled={downloading}>{downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Download draft PDF</Button>
        {onCollapse && <Button variant="secondary" aria-expanded="true" onClick={onCollapse}>Hide details</Button>}
      </div>
    </div>
    {draft.approval && <ApprovalNote participantId={participantId} approval={draft.approval} replacedBy={replacedBy} noteRef={note} />}
    {approvable && (mayApprove ? (
      <div className="flex flex-wrap items-center gap-3">
        {/* The stored pricing already says when approval will be refused: the button then does not promise it (secondary), and the line says so. It still opens the dialog, which says which lines and where. */}
        <Button variant={notReady ? 'secondary' : 'primary'} onClick={() => setApproving(true)}>Mark approved</Button>
        {notReady
          ? <p className="text-sm text-[var(--color-on-warning-container)]">Not ready yet: some lines need fixing or a decision. Select to see which.</p>
          : <p className="text-sm text-[var(--color-muted-foreground)]">Makes this plan's weekly roster patterns and unfilled shifts. Separate from signing.</p>}
      </div>
    ) : approverRoles && (
      <p className="text-sm text-[var(--color-muted-foreground)]">Your organisation lets only {joinList(approverRoles)} approve plans.</p>
    ))}
    {approvable && mayApprove && <ApprovalDialog open={approving} participantId={participantId} draft={draft} onClose={closeWithoutApproving} onApproved={() => setApproving(false)} onGoToBlock={onGoToBlock} />}
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
