import { Link, useNavigate } from 'react-router-dom'
import { useClaimBatches } from '@/api/hooks'
import type { ClaimBatchListDto } from '@/api/types'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { usePermissions } from '@/lib/permissions'
import { Layers, FileStack } from 'lucide-react'

function formatDateTimeAu(value: string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-AU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function ClaimBatchesPage() {
  const navigate = useNavigate()
  const { canWrite } = usePermissions()
  const { data: batches = [], isLoading, isError } = useClaimBatches()

  if (isError) return (
    <div className="p-8 text-center text-red-600">Failed to load claim batches. Please refresh the page.</div>
  )

  const columns: Column<ClaimBatchListDto>[] = [
    {
      key: 'fileName',
      header: 'File Name',
      sortable: true,
      className: 'font-mono text-xs font-medium',
    },
    {
      key: 'createdAt',
      header: 'Created',
      sortable: true,
      render: b => formatDateTimeAu(b.createdAt),
    },
    {
      key: 'submittedAt',
      header: 'Submitted',
      sortable: true,
      render: b => b.submittedAt ? formatDateTimeAu(b.submittedAt) : 'Not submitted',
    },
    {
      key: 'eventCount',
      header: 'Events',
      align: 'right',
      sortable: true,
    },
    {
      key: 'totalAmount',
      header: 'Total',
      align: 'right',
      type: 'currency',
      sortable: true,
      className: 'font-semibold',
    },
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Claim Batches"
        subtitle={`${batches.length} claim batch${batches.length !== 1 ? 'es' : ''}`}
        action={canWrite && (
          <Link
            to="/billing/claim-batches/new"
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 shadow-md shadow-[var(--color-primary)]/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-all"
          >
            <Layers className="w-4 h-4" /> Build claim batch
          </Link>
        )}
      />

      {!isLoading && batches.length === 0 ? (
        <EmptyState
          icon={FileStack}
          title="No claim batches yet"
          description="A claim batch bundles validated billable events into a PRODA bulk file ready for submission to the NDIA. Build one from your unclaimed events to get started."
          action={canWrite ? { label: 'Build claim batch', to: '/billing/claim-batches/new' } : undefined}
        />
      ) : (
        <DataTable
          data={batches}
          columns={columns}
          keyField="id"
          sortable
          loading={isLoading}
          onRowClick={b => navigate(`/billing/claim-batches/${b.id}`)}
          emptyMessage="No claim batches found"
        />
      )}
    </div>
  )
}
