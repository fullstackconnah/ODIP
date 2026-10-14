import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import type { AdminUserDto, TenantSummaryDto } from '@/api/types'
import { BackButton } from '@/components/BackButton'
import { PageHeader } from '@/components/PageHeader'
import { useIsBelowMd } from '@/hooks/useIsBelowMd'
import { useNotices } from '@/hooks/useNotices'
import { usePermissions } from '@/lib/permissions'
import ActivityLibraryTab from '@/pages/settings/ActivityLibraryTab'
import AdminNotificationsTab from '@/pages/settings/AdminNotificationsTab'
import AlertWindowsSection from '@/pages/settings/AlertWindowsSection'
import AppearanceSection from '@/pages/settings/AppearanceSection'
import BudgetSettingsTab from '@/pages/settings/BudgetSettingsTab'
import DataExportTab from '@/pages/settings/DataExportTab'
import EventTemplatesSection from '@/pages/settings/EventTemplatesSection'
import ImportDataTab from '@/pages/settings/ImportDataTab'
import NotificationPreferencesTab from '@/pages/settings/NotificationPreferencesTab'
import PlanPricingSettingsTab from '@/pages/settings/PlanPricingSettingsTab'
import ProfileSection from '@/pages/settings/ProfileSection'
import PublicHolidaysSection from '@/pages/settings/PublicHolidaysSection'
import SettingsNav from '@/pages/settings/SettingsNav'
import { SettingsSection, type SectionFrame } from '@/pages/settings/SettingsSection'
import { requestedSection, visibleSections, type SectionDef, type SectionKey } from '@/pages/settings/settingsSections'
import SupportCatalogueSection from '@/pages/settings/SupportCatalogueSection'
import TenantDetailView from '@/pages/settings/TenantDetailView'
import TenantFormPanel from '@/pages/settings/TenantFormPanel'
import TenantsTab from '@/pages/settings/TenantsTab'
import UserFormPanel from '@/pages/settings/UserFormPanel'
import UsersTab from '@/pages/settings/UsersTab'
import type { AxiosError } from 'axios'
import { useProviderSettings, useUpsertProviderSettings } from '@/api/hooks'
import type { MedicationCompetencyMode, ParticipantReadinessMode, ProviderSettingsDto, UpsertProviderSettingsDto } from '@/api/types'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { Dropdown } from '@/components/Dropdown'
import { labelClass } from '@/components/FormField'
import { ToggleGroup } from '@/components/ToggleGroup'
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning'
import { extractErrorMessage } from '@/lib/utils'

/**
 * Settings: the shell. The URL names the open section (`?section=`; a legacy `?tab=` is rewritten in place). From md the grouped rail
 * sits beside the open section; below md the list is a screen of its own and each section opens full-screen with a Back link.
 * One section is mounted at a time, keyed by its section, so switching always starts the next one fresh.
 */
