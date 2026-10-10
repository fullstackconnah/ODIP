import { useState, useMemo } from 'react'
import { Plus, Search } from 'lucide-react'
import { useAdminTenantsSummary } from '@/api/hooks/admin'
import { DataTable } from '@/components/DataTable'
import type { TenantSummaryDto } from '@/api/types'
import { Button } from '@/components/Button'

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
  const { data: tenants = [], isLoading } = useAdminTenantsSummary()
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search.trim()) return tenants
    const q = search.toLowerCase()
    return tenants.filter(
      t =>
        t.name.toLowerCase().includes(q) ||
        t.emailDomain.toLowerCase().includes(q),
    )
  }, [tenants, search])

  // ── Loading state ────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-[var(--color-muted-foreground)]">
        Loading tenants...
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-muted-foreground)]" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or domain..."
            className="w-full pl-9 pr-3 h-[var(--control-h)] rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] transition-all"
          />
        </div>

        <Button onClick={onAddTenant}>
          <Plus className="w-4 h-4" /> Add Tenant
        </Button>
      </div>

      {/* Table */}
      <DataTable
        data={filtered}
        keyField="id"
        emptyMessage={
          tenants.length === 0
            ? 'No tenants yet. Click "+ Add Tenant" to create the first one.'
            : 'No tenants match your search.'
        }
        columns={[
          { key: 'name', header: 'Organisation Name', className: 'font-medium' },
          { key: 'emailDomain', header: 'Email Domain', className: 'text-[var(--color-muted-foreground)]' },
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
            render: (tenant: TenantSummaryDto) => new Date(tenant.createdAt).toLocaleDateString(),
          },
          { key: 'userCount', header: 'Users', className: 'text-[var(--color-muted-foreground)]' },
          {
            key: 'actions',
            header: '',
            align: 'right',
            render: (tenant: TenantSummaryDto) => (
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => onEditTenant(tenant)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg hover:bg-[var(--color-accent)] text-[var(--color-foreground)] transition-colors"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onViewTenantDetail(tenant)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg hover:bg-[var(--color-accent)] text-[var(--color-primary)] transition-colors"
                >
                  View Users
                </button>
              </div>
            ),
          },
        ]}
      />
    </div>
  )
}
