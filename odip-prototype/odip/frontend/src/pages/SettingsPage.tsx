import { labelClass } from '@/components/FormField'
import { useSettings, useUpdateSettings, useProviderSettings, useUpsertProviderSettings } from '@/api/hooks'
import { useState, useEffect, useRef } from 'react'
import { Tabs } from '@/components/Tabs'
import { Dropdown } from '@/components/Dropdown'
import { ToggleGroup } from '@/components/ToggleGroup'
import { extractErrorMessage } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import type { MedicationCompetencyMode, ProviderSettingsDto, ParticipantReadinessMode, UpsertProviderSettingsDto } from '@/api/types'
import type { AxiosError } from 'axios'
import TenantsTab from '@/pages/settings/TenantsTab'
import TenantFormPanel from '@/pages/settings/TenantFormPanel'
import UsersTab from '@/pages/settings/UsersTab'
import UserFormPanel from '@/pages/settings/UserFormPanel'
import TenantDetailView from '@/pages/settings/TenantDetailView'
import NotificationPreferencesTab from '@/pages/settings/NotificationPreferencesTab'
import AdminNotificationsTab from '@/pages/settings/AdminNotificationsTab'
import ActivityLibraryTab from '@/pages/settings/ActivityLibraryTab'
import BudgetSettingsTab from '@/pages/settings/BudgetSettingsTab'
import type { TenantSummaryDto, AdminUserDto } from '@/api/types'
import { usePermissions } from '@/lib/permissions'
import { useNotices } from '@/hooks/useNotices'
import { useUiPreferences } from '@/hooks/useUiPreferences'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { useTabParam } from '@/hooks/useTabParam'
import PlanPricingSettingsTab from '@/pages/settings/PlanPricingSettingsTab'
import ImportDataTab from '@/pages/settings/ImportDataTab'
import DataExportTab from '@/pages/settings/DataExportTab'
import { Callout } from '@/components/Callout'
import EventTemplatesSection from '@/pages/settings/EventTemplatesSection'
import PublicHolidaysSection from '@/pages/settings/PublicHolidaysSection'
import SupportCatalogueSection from '@/pages/settings/SupportCatalogueSection'

