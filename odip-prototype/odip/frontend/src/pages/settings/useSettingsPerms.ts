import { useAuthConfig } from '@/api/hooks'
import { usePermissions } from '@/lib/permissions'
import type { SettingsPerms } from './settingsSections'
import { getViewAs } from '@/lib/viewAs'

/** What Settings decides sections by: the signed-in person's permissions, plus whether the server offers Microsoft sign-in at all. */
export function useSettingsPerms(): SettingsPerms {
  const perms = usePermissions()
  const config = useAuthConfig()
  return { ...perms, microsoftSignIn: config.data?.microsoft === true, viewingAs: getViewAs('odip_viewing_user') !== null }
}