export default function SettingsPage() {
  const perms = usePermissions()
  const belowMd = useIsBelowMd()
  const [params] = useSearchParams()
  const visible = visibleSections(perms)
  const asked = requestedSection(params, visible)
  // Below md bare /settings is the list; from md it opens on Profile, which is first for everyone who can open Settings.
  const current: SectionDef | null = asked ?? (belowMd ? null : visible[0])
  const key = current?.key ?? null

  // Only cleanup rewrites the URL in place: a legacy ?tab= becomes ?section= (other params kept), and a key this person can't see is dropped.
  const tidy = new URLSearchParams(params)
  tidy.delete('tab')
  if (asked) tidy.set('section', asked.key)
  else tidy.delete('section')
  const tidySearch = tidy.toString()

  // The section shown before this one. A switch moves focus (to the new heading, or back to the list row just left); a first load doesn't.
  const [shown, setShown] = useState<{ key: SectionKey | null; from: SectionKey | null | undefined }>({ key, from: undefined })
  if (shown.key !== key) setShown({ key, from: shown.key })
  const switched = shown.from !== undefined

  const [tenantPanelOpen, setTenantPanelOpen] = useState(false)
  const [editingTenant, setEditingTenant] = useState<TenantSummaryDto | undefined>()
  const [tenantDetail, setTenantDetail] = useState<TenantSummaryDto | undefined>()
  // Leaving Tenants closes a tenant's detail view, as leaving the tab did.
  if (tenantDetail && key !== 'tenants') setTenantDetail(undefined)
  const [userPanelOpen, setUserPanelOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<AdminUserDto | undefined>()
  const [defaultTenantId, setDefaultTenantId] = useState<string | undefined>()
  // What became of each Users "Send set-password email". Held here, not in the section, because the section is unmounted whenever another
  // is shown: an unacknowledged failure must still be there on return, and a send that finishes while it is away must still report.
  const userNotices = useNotices()
  const addUser = (tenantId?: string) => { setDefaultTenantId(tenantId); setEditingUser(undefined); setUserPanelOpen(true) }

  function body(def: SectionDef): ReactNode {
    const frame: SectionFrame = { title: def.label, description: def.description, readOnly: def.readOnly?.(perms) ?? false, focusOnMount: switched }
    // A section with a Save renders the frame itself (its dirty state and the guard live with the form); the page frames the rest.
    const framed = (content: ReactNode) => <SettingsSection {...frame} wide={def.wide}>{content}</SettingsSection>
    switch (def.key) {
      case 'profile': return framed(<ProfileSection />)
      case 'notifications': return <NotificationPreferencesTab {...frame} />
      case 'appearance': return framed(<AppearanceSection />)
      // shortcut: one Provider settings form behind all three keys until the split later in this PR (Tasks 11 and 12).
      case 'organisation': case 'billing': case 'safety': return framed(<ProviderSettingsTab />)
      case 'alerts': return <AlertWindowsSection {...frame} />
      case 'pricing': return framed(<PlanPricingSettingsTab />)
      case 'budgets': return framed(<BudgetSettingsTab />)
      case 'templates': return framed(<EventTemplatesSection />)
      case 'activities': return framed(<ActivityLibraryTab />)
      case 'holidays': return framed(<PublicHolidaysSection canEdit={perms.isSuperAdmin} />)
      case 'import': return framed(<ImportDataTab />)
      case 'export': return framed(<DataExportTab />)
      case 'failed-sends': return framed(<AdminNotificationsTab />)
      case 'catalogue': return framed(<SupportCatalogueSection />)
      case 'users': return framed(<UsersTab notices={userNotices} onAddUser={addUser} onEditUser={(u) => { setEditingUser(u); setUserPanelOpen(true) }} />)
      case 'tenants': return framed(tenantDetail ? (
        <TenantDetailView
          tenant={tenantDetail}
          onBack={() => setTenantDetail(undefined)}
          onEditTenant={() => { setEditingTenant(tenantDetail); setTenantPanelOpen(true) }}
          onAddUser={addUser}
          onEditUser={() => { setUserPanelOpen(true) }}
        />
      ) : (
        <TenantsTab
          onAddTenant={() => { setEditingTenant(undefined); setTenantPanelOpen(true) }}
          onEditTenant={(t) => { setEditingTenant(t); setTenantPanelOpen(true) }}
          onViewTenantDetail={(t) => setTenantDetail(t)}
        />
      ))
    }
  }

  const sectionScreen = belowMd && current !== null
  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      {tidySearch !== params.toString() && <Navigate replace to={{ pathname: '/settings', search: tidySearch ? `?${tidySearch}` : '' }} />}
      {/* history={false}: useBackTarget tracks pathnames only, so a history-aware Back would skip the list. */}
      {sectionScreen && <BackButton variant="link" label="settings" to="/settings" history={false} className="self-start" />}
      <div className={sectionScreen ? 'sr-only' : undefined}>
        <PageHeader title="Settings" documentTitle={current ? `${current.label} · Settings` : 'Settings'} />
      </div>
      <div className="md:grid md:grid-cols-[13rem_minmax(0,1fr)] md:items-start md:gap-8">
        {!sectionScreen && (
          <SettingsNav
            sections={visible}
            current={belowMd ? null : key}
            noOrganisation={perms.isSuperAdmin && !perms.hasOrganisation}
            returnFocusTo={key === null && switched ? shown.from : null}
          />
        )}
        {current && <Fragment key={current.key}>{body(current)}</Fragment>}
      </div>

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
