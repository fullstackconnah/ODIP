import type { usePermissions } from '@/lib/permissions'
import { apiErrorStatus } from '@/lib/shiftPackageErrors'
import { extractErrorMessage } from '@/lib/utils'

/** What Settings reads from usePermissions() to decide who sees, and who may change, each section. */
export type SettingsPerms = Pick<
  ReturnType<typeof usePermissions>,
  'isSuperAdmin' | 'isAdmin' | 'isCoordinator' | 'hasOrganisation' | 'canEditProviderSettings' | 'canImportData' | 'canManageIntegrations'
>

export type SectionKey =
  | 'profile' | 'notifications' | 'appearance'
  | 'setup' | 'workspace-visibility' | 'organisation' | 'billing' | 'safety' | 'alerts'
  | 'pricing' | 'budgets'
  | 'templates' | 'activities' | 'holidays'
  | 'import' | 'export' | 'integrations' | 'failed-sends'
  | 'tenants' | 'users' | 'catalogue' | 'alpha-signups'

export type SectionGroup = 'My account' | 'Organisation' | 'Pricing and budgets' | 'Content' | 'Data' | 'Platform'

export type SectionDef = {
  key: SectionKey
  label: string
  group: SectionGroup
  /** One sentence under the heading: what the section controls and who it affects. */
  description: string
  /** Records and tools take the whole column; forms stop at 60rem. */
  wide?: boolean
  visible: (p: SettingsPerms) => boolean
  /** Seen but not changed: every field locked, a note says why, and there is no Save. */
  readOnly?: (p: SettingsPerms) => boolean
}

const everyone = () => true
const withOrganisation = (p: SettingsPerms) => p.hasOrganisation
const managesOrganisation = (p: SettingsPerms) => (p.isAdmin || p.isSuperAdmin) && p.hasOrganisation
const onlyAdminsChange = (p: SettingsPerms) => !p.canEditProviderSettings
const HOLIDAYS = 'The public holiday calendar that sets holiday rates on plans and claims. One calendar serves every organisation.'

/**
 * Every Settings section, in rail order: the rail, the phone list, the legacy ?tab= map and the tests all read this list.
 * Public holidays and Failed sends are listed twice with opposite visibility: under Platform for a SuperAdmin (both are platform-wide
 * for them), under Content and Data for everyone else. One key, one place per role.
 */
