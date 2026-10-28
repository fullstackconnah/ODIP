import { useState, useMemo } from 'react'
import { Plus } from 'lucide-react'
import { useAdminTenantsSummary } from '@/api/hooks/admin'
import { DataTable, RowActions } from '@/components/DataTable'
import type { TenantSummaryDto } from '@/api/types'
import { Button } from '@/components/Button'
import { PageState } from '@/components/PageState'
import { SearchInput } from '@/components/SearchInput'
import { formatInstantDateAu } from '@/lib/format'
import { retryingAfterError } from '@/lib/queryPhase'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TenantsTabProps {
  onAddTenant: () => void
  onEditTenant: (tenant: TenantSummaryDto) => void
  onViewTenantDetail: (tenant: TenantSummaryDto) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TenantsTab({
  onAddTenant,
  onEditTenant,
  onViewTenantDetail,
}: TenantsTabProps) {
  const pageQuery = useAdminTenantsSummary()
  const { data: tenants = [], isLoading, isError, refetch } = pageQuery
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search.trim()) return tenants
    const q = search.toLowerCase()
    return tenants.filter(
      t =>
        t.name.toLowerCase().includes(q) ||
        (t.emailDomain ?? '').toLowerCase().includes(q),
    )
  }, [tenants, search])

  // ── Loading state ────────────────────────────────────────────────────────
  if (isLoading && !retryingAfterError(pageQuery)) return <PageState kind="loading" noun="tenants" />

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by name or domain..." className="flex-1 max-w-sm" />

        <Button onClick={onAddTenant}>
          <Plus className="w-4 h-4" /> New tenant
        </Button>
      </div>

      {/* Table */}
      <DataTable
        data={filtered}
        keyField="id"
        error={isError || retryingAfterError(pageQuery)}
        onRetry={() => refetch()}
        emptyMessage={
          tenants.length === 0
            ? 'No tenants yet. Select "New tenant" to create the first one.'
            : 'No tenants match your search.'
        }
        columns={[
          { key: 'name', header: 'Organisation Name', className: 'font-medium' },
          { key: 'emailDomain', header: 'Email Domain', className: 'text-[var(--color-muted-foreground)]', render: (tenant: TenantSummaryDto) => tenant.emailDomain ?? 'None' },
          {
            key: 'isActive',
            header: 'Status',
            render: (tenant: TenantSummaryDto) => (
              <span
                className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  tenant.isActive
                    ? 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]'
                    : 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]'
                }`}
              >
                {tenant.isActive ? 'Active' : 'Inactive'}
              </span>
            ),
          },
          {
            key: 'createdAt',
            header: 'Created',
            className: 'text-[var(--color-muted-foreground)]',
            render: (tenant: TenantSummaryDto) => formatInstantDateAu(tenant.createdAt),
          },
          { key: 'userCount', header: 'Users', className: 'text-[var(--color-muted-foreground)]' },
          {
            key: 'actions',
            header: '',
            align: 'right',
            render: (tenant: TenantSummaryDto) => (
              <RowActions>
                <Button variant="ghost" size="sm" onClick={() => onEditTenant(tenant)} aria-label={`Edit: ${tenant.name}`}>
                  Edit
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onViewTenantDetail(tenant)} aria-label={`View Users: ${tenant.name}`}>
                  View Users
                </Button>
              </RowActions>
            ),
          },
        ]}
      />
    </div>
  )
}
