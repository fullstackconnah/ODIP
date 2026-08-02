import { useState, useMemo } from 'react'
import { Users, UserCheck, Clock, ChevronDown, ChevronRight, ArrowLeft } from 'lucide-react'
import { useAdminTenantUsers } from '@/api/hooks/settings'
import { useAdminTenantProviderSettings } from '@/api/hooks/admin'
import type { TenantSummaryDto, TenantUserDto, ProviderSettingsDto } from '@/api/types'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TenantDetailViewProps {
  tenant: TenantSummaryDto
  onBack: () => void
  onEditTenant: () => void
  onAddUser: (tenantId: string) => void
  onEditUser: (userId: string) => void
}

// ---------------------------------------------------------------------------
// Role badge colours
// ---------------------------------------------------------------------------

const ROLE_COLORS: Record<string, string> = {
  SuperAdmin: 'bg-purple-100 text-purple-700',
  Admin: 'bg-blue-100 text-blue-700',
  Coordinator: 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]',
  SupportWorker: 'bg-amber-100 text-amber-700',
  ReadOnly: 'bg-gray-100 text-gray-600',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TenantDetailView({
  tenant,
  onBack,
  onEditTenant,
  onAddUser,
  onEditUser,
}: TenantDetailViewProps) {
  const { data: usersResponse, isLoading: usersLoading } = useAdminTenantUsers(tenant.id)
  const users: TenantUserDto[] = useMemo(() => usersResponse?.data ?? [], [usersResponse?.data])
  const { data: providerSettings, isLoading: providerLoading } =
    useAdminTenantProviderSettings(tenant.id)

  const [providerOpen, setProviderOpen] = useState(false)

  const activeUsers = useMemo(() => users.filter(u => u.isActive).length, [users])

  return (
    <div className="space-y-6">
      {/* ── Back / Breadcrumb ──────────────────────────────────── */}
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Tenants
      </button>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-[var(--color-foreground)]">
              {tenant.name}
            </h2>
            <span
              className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                tenant.isActive
                  ? 'bg-green-100 text-green-800'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              {tenant.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            {tenant.emailDomain}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onEditTenant}
            className="px-4 py-2 rounded-full text-sm font-semibold border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-accent)] transition-all"
          >
            Edit Tenant
          </button>
          <button
            type="button"
            onClick={() => onAddUser(tenant.id)}
            className="px-5 py-2 bg-[var(--color-primary)] text-white rounded-full text-sm font-semibold hover:opacity-90 transition-all"
          >
            + Add User
          </button>
        </div>
      </div>

      {/* ── Summary Cards ──────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        <SummaryCard
          icon={<Users className="w-5 h-5 text-blue-500" />}
          value={users.length}
          label="Total Users"
          loading={usersLoading}
        />
        <SummaryCard
          icon={<UserCheck className="w-5 h-5 text-green-500" />}
          value={activeUsers}
          label="Active Users"
          loading={usersLoading}
        />
        <SummaryCard
          icon={<Clock className="w-5 h-5 text-[var(--color-muted-foreground)]" />}
          value={new Date(tenant.createdAt).toLocaleDateString()}
          label="Created"
          loading={false}
        />
      </div>

      {/* ── Users Table ────────────────────────────────────────── */}
      <div className="bg-[var(--color-card)] rounded-2xl border border-[var(--color-border)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <h3 className="text-sm font-semibold text-[var(--color-foreground)]">Users</h3>
        </div>

        {usersLoading ? (
          <div className="flex items-center justify-center py-12 text-sm text-[var(--color-muted-foreground)]">
            Loading users...
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-12 text-sm text-[var(--color-muted-foreground)]">
            No users in this tenant yet.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left px-4 py-3 font-medium text-[var(--color-muted-foreground)]">
                  Name
                </th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-muted-foreground)]">
                  Role
                </th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-muted-foreground)]">
                  Status
                </th>
                <th className="text-right px-4 py-3 font-medium text-[var(--color-muted-foreground)]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr
                  key={user.id}
                  className="border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-accent)]/50 transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-[var(--color-foreground)]">
                    {user.fullName}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        ROLE_COLORS[user.role] ?? 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        user.isActive
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {user.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => onEditUser(user.id)}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg hover:bg-[var(--color-accent)] text-[var(--color-primary)] transition-colors"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Provider Settings (collapsible) ────────────────────── */}
      <div className="bg-[var(--color-card)] rounded-2xl border border-[var(--color-border)] overflow-hidden">
        <button
          type="button"
          onClick={() => setProviderOpen(prev => !prev)}
          className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-[var(--color-accent)]/50 transition-colors"
        >
          <h3 className="text-sm font-semibold text-[var(--color-foreground)]">
            Provider Settings
          </h3>
          {providerOpen ? (
            <ChevronDown className="w-4 h-4 text-[var(--color-muted-foreground)]" />
          ) : (
            <ChevronRight className="w-4 h-4 text-[var(--color-muted-foreground)]" />
          )}
        </button>

        {providerOpen && (
          <div className="border-t border-[var(--color-border)] px-4 py-4">
            {providerLoading ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">
                Loading provider settings...
              </p>
            ) : !providerSettings ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">
                No provider settings configured for this tenant.
              </p>
            ) : (
              <ProviderSettingsGrid settings={providerSettings} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({
  icon,
  value,
  label,
  loading,
}: {
  icon: React.ReactNode
  value: string | number
  label: string
  loading: boolean
}) {
  return (
    <div className="bg-[var(--color-card)] rounded-2xl border border-[var(--color-border)] p-4 flex items-center gap-4">
      <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[var(--color-accent)]">
        {icon}
      </div>
      <div>
        {loading ? (
          <div className="h-6 w-10 rounded bg-[var(--color-accent)] animate-pulse" />
        ) : (
          <p className="text-xl font-bold text-[var(--color-foreground)]">{value}</p>
        )}
        <p className="text-xs text-[var(--color-muted-foreground)]">{label}</p>
      </div>
    </div>
  )
}

function ProviderSettingsGrid({ settings }: { settings: ProviderSettingsDto }) {
  return (
    <div className="space-y-4">
      {/* Organisation info */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
        <Field label="Organisation Name" value={settings.organisationName} />
        <Field label="Registration Number" value={settings.registrationNumber} />
        <Field label="ABN" value={settings.abn} />
        <Field label="Address" value={settings.address} />
        <Field label="State" value={settings.state} />
      </div>

      {/* Badges */}
      <div className="flex items-center gap-2">
        <Badge
          active={settings.gstRegistered}
          activeLabel="GST Registered"
          inactiveLabel="Not GST Registered"
        />
        <Badge
          active={settings.isPaceProvider}
          activeLabel="PACE Provider"
          inactiveLabel="Not PACE Provider"
        />
      </div>

      {/* Bank details */}
      {(settings.bankAccountName || settings.bsb || settings.accountNumber) && (
        <>
          <div className="border-t border-[var(--color-border)] pt-3">
            <p className="text-xs font-medium text-[var(--color-muted-foreground)] mb-2 uppercase tracking-wide">
              Bank Details
            </p>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
              <Field label="Account Name" value={settings.bankAccountName} />
              <Field label="BSB" value={settings.bsb} />
              <Field label="Account Number" value={settings.accountNumber} />
            </div>
          </div>
        </>
      )}

      {/* Invoice footer */}
      {settings.invoiceFooterNotes && (
        <div className="border-t border-[var(--color-border)] pt-3">
          <p className="text-xs font-medium text-[var(--color-muted-foreground)] mb-1 uppercase tracking-wide">
            Invoice Footer Notes
          </p>
          <p className="text-sm text-[var(--color-foreground)]">
            {settings.invoiceFooterNotes}
          </p>
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs text-[var(--color-muted-foreground)]">{label}</p>
      <p className="text-[var(--color-foreground)] font-medium">
        {value || <span className="text-[var(--color-muted-foreground)] font-normal">--</span>}
      </p>
    </div>
  )
}

function Badge({
  active,
  activeLabel,
  inactiveLabel,
}: {
  active: boolean
  activeLabel: string
  inactiveLabel: string
}) {
  return (
    <span
      className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
        active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
      }`}
    >
      {active ? activeLabel : inactiveLabel}
    </span>
  )
}
