import { useState } from 'react'
import { Search, Pencil } from 'lucide-react'
import { useAdminUsers, useAdminTenantsSummary } from '@/api/hooks'
import type { AdminUserDto } from '@/api/types'
import { Dropdown } from '@/components/Dropdown'
import { DataTable } from '@/components/DataTable'

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
  SuperAdmin: 'bg-purple-100 text-purple-700',
  Admin: 'bg-blue-100 text-blue-700',
  Coordinator: 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]',
  SupportWorker: 'bg-amber-100 text-amber-700',
  ReadOnly: 'bg-gray-100 text-gray-600',
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

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHr = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHr / 24)

  if (diffSec < 60) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDay < 7) return `${diffDay}d ago`
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}w ago`
  return date.toLocaleDateString()
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
    'w-full px-3 py-2 rounded-2xl bg-[var(--color-accent)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] transition-all'

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
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[user.role] ?? 'bg-gray-100 text-gray-600'}`}>
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
                    ? 'bg-green-100 text-green-700'
                    : 'bg-red-50 text-red-600'
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