function QualificationSettingsTab() {
  const { data: settings } = useSettings()
  const updateSettings = useUpdateSettings()
  const [warningDays, setWarningDays] = useState<number>(30)
  const [initialWarningDays, setInitialWarningDays] = useState<number | null>(null)
  const [saved, setSaved] = useState(false)
  // "Saved!" puts the label back after two seconds. The timer is kept so a newer save can replace it and leaving the tab can cancel it: left
  // running it fires setSaved into a tree that is gone.
  const savedResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (savedResetTimer.current) clearTimeout(savedResetTimer.current)
    }
  }, [])

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
        if (savedResetTimer.current) clearTimeout(savedResetTimer.current)
        savedResetTimer.current = setTimeout(() => setSaved(false), 2000)
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

  const { isSuperAdmin, isAdmin, canManageNotifications, canImportData } = usePermissions()

  const [tenantPanelOpen, setTenantPanelOpen] = useState(false)
  const [editingTenant, setEditingTenant] = useState<TenantSummaryDto | undefined>()
  const [tenantDetail, setTenantDetail] = useState<TenantSummaryDto | undefined>()
  const [userPanelOpen, setUserPanelOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<AdminUserDto | undefined>()
  const [defaultTenantId, setDefaultTenantId] = useState<string | undefined>()
  // What became of each Users-tab "Send set-password email". Held here, not in the tab, because the tab is unmounted whenever another tab is
  // shown: an unacknowledged failure must still be there on return, and a send that finishes while the tab is away must still report.
  const userNotices = useNotices()

  const allTabs = [
    { key: 'templates' as const, label: 'Event templates' },
    { key: 'activities' as const, label: 'Activity library' },
    { key: 'qualifications' as const, label: 'Qualification warnings' },
    { key: 'appearance' as const, label: 'Appearance' },
    { key: 'provider' as const, label: 'Provider settings' },
    // Settings → Import data: an Admin, or a SuperAdmin viewing as the organisation (ImportsController; an import belongs to one organisation).
    { key: 'import' as const, label: 'Import data', hidden: !canImportData },
    // Settings → Data export: the same gate. DataExportController admits Admin and SuperAdmin, and answers 400 to a SuperAdmin who hasn't chosen an organisation.
    { key: 'export' as const, label: 'Data export', hidden: !canImportData },
    // The pricing engine's own answers (registration groups, crossing policy, travel rates): the provider's to set, so Admins and SuperAdmins only.
    { key: 'pricing' as const, label: 'Plan pricing', hidden: !(isAdmin || isSuperAdmin) },
    // What a budget check does about a one-off shift that would put a participant over budget, and when a participant counts as approaching it (budget phase 1 stores the choice): Admins and SuperAdmins only.
    { key: 'budgets' as const, label: 'Budgets', hidden: !(isAdmin || isSuperAdmin) },
    { key: 'catalogue' as const, label: 'Support catalogue', superAdminOnly: true },
    // Everyone reads the calendar (it prices their plans and claims); only a SuperAdmin changes it, so the tab is read-only for the rest.
    { key: 'holidays' as const, label: 'Public holidays' },
    { key: 'tenants' as const, label: 'Tenants', superAdminOnly: true },
    { key: 'users' as const, label: 'Users', superAdminOnly: true },
    { key: 'notifications' as const, label: 'Notifications' },
    { key: 'notifications-admin' as const, label: 'Failed sends', hidden: !canManageNotifications },
  ]
  const tabs = allTabs.filter(t => (!t.superAdminOnly || isSuperAdmin) && !t.hidden)
  // The active tab lives in the URL (?tab=pricing), so a link, a reload and the plan builder's "Confirm in Settings" all land on it; a tab this user cannot see reads as the first.
  const [tab, setTab] = useTabParam(tabs.map(t => t.key), 'templates')

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <PageHeader title="Settings" />

      <Tabs
        tabs={tabs.map(t => ({ id: t.key, label: t.label }))}
        active={tab}
        onChange={(key) => { setTab(key); if (key !== 'tenants') setTenantDetail(undefined) }}
        ariaLabel="Settings sections"
        // Ten tabs do not fit one row at 1440px: one row that scrolls (the active tab scrolled into view) rather than the last tab alone on a second row.
        overflow="scroll"
      />

      {tab === 'templates' && <EventTemplatesSection />}

      {tab === 'activities' && <ActivityLibraryTab />}

      {tab === 'qualifications' && <QualificationSettingsTab />}
      {tab === 'appearance' && <AppearanceSettingsTab />}
      {tab === 'provider' && <ProviderSettingsTab />}
      {tab === 'import' && <ImportDataTab />}
      {tab === 'export' && <DataExportTab />}
      {tab === 'pricing' && <PlanPricingSettingsTab />}
      {tab === 'budgets' && <BudgetSettingsTab />}
      {tab === 'catalogue' && <SupportCatalogueSection />}
      {tab === 'holidays' && <PublicHolidaysSection canEdit={isSuperAdmin} />}
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
          notices={userNotices}
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

const READINESS_MODE_OPTIONS: { key: ParticipantReadinessMode; label: string }[] = [
  { key: 'Warn', label: 'Warn only' },
  { key: 'Enforce', label: 'Enforce' },
]

function ProviderSettingsTab() {
  const { canEditProviderSettings, showBankDetails } = usePermissions()
  const { data: settings, isLoading } = useProviderSettings()
  const upsert = useUpsertProviderSettings()
  const [form, setForm] = useState<Partial<ProviderSettingsDto>>({})
  // The medication competency mode this form LOADED (and, after a save, last saved). The mode is last-write-wins on the server and nothing refreshes
  // this form while it is open, so it is sent only when the user changed it from this value: re-sending a stale one would silently undo another
  // admin's change (and, being a medication-safety control, nothing would say so).
  const [loadedMode, setLoadedMode] = useState<MedicationCompetencyMode>('Warn')
  const [init, setInit] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  // "Saved!" puts the label back after two seconds. The timer is kept so a newer save can replace it and leaving the tab can cancel it: left
  // running it fires setSaved into a tree that is gone.
  const savedResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (savedResetTimer.current) clearTimeout(savedResetTimer.current)
    }
  }, [])
  // The readiness check is kept out of `form` on purpose. `serverMode` is the server's current value (an org with no settings row yet is
  // Warn); `modePick` is what the user chose on the control, with the server value they chose it against. Only a deliberate pick that
  // differs from the server is ever sent. A pick is good only while the server still holds the value it was made against: once that
  // moves on (our own save landed, or another admin changed it) the pick is dropped for good, so a stale tab can never push an old
  // choice back over a newer one, not even if the server later returns to the value the pick was made against.
  const serverMode: ParticipantReadinessMode = settings?.participantReadinessMode ?? 'Warn'
  const [modePick, setModePick] = useState<{ value: ParticipantReadinessMode; base: ParticipantReadinessMode } | null>(null)
  if (modePick && modePick.base !== serverMode) setModePick(null)
  const pickedMode = modePick && modePick.base === serverMode ? modePick.value : null
  const shownMode = pickedMode ?? serverMode
  const modeChanged = pickedMode !== null && pickedMode !== serverMode

  if (settings && !init) { setForm(settings); setLoadedMode(settings.medicationCompetencyMode ?? 'Warn'); setInit(true) }

  const { dialog: unsavedChangesDialog } = useUnsavedChangesWarning(dirty)

  const inputClass = 'w-full px-3 h-[var(--control-h)] rounded-[var(--radius-sm)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all'
  // A textarea must not take inputClass's fixed height: an explicit height beats `rows`, so the invoice footer notes were one line
  // tall (and resize-none kept them that way). min-h keeps it level with the 32px / 44px inputs; h-auto lets `rows` set the height.
  const textareaClass = 'w-full px-3 min-h-[var(--control-h)] h-auto py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-container-low)] text-sm focus:outline-none focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-ring)] transition-all resize-y'

  const f = (field: keyof ProviderSettingsDto) => ({
    value: (form[field] as string) ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setForm((p) => ({ ...p, [field]: e.target.value })); setDirty(true) },
    className: inputClass,
    // Names the field: each label points at it with htmlFor.
    id: `provider-${field}`,
  })

  function handleSave() {
    setError(null)
    // `form` is the whole GET response, so it carries BOTH modes as they were when this tab loaded. Neither may go back up as it is: the server
    // changes a mode whenever its field is present, so a stale tab saving an unrelated field (a manager name) would silently revert a mode
    // another admin has since set. Strip both, then add each back only for a deliberate change.
    const body: Partial<ProviderSettingsDto> = { ...form }
    delete body.participantReadinessMode
    const chosenMode = form.medicationCompetencyMode ?? 'Warn'
    if (chosenMode === loadedMode) delete body.medicationCompetencyMode   // untouched: leave the server value alone
    const payload = body as UpsertProviderSettingsDto
    if (modeChanged) payload.participantReadinessMode = shownMode
    upsert.mutate(payload, {
      onSuccess: () => {
        setLoadedMode(chosenMode); setDirty(false); setSaved(true)
        if (savedResetTimer.current) clearTimeout(savedResetTimer.current)
        savedResetTimer.current = setTimeout(() => setSaved(false), 2000)
      },
      onError: (err: unknown) => {
        const status = (err as AxiosError)?.response?.status
        if (status === 403) setError('Admin role is required to update provider settings. Ask an Admin to make this change.')
        else if (status === 400) setError(extractErrorMessage(err, 'Validation failed — check Registration Number, ABN, Organisation Name and Address are filled in.'))
        else setError(extractErrorMessage(err, 'Failed to save. Please try again.'))
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
          <div><label htmlFor="provider-registrationNumber" className={labelClass}>Registration Number</label><input {...f('registrationNumber')} /></div>
          <div><label htmlFor="provider-abn" className={labelClass}>ABN</label><input {...f('abn')} /></div>
          <div className="col-span-2"><label htmlFor="provider-organisationName" className={labelClass}>Organisation Name</label><input {...f('organisationName')} /></div>
          <div className="col-span-2"><label htmlFor="provider-address" className={labelClass}>Address</label><input {...f('address')} /></div>
          <div>
            <label id="provider-state-label" className={labelClass}>State</label>
            <Dropdown
              variant="form"
              aria-labelledby="provider-state-label"
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
            <div><label htmlFor="provider-bankAccountName" className={labelClass}>Account Name</label><input {...f('bankAccountName')} /></div>
            <div><label htmlFor="provider-bsb" className={labelClass}>BSB</label><input {...f('bsb')} /></div>
            <div><label htmlFor="provider-accountNumber" className={labelClass}>Account Number</label><input {...f('accountNumber')} /></div>
          </div>
        </div>
      )}
      <div>
        <h2 className="font-semibold text-[var(--color-foreground)] mb-1">Manager Contact</h2>
        <p className="text-sm text-[var(--color-muted-foreground)] mb-4">The primary manager contact shown first when staff need guidance on a missed medication.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label htmlFor="provider-managerName" className={labelClass}>Manager Name</label><input {...f('managerName')} placeholder="e.g. Priya Sharma" /></div>
          <div><label htmlFor="provider-managerPhone" className={labelClass}>Manager Phone</label><input {...f('managerPhone')} placeholder="e.g. 0412 345 007" /></div>
        </div>
      </div>
      <div>
        <h2 className="font-semibold text-[var(--color-foreground)] mb-1">Participant readiness check</h2>
        <p className="text-sm text-[var(--color-muted-foreground)] mb-3">
          Warn only: staff can roster, book and activate participants who are not fully ready, and the gaps show as warnings. Enforce: participants must be fully ready first, including a signed service agreement. Signed agreements cannot be recorded yet, so Enforce would block participants with no way to clear it. Keep Warn only for now.
        </p>
        <ToggleGroup
          ariaLabel="Participant readiness check"
          options={READINESS_MODE_OPTIONS}
          value={shownMode}
          onChange={v => { setModePick({ value: v as ParticipantReadinessMode, base: serverMode }); setDirty(true) }}
          disabled={!canEditProviderSettings || isLoading}
        />
      </div>
      <div>
        <h2 className="font-semibold text-[var(--color-foreground)] mb-1">Medication Competency</h2>
        <p className="text-sm text-[var(--color-muted-foreground)] mb-4">
          What happens when a staff member without a current Medication Competency records a dose. Warn only lets them record it and flags the record for review; Enforce refuses it.
        </p>
        <div className="max-w-xs">
          <label id="medication-competency-mode-label" className={labelClass}>Medication competency check</label>
          <Dropdown
            variant="form"
            id="medication-competency-mode"
            aria-labelledby="medication-competency-mode-label"
            value={form.medicationCompetencyMode ?? 'Warn'}
            onChange={v => { setForm((p) => ({ ...p, medicationCompetencyMode: v as MedicationCompetencyMode })); setDirty(true) }}
            items={[{ value: 'Warn', label: 'Warn only' }, { value: 'Enforce', label: 'Enforce' }]}
            label="Medication competency check"
            disabled={!canEditProviderSettings}
          />
        </div>
      </div>
      <div>
        <h2 id="provider-invoice-footer-notes-label" className="font-semibold text-[var(--color-foreground)] mb-2">Invoice Footer Notes</h2>
        <textarea {...f('invoiceFooterNotes')} aria-labelledby="provider-invoice-footer-notes-label" rows={3} className={textareaClass} placeholder="e.g. All services delivered in accordance with the NDIS Code of Conduct..." />
      </div>
      {error && (
        <Callout tone="error">{error}</Callout>
      )}
      {canEditProviderSettings && (
        <Button size="md" onClick={handleSave} disabled={upsert.isPending}>
          {upsert.isPending ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
        </Button>
      )}
    </div>
  )
}
