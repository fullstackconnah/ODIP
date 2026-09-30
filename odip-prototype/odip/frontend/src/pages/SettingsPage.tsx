import { useEventTemplates, useActivities, useSettings, useUpdateSettings, useProviderSettings, useUpsertProviderSettings, useSupportCatalogue, usePublicHolidays, useCreatePublicHoliday, useDeletePublicHoliday, useSyncHolidays } from '@/api/hooks'
import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import { LayoutTemplate, Pencil, X } from 'lucide-react'
import { Tabs } from '@/components/Tabs'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/StatusBadge'
import { DataTable } from '@/components/DataTable'
import { Dropdown } from '@/components/Dropdown'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { formatDateAu } from '@/lib/utils'
import TemplateFormPanel from '@/components/TemplateFormPanel'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import type { EventTemplateDto, ActivityDto, ProviderSettingsDto, SupportActivityGroupDto, SupportCatalogueItemDto, CatalogueImportPreviewDto, CatalogueImportRowDto, PublicHolidayDto } from '@/api/types'
import type { AxiosError } from 'axios'
import TenantsTab from '@/pages/settings/TenantsTab'
import TenantFormPanel from '@/pages/settings/TenantFormPanel'
import UsersTab from '@/pages/settings/UsersTab'
import UserFormPanel from '@/pages/settings/UserFormPanel'
import TenantDetailView from '@/pages/settings/TenantDetailView'
import NotificationPreferencesTab from '@/pages/settings/NotificationPreferencesTab'
import AdminNotificationsTab from '@/pages/settings/AdminNotificationsTab'
import type { TenantSummaryDto, AdminUserDto } from '@/api/types'
import { usePermissions } from '@/lib/permissions'
import { useUiPreferences } from '@/hooks/useUiPreferences'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'

function QualificationSettingsTab() {
  const { data: settings } = useSettings()
  const updateSettings = useUpdateSettings()
  const [warningDays, setWarningDays] = useState<number>(30)
  const [initialWarningDays, setInitialWarningDays] = useState<number | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (settings) {
      setWarningDays(settings.qualificationWarningDays)
      setInitialWarningDays(current => current ?? settings.qualificationWarningDays)
    }
  }, [settings])

  const isDirty = initialWarningDays !== null && warningDays !== initialWarningDays
  const { dialog: unsavedChangesDialog } = useUnsavedChangesWarning(isDirty)

  function handleSave() {
    updateSettings.mutate({ qualificationWarningDays: warningDays }, {
      onSuccess: () => {
        setInitialWarningDays(warningDays)
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      },
    })
  }

  return (
    <div className="max-w-md flex flex-col gap-[var(--section-gap)]">
      {unsavedChangesDialog}
      <div>
        <h2 className="font-semibold text-[var(--color-foreground)] mb-1">Qualification Warning Window</h2>
        <p className="text-sm text-[var(--color-muted-foreground)] mb-4">
          Staff qualifications expiring within this window will appear as warnings on the
          Qualifications page and Dashboard.
        </p>
        <Dropdown
          variant="form"
          value={String(warningDays)}
          onChange={v => setWarningDays(Number(v))}
          items={[7, 14, 30, 60, 90].map(d => ({ value: String(d), label: `${d} days` }))}
          label="Select warning window"
        />
      </div>
      <Button size="md" onClick={handleSave} disabled={updateSettings.isPending}>
        {updateSettings.isPending ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
      </Button>
    </div>
  )
}

