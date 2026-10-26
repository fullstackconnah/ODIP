import { useAuthConfig } from '@/api/hooks'
import { usePermissions } from '@/lib/permissions'
import type { SettingsPerms } from './settingsSections'

/** What Settings decides sections by: the signed-in person's permissions, plus whether the server offers Microsoft sign-in at all. */
export function useSettingsPerms(): SettingsPerms {
  const perms = usePermissions()
  const config = useAuthConfig()
  return { ...perms, microsoftSignIn: config.data?.microsoft === true }
}
