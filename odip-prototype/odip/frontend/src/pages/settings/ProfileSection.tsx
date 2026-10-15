import { FactList } from '@/components/FactList'
import { usePermissions } from '@/lib/permissions'

/**
 * My account › Profile, PR 1: who you're signed in as, from the sign-in response (odip_user), with no endpoint. The username is the
 * sign-in name, not necessarily the email (users have both), so the row says "Signed in as". Editing name and phone comes with PR 4.
 */
export default function ProfileSection() {
  const { fullName, username, role, tenantName, isSuperAdmin } = usePermissions()
  // A SuperAdmin viewing as someone: UserSwitcher swaps in only that person's id, name and role, so the sign-in name and organisation
  // in odip_user are still the SuperAdmin's own. Show only what is true of the person being viewed.
  const viewingAs = localStorage.getItem('odip_viewing_user') !== null
  return (
    <FactList
      items={[
        { label: 'Name', value: fullName },
        ...(viewingAs ? [] : [{ label: 'Signed in as', value: username }]),
        { label: 'Role', value: role === 'SuperAdmin' ? 'Super admin' : role },
        // A SuperAdmin's sign-in organisation is not the one they view (or they view none), so the row would mislead them.
        ...(tenantName && !viewingAs && !isSuperAdmin ? [{ label: 'Organisation', value: tenantName }] : []),
      ]}
    />
  )
}