function AppearanceSettingsTab() {
  const { prefs, setPref } = useUiPreferences()

  return (
    <div className="max-w-md space-y-4">
      <div>
        <h2 className="font-semibold text-[var(--color-foreground)] mb-1">Appearance</h2>
        <p className="text-sm text-[var(--color-muted-foreground)] mb-4">
          Applies to all tables and is remembered on this device.
        </p>
        <label className="flex items-center gap-3 text-sm text-[var(--color-foreground)] cursor-pointer">
          <input
            type="checkbox"
            checked={prefs.tableVerticalDividers}
            onChange={e => setPref('tableVerticalDividers', e.target.checked)}
            className="w-4 h-4 accent-[var(--color-primary)]"
          />
          Show vertical separators between table columns
        </label>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const [tab, setTab] = useState<'templates' | 'activities' | 'qualifications' | 'appearance' | 'provider' | 'catalogue' | 'holidays' | 'tenants' | 'users' | 'notifications' | 'notifications-admin'>('templates')
  const { data: templates = [], isLoading: templatesLoading } = useEventTemplates()
  const [panelOpen, setPanelOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<EventTemplateDto | undefined>(undefined)
  const { data: activities = [] } = useActivities()

  const activeTemplates = templates.filter((t) => t.isActive)
  // Only claim "no templates" once the fetch has settled, so the empty state doesn't flash on load.
  const templatesEmpty = !templatesLoading && activeTemplates.length === 0
  const openNewTemplate = () => { setEditingTemplate(undefined); setPanelOpen(true) }

  const { isSuperAdmin, canManageNotifications } = usePermissions()

  const [tenantPanelOpen, setTenantPanelOpen] = useState(false)
  const [editingTenant, setEditingTenant] = useState<TenantSummaryDto | undefined>()
  const [tenantDetail, setTenantDetail] = useState<TenantSummaryDto | undefined>()
  const [userPanelOpen, setUserPanelOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<AdminUserDto | undefined>()
  const [defaultTenantId, setDefaultTenantId] = useState<string | undefined>()

  const allTabs = [
    { key: 'templates' as const, label: 'Event Templates' },
    { key: 'activities' as const, label: 'Activity Library' },
    { key: 'qualifications' as const, label: 'Qualification Warnings' },
    { key: 'appearance' as const, label: 'Appearance' },
    { key: 'provider' as const, label: 'Provider Settings' },
    { key: 'catalogue' as const, label: 'Support Catalogue', superAdminOnly: true },
    { key: 'holidays' as const, label: 'Public Holidays', superAdminOnly: true },
    { key: 'tenants' as const, label: 'Tenants', superAdminOnly: true },
    { key: 'users' as const, label: 'Users', superAdminOnly: true },
    { key: 'notifications' as const, label: 'Notifications' },
    { key: 'notifications-admin' as const, label: 'Failed Sends', hidden: !canManageNotifications },
  ]
  const tabs = allTabs.filter(t => (!t.superAdminOnly || isSuperAdmin) && !t.hidden)

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <PageHeader
        title="Settings"
        subtitle="Manage event templates, activity library, and qualification settings"
      />

      <Tabs
        tabs={tabs.map(t => ({ id: t.key, label: t.label }))}
        active={tab}
        onChange={(key) => { setTab(key as typeof tab); if (key !== 'tenants') setTenantDetail(undefined) }}
        ariaLabel="Settings sections"
      />

      {tab === 'templates' && (
        <div className="space-y-4">
          {templatesEmpty ? (
            // The "+ New Template" action lives inside the empty state (not also in the toolbar)
            // so there is exactly one control for it, right where the eye lands. It is a real
            // <Button size="md"> under the EmptyState rather than EmptyState's own `action` slot, which
            // draws a hand-rolled min-h-[44px] text button that ignores the density tokens (44px on a
            // mouse; this one is 32px, and 44px on a coarse pointer). gap-5 + pb-10 reproduce the slot's
            // spacing (gap-3 + mt-2 above it, py-10 around it), hence the pb-0! on the EmptyState.
            <div className="flex flex-col items-center gap-5 pb-10">
              <EmptyState
                icon={LayoutTemplate}
                title="No event templates yet"
                description="Templates pre-fill the destination, region and duration when you create a trip. Add one to get started."
                className="pb-0!"
              />
              <Button onClick={openNewTemplate} size="md">
                + New Template
              </Button>
            </div>
          ) : (
            <>
              <div className="flex justify-end">
                <Button onClick={openNewTemplate} size="md">
                  + New Template
                </Button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {activeTemplates.map((t) => (
                  <div key={t.id} className="bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] p-[var(--card-pad)] group">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h3 className="font-semibold">{t.eventName}</h3>
                        <span className="text-xs text-[var(--color-muted-foreground)] font-mono">{t.eventCode}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        iconOnly
                        onClick={() => { setEditingTemplate(t); setPanelOpen(true) }}
                        className="opacity-0 group-hover:opacity-100"
                        title="Edit template"
                        aria-label="Edit template"
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="text-sm text-[var(--color-muted-foreground)] space-y-1">
                      <p className="flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">location_on</span> {t.defaultDestination || '—'} · {t.defaultRegion || '—'}</p>
                      {t.standardDurationDays && <p className="flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">schedule</span> {t.standardDurationDays} days</p>}
                      {t.preferredTimeOfYear && <p className="flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">calendar_today</span> {t.preferredTimeOfYear}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <TemplateFormPanel
            isOpen={panelOpen}
            onClose={() => { setPanelOpen(false); setEditingTemplate(undefined) }}
            template={editingTemplate}
          />
        </div>
      )}

      {tab === 'activities' && (
        <DataTable
          data={activities}
          keyField="id"
          sortable
          columns={[
            { key: 'activityName', header: 'Activity', sortable: true, className: 'font-medium' },
            { key: 'category', header: 'Category', sortable: true },
            { key: 'location', header: 'Location', render: (a: ActivityDto) => a.location || '—' },
            {
              key: 'isActive',
              header: 'Status',
              sortable: true,
              render: (a: ActivityDto) => (
                <StatusBadge status={a.isActive ? 'Active' : 'Inactive'} />
              ),
            },
          ]}
        />
      )}

      {tab === 'qualifications' && <QualificationSettingsTab />}
      {tab === 'appearance' && <AppearanceSettingsTab />}
      {tab === 'provider' && <ProviderSettingsTab />}
      {tab === 'catalogue' && <SupportCatalogueTab />}
      {tab === 'holidays' && <PublicHolidaysTab />}
      {tab === 'notifications' && <NotificationPreferencesTab />}
      {tab === 'notifications-admin' && canManageNotifications && <AdminNotificationsTab />}

      {tab === 'tenants' && !tenantDetail && (
        <TenantsTab
          onAddTenant={() => { setEditingTenant(undefined); setTenantPanelOpen(true) }}
          onEditTenant={(t) => { setEditingTenant(t); setTenantPanelOpen(true) }}
          onViewTenantDetail={(t) => setTenantDetail(t)}
        />
      )}

      {tab === 'tenants' && tenantDetail && (
        <TenantDetailView
          tenant={tenantDetail}
          onBack={() => setTenantDetail(undefined)}
          onEditTenant={() => { setEditingTenant(tenantDetail); setTenantPanelOpen(true) }}
          onAddUser={(tid) => { setDefaultTenantId(tid); setEditingUser(undefined); setUserPanelOpen(true) }}
          onEditUser={() => { setUserPanelOpen(true) }}
        />
      )}

      {tab === 'users' && (
        <UsersTab
          onAddUser={(tid) => { setDefaultTenantId(tid); setEditingUser(undefined); setUserPanelOpen(true) }}
          onEditUser={(u) => { setEditingUser(u); setUserPanelOpen(true) }}
        />
      )}

      <TenantFormPanel
        isOpen={tenantPanelOpen}
        onClose={() => { setTenantPanelOpen(false); setEditingTenant(undefined) }}
        tenant={editingTenant}
      />

      <UserFormPanel
        isOpen={userPanelOpen}
        onClose={() => { setUserPanelOpen(false); setEditingUser(undefined); setDefaultTenantId(undefined) }}
        user={editingUser}
        defaultTenantId={defaultTenantId}
      />
    </div>
  )
}

function ProviderSettingsTab() {
  const { canEditProviderSettings, showBankDetails } = usePermissions()
  const { data: settings } = useProviderSettings()
  const upsert = useUpsertProviderSettings()
  const [form, setForm] = useState<Partial<ProviderSettingsDto>>({})
  const [init, setInit] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  if (settings && !init) { setForm(settings); setInit(true) }

  const { dialog: unsavedChangesDialog } = useUnsavedChangesWarning(dirty)

  const inputClass = 'w-full px-3 h-[var(--control-h)] rounded-[var(--radius-sm)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[var(--color-ring)] transition-all'
  // A textarea must not take inputClass's fixed height: an explicit height beats `rows`, so the invoice footer notes were one line
  // tall (and resize-none kept them that way). min-h keeps it level with the 32px / 44px inputs; h-auto lets `rows` set the height.
  const textareaClass = 'w-full px-3 min-h-[var(--control-h)] h-auto py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[var(--color-ring)] transition-all resize-y'
  const labelClass = 'block text-xs font-medium text-[var(--color-muted-foreground)] mb-1'

  const f = (field: keyof ProviderSettingsDto) => ({
    value: (form[field] as string) ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setForm((p) => ({ ...p, [field]: e.target.value })); setDirty(true) },
    className: inputClass,
  })

  function handleSave() {
    setError(null)
    upsert.mutate(form as import('@/api/types').UpsertProviderSettingsDto, {
      onSuccess: () => { setDirty(false); setSaved(true); setTimeout(() => setSaved(false), 2000) },
      onError: (err: unknown) => {
        const axiosErr = err as AxiosError<{ message?: string; errors?: string[] }>
        const status = axiosErr?.response?.status
        const msg = axiosErr?.response?.data?.errors?.[0] || axiosErr?.response?.data?.message
        if (status === 403) setError('Admin role is required to update provider settings. Ask an Admin to make this change.')
        else if (status === 400) setError(msg || 'Validation failed — check Registration Number, ABN, Organisation Name and Address are filled in.')
        else setError(msg || 'Failed to save. Please try again.')
      },
    })
  }

  return (
    <div className="flex flex-col gap-[var(--section-gap)] max-w-2xl">
      {unsavedChangesDialog}
      <div>
        <h2 className="font-semibold text-[var(--color-foreground)] mb-1">Organisation Details</h2>
        <p className="text-sm text-[var(--color-muted-foreground)] mb-4">Used on NDIS claims, BPR CSV files, and invoices.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label className={labelClass}>Registration Number</label><input {...f('registrationNumber')} /></div>
          <div><label className={labelClass}>ABN</label><input {...f('abn')} /></div>
          <div className="col-span-2"><label className={labelClass}>Organisation Name</label><input {...f('organisationName')} /></div>
          <div className="col-span-2"><label className={labelClass}>Address</label><input {...f('address')} /></div>
          <div>
            <label className={labelClass}>State</label>
            <Dropdown
              variant="form"
              value={form.state ?? 'VIC'}
              onChange={v => setForm((p) => ({ ...p, state: v }))}
              items={['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'].map(s => ({ value: s, label: s }))}
              label="Select state"
            />
          </div>
          <div className="flex items-center gap-3">
            <input type="checkbox" checked={form.gstRegistered ?? false} onChange={e => { setForm((p) => ({ ...p, gstRegistered: e.target.checked })); setDirty(true) }} className="w-4 h-4 accent-[var(--color-primary)]" id="gst" />
            <label htmlFor="gst" className="text-sm text-[var(--color-muted-foreground)]">GST Registered</label>
          </div>
          <div className="flex items-center gap-3">
            <input type="checkbox" checked={form.isPaceProvider ?? false} onChange={e => { setForm((p) => ({ ...p, isPaceProvider: e.target.checked })); setDirty(true) }} className="w-4 h-4 accent-[var(--color-primary)]" id="pace" />
            <label htmlFor="pace" className="text-sm text-[var(--color-muted-foreground)]">PACE Provider <span className="text-xs text-[var(--color-muted-foreground)]/60">(16-col BPR CSV)</span></label>
          </div>
        </div>
      </div>
      {showBankDetails && (
        <div>
          <h2 className="font-semibold text-[var(--color-foreground)] mb-4">Bank Details</h2>
          <div className="grid grid-cols-3 gap-4">
            <div><label className={labelClass}>Account Name</label><input {...f('bankAccountName')} /></div>
            <div><label className={labelClass}>BSB</label><input {...f('bsb')} /></div>
            <div><label className={labelClass}>Account Number</label><input {...f('accountNumber')} /></div>
          </div>
        </div>
      )}
      <div>
        <h2 className="font-semibold text-[var(--color-foreground)] mb-1">Manager Contact</h2>
        <p className="text-sm text-[var(--color-muted-foreground)] mb-4">The primary manager contact shown first when staff need guidance on a missed medication.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label className={labelClass}>Manager Name</label><input {...f('managerName')} placeholder="e.g. Priya Sharma" /></div>
          <div><label className={labelClass}>Manager Phone</label><input {...f('managerPhone')} placeholder="e.g. 0412 345 007" /></div>
        </div>
      </div>
      <div>
        <h2 className="font-semibold text-[var(--color-foreground)] mb-2">Invoice Footer Notes</h2>
        <textarea {...f('invoiceFooterNotes')} rows={3} className={textareaClass} placeholder="e.g. All services delivered in accordance with the NDIS Code of Conduct..." />
      </div>
      {error && (
        <div className="bg-[var(--color-error-container)] border border-[var(--color-destructive)]/20 rounded-[var(--radius-md)] px-4 py-3 text-sm text-[var(--color-on-error-container)] flex items-start gap-2">
          <span className="mt-0.5">⚠</span>
          <span>{error}</span>
        </div>
      )}
      {canEditProviderSettings && (
        <Button size="md" onClick={handleSave} disabled={upsert.isPending}>
          {upsert.isPending ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
        </Button>
      )}
    </div>
  )
}

function SupportCatalogueTab() {
  const { data: groups = [] } = useSupportCatalogue()
  const [importing, setImporting] = useState(false)
  const [previewStep, setPreviewStep] = useState<'upload' | 'preview' | null>(null)
  const [preview, setPreview] = useState<CatalogueImportPreviewDto | null>(null)
  const [version, setVersion] = useState('')
  const [uploading, setUploading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const qc = useQueryClient()

  const allItems = (groups as SupportActivityGroupDto[]).flatMap((g: SupportActivityGroupDto) => g.items ?? [])

  const dayTypeColor = (dt: string) => {
    switch(dt) {
      case 'Weekday': return 'bg-[var(--color-secondary-container)] text-[var(--color-foreground)]'
      case 'Saturday': return 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]'
      case 'Sunday': return 'bg-[var(--color-accessible-container)] text-[var(--color-on-accessible-container)]'
      case 'PublicHoliday': return 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]'
      default: return 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]'
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setImportError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const { data } = await apiClient.post('/support-catalogue/import/preview', fd, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      setPreview(data.data)
      setVersion(data.data?.detectedVersion || '')
      setPreviewStep('preview')
    } catch (err: unknown) {
      const axiosErr = err as AxiosError<{ message?: string }>
      setImportError(axiosErr?.response?.data?.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function handleConfirm() {
    if (!preview) return
    setConfirming(true)
    setImportError(null)
    try {
      await apiClient.post('/support-catalogue/import/confirm', { catalogueVersion: version, rows: preview.rows })
      qc.invalidateQueries({ queryKey: ['support-catalogue'] })
      setPreviewStep(null)
      setPreview(null)
      setImporting(false)
    } catch (err: unknown) {
      const axiosErr = err as AxiosError<{ message?: string }>
      setImportError(axiosErr?.response?.data?.message || 'Confirm failed')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-[var(--color-foreground)]">Support Catalogue</h2>
          <p className="text-sm text-[var(--color-muted-foreground)]">NDIS price limits for Category 04 — Group Access.</p>
        </div>
        <Button size="md" onClick={() => { setImporting(true); setPreviewStep('upload'); setImportError(null) }}>
          Import Catalogue
        </Button>
      </div>

      <DataTable
        data={allItems}
        keyField="id"
        sortable
        columns={[
          { key: 'itemNumber', header: 'Item Number', sortable: true, className: 'font-mono text-xs' },
          { key: 'description', header: 'Description', sortable: true },
          {
            key: 'dayType',
            header: 'Day Type',
            sortable: true,
            render: (item: SupportCatalogueItemDto) => (
              <span className={`text-xs px-2 py-0.5 rounded-full ${dayTypeColor(item.dayType)}`}>{item.dayType}</span>
            ),
          },
          { key: 'priceLimit_ACT', header: 'ACT', align: 'right' as const, type: 'currency' as const, sortable: true },
          { key: 'priceLimit_NSW', header: 'NSW', align: 'right' as const, type: 'currency' as const, sortable: true },
          { key: 'priceLimit_NT', header: 'NT', align: 'right' as const, type: 'currency' as const, sortable: true },
          { key: 'priceLimit_QLD', header: 'QLD', align: 'right' as const, type: 'currency' as const, sortable: true },
          { key: 'priceLimit_SA', header: 'SA', align: 'right' as const, type: 'currency' as const, sortable: true },
          { key: 'priceLimit_TAS', header: 'TAS', align: 'right' as const, type: 'currency' as const, sortable: true },
          { key: 'priceLimit_VIC', header: 'VIC', align: 'right' as const, type: 'currency' as const, sortable: true },
          { key: 'priceLimit_WA', header: 'WA', align: 'right' as const, type: 'currency' as const, sortable: true },
          { key: 'priceLimit_Remote', header: 'Remote', align: 'right' as const, type: 'currency' as const, sortable: true },
          { key: 'priceLimit_VeryRemote', header: 'V.Remote', align: 'right' as const, type: 'currency' as const, sortable: true },
          { key: 'effectiveFrom', header: 'Effective From', type: 'date' as const, sortable: true },
        ]}
        emptyMessage="No catalogue items. Import the NDIS Support Catalogue XLSX."
      />

      {/* Import modal */}
      {importing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-[var(--color-card)] rounded-[var(--radius-lg)] p-[var(--card-pad)] max-w-lg w-full mx-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[var(--color-foreground)]">Import NDIS Support Catalogue</h3>
              <Button variant="ghost" size="sm" iconOnly aria-label="Close" onClick={() => { setImporting(false); setPreviewStep(null); setPreview(null); setImportError(null) }}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            {importError && (
              <div role="alert" className="bg-[var(--color-error-container)] border border-[var(--color-destructive)]/20 rounded-[var(--radius-md)] px-4 py-3 text-sm text-[var(--color-on-error-container)] flex items-start gap-2">
                <span className="mt-0.5">⚠</span>
                <span>{importError}</span>
              </div>
            )}

            {previewStep === 'upload' && (
              <div className="space-y-4">
                <p className="text-sm text-[var(--color-muted-foreground)]">Upload the NDIA Support Catalogue .xlsx file to preview changes.</p>
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-[var(--color-border)] rounded-[var(--radius-md)] p-[var(--card-pad)] cursor-pointer hover:border-[var(--color-primary)] transition-colors">
                  <span className="text-[var(--color-muted-foreground)] text-sm mb-2">{uploading ? 'Uploading...' : 'Drop .xlsx here or click to browse'}</span>
                  <input type="file" accept=".xlsx" onChange={handleUpload} className="hidden" disabled={uploading} />
                </label>
              </div>
            )}

            {previewStep === 'preview' && preview && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="bg-[var(--color-surface-container-low)] rounded-[var(--radius-md)] p-[var(--card-pad)]"><p className="text-xs text-[var(--color-muted-foreground)]">New items</p><p className="text-xl font-bold text-[var(--color-primary)]">{preview.itemsToAdd}</p></div>
                  <div className="bg-[var(--color-surface-container-low)] rounded-[var(--radius-md)] p-[var(--card-pad)]"><p className="text-xs text-[var(--color-muted-foreground)]">Updated</p><p className="text-xl font-bold text-[var(--color-warning)]">{(preview.rows ?? []).filter((r: CatalogueImportRowDto) => r.priceChanged).length}</p></div>
                  <div className="bg-[var(--color-surface-container-low)] rounded-[var(--radius-md)] p-[var(--card-pad)]"><p className="text-xs text-[var(--color-muted-foreground)]">To deactivate</p><p className="text-xl font-bold text-[var(--color-destructive)]">{preview.itemsToDeactivate}</p></div>
                </div>
                {(preview.warnings ?? []).length > 0 && (
                  <div className="bg-[var(--color-warning-container)] rounded-[var(--radius-md)] p-[var(--card-pad)] text-xs text-[var(--color-on-warning-container)] space-y-1">
                    {preview.warnings.map((w: string, i: number) => <p key={i}>&#9888; {w}</p>)}
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">Catalogue Version</label>
                  <input value={version} onChange={e => setVersion(e.target.value)} className="w-full px-3 h-[var(--control-h)] rounded-[var(--radius-sm)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[var(--color-ring)] transition-all" />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="secondary" size="md" onClick={() => setPreviewStep('upload')}>Back</Button>
                  <Button size="md" onClick={handleConfirm} disabled={confirming}>
                    {confirming ? 'Importing...' : 'Confirm Import'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function PublicHolidaysTab() {
  const [year, setYear] = useState(new Date().getFullYear())
  const [state, setState] = useState('VIC')
  const { data: holidays = [] } = usePublicHolidays(year, state)
  const createHoliday = useCreatePublicHoliday()
  const deleteHoliday = useDeletePublicHoliday()
  const syncHolidays = useSyncHolidays()
  const [adding, setAdding] = useState(false)
  const [deletingHoliday, setDeletingHoliday] = useState<PublicHolidayDto | null>(null)
  const [newForm, setNewForm] = useState({ date: '', name: '', state: 'VIC' })
  const [showSyncAdvanced, setShowSyncAdvanced] = useState(false)
  const [syncFromYear, setSyncFromYear] = useState<number | undefined>(undefined)
  const [syncToYear, setSyncToYear] = useState<number | undefined>(undefined)
  const [syncMessage, setSyncMessage] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null)

  const inputClass = 'px-3 h-[var(--control-h)] rounded-[var(--radius-sm)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[var(--color-ring)] transition-all'

  function handleAdd() {
    createHoliday.mutate(newForm, {
      onSuccess: () => { setAdding(false); setNewForm({ date: '', name: '', state: 'VIC' }) }
    })
  }

  function handleSync() {
    setSyncMessage(null)
    syncHolidays.mutate(
      { fromYear: syncFromYear, toYear: syncToYear },
      {
        onSuccess: (result) => {
          const errSuffix = result.errors?.length > 0 ? ` (${result.errors.length} error${result.errors.length > 1 ? 's' : ''} — check server logs)` : ''
          setSyncMessage({ type: result.errors?.length > 0 ? 'warning' : 'success', text: `Sync complete: ${result.holidaysAdded} added, ${result.holidaysUpdated} updated${errSuffix}` })
          setTimeout(() => setSyncMessage(null), 4000)
        },
        onError: (error: Error) => {
          const err = error as AxiosError<{ message?: string }>
          const msg = err?.response?.data?.message || err?.message || 'Sync failed. Please try again.'
          setSyncMessage({ type: 'error', text: msg })
        },
      }
    )
  }

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 1 + i)
  const states = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA']

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-semibold text-[var(--color-foreground)]">Public Holidays</h2>
          <p className="text-sm text-[var(--color-muted-foreground)]">Used to determine NDIS public holiday rates on claims.</p>
        </div>
        <div className="flex items-center gap-2">
          <Dropdown
            variant="form"
            value={String(year)}
            onChange={v => setYear(Number(v))}
            items={years.map(y => ({ value: String(y), label: String(y) }))}
            label="Select year"
          />
          <Dropdown
            variant="form"
            value={state}
            onChange={v => setState(v)}
            items={states.map(s => ({ value: s, label: s }))}
            label="Select state"
          />
          <Button size="md" onClick={() => setAdding(true)}>
            + Add Holiday
          </Button>
        </div>
      </div>

      {adding && (
        <div className="bg-[var(--color-card)] rounded-t-2xl border border-b-0 border-[var(--color-border)] p-3">
          <div className="flex items-center gap-3">
            <input type="date" value={newForm.date} onChange={e => setNewForm(p => ({ ...p, date: e.target.value }))} className={inputClass + ' w-40'} />
            <input value={newForm.name} onChange={e => setNewForm(p => ({ ...p, name: e.target.value }))} placeholder="Holiday name" className={inputClass + ' flex-1'} />
            <Dropdown
              variant="form"
              value={newForm.state}
              onChange={v => setNewForm(p => ({ ...p, state: v }))}
              items={states.map(s => ({ value: s, label: s }))}
              label="Select state"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd} disabled={createHoliday.isPending}>Save</Button>
              <Button variant="secondary" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
      <DataTable
        data={holidays as PublicHolidayDto[]}
        keyField="id"
        className={adding ? 'relative bg-[var(--color-card)] rounded-b-2xl border border-t-0 border-[var(--color-border)] overflow-x-auto' : undefined}
        sortable
        columns={[
          { key: 'date', header: 'Date', type: 'date' as const, sortable: true, className: 'font-medium' },
          { key: 'name', header: 'Name', sortable: true },
          {
            key: 'state',
            header: 'State',
            render: (h: PublicHolidayDto) => (
              <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-accent)] text-[var(--color-muted-foreground)]">
                {h.state || 'All'}
              </span>
            ),
          },
          {
            key: 'actions',
            header: '',
            render: (h: PublicHolidayDto) => (
              <button onClick={() => setDeletingHoliday(h)} className="text-xs text-[var(--color-destructive)] hover:underline">
                Delete
              </button>
            ),
          },
        ]}
        emptyMessage={`No holidays found for ${year} in ${state}.`}
      />

      {/* Holiday Sync */}
      <div className="pt-4">
        <div className="flex items-center gap-3">
          <Button size="md" onClick={handleSync} disabled={syncHolidays.isPending}>
            {syncHolidays.isPending ? 'Syncing...' : 'Sync Holidays'}
          </Button>
          <button
            type="button"
            onClick={() => setShowSyncAdvanced(v => !v)}
            className="text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] underline"
          >
            {showSyncAdvanced ? 'Hide advanced' : 'Advanced'}
          </button>
        </div>

        {showSyncAdvanced && (
          <div className="flex items-center gap-3 mt-3">
            <label className="text-sm text-[var(--color-muted-foreground)]">From year</label>
            <input
              type="number"
              value={syncFromYear ?? ''}
              onChange={e => setSyncFromYear(e.target.value ? Number(e.target.value) : undefined)}
              placeholder={String(new Date().getFullYear())}
              className="w-24 px-3 h-[var(--control-h)] rounded-[var(--radius-sm)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[var(--color-ring)] transition-all"
            />
            <label className="text-sm text-[var(--color-muted-foreground)]">To year</label>
            <input
              type="number"
              value={syncToYear ?? ''}
              onChange={e => setSyncToYear(e.target.value ? Number(e.target.value) : undefined)}
              placeholder={String(new Date().getFullYear() + 1)}
              className="w-24 px-3 h-[var(--control-h)] rounded-[var(--radius-sm)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[var(--color-ring)] transition-all"
            />
          </div>
        )}

        {syncMessage && (
          <div className={`mt-3 px-4 py-2.5 rounded-[var(--radius-md)] text-sm ${
            syncMessage.type === 'success'
              ? 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]'
              : syncMessage.type === 'warning'
              ? 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]'
              : 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]'
          }`}>
            {syncMessage.text}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deletingHoliday !== null}
        onCancel={() => setDeletingHoliday(null)}
        onConfirm={() => {
          if (!deletingHoliday) return
          deleteHoliday.mutate(deletingHoliday.id, { onSuccess: () => setDeletingHoliday(null) })
        }}
        title="Delete Public Holiday"
        message={
          deletingHoliday
            ? `Delete the public holiday "${deletingHoliday.name}" on ${formatDateAu(deletingHoliday.date)} (${deletingHoliday.state || 'All states'})? This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        variant="danger"
        loading={deleteHoliday.isPending}
      />
    </div>
  )
}
