import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CircleCheck } from 'lucide-react'
import { Button } from '@/components/Button'
import { buttonClasses } from '@/components/buttonClasses'
import { Callout } from '@/components/Callout'
import { Card } from '@/components/Card'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { CellText, DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { PageState } from '@/components/PageState'
import { StatusBadge } from '@/components/StatusBadge'
import { fetchClaimFile, useDismissBatchLine } from '@/api/hooks/claimHub'
import type { RejectedLineDto } from '@/api/types'
import { plural } from '@/lib/format'
import { formatCurrency } from '@/lib/utils'
import { AgeCell } from './claimHubParts'
import { deliveredText } from './claimHubSteps'

// The NDIA's reject codes in plain English (SHAPE §6). The hint and the kind come from the server; this only names the group.
const CODE_TITLES: Record<string, string> = {
  C16: 'Item not valid on that date', C27: 'Date in the future', C38: 'Price over the limit', V31: 'Price over the limit',
  C30: 'Cancellation reason missing', V26: 'Line crosses two plans', V04: 'Already claimed', P04: 'Already claimed',
  V11: 'Not their provider', V13: 'Plan management type', V43: 'Plan management type', V16: 'No funding for this support',
  V17: 'Not enough funding left', V27: 'Not enough funding left', P03: 'Not enough funding left',
}
const OTHER_HINT = "The NDIA's message says what went wrong. Fix the line, then send it again, or decide not to claim it."

interface Group { code: string; title: string; hint: string; decision: boolean; lines: RejectedLineDto[] }

function groupsOf(lines: RejectedLineDto[]): Group[] {
  const map = new Map<string, Group>()
  for (const l of lines) {
    const known = l.rejectCode in CODE_TITLES
    const code = known ? l.rejectCode : 'Other'
    const g = map.get(code) ?? map.set(code, { code, title: known ? CODE_TITLES[code] : 'Other codes', hint: known ? l.hint : OTHER_HINT, decision: known && l.needsDecision, lines: [] }).get(code)!
    g.lines.push(l)
  }
  // Decisions first, then the fixable groups; the biggest group first in each.
  return [...map.values()].sort((a, b) => Number(b.decision) - Number(a.decision) || b.lines.length - a.lines.length)
}

// Every listed fixable code is a fix on the line itself, so Fix opens its claim.
const fixLink = (l: RejectedLineDto) => ({ to: `/claims/${l.claimId}` })

interface Props {
  lines: RejectedLineDto[]
  loading: boolean
  failed: boolean
  onRetry: () => void
  /** Shows only one file's rejected lines, from that file's panel. */
  fileFilter?: string
  onClearFilter: () => void
  onOpenFile: (batchId: string) => void
  onBuilt: (batchId: string | undefined, fileName: string, lineCount: number) => void
  announce: (message: string) => void
}

export function NeedsActionPanel({ lines, loading, failed, onRetry, fileFilter, onClearFilter, onOpenFile, onBuilt, announce }: Props) {
  const shown = useMemo(() => fileFilter ? lines.filter(l => l.batchId === fileFilter) : lines, [lines, fileFilter])
  const groups = useMemo(() => groupsOf(shown), [shown])
  const [sending, setSending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmSend, setConfirmSend] = useState<RejectedLineDto | null>(null)
  const [confirmDrop, setConfirmDrop] = useState<RejectedLineDto | null>(null)
  const dismiss = useDismissBatchLine()

  // shortcut: sending again builds a file at once (G15) rather than parking the line back in Ready to send with a chip.
  const sendAgain = async (key: string, picked: RejectedLineDto[], confirmed: boolean) => {
    setSending(key)
    setError(null)
    try {
      const ids = picked.map(l => l.lineId)
      const { batchId, fileName } = await fetchClaimFile('post', '/claim-batches', { lineIds: ids, ...(confirmed ? { confirmedLineIds: ids } : {}) }, 'claims.csv', "Couldn't build the file. Check your connection and try again.")
      setConfirmSend(null)
      onBuilt(batchId, fileName, picked.length)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSending(null)
    }
  }

  if (failed) return <div data-testid="claims-panel-action"><PageState kind="error" noun="rejected lines" onRetry={onRetry} /></div>
  if (loading) return <div data-testid="claims-panel-action"><PageState kind="loading" noun="rejected lines" /></div>
  const filterName = fileFilter ? lines.find(l => l.batchId === fileFilter)?.fileName : undefined

  return (
    <div data-testid="claims-panel-action" className="flex flex-col gap-4">
      {fileFilter && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          Showing rejected lines from <strong className="whitespace-nowrap">{filterName ?? 'one file'}</strong>.
          <Button variant="ghost" size="sm" onClick={onClearFilter}>Show all</Button>
        </p>
      )}
      {error && <Callout tone="danger">{error}</Callout>}
      {groups.length === 0 && <EmptyState icon={CircleCheck} title="Nothing rejected" description="When the NDIA rejects a line, it shows here with what to do next." />}
      {groups.map(g => {
        const columns: Column<RejectedLineDto>[] = [
          { key: 'participant', header: 'Participant', mobile: 'primary', render: l => <CellText>{l.participantName}</CellText> },
          { key: 'claim', header: 'Claim', mobile: 'meta', render: l => <Link to={`/claims/${l.claimId}`} className="text-[var(--color-muted-foreground)] hover:underline" onClick={e => e.stopPropagation()}>{l.claimReference}</Link> },
          { key: 'item', header: 'Support item', mobile: 'meta', render: l => <CellText title={l.supportName}>{l.supportNumber}</CellText> },
          { key: 'delivered', header: 'Delivered', mobile: 'meta', render: l => <span className="whitespace-nowrap">{deliveredText(l.from, l.to)}</span> },
          { key: 'amount', header: 'Amount', align: 'right', mobile: 'meta', render: l => formatCurrency(l.totalAmount) },
          { key: 'file', header: 'File', mobile: 'meta', render: l => <button type="button" className="whitespace-nowrap text-[var(--color-primary)] hover:underline" onClick={() => onOpenFile(l.batchId)}>{l.fileName}</button> },
          { key: 'message', header: 'NDIA message', mobile: 'meta', render: l => <CellText title={l.rejectMessage}>{l.rejectMessage ?? l.rejectCode}</CellText> },
          { key: 'age', header: 'Age', mobile: 'status', render: l => <AgeCell days={l.ageDays} band={l.ageBand} /> },
          {
            key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right',
            render: l => (
              <span className="inline-flex gap-2 whitespace-nowrap max-md:w-full max-md:[&>*]:min-h-11 max-md:[&>*]:flex-1">
                {g.decision ? (
                  <>
                    <Button variant="secondary" size="sm" aria-label={`Send again: ${l.participantName}, ${l.claimReference}`} onClick={() => setConfirmSend(l)}>Send again…</Button>
                    <Button variant="ghost-danger" size="sm" aria-label={`Don't claim: ${l.participantName}, ${l.claimReference}`} onClick={() => { dismiss.reset(); setConfirmDrop(l) }}>Don't claim</Button>
                  </>
                ) : (
                  <>
                    <Link to={fixLink(l).to} className={buttonClasses('ghost', 'sm')} aria-label={`Fix: ${l.participantName}, ${l.claimReference}`}>Fix</Link>
                    <Button variant="secondary" size="sm" aria-label={`Send again: ${l.participantName}, ${l.claimReference}`} disabled={!!sending} onClick={() => sendAgain(l.batchLineId, [l], false)}>
                      {sending === l.batchLineId ? 'Building…' : 'Send again'}
                    </Button>
                  </>
                )}
              </span>
            ),
          },
        ]
        return (
          <Card
            key={g.code}
            title={g.code === 'Other' ? g.title : `${g.code} ${g.title}`}
            action={(
              <span className="inline-flex flex-wrap items-center justify-end gap-2">
                <span className="text-[13px] text-[var(--color-muted-foreground)]">{plural(g.lines.length, 'line')}</span>
                <StatusBadge status={g.decision ? 'decision' : 'fix'} tone={g.decision ? 'warning' : 'info'} label={g.decision ? 'Needs a decision' : 'Fix and send again'} />
                {!g.decision && g.lines.length > 1 && (
                  <Button variant="secondary" size="sm" disabled={!!sending} onClick={() => sendAgain(g.code, g.lines, false)}>
                    {sending === g.code ? 'Building…' : `Send all ${g.lines.length} again`}
                  </Button>
                )}
              </span>
            )}
          >
            <p className="mb-2 text-[13px] text-[var(--color-muted-foreground)]">{g.hint}</p>
            <DataTable data={g.lines} columns={columns} keyField="batchLineId" />
          </Card>
        )
      })}
      <ConfirmDialog
        open={!!confirmSend}
        title="Send this line again?"
        message={confirmSend && <p>The NDIA rejected it as {confirmSend.rejectCode}: {confirmSend.rejectMessage ?? CODE_TITLES[confirmSend.rejectCode] ?? 'no message'}. {confirmSend.hint} Your decision is recorded in the audit log.</p>}
        confirmLabel="Send again"
        loading={!!sending}
        onCancel={() => setConfirmSend(null)}
        onConfirm={() => confirmSend && sendAgain(confirmSend.batchLineId, [confirmSend], true)}
      />
      <ConfirmDialog
        open={!!confirmDrop}
        variant="danger"
        title="Don't claim this line?"
        message={<><p>It stays rejected and leaves Needs action. You can still see it on the claim.</p>{dismiss.isError && <Callout tone="danger" className="mt-2">Couldn't update the line. Try again.</Callout>}</>}
        confirmLabel="Don't claim"
        loading={dismiss.isPending}
        onCancel={() => setConfirmDrop(null)}
        onConfirm={() => confirmDrop && dismiss.mutate(confirmDrop.batchLineId, { onSuccess: () => { setConfirmDrop(null); announce("Line won't be claimed. It's left Needs action.") } })}
      />
    </div>
  )
}
