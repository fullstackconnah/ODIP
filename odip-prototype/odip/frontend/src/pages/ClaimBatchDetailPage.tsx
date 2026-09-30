import { useParams, Link } from 'react-router-dom'
import { useClaimBatch, useDownloadProdaFile } from '@/api/hooks'
import type { BillableEventDto } from '@/api/types'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/StatusBadge'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { FactBar } from '@/components/FactBar'
import { formatCurrency, formatDateAu } from '@/lib/utils'
import { CheckCircle2, Clock, Download, FileWarning, Loader2 } from 'lucide-react'

const linkBtn =
  'text-xs font-medium text-[var(--color-primary)] hover:underline focus-visible:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded'

function formatDateTimeAu(value: string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-AU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

// Decorative skeleton for the initial load — avoids a layout jump between the loading and
// loaded states, and avoids a bare spinner per the surface's quality bar.
function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <div role="status" aria-live="polite" className="sr-only">Loading claim batch…</div>
      <div aria-hidden="true" className="flex flex-col gap-[var(--section-gap)]">
        <div className="h-4 w-32 rounded bg-[var(--color-input)] animate-pulse" />
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-6 w-64 rounded bg-[var(--color-input)] animate-pulse" />
            <div className="h-4 w-40 rounded bg-[var(--color-input)] animate-pulse" />
          </div>
          <div className="h-8 w-44 rounded-[var(--radius-md)] bg-[var(--color-input)] animate-pulse" />
        </div>
        <div className="h-11 rounded-[var(--radius-md)] bg-[var(--color-input)] animate-pulse" />
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] overflow-hidden">
          <div className="h-10 bg-[var(--color-accent)]" />
          <div className="divide-y divide-[var(--color-border)]">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 p-2">
                <div className="h-4 flex-[2] rounded bg-[var(--color-input)] animate-pulse" />
                <div className="h-4 flex-1 rounded bg-[var(--color-input)] animate-pulse" />
                <div className="h-4 flex-1 rounded bg-[var(--color-input)] animate-pulse" />
                <div className="h-4 w-20 rounded bg-[var(--color-input)] animate-pulse shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ClaimBatchDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: batch, isLoading, isError } = useClaimBatch(id)
  const downloadProdaFile = useDownloadProdaFile()

  if (isLoading) return <DetailSkeleton />

  if (isError || !batch) {
    return (
      <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
        <EmptyState
          icon={FileWarning}
          title="Claim batch not found"
          description="It may have been removed, or the link you followed is incorrect."
          action={{ label: 'Back to Claim Batches', to: '/billing/claim-batches' }}
        />
      </div>
    )
  }

  const events = batch.events ?? []
  const isSubmitted = !!batch.submittedAt

  function handleDownload() {
    if (!batch) return
    downloadProdaFile.mutate({ id: batch.id, fileName: batch.fileName })
  }

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <div className="text-sm text-[var(--color-muted-foreground)]">
        <Link to="/billing/claim-batches" className={linkBtn}>← Back to Claim Batches</Link>
      </div>

      <PageHeader
        title={batch.fileName}
        subtitle={
          isSubmitted ? (
            <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)] font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5" /> Submitted to NDIA
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full bg-[var(--color-input)] text-[var(--color-muted-foreground)] font-semibold">
              <Clock className="w-3.5 h-3.5" /> Draft — not yet submitted
            </span>
          )
        }
        action={
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Button
              variant="primary"
              size="md"
              onClick={handleDownload}
              disabled={downloadProdaFile.isPending || events.length === 0}
            >
              {downloadProdaFile.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {downloadProdaFile.isPending ? 'Preparing file…' : 'Download PRODA file'}
            </Button>
            {downloadProdaFile.isError && (
              <p role="alert" className="text-xs text-[var(--color-destructive)]">
                Couldn't download the file. Try again, or contact support if this keeps happening.
              </p>
            )}
          </div>
        }
      />

      <FactBar
        segments={[
          { label: 'Events', value: <span className="tabular-nums">{events.length}</span> },
          { label: 'Total Amount', value: <span className="tabular-nums">{formatCurrency(batch.totalAmount)}</span> },
          { label: 'Created', value: <span className="tabular-nums">{formatDateTimeAu(batch.createdAt)}</span> },
          { label: 'Submitted', value: <span className="tabular-nums">{isSubmitted ? formatDateTimeAu(batch.submittedAt) : 'Not yet submitted'}</span> },
        ]}
      />

      {/* Events table */}
      <div className="bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] overflow-hidden">
        <div className="px-[var(--card-pad)] py-2 bg-[var(--color-surface-container-low)] flex items-center justify-between">
          <h2 className="font-semibold text-sm text-[var(--color-muted-foreground)]">Batch Events</h2>
          <span className="text-xs text-[var(--color-muted-foreground)]">{events.length} events</span>
        </div>
        {events.length === 0 ? (
          <EmptyState
            icon={FileWarning}
            title="This batch has no events"
            description="Something went wrong when this batch was created — it shouldn't be possible to submit an empty batch."
            className="py-12"
          />
        ) : (
          <DataTable
            data={events}
            keyField="id"
            sortable
            className="overflow-x-auto"
            columns={[
              {
                key: 'participantName',
                header: 'Participant',
                sortable: true,
                render: (e: BillableEventDto) => (
                  <Link to={`/participants/${e.participantId}`} className="font-medium hover:text-[var(--color-primary)]">
                    {e.participantName || '—'}
                  </Link>
                ),
              },
              {
                key: 'supportItemNumber',
                header: 'Support Item',
                sortable: true,
                className: 'font-mono text-sm tabular-nums text-[var(--color-muted-foreground)]',
              },
              { key: 'dayType', header: 'Day Type', sortable: true },
              {
                key: 'supportsDeliveredFrom',
                header: 'Dates',
                sortable: true,
                render: (e: BillableEventDto) => (
                  <span className="text-sm tabular-nums text-[var(--color-muted-foreground)] whitespace-nowrap">
                    {formatDateAu(e.supportsDeliveredFrom)} – {formatDateAu(e.supportsDeliveredTo)}
                  </span>
                ),
              },
              {
                key: 'quantity',
                header: 'Qty / Hours',
                align: 'right' as const,
                render: (e: BillableEventDto) => (
                  <span className="tabular-nums">{e.hours != null ? `${e.hours}h` : e.quantity != null ? String(e.quantity) : '—'}</span>
                ),
              },
              {
                key: 'totalAmount',
                header: 'Amount',
                type: 'currency' as const,
                align: 'right' as const,
                sortable: true,
                className: 'font-medium tabular-nums',
              },
              {
                key: 'status',
                header: 'Status',
                render: (e: BillableEventDto) => <StatusBadge status={e.status} />,
              },
              {
                key: 'claimReference',
                header: 'Reference',
                className: 'font-mono text-sm tabular-nums text-[var(--color-muted-foreground)]',
              },
            ]}
            footer={
              <tr>
                <td colSpan={5} className="p-2 text-right font-semibold text-[var(--color-foreground)]">Total</td>
                <td className="p-2 text-right font-bold tabular-nums text-[var(--color-foreground)]">{formatCurrency(batch.totalAmount)}</td>
                <td colSpan={2} />
              </tr>
            }
          />
        )}
      </div>
    </div>
  )
}
