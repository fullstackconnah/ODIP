import { useNavigate } from 'react-router-dom'
import { useClaimBatches } from '@/api/hooks'
import type { ClaimBatchListDto } from '@/api/types'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/Button'
import { usePermissions } from '@/lib/permissions'
import { formatDateTimeAu, plural } from '@/lib/format'
import { Layers, FileStack } from 'lucide-react'

export default function ClaimBatchesPage() {
  const navigate = useNavigate()
  const { canWrite } = usePermissions()
  const { data: batches = [], isLoading, isError } = useClaimBatches()

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
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      {/* The header (H1 + actions) renders in every state, including a failed fetch. The count is
          left off on error: `batches` is only the [] default there, and "0 claim batches" would
          read as a real empty list rather than a failure. */}
      <PageHeader
        title="Claim Batches"
        subtitle={isError ? undefined : plural(batches.length, 'claim batch', 'claim batches')}
        action={canWrite && (
          <Button to="/billing/claim-batches/new" size="md">
            <Layers className="w-4 h-4" /> Build claim batch
          </Button>
        )}
      />

      {isError ? (
        <div className="p-[var(--card-pad)] text-center text-[var(--color-destructive)]">Failed to load claim batches. Please refresh the page.</div>
      ) : !isLoading && batches.length === 0 ? (
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
