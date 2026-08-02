import { useState, useMemo } from 'react'
import { Search } from 'lucide-react'
import { useAdminTenantsSummary } from '@/api/hooks/admin'
import type { TenantSummaryDto } from '@/api/types'

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
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-[var(--color-accent)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 transition-all"
          />
        </div>

        <button
          type="button"
          onClick={onAddTenant}
          className="px-5 py-2 bg-[var(--color-primary)] text-white rounded-full text-sm font-semibold hover:opacity-90 transition-all"
        >
          + Add Tenant
        </button>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-sm text-[var(--color-muted-foreground)]">
          {tenants.length === 0
            ? 'No tenants yet. Click "+ Add Tenant" to create the first one.'
            : 'No tenants match your search.'}
        </div>
      ) : (
        <div className="bg-[var(--color-card)] rounded-2xl border border-[var(--color-border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left px-4 py-3 font-medium text-[var(--color-muted-foreground)]">
                  Organisation Name
                </th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-muted-foreground)]">
                  Email Domain
                </th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-muted-foreground)]">
                  Status
                </th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-muted-foreground)]">
                  Created
                </th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-muted-foreground)]">
                  Users
                </th>
                <th className="text-right px-4 py-3 font-medium text-[var(--color-muted-foreground)]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(tenant => (
                <tr
                  key={tenant.id}
                  className="border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-accent)]/50 transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-[var(--color-foreground)]">
                    {tenant.name}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-muted-foreground)]">
                    {tenant.emailDomain}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        tenant.isActive
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {tenant.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--color-muted-foreground)]">
                    {new Date(tenant.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-muted-foreground)]">
                    {tenant.userCount}
                  </td>
                  <td className="px-4 py-3 text-right">
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
