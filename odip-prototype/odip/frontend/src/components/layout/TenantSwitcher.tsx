import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useAdminTenantsSummary } from '@/api/hooks'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { switchViewAndReload } from '@/lib/viewAsSwitch'
import { TONE } from '@/lib/tone'

export default function TenantSwitcher() {
  const [open, setOpen] = useState(false)
  const [pendingTenant, setPendingTenant] = useState<{ id: string; name: string } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const { data: tenants = [] } = useAdminTenantsSummary()
  const viewingId = localStorage.getItem('odip_viewing_tenant')
  const current = tenants.find(t => t.id === viewingId)
  const user = JSON.parse(localStorage.getItem('odip_user') || '{}')
  const ownTenantId = user.tenantId as string | undefined

  // Auto-select tenant when tenants load but none is selected (or stale)
  useEffect(() => {
    if (tenants.length === 0) return

    // Already have a valid selection — just keep last-used in sync
    if (viewingId && tenants.some(t => t.id === viewingId)) {
      localStorage.setItem('odip_last_tenant', viewingId)
      return
    }

    // Try to restore last-used tenant
    const lastTenant = localStorage.getItem('odip_last_tenant')
    if (lastTenant && tenants.some(t => t.id === lastTenant)) {
      localStorage.setItem('odip_viewing_tenant', lastTenant)
      window.location.reload()
      return
    }

    // Fall back to "Demo" tenant
    const demo = tenants.find(t => t.name.toLowerCase() === 'demo')
    if (demo) {
      localStorage.setItem('odip_viewing_tenant', demo.id)
      localStorage.setItem('odip_last_tenant', demo.id)
      window.location.reload()
      return
    }

    // Last resort: first active tenant
    const firstActive = tenants.find(t => t.isActive)
    if (firstActive) {
      localStorage.setItem('odip_viewing_tenant', firstActive.id)
      localStorage.setItem('odip_last_tenant', firstActive.id)
      window.location.reload()
    }
  }, [tenants, viewingId])

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

  const switchTenant = (tenantId: string) => switchViewAndReload(() => {
    // Restore original SuperAdmin user if we were impersonating
    const savedAdmin = localStorage.getItem('odip_superadmin_user')
    if (savedAdmin) {
      localStorage.setItem('odip_user', savedAdmin)
      localStorage.removeItem('odip_superadmin_user')
    }
    localStorage.removeItem('odip_viewing_user')
    localStorage.setItem('odip_viewing_tenant', tenantId)
    localStorage.setItem('odip_last_tenant', tenantId)
  })

  return (
    <div ref={ref} className="relative">
      {/* `--tap-min` floor: 44px tall under a coarse pointer (the header is 48px), unchanged on a mouse. Below sm the
          tenant name is dropped from the trigger, because a SuperAdmin's two switchers (badge + name + caret each),
          the bell and the avatar do not fit a 390px header: the badge and caret stay and the name moves into the
          accessible name and the tooltip. */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`SA ${current?.name ?? 'Loading…'}`}
        title={current?.name}
        className={`flex min-h-[var(--tap-min)] items-center gap-1.5 max-sm:gap-1 ${TONE.info.solid} border border-[var(--color-border)] rounded-lg px-2.5 max-sm:px-1.5 py-1.5 cursor-pointer hover:brightness-95 transition-[filter]`}
      >
        <span className="text-xs bg-[var(--color-info)] text-[var(--color-secondary-foreground)] px-1.5 max-sm:px-1 py-0.5 rounded font-bold tracking-wide">SA</span>
        <span className="hidden min-w-0 max-w-[12rem] max-md:max-w-[8rem] min-[1400px]:max-w-[20rem] truncate whitespace-nowrap text-sm font-semibold sm:block">{current?.name ?? 'Loading…'}</span>
        <span className="text-xs">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-56 bg-[var(--color-popover)] border border-[var(--color-border)] rounded-xl shadow-2xl overflow-hidden z-50">
          <div className="px-3 py-2 border-b border-[var(--color-border)] text-xs text-[var(--color-muted-foreground)] uppercase tracking-wider">
            Viewing as tenant
          </div>
          <div className="p-1.5">
            {tenants.map(tenant => (
              <button
                key={tenant.id}
                onClick={() => {
  ref.current?.querySelector('button')?.focus();
  setOpen(false);
  setPendingTenant({ id: tenant.id, name: tenant.name });
}}
                className={`w-full flex min-h-[var(--tap-min)] items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors ${
                  tenant.id === viewingId
                    ? TONE.info.soft
                    : 'hover:bg-[var(--color-accent)]'
                } ${!tenant.isActive ? 'opacity-50' : ''}`}
              >
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${tenant.isActive ? 'bg-[var(--color-success)]' : 'bg-[var(--color-destructive)]'}`} />
                <span className={`text-sm flex-1 ${tenant.id === viewingId ? 'text-[var(--color-foreground)] font-medium' : 'text-[var(--color-muted-foreground)]'}`}>
                  {tenant.name}
                </span>
                {tenant.id === ownTenantId && (
                  <span className="text-[13px] text-[var(--color-muted-foreground)]">(yours)</span>
                )}
                {!tenant.isActive && (
                  <span className="text-[13px] text-[var(--color-muted-foreground)]">inactive</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {createPortal(
        <ConfirmDialog
          open={pendingTenant !== null}
          onCancel={() => setPendingTenant(null)}
          onConfirm={() => { if (pendingTenant) switchTenant(pendingTenant.id) }}
          title="Switch tenant?"
          confirmLabel="Switch tenant"
          message={`Switch to ${pendingTenant?.name ?? 'this tenant'}? Unsaved changes on this page will be lost.`}
        />,
        document.body
      )}
    </div>
  )
}
