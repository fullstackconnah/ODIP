import { useMemo, useState } from 'react'
import { FileText } from 'lucide-react'
import { Button } from '@/components/Button'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { PageState } from '@/components/PageState'
import type { BatchDto } from '@/api/types'
import { formatInstantDateAu, formatRelative, plural } from '@/lib/format'
import { formatCurrency } from '@/lib/utils'
import { NEXT_ACTION, NEXT_TEXT, ROWS_PER_PAGE, STEP_NUMBER, StepBadge, isUnfinished, stepOf } from './claimHubParts'

const FILE_NAME = 'whitespace-nowrap text-sm font-semibold'

/** Every step's one next action opens the file's panel at that step, so the strip, the Files row and the panel all act the same. */
function NextActionButton({ batch, onOpen, full }: { batch: BatchDto; onOpen: (id: string) => void; full?: boolean }) {
  const next = NEXT_ACTION[stepOf(batch)]
  if (!next) return null
  return (
    <Button variant={next.primary ? 'primary' : 'secondary'} size="sm" className={full ? 'max-md:min-h-11 max-md:w-full' : undefined}
      aria-label={`${next.label}: ${batch.fileName}`} onClick={e => { e.stopPropagation(); onOpen(batch.id) }}>
      {next.label}
    </Button>
  )
}

const resultsText = (b: BatchDto) => b.status === 'ResultsImported' ? `${b.successful} successful · ${b.rejected} rejected` : '—'

/** Oldest step first: a Built file waits on a person sooner than one waiting on the NDIA. */
const byStep = (a: BatchDto, b: BatchDto) => STEP_NUMBER[stepOf(a)] - STEP_NUMBER[stepOf(b)] || a.createdAt.localeCompare(b.createdAt)

export function FilesStrip({ batches, loading, failed, onRetry, onOpen, onShowAll }: {
  batches: BatchDto[] | undefined; loading: boolean; failed: boolean; onRetry: () => void; onOpen: (id: string) => void; onShowAll: () => void
}) {
  const unfinished = useMemo(() => (batches ?? []).filter(isUnfinished).sort(byStep), [batches])
  if (loading) return <p className="text-[13px] text-[var(--color-muted-foreground)]">Loading files in progress…</p>
  if (failed) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-[var(--color-muted-foreground)]">
        Couldn't load files in progress.
        <Button variant="ghost" size="sm" onClick={onRetry}>Try again</Button>
      </p>
    )
  }
  if (unfinished.length === 0) return null
  return (
    <section data-testid="claims-strip" aria-labelledby="claims-strip-title" className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3">
      <h2 id="claims-strip-title" className="mb-1 text-sm font-semibold">Files in progress</h2>
      <ul className="divide-y divide-[var(--color-border)]">
        {unfinished.slice(0, 3).map(b => {
          const step = stepOf(b)
          return (
            <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 md:min-h-[var(--row-h)] md:flex-nowrap md:py-0.5">
              <button type="button" className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-4 gap-y-0.5 text-left max-md:min-h-11" onClick={() => onOpen(b.id)}>
                <span data-testid="strip-file-name" className={FILE_NAME}>{b.fileName}</span>
                <span className="text-sm">Step {STEP_NUMBER[step]} of 4 · {NEXT_TEXT[step]}</span>
                <span className="text-[13px] text-[var(--color-muted-foreground)] max-md:basis-full">Built {formatRelative(b.createdAt, { style: 'long' })} by {b.createdByName}</span>
              </button>
              <span className="max-md:basis-full"><NextActionButton batch={b} onOpen={onOpen} full /></span>
            </li>
          )
        })}
      </ul>
      {unfinished.length > 3 && <Button variant="ghost" size="sm" className="mt-1" onClick={onShowAll}>See all {unfinished.length} in Files</Button>}
    </section>
  )
}

export function FilesPanel({ batches, loading, failed, onRetry, onOpen, onGoToReady }: {
  batches: BatchDto[] | undefined; loading: boolean; failed: boolean; onRetry: () => void; onOpen: (id: string) => void; onGoToReady: () => void
}) {
  const [page, setPage] = useState(1)
  // Newest first; a discarded file is history, so it sinks to the end.
  const rows = useMemo(() => [...(batches ?? [])].sort((a, b) => Number(a.status === 'Discarded') - Number(b.status === 'Discarded') || b.createdAt.localeCompare(a.createdAt)), [batches])
  const columns: Column<BatchDto>[] = [
    { key: 'file', header: 'File', mobile: 'primary', render: b => <span data-testid="files-file-name" className={`${FILE_NAME} ${b.status === 'Discarded' ? 'text-[var(--color-muted-foreground)]' : ''}`}>{b.fileName}</span> },
    { key: 'step', header: 'Step', mobile: 'status', render: b => (
      <span className="inline-flex items-center gap-2 whitespace-nowrap">
        <StepBadge batch={b} />
        {b.status !== 'Discarded' && <span className="text-[13px] text-[var(--color-muted-foreground)] max-md:hidden">Next: {NEXT_TEXT[stepOf(b)]}</span>}
      </span>
    ) },
    { key: 'built', header: 'Built', mobile: 'meta', render: b => <span className="whitespace-nowrap">Built {formatInstantDateAu(b.createdAt)}<span className="max-md:hidden"> by {b.createdByName}</span></span> },
    { key: 'lines', header: 'Lines', align: 'right', mobile: 'meta', render: b => plural(b.lineCount, 'line') },
    { key: 'total', header: 'Total', align: 'right', mobile: 'meta', render: b => formatCurrency(b.totalAmount) },
    { key: 'results', header: 'Results', mobile: 'hidden', render: b => <span className="whitespace-nowrap">{resultsText(b)}</span> },
    { key: 'actions', header: <span className="sr-only">Next action</span>, align: 'right', render: b => <NextActionButton batch={b} onOpen={onOpen} full /> },
  ]
  if (failed) return <div data-testid="claims-panel-files"><PageState kind="error" noun="files" onRetry={onRetry} /></div>
  if (!loading && rows.length === 0) {
    return (
      <div data-testid="claims-panel-files">
        <EmptyState icon={FileText} title="No files yet" description="Build your first file from the lines in Ready to send." action={{ label: 'Go to Ready to send', onClick: onGoToReady }} />
      </div>
    )
  }
  return (
    <div data-testid="claims-panel-files">
      <DataTable
        data={rows.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE)}
        columns={columns}
        keyField="id"
        loading={loading}
        onRowClick={b => onOpen(b.id)}
        pagination={{ page, pageSize: ROWS_PER_PAGE, totalCount: rows.length, onPageChange: setPage }}
      />
    </div>
  )
}
