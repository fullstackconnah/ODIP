import type { SettingsPerms } from '@/pages/settings/settingsSections'

/** The rest of usePermissions() that Settings' sections read. */
type SettingsFixture = SettingsPerms & {
  role: 'Admin' | 'Coordinator' | 'SuperAdmin'
  fullName: string
  username: string
  tenantName: string | null
  showBankDetails: boolean
  canManageNotifications: boolean
}

const superAdmin: SettingsFixture = {
  role: 'SuperAdmin', isAdmin: false, isCoordinator: false, isSuperAdmin: true, hasOrganisation: true, canEditProviderSettings: true,
  canImportData: true, showBankDetails: true, canManageNotifications: true, fullName: 'Sam Okafor', username: 'sam.okafor', tenantName: null,
}

/**
 * usePermissions() as the Settings page reads it, for tests that mock '@/lib/permissions'. settingsSections.test.ts checks every
 * flag here against the real hook, so a mock can't quietly give a role something the app doesn't.
 */
export const SETTINGS_PERMS = {
  Admin: {
    role: 'Admin', isAdmin: true, isCoordinator: false, isSuperAdmin: false, hasOrganisation: true, canEditProviderSettings: true,
    canImportData: true, showBankDetails: true, canManageNotifications: true, fullName: 'Dana Whitlock', username: 'dana.whitlock', tenantName: 'Sunrise Support',
  },
  Coordinator: {
    role: 'Coordinator', isAdmin: false, isCoordinator: true, isSuperAdmin: false, hasOrganisation: true, canEditProviderSettings: false,
    canImportData: false, showBankDetails: false, canManageNotifications: false, fullName: 'Priya Sharma', username: 'priya.sharma', tenantName: 'Sunrise Support',
  },
  SuperAdmin: superAdmin,
  SuperAdminNoOrg: { ...superAdmin, hasOrganisation: false, canImportData: false },
} satisfies Record<string, SettingsFixture>
