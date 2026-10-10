import { useState, useMemo } from 'react'
import { Users, UserCheck, Clock, ChevronDown, ChevronRight } from 'lucide-react'
import { BackButton } from '@/components/BackButton'
import { useAdminTenantUsers } from '@/api/hooks/settings'
import { useAdminTenantProviderSettings } from '@/api/hooks/admin'
import { DataTable } from '@/components/DataTable'
import type { TenantSummaryDto, TenantUserDto, ProviderSettingsDto } from '@/api/types'
import { Button } from '@/components/Button'

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
  SuperAdmin: 'bg-[var(--color-accessible-container)] text-[var(--color-on-accessible-container)]',
  Admin: 'bg-[var(--color-secondary-container)] text-[var(--color-foreground)]',
  Coordinator: 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]',
  SupportWorker: 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]',
  ReadOnly: 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]',
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
    <div className="flex flex-col gap-[var(--section-gap)]">
      {/* ── Back / Breadcrumb ──────────────────────────────────── */}
      <BackButton onBack={onBack} label="tenants" variant="link" />

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-[var(--color-foreground)]">
              {tenant.name}
            </h2>
            <span
              className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                tenant.isActive
                  ? 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]'
                  : 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]'
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
          <Button variant="secondary" onClick={onEditTenant}>
            Edit Tenant
          </Button>
          <Button onClick={() => onAddUser(tenant.id)}>
            + Add User
          </Button>
        </div>
      </div>

      {/* ── Summary Cards ──────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        <SummaryCard
          icon={<Users className="w-5 h-5 text-[var(--color-secondary)]" />}
          value={users.length}
          label="Total Users"
          loading={usersLoading}
        />
        <SummaryCard
          icon={<UserCheck className="w-5 h-5 text-[var(--color-primary)]" />}
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
      <div className="bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] overflow-hidden">
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
          <DataTable
            data={users}
            keyField="id"
            className="w-full"
            columns={[
              { key: 'fullName', header: 'Name', className: 'font-medium' },
              {
                key: 'role',
                header: 'Role',
                render: (user: TenantUserDto) => (
                  <span
                    className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      ROLE_COLORS[user.role] ?? 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]'
                    }`}
                  >
                    {user.role}
                  </span>
                ),
              },
              {
                key: 'isActive',
                header: 'Status',
                render: (user: TenantUserDto) => (
                  <span
                    className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      user.isActive
                        ? 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]'
                        : 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]'
                    }`}
                  >
                    {user.isActive ? 'Active' : 'Inactive'}
                  </span>
                ),
              },
              {
                key: 'actions',
                header: '',
                align: 'right',
                render: (user: TenantUserDto) => (
                  <button
                    type="button"
                    onClick={() => onEditUser(user.id)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg hover:bg-[var(--color-accent)] text-[var(--color-primary)] transition-colors"
                  >
                    Edit
                  </button>
                ),
              },
            ]}
          />
        )}
      </div>

      {/* ── Provider Settings (collapsible) ────────────────────── */}
      <div className="bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] overflow-hidden">
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
    <div className="bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] p-[var(--card-pad)] flex items-center gap-4">
      <div className="flex items-center justify-center w-10 h-10 rounded-[var(--radius-md)] bg-[var(--color-accent)]">
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
        active ? 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]' : 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]'
      }`}
    >
      {active ? activeLabel : inactiveLabel}
    </span>
  )
}
