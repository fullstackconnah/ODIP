import WorkspaceVisibilitySection from '@/pages/settings/WorkspaceVisibilitySection'
import { Fragment, useRef, useState, type ReactNode } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { apiGet } from '@/api/client'
import type { AdminUserDto, TenantSummaryDto, TenantUserDto } from '@/api/types'
import { BackButton } from '@/components/BackButton'
import { NoticesRegion } from '@/components/NoticesRegion'
import { PageHeader } from '@/components/PageHeader'
import { useIsBelowMd } from '@/hooks/useIsBelowMd'
import { useNotices, type Notice } from '@/hooks/useNotices'
import { usePermissions } from '@/lib/permissions'
import ActivityLibraryTab from '@/pages/settings/ActivityLibraryTab'
import AdminNotificationsTab from '@/pages/settings/AdminNotificationsTab'
import AlphaSignupsTab from '@/pages/settings/AlphaSignupsTab'
import AlertWindowsSection from '@/pages/settings/AlertWindowsSection'
import AppearanceSection from '@/pages/settings/AppearanceSection'
import BillingDetailsSection from '@/pages/settings/BillingDetailsSection'
import BudgetSettingsTab from '@/pages/settings/BudgetSettingsTab'
import DataExportTab from '@/pages/settings/DataExportTab'
import EventTemplatesSection from '@/pages/settings/EventTemplatesSection'
import ImportDataTab from '@/pages/settings/ImportDataTab'
import IntegrationsTab from '@/pages/settings/IntegrationsTab'
import NotificationPreferencesTab from '@/pages/settings/NotificationPreferencesTab'
import OrganisationSetupSection from '@/pages/settings/OrganisationSetupSection'
import OrganisationProfileSection from '@/pages/settings/OrganisationProfileSection'
import PlanPricingSettingsTab from '@/pages/settings/PlanPricingSettingsTab'
import ProfileSection from '@/pages/settings/ProfileSection'
import SafetyChecksSection from '@/pages/settings/SafetyChecksSection'
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
  // What the tenant detail says when Edit cannot load the user.
  const editNotices = useNotices()
  // The tenant detail lists users by id and name only, but the panel reads and saves every field: it opens on the full record, once that has arrived.
  // One load at a time (the rows say "busy", as the Users tab's send buttons do). Everything else that changes what the panel shows, or leaves the
  // detail, calls cancelEdit, so a load that lands after it opens nothing and says nothing.
  const [openingUserId, setOpeningUserId] = useState<string | null>(null)
  const editSeq = useRef(0)
  const cancelEdit = () => { editSeq.current++; setOpeningUserId(null) }
  async function editTenantUser(user: TenantUserDto) {
    if (openingUserId !== null) return
    const seq = ++editSeq.current
    setOpeningUserId(user.id)
    try {
      const full = await apiGet<AdminUserDto>(`/admin/users/${user.id}`)
      if (seq !== editSeq.current) return
      setEditingUser(full)
      setUserPanelOpen(true)
      // A retry that works leaves nothing of the earlier failure on screen.
      editNotices.notices.filter(n => n.subject === user.id).forEach(n => editNotices.dismiss(n.id))
    } catch {
      if (seq === editSeq.current) {
        editNotices.notify('danger', user.fullName, "Couldn't load their details, so nothing was opened or changed. Check your connection and use Edit again.", user.id)
      }
    } finally {
      if (seq === editSeq.current) setOpeningUserId(null)
    }
  }
  const addUser = (tenantId?: string) => { cancelEdit(); setDefaultTenantId(tenantId); setEditingUser(undefined); setUserPanelOpen(true) }
  // Dismissing the last notice about someone hands focus back to their Edit, which is still in the detail's table.
  const focusEditButtonOf = (dismissed: Notice) =>
    dismissed.subject ? document.querySelector<HTMLElement>(`[data-edit-user="${dismissed.subject}"]`) : null

  function body(def: SectionDef): ReactNode {
    const frame: SectionFrame = { title: def.label, description: def.description, readOnly: def.readOnly?.(perms) ?? false, focusOnMount: switched }
    // A section with a Save renders the frame itself (its dirty state and the guard live with the form); the page frames the rest.
    const framed = (content: ReactNode) => <SettingsSection {...frame} wide={def.wide}>{content}</SettingsSection>
    switch (def.key) {
      case 'profile': return framed(<ProfileSection />)
      case 'notifications': return <NotificationPreferencesTab {...frame} />
      case 'appearance': return framed(<AppearanceSection />)
      case 'workspace-visibility': return <WorkspaceVisibilitySection {...frame} />
      case 'setup': return framed(<OrganisationSetupSection />)
      case 'organisation': return <OrganisationProfileSection {...frame} />
      case 'billing': return <BillingDetailsSection {...frame} />
      case 'safety': return <SafetyChecksSection {...frame} />
      case 'alerts': return <AlertWindowsSection {...frame} />
      case 'pricing': return <PlanPricingSettingsTab {...frame} />
      case 'budgets': return <BudgetSettingsTab {...frame} />
      case 'templates': return framed(<EventTemplatesSection />)
      case 'activities': return framed(<ActivityLibraryTab />)
      case 'holidays': return framed(<PublicHolidaysSection canEdit={perms.isSuperAdmin} />)
      case 'import': return framed(<ImportDataTab />)
      case 'export': return framed(<DataExportTab />)
      case 'integrations': return framed(<IntegrationsTab />)
      case 'failed-sends': return framed(<AdminNotificationsTab />)
      case 'alpha-signups': return framed(<AlphaSignupsTab />)
      case 'catalogue': return framed(<SupportCatalogueSection />)
      case 'users': return framed(<UsersTab notices={userNotices} onAddUser={addUser} onEditUser={(u) => { cancelEdit(); setEditingUser(u); setUserPanelOpen(true) }} />)
      case 'tenants': return framed(tenantDetail ? (
        <TenantDetailView
          tenant={tenantDetail}
          onBack={() => { cancelEdit(); setTenantDetail(undefined) }}
          onEditTenant={() => { setEditingTenant(tenantDetail); setTenantPanelOpen(true) }}
          onAddUser={addUser}
          onEditUser={editTenantUser}
          openingUserId={openingUserId}
          // Always mounted, so a live region exists before its content; while empty its box cancels the gap below it.
          usersNotice={<NoticesRegion notices={editNotices.notices} onDismiss={editNotices.dismiss} focusAfterDismiss={focusEditButtonOf} className="empty:-mb-[var(--section-gap)]" />}
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
        onClose={() => { cancelEdit(); setUserPanelOpen(false); setEditingUser(undefined); setDefaultTenantId(undefined) }}
        user={editingUser}
        defaultTenantId={defaultTenantId}
      />
    </div>
  )
}
