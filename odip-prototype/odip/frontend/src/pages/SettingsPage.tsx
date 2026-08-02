import { useEventTemplates, useActivities, useSettings, useUpdateSettings, useProviderSettings, useUpsertProviderSettings, useSupportCatalogue, usePublicHolidays, useCreatePublicHoliday, useDeletePublicHoliday, useSyncHolidays } from '@/api/hooks'
import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import { Pencil } from 'lucide-react'
import { TabNav } from '@/components/TabNav'
import { StatusBadge } from '@/components/StatusBadge'
import { DataTable } from '@/components/DataTable'
import { Dropdown } from '@/components/Dropdown'
import TemplateFormPanel from '@/components/TemplateFormPanel'
import type { EventTemplateDto, ActivityDto, ProviderSettingsDto, SupportActivityGroupDto, SupportCatalogueItemDto, CatalogueImportPreviewDto, CatalogueImportRowDto, PublicHolidayDto } from '@/api/types'
import type { AxiosError } from 'axios'
import TenantsTab from '@/pages/settings/TenantsTab'
import TenantFormPanel from '@/pages/settings/TenantFormPanel'
import UsersTab from '@/pages/settings/UsersTab'
import UserFormPanel from '@/pages/settings/UserFormPanel'
import TenantDetailView from '@/pages/settings/TenantDetailView'
import type { TenantSummaryDto, AdminUserDto } from '@/api/types'
import { usePermissions } from '@/lib/permissions'

function QualificationSettingsTab() {
  const { data: settings } = useSettings()
  const updateSettings = useUpdateSettings()
  const [warningDays, setWarningDays] = useState<number>(30)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (settings) setWarningDays(settings.qualificationWarningDays)
  }, [settings])

  function handleSave() {
    updateSettings.mutate({ qualificationWarningDays: warningDays }, {
      onSuccess: () => {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      },
    })
  }

  return (
    <div className="max-w-md space-y-6">
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
      <button
        onClick={handleSave}
        disabled={updateSettings.isPending}
        className="px-6 py-2.5 bg-[var(--color-primary)] text-white rounded-full font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {updateSettings.isPending ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
      </button>
    </div>
  )
}

