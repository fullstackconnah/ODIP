import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useAdminTenantUsers } from '@/api/hooks'
import type { TenantUserDto, ApiResponse } from '@/api/types'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { switchViewAndReload } from '@/lib/viewAsSwitch'
import { TONE } from '@/lib/tone'

export default function UserSwitcher() {
  const [open, setOpen] = useState(false)
  const [pendingUser, setPendingUser] = useState<TenantUserDto | null>(null)
  const [confirmingExit, setConfirmingExit] = useState(false)
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

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open])

  const selectUser = (user: TenantUserDto) => switchViewAndReload(() => {
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
  })

  const clearUser = () => switchViewAndReload(() => {
    const savedAdmin = localStorage.getItem('odip_superadmin_user')
    if (savedAdmin) {
      localStorage.setItem('odip_user', savedAdmin)
      localStorage.removeItem('odip_superadmin_user')
    }
    localStorage.removeItem('odip_viewing_user')
  })

  return (
    <div ref={ref} className="relative">
      {/* Same floor and the same small-screen treatment as TenantSwitcher's trigger: 44px tall on touch, and below sm
          the user's name leaves the trigger (kept in its accessible name and tooltip) so the header fits 390px. */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`USR ${currentViewUser?.fullName ?? 'View as user…'}`}
        title={currentViewUser?.fullName}
        className={`flex min-h-[var(--tap-min)] items-center gap-1.5 max-sm:gap-1 ${TONE.warning.solid} border border-[var(--color-border)] rounded-lg px-2.5 max-sm:px-1.5 py-1.5 cursor-pointer hover:brightness-95 transition-[filter] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]`}
      >
        <span className="text-xs bg-[var(--color-on-warning-container)] text-[var(--color-card)] px-1.5 max-sm:px-1 py-0.5 rounded font-bold tracking-wide">USR</span>
        <span className="hidden min-w-0 max-w-[12rem] max-md:max-w-[8rem] min-[1400px]:max-w-[20rem] truncate whitespace-nowrap text-sm font-semibold sm:block">
          {currentViewUser?.fullName ?? 'View as user…'}
        </span>
        <span className="text-xs">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-64 max-sm:w-56 bg-[var(--color-popover)] border border-[var(--color-border)] rounded-xl shadow-2xl overflow-hidden z-50">
          <div className="px-3 py-2 border-b border-[var(--color-border)] text-xs text-[var(--color-muted-foreground)] uppercase tracking-wider">
            View as user
          </div>
          <div className="p-1.5">
            {viewingUserId && (
              <button
                onClick={() => {
  ref.current?.querySelector('button')?.focus();
  setOpen(false);
  setConfirmingExit(true);
}}
                className="w-full flex min-h-[var(--tap-min)] items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:relative hover:bg-[var(--color-accent)] mb-1 border-b border-[var(--color-border)] pb-2"
              >
                <span className="text-sm text-[var(--color-muted-foreground)]">↩ Exit view</span>
              </button>
            )}
            {users.length === 0 && (
              <p className="px-2.5 py-2 text-sm text-[var(--color-muted-foreground)]">No users in this tenant</p>
            )}
            {users.map(user => (
              <button
                key={user.id}
                onClick={() => {
  if (!user.isActive) {
    return;
  }
  ref.current?.querySelector('button')?.focus();
  setOpen(false);
  setPendingUser(user);
}}
                disabled={!user.isActive}
                className={`w-full flex min-h-[var(--tap-min)] items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:relative ${
                  user.id === viewingUserId
                    ? TONE.warning.soft
                    : user.isActive ? 'hover:bg-[var(--color-accent)]' : ''
                } ${!user.isActive ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${user.isActive ? 'bg-[var(--color-success)]' : 'bg-[var(--color-destructive)]'}`} />
                <span className={`text-sm flex-1 ${user.id === viewingUserId ? 'text-[var(--color-foreground)] font-medium' : 'text-[var(--color-muted-foreground)]'}`}>
                  {user.fullName}
                </span>
                <span className="text-[13px] text-[var(--color-muted-foreground)]">{user.role}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {createPortal(
        <ConfirmDialog
          open={pendingUser !== null}
          onCancel={() => setPendingUser(null)}
          onConfirm={() => { if (pendingUser) selectUser(pendingUser); setPendingUser(null) }}
          title="Switch user?"
          confirmLabel="Switch user"
          message={`Switch to ${pendingUser?.fullName ?? 'this user'}? Unsaved changes on this page will be lost.`}
        />,
        document.body
      )}

      {createPortal(
        <ConfirmDialog
          open={confirmingExit}
          onCancel={() => setConfirmingExit(false)}
          onConfirm={() => { clearUser(); setConfirmingExit(false) }}
          title="Exit user view?"
          confirmLabel="Exit view"
          message="Return to your own account? Unsaved changes on this page will be lost."
        />,
        document.body
      )}
    </div>
  )
}
