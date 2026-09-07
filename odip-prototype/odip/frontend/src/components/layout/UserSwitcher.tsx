import { useState, useRef, useEffect } from 'react'
import { useAdminTenantUsers } from '@/api/hooks'
import type { TenantUserDto, ApiResponse } from '@/api/types'
import { ConfirmDialog } from '@/components/ConfirmDialog'

export default function UserSwitcher() {
  const [open, setOpen] = useState(false)
  const [pendingUser, setPendingUser] = useState<TenantUserDto | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const viewingTenantId = localStorage.getItem('odip_viewing_tenant')
  const viewingUserId = localStorage.getItem('odip_viewing_user')

  const { data } = useAdminTenantUsers(viewingTenantId)
  const users: TenantUserDto[] = (data as ApiResponse<TenantUserDto[]>)?.data ?? []
  const currentViewUser = users.find(u => u.id === viewingUserId)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const selectUser = (user: TenantUserDto) => {
    // Preserve original SuperAdmin user object before first impersonation
    if (!localStorage.getItem('odip_superadmin_user')) {
      localStorage.setItem('odip_superadmin_user', localStorage.getItem('odip_user') || '{}')
    }

    // Override odip_user with the impersonated user's id, role and name. `id` matters just as
    // much as fullName/role here: usePermissions() exposes it as the self-exclusion source (e.g.
    // excluding yourself from a medication witness picker — see RecordAdministrationModal), and
    // without this override that check kept comparing against the SuperAdmin's own id while
    // "viewing as" someone else, so the impersonated user was never excluded from their own
    // picker. odip_superadmin_user (saved above) still holds the original id, so switching back
    // via clearUser restores it correctly.
    const currentUser = JSON.parse(localStorage.getItem('odip_user') || '{}')
    const overriddenUser = { ...currentUser, id: user.id, fullName: user.fullName, role: user.role }
    localStorage.setItem('odip_user', JSON.stringify(overriddenUser))
    localStorage.setItem('odip_viewing_user', user.id)

    setOpen(false)
    window.location.reload()
  }

  const clearUser = () => {
    const savedAdmin = localStorage.getItem('odip_superadmin_user')
    if (savedAdmin) {
      localStorage.setItem('odip_user', savedAdmin)
      localStorage.removeItem('odip_superadmin_user')
    }
    localStorage.removeItem('odip_viewing_user')
    window.location.reload()
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 bg-[#fff7ed] border border-[#fed7aa] rounded-lg px-2.5 py-1.5 cursor-pointer hover:bg-[#ffedd5] transition-colors"
      >
        <span className="text-[10px] bg-[#ea580c] text-white px-1.5 py-0.5 rounded font-bold tracking-wide">USR</span>
        <span className="text-sm font-semibold text-[#9a3412]">
          {currentViewUser?.fullName ?? 'View as user…'}
        </span>
        <span className="text-[#ea580c] text-xs">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-64 bg-[#1e2030] border border-[#334155] rounded-xl shadow-2xl overflow-hidden z-50">
          <div className="px-3 py-2 border-b border-[#334155] text-[10px] text-[#64748b] uppercase tracking-wider">
            View as user
          </div>
          <div className="p-1.5">
            {viewingUserId && (
              <button
                onClick={clearUser}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors hover:bg-[rgba(255,255,255,0.05)] mb-1 border-b border-[#334155] pb-2"
              >
                <span className="text-sm text-[#64748b]">↩ Exit view</span>
              </button>
            )}
            {users.length === 0 && (
              <p className="px-2.5 py-2 text-sm text-[#64748b]">No users in this tenant</p>
            )}
            {users.map(user => (
              <button
                key={user.id}
                onClick={() => !user.isActive ? undefined : setPendingUser(user)}
                disabled={!user.isActive}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors ${
                  user.id === viewingUserId
                    ? 'bg-[rgba(234,88,12,0.15)]'
                    : user.isActive ? 'hover:bg-[rgba(255,255,255,0.05)]' : ''
                } ${!user.isActive ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${user.isActive ? 'bg-[#22c55e]' : 'bg-[#ef4444]'}`} />
                <span className={`text-sm flex-1 ${user.id === viewingUserId ? 'text-[#e2e8f0] font-medium' : 'text-[#94a3b8]'}`}>
                  {user.fullName}
                </span>
                <span className="text-[10px] text-[#64748b]">{user.role}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingUser !== null}
        onCancel={() => setPendingUser(null)}
        onConfirm={() => { if (pendingUser) selectUser(pendingUser) }}
        title="Switch user?"
        confirmLabel="Switch user"
        message={`Switch to ${pendingUser?.fullName ?? 'this user'}? Unsaved changes on this page will be lost.`}
      />
    </div>
  )
}