export const SECTIONS: SectionDef[] = [
  { key: 'profile', label: 'Profile', group: 'My account', visible: everyone, description: "Who you're signed in as." },
  { key: 'notifications', label: 'Notifications', group: 'My account', visible: everyone, description: "Which events ODIP emails you about. Your choices don't change anyone else's." },
  { key: 'appearance', label: 'Appearance', group: 'My account', visible: everyone, description: 'How tables look for you. Saved on this device only, so another computer keeps its own.' },
  { key: 'setup', label: 'Organisation setup', group: 'Organisation', visible: managesOrganisation, description: "Review your organisation's existing settings. You can leave and return at any time." },
  { key: 'workspace-visibility', label: 'Workspace visibility', group: 'Organisation', visible: managesOrganisation, description: 'Choose which optional workspaces appear in the usual menu for your organisation.' },
  { key: 'organisation', label: 'Organisation profile', group: 'Organisation', visible: withOrganisation, readOnly: onlyAdminsChange, description: "Your organisation's legal details and address, as they appear on NDIS claims, bulk payment files and invoices." },
  { key: 'billing', label: 'Billing details', group: 'Organisation', visible: withOrganisation, readOnly: onlyAdminsChange, description: 'The bank account on your invoices, your GST and PACE status, and the note printed at the foot of every invoice.' },
  { key: 'safety', label: 'Safety checks', group: 'Organisation', visible: withOrganisation, readOnly: onlyAdminsChange, description: "What ODIP stops, and what it only warns about, when something isn't in place. These apply to everyone in your organisation, and every change is recorded in the audit log." },
  { key: 'alerts', label: 'Alert windows', group: 'Organisation', visible: withOrganisation, readOnly: onlyAdminsChange, description: 'How early ODIP warns before something expires. The warnings show on the dashboard and on the pages that list them, for everyone in your organisation.' },
  { key: 'pricing', label: 'Plan pricing', group: 'Pricing and budgets', visible: managesOrganisation, description: 'The answers the plan builder uses to price supports: the registration groups you hold, price boundaries, provider travel, group outings, and who may approve an agreement.' },
  { key: 'budgets', label: 'Budgets', group: 'Pricing and budgets', visible: managesOrganisation, description: 'What the roster does when a one-off shift would put a participant over budget, and when a participant counts as approaching it.' },
  { key: 'templates', label: 'Event templates', group: 'Content', wide: true, visible: withOrganisation, description: 'Starting points for new trips: destination, region, length and accommodation notes. Used by everyone who creates a trip.' },
  { key: 'activities', label: 'Activity library', group: 'Content', wide: true, visible: withOrganisation, description: 'The activities your coordinators pick from when planning a trip.' },
  { key: 'holidays', label: 'Public holidays', group: 'Content', wide: true, visible: p => !p.isSuperAdmin && p.hasOrganisation, description: HOLIDAYS },
  { key: 'import', label: 'Import data', group: 'Data', wide: true, visible: p => p.canImportData, description: 'Bring participants and staff in from a spreadsheet, and undo an import that went wrong.' },
  // Data export (#243): the same gate as Import data. DataExportController admits an Admin, or a SuperAdmin viewing an organisation.
  { key: 'export', label: 'Data export', group: 'Data', visible: p => p.canImportData, description: 'Download everything your organisation has in ODIP, as CSV files.' },
  // Employment Hero (EH PR 1): EmploymentHeroController admits an Admin, or a SuperAdmin viewing an organisation.
  { key: 'integrations', label: 'Integrations', group: 'Data', wide: true, visible: p => p.canManageIntegrations, description: 'Connect ODIP to the other systems you use, such as Employment Hero.' },
  { key: 'failed-sends', label: 'Failed sends', group: 'Data', wide: true, visible: p => p.isAdmin, description: "Emails ODIP couldn't deliver for your organisation. Retry one, or send a test email to check sending works." },
  { key: 'tenants', label: 'Tenants', group: 'Platform', wide: true, visible: p => p.isSuperAdmin, description: 'Every organisation on ODIP. Create one, edit its details, or see its users.' },
  { key: 'users', label: 'Users', group: 'Platform', wide: true, visible: p => p.isSuperAdmin, description: 'Everyone who can sign in, across every organisation.' },
  { key: 'catalogue', label: 'Support catalogue', group: 'Platform', wide: true, visible: p => p.isSuperAdmin, description: 'NDIS price limits for every support item. Import the new catalogue when the NDIA publishes one.' },
  { key: 'holidays', label: 'Public holidays', group: 'Platform', wide: true, visible: p => p.isSuperAdmin, description: HOLIDAYS },
  { key: 'failed-sends', label: 'Failed sends', group: 'Platform', wide: true, visible: p => p.isSuperAdmin, description: "Emails ODIP couldn't deliver, across every organisation. Retry one, or send a test email." },
  // Alpha sign-ups (landing PR 1): the public early-access rows. AdminEarlyAccessController admits a SuperAdmin only.
  { key: 'alpha-signups', label: 'Alpha sign-ups', group: 'Platform', wide: true, visible: p => p.isSuperAdmin, description: 'People who asked to join the alpha on the website. Each sign-up is deleted 12 months after it was first sent; delete one sooner if they ask.' },
]

/** Old ?tab= keys whose section has a new name. Every other old key is its own section key. Old keys live forever: sent emails carry them. */
export const LEGACY_TAB: Partial<Record<string, SectionKey>> = { provider: 'organisation', qualifications: 'alerts', 'notifications-admin': 'failed-sends' }

export const visibleSections = (p: SettingsPerms): SectionDef[] => SECTIONS.filter(s => s.visible(p))

/** The section the URL asks for (`?section=`, else a legacy `?tab=` mapped to its section) when this person can see it; otherwise null. */
export function requestedSection(params: URLSearchParams, visible: readonly SectionDef[]): SectionDef | null {
  const tab = params.get('tab')
  const key = params.get('section') ?? (tab === null ? null : (LEGACY_TAB[tab] ?? tab))
  return visible.find(s => s.key === key) ?? null
}

/** The section on screen: the one asked for, else Profile (always first) from md up. Below md, null is the list of sections. */
export function shownSection(params: URLSearchParams, visible: readonly SectionDef[], belowMd: boolean): SectionDef | null {
  return requestedSection(params, visible) ?? (belowMd ? null : (visible[0] ?? null))
}

/**
 * The save foot's failure line: "Not saved." and the reason the server gave, or the section's own sentence for a 400 that names no field
 * (an ASP.NET [Required] refusal carries its errors as an object, which extractErrorMessage doesn't read), or the connection sentence.
 * A 403 can't come from a Save the role is shown, so it gets a short fallback.
 */
export function notSavedText(error: unknown, badRequest?: string): string {
  const said = extractErrorMessage(error, '')
  if (said) return `Not saved. ${said}`
  const status = apiErrorStatus(error)
  if (status === 403) return 'Not saved. Only an Admin can change these.'
  if (status === 400 && badRequest) return `Not saved. ${badRequest}`
  return 'Not saved. Check your connection and try again.'
}
