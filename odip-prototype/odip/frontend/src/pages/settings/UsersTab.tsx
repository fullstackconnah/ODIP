import { useState } from 'react'
import { Search, Pencil } from 'lucide-react'
import { useAdminUsers, useAdminTenantsSummary } from '@/api/hooks'
import type { AdminUserDto } from '@/api/types'
import { Dropdown } from '@/components/Dropdown'
import { DataTable } from '@/components/DataTable'
import { formatRelative } from '@/lib/format'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface UsersTabProps {
  onAddUser: (tenantId?: string) => void
  onEditUser: (user: AdminUserDto) => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROLE_COLORS: Record<string, string> = {
  SuperAdmin: 'bg-[var(--color-accessible-container)] text-[var(--color-on-accessible-container)]',
  Admin: 'bg-[var(--color-secondary-container)] text-[var(--color-foreground)]',
  Coordinator: 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]',
  SupportWorker: 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]',
  ReadOnly: 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]',
}

const ROLE_LABELS: Record<string, string> = {
  SuperAdmin: 'Super Admin',
  Admin: 'Admin',
  Coordinator: 'Coordinator',
  SupportWorker: 'Support Worker',
  ReadOnly: 'Read Only',
}

const PAGE_SIZE = 20

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONTH_MS = 30 * 86_400_000

/** "Never", "Just now", "5m ago", "3d ago", then the date itself once the login is a month old or more. */
function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  const date = new Date(dateStr)
  if (Date.now() - date.getTime() >= MONTH_MS) return date.toLocaleDateString()
  return formatRelative(date, { style: 'compact' })
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function UsersTab({ onAddUser, onEditUser }: UsersTabProps) {
  const [tenantId, setTenantId] = useState('')
  const [role, setRole] = useState('')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const { data: tenants = [] } = useAdminTenantsSummary()
  const { data: pagedResult, isLoading } = useAdminUsers({
    tenantId: tenantId || undefined,
    role: role || undefined,
    status: status || undefined,
    search: search || undefined,
    page,
    pageSize: PAGE_SIZE,
  })

  const users = pagedResult?.items ?? []
  const totalCount = pagedResult?.totalCount ?? 0
  const hasNext = pagedResult?.hasNext ?? false
  const hasPrevious = pagedResult?.hasPrevious ?? false

  const startItem = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const endItem = Math.min(page * PAGE_SIZE, totalCount)

  const inputClass =
    'w-full px-3 h-[var(--control-h)] rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] transition-all'

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-44">
          <Dropdown
            variant="form"
            value={tenantId}
            onChange={v => { setTenantId(v); setPage(1) }}
            items={[
              { value: '', label: 'All Tenants' },
              ...tenants.map(t => ({ value: t.id, label: t.name })),
            ]}
            label="All Tenants"
          />
        </div>

        <div className="w-40">
          <Dropdown
            variant="form"
            value={role}
            onChange={v => { setRole(v); setPage(1) }}
            items={[
              { value: '', label: 'All Roles' },
              { value: 'Admin', label: 'Admin' },
              { value: 'Coordinator', label: 'Coordinator' },
              { value: 'SupportWorker', label: 'Support Worker' },
              { value: 'ReadOnly', label: 'Read Only' },
            ]}
            label="All Roles"
          />
        </div>

        <div className="w-32">
          <Dropdown
            variant="form"
            value={status}
            onChange={v => { setStatus(v); setPage(1) }}
            items={[
              { value: '', label: 'All' },
              { value: 'Active', label: 'Active' },
              { value: 'Inactive', label: 'Inactive' },
            ]}
            label="All"
          />
        </div>

        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-muted-foreground)]" />
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search users..."
            className={`${inputClass} pl-9`}
          />
        </div>

        <button
          onClick={() => onAddUser(tenantId || undefined)}
          className="px-5 py-2 bg-[var(--color-primary)] text-white rounded-full text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-all"
        >
          + Add User
        </button>
      </div>

      {/* Table */}
      <DataTable
        data={users}
        keyField="id"
        loading={isLoading}
        emptyMessage="No users found."
        columns={[
          { key: 'fullName', header: 'Name', className: 'font-medium' },
          { key: 'email', header: 'Email', className: 'text-[var(--color-muted-foreground)]' },
          {
            key: 'tenantName',
            header: 'Tenant',
            render: (user: AdminUserDto) => (
              <span className="text-xs px-2 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-muted-foreground)]">
                {user.tenantName}
              </span>
            ),
          },
          {
            key: 'role',
            header: 'Role',
            render: (user: AdminUserDto) => (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[user.role] ?? 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]'}`}>
                {ROLE_LABELS[user.role] ?? user.role}
              </span>
            ),
          },
          {
            key: 'isActive',
            header: 'Status',
            render: (user: AdminUserDto) => (
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  user.isActive
                    ? 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]'
                    : 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]'
                }`}
              >
                {user.isActive ? 'Active' : 'Inactive'}
              </span>
            ),
          },
          {
            key: 'lastLoginAt',
            header: 'Last Login',
            className: 'text-[var(--color-muted-foreground)]',
            render: (user: AdminUserDto) => formatRelativeTime(user.lastLoginAt),
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            render: (user: AdminUserDto) => (
              <button
                onClick={() => onEditUser(user)}
                className="p-1.5 rounded-lg hover:bg-[var(--color-accent)] transition-colors"
                title="Edit user"
                aria-label="Edit user"
              >
                <Pencil className="w-4 h-4 text-[var(--color-muted-foreground)]" />
              </button>
            ),
          },
        ]}
      />

      {/* Pagination */}
      {totalCount > 0 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-[var(--color-muted-foreground)]">
            Showing {startItem}-{endItem} of {totalCount} users
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => p - 1)}
              disabled={!hasPrevious}
              className="px-3 py-1.5 rounded-full border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={!hasNext}
              className="px-3 py-1.5 rounded-full border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