export default function SettingsPage() {
  const [tab, setTab] = useState<'templates' | 'activities' | 'qualifications' | 'provider' | 'catalogue' | 'holidays' | 'tenants' | 'users'>('templates')
  const { data: templates = [] } = useEventTemplates()
  const [panelOpen, setPanelOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<EventTemplateDto | undefined>(undefined)
  const { data: activities = [] } = useActivities()

  const { isSuperAdmin } = usePermissions()

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
    { key: 'provider' as const, label: 'Provider Settings' },
    { key: 'catalogue' as const, label: 'Support Catalogue', superAdminOnly: true },
    { key: 'holidays' as const, label: 'Public Holidays', superAdminOnly: true },
    { key: 'tenants' as const, label: 'Tenants', superAdminOnly: true },
    { key: 'users' as const, label: 'Users', superAdminOnly: true },
  ]
  const tabs = allTabs.filter(t => !t.superAdminOnly || isSuperAdmin)

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Manage event templates, activity library, and qualification settings
        </p>
      </div>

      <TabNav
        tabs={tabs.map(t => ({ key: t.key, label: t.label }))}
        active={tab}
        onChange={(key) => { setTab(key as typeof tab); if (key !== 'tenants') setTenantDetail(undefined) }}
      />

      {tab === 'templates' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => { setEditingTemplate(undefined); setPanelOpen(true) }}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--color-primary)] text-white text-sm font-medium hover:opacity-90 transition-all"
            >
              + New Template
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {templates.filter((t) => t.isActive).map((t) => (
              <div key={t.id} className="bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] p-5 group">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-semibold">{t.eventName}</h3>
                    <span className="text-xs text-[var(--color-muted-foreground)] font-mono">{t.eventCode}</span>
                  </div>
                  <button
                    onClick={() => { setEditingTemplate(t); setPanelOpen(true) }}
                    className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-[var(--color-accent)] transition-all"
                    title="Edit template"
                  >
                    <Pencil className="w-4 h-4 text-[var(--color-muted-foreground)]" />
                  </button>
                </div>
                <div className="text-sm text-[var(--color-muted-foreground)] space-y-1">
                  <p className="flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">location_on</span> {t.defaultDestination || '—'} · {t.defaultRegion || '—'}</p>
                  {t.standardDurationDays && <p className="flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">schedule</span> {t.standardDurationDays} days</p>}
                  {t.preferredTimeOfYear && <p className="flex items-center gap-1"><span className="material-symbols-outlined text-base leading-none">calendar_today</span> {t.preferredTimeOfYear}</p>}
                </div>
              </div>
            ))}
          </div>

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
      {tab === 'provider' && <ProviderSettingsTab />}
      {tab === 'catalogue' && <SupportCatalogueTab />}
      {tab === 'holidays' && <PublicHolidaysTab />}

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
          onEditUser={(_userId) => { setUserPanelOpen(true) }}
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

  if (settings && !init) { setForm(settings); setInit(true) }

  const inputClass = 'w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all'
  const labelClass = 'block text-xs font-medium text-[#43493a] mb-1'

  const f = (field: keyof ProviderSettingsDto) => ({
    value: (form[field] as string) ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((p) => ({ ...p, [field]: e.target.value })),
    className: inputClass,
  })

  function handleSave() {
    setError(null)
    upsert.mutate(form as import('@/api/types').UpsertProviderSettingsDto, {
      onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2000) },
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
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="font-semibold text-[#1b1c1a] mb-1">Organisation Details</h2>
        <p className="text-sm text-[#43493a] mb-4">Used on NDIS claims, BPR CSV files, and invoices.</p>
        <div className="grid grid-cols-2 gap-4">
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
            <input type="checkbox" checked={form.gstRegistered ?? false} onChange={e => setForm((p) => ({ ...p, gstRegistered: e.target.checked }))} className="w-4 h-4 accent-[#396200]" id="gst" />
            <label htmlFor="gst" className="text-sm text-[#43493a]">GST Registered</label>
          </div>
          <div className="flex items-center gap-3">
            <input type="checkbox" checked={form.isPaceProvider ?? false} onChange={e => setForm((p) => ({ ...p, isPaceProvider: e.target.checked }))} className="w-4 h-4 accent-[#396200]" id="pace" />
            <label htmlFor="pace" className="text-sm text-[#43493a]">PACE Provider <span className="text-xs text-[#43493a]/60">(16-col BPR CSV)</span></label>
          </div>
        </div>
      </div>
      {showBankDetails && (
        <div>
          <h2 className="font-semibold text-[#1b1c1a] mb-4">Bank Details</h2>
          <div className="grid grid-cols-3 gap-4">
            <div><label className={labelClass}>Account Name</label><input {...f('bankAccountName')} /></div>
            <div><label className={labelClass}>BSB</label><input {...f('bsb')} /></div>
            <div><label className={labelClass}>Account Number</label><input {...f('accountNumber')} /></div>
          </div>
        </div>
      )}
      <div>
        <h2 className="font-semibold text-[#1b1c1a] mb-2">Invoice Footer Notes</h2>
        <textarea {...f('invoiceFooterNotes')} rows={3} className={inputClass + ' resize-none'} placeholder="e.g. All services delivered in accordance with the NDIS Code of Conduct..." />
      </div>
      {error && (
        <div className="bg-red-50 border border-red-100 rounded-2xl px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <span className="mt-0.5">⚠</span>
          <span>{error}</span>
        </div>
      )}
      {canEditProviderSettings && (
        <button onClick={handleSave} disabled={upsert.isPending} className="px-6 py-2.5 bg-[#396200] text-white rounded-full font-semibold text-sm hover:bg-[#294800] transition-all disabled:opacity-50">
          {upsert.isPending ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
        </button>
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
  const qc = useQueryClient()

  const allItems = (groups as SupportActivityGroupDto[]).flatMap((g: SupportActivityGroupDto) => g.items ?? [])

  const dayTypeColor = (dt: string) => {
    switch(dt) {
      case 'Weekday': return 'bg-blue-100 text-blue-700'
      case 'Saturday': return 'bg-amber-100 text-amber-700'
      case 'Sunday': return 'bg-orange-100 text-orange-700'
      case 'PublicHoliday': return 'bg-red-100 text-red-700'
      default: return 'bg-gray-100 text-gray-600'
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
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
      alert(axiosErr?.response?.data?.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function handleConfirm() {
    if (!preview) return
    setConfirming(true)
    try {
      await apiClient.post('/support-catalogue/import/confirm', { catalogueVersion: version, rows: preview.rows })
      qc.invalidateQueries({ queryKey: ['support-catalogue'] })
      setPreviewStep(null)
      setPreview(null)
      setImporting(false)
    } catch (err: unknown) {
      const axiosErr = err as AxiosError<{ message?: string }>
      alert(axiosErr?.response?.data?.message || 'Confirm failed')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-[#1b1c1a]">Support Catalogue</h2>
          <p className="text-sm text-[#43493a]">NDIS price limits for Category 04 — Group Access.</p>
        </div>
        <button onClick={() => { setImporting(true); setPreviewStep('upload') }} className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#396200] text-white text-sm font-medium hover:bg-[#294800] transition-all">
          Import Catalogue
        </button>
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
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full mx-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[#1b1c1a]">Import NDIS Support Catalogue</h3>
              <button onClick={() => { setImporting(false); setPreviewStep(null); setPreview(null) }} className="text-[#43493a] hover:text-[#1b1c1a]">✕</button>
            </div>

            {previewStep === 'upload' && (
              <div className="space-y-4">
                <p className="text-sm text-[#43493a]">Upload the NDIA Support Catalogue .xlsx file to preview changes.</p>
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-[#c3c9b6] rounded-2xl p-8 cursor-pointer hover:border-[#396200] transition-colors">
                  <span className="text-[#43493a] text-sm mb-2">{uploading ? 'Uploading...' : 'Drop .xlsx here or click to browse'}</span>
                  <input type="file" accept=".xlsx" onChange={handleUpload} className="hidden" disabled={uploading} />
                </label>
              </div>
            )}

            {previewStep === 'preview' && preview && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="bg-[#f5f3ef] rounded-xl p-3"><p className="text-xs text-[#43493a]">New items</p><p className="text-xl font-bold text-[#396200]">{preview.itemsToAdd}</p></div>
                  <div className="bg-[#f5f3ef] rounded-xl p-3"><p className="text-xs text-[#43493a]">Updated</p><p className="text-xl font-bold text-amber-600">{(preview.rows ?? []).filter((r: CatalogueImportRowDto) => r.priceChanged).length}</p></div>
                  <div className="bg-[#f5f3ef] rounded-xl p-3"><p className="text-xs text-[#43493a]">To deactivate</p><p className="text-xl font-bold text-red-500">{preview.itemsToDeactivate}</p></div>
                </div>
                {(preview.warnings ?? []).length > 0 && (
                  <div className="bg-amber-50 rounded-xl p-3 text-xs text-amber-700 space-y-1">
                    {preview.warnings.map((w: string, i: number) => <p key={i}>&#9888; {w}</p>)}
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-[#43493a] mb-1">Catalogue Version</label>
                  <input value={version} onChange={e => setVersion(e.target.value)} className="w-full px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all" />
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setPreviewStep('upload')} className="px-4 py-2 rounded-full border border-[#c3c9b6] text-sm text-[#43493a] hover:bg-[#f5f3ef]">Back</button>
                  <button onClick={handleConfirm} disabled={confirming} className="px-4 py-2 rounded-full bg-[#396200] text-white text-sm font-medium hover:bg-[#294800] disabled:opacity-50">
                    {confirming ? 'Importing...' : 'Confirm Import'}
                  </button>
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
  const [newForm, setNewForm] = useState({ date: '', name: '', state: 'VIC' })
  const [showSyncAdvanced, setShowSyncAdvanced] = useState(false)
  const [syncFromYear, setSyncFromYear] = useState<number | undefined>(undefined)
  const [syncToYear, setSyncToYear] = useState<number | undefined>(undefined)
  const [syncMessage, setSyncMessage] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null)

  const inputClass = 'px-3 py-2 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all'

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
          <h2 className="font-semibold text-[#1b1c1a]">Public Holidays</h2>
          <p className="text-sm text-[#43493a]">Used to determine NDIS public holiday rates on claims.</p>
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
          <button onClick={() => setAdding(true)} className="px-4 py-2 rounded-full bg-[#396200] text-white text-sm font-medium hover:bg-[#294800] transition-all">
            + Add Holiday
          </button>
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
              <button onClick={handleAdd} disabled={createHoliday.isPending} className="px-3 py-1.5 rounded-full bg-[#396200] text-white text-xs font-medium hover:bg-[#294800] disabled:opacity-50">Save</button>
              <button onClick={() => setAdding(false)} className="px-3 py-1.5 rounded-full border border-[#c3c9b6] text-xs text-[#43493a] hover:bg-[#f5f3ef]">Cancel</button>
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
              <button onClick={() => deleteHoliday.mutate(h.id)} className="text-xs text-red-500 hover:text-red-700 hover:underline">
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
          <button
            onClick={handleSync}
            disabled={syncHolidays.isPending}
            className="px-4 py-2 rounded-full bg-[#396200] text-white text-sm font-medium hover:bg-[#294800] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {syncHolidays.isPending ? 'Syncing...' : 'Sync Holidays'}
          </button>
          <button
            type="button"
            onClick={() => setShowSyncAdvanced(v => !v)}
            className="text-sm text-[#43493a] hover:text-[#1b1c1a] underline"
          >
            {showSyncAdvanced ? 'Hide advanced' : 'Advanced'}
          </button>
        </div>

        {showSyncAdvanced && (
          <div className="flex items-center gap-3 mt-3">
            <label className="text-sm text-[#43493a]">From year</label>
            <input
              type="number"
              value={syncFromYear ?? ''}
              onChange={e => setSyncFromYear(e.target.value ? Number(e.target.value) : undefined)}
              placeholder={String(new Date().getFullYear())}
              className="w-24 px-3 py-1.5 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all"
            />
            <label className="text-sm text-[#43493a]">To year</label>
            <input
              type="number"
              value={syncToYear ?? ''}
              onChange={e => setSyncToYear(e.target.value ? Number(e.target.value) : undefined)}
              placeholder={String(new Date().getFullYear() + 1)}
              className="w-24 px-3 py-1.5 rounded-2xl bg-[#f5f3ef] text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#396200]/30 transition-all"
            />
          </div>
        )}

        {syncMessage && (
          <div className={`mt-3 px-4 py-2.5 rounded-2xl text-sm ${
            syncMessage.type === 'success'
              ? 'bg-green-50 text-green-700'
              : syncMessage.type === 'warning'
              ? 'bg-yellow-50 text-yellow-700'
              : 'bg-red-50 text-red-700'
          }`}>
            {syncMessage.text}
          </div>
        )}
      </div>
    </div>
  )
}
