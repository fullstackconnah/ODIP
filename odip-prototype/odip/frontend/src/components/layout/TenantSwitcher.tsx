import { useState, useRef, useEffect } from 'react'
import { useAdminTenantsSummary } from '@/api/hooks'
import { ConfirmDialog } from '@/components/ConfirmDialog'

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

  const switchTenant = (tenantId: string) => {
    // Restore original SuperAdmin user if we were impersonating
    const savedAdmin = localStorage.getItem('odip_superadmin_user')
    if (savedAdmin) {
      localStorage.setItem('odip_user', savedAdmin)
      localStorage.removeItem('odip_superadmin_user')
    }
    localStorage.removeItem('odip_viewing_user')
    localStorage.setItem('odip_viewing_tenant', tenantId)
    localStorage.setItem('odip_last_tenant', tenantId)
    window.location.reload()
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 bg-[#eef2ff] border border-[#c7d2fe] rounded-lg px-2.5 py-1.5 cursor-pointer hover:bg-[#e0e7ff] transition-colors"
      >
        <span className="text-[10px] bg-[#6366f1] text-white px-1.5 py-0.5 rounded font-bold tracking-wide">SA</span>
        <span className="text-sm font-semibold text-[#3730a3]">{current?.name ?? 'Loading…'}</span>
        <span className="text-[#6366f1] text-xs">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-56 bg-[#1e2030] border border-[#334155] rounded-xl shadow-2xl overflow-hidden z-50">
          <div className="px-3 py-2 border-b border-[#334155] text-[10px] text-[#64748b] uppercase tracking-wider">
            Viewing as tenant
          </div>
          <div className="p-1.5">
            {tenants.map(tenant => (
              <button
                key={tenant.id}
                onClick={() => setPendingTenant({ id: tenant.id, name: tenant.name })}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors ${
                  tenant.id === viewingId
                    ? 'bg-[rgba(99,102,241,0.15)]'
                    : 'hover:bg-[rgba(255,255,255,0.05)]'
                } ${!tenant.isActive ? 'opacity-50' : ''}`}
              >
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${tenant.isActive ? 'bg-[#22c55e]' : 'bg-[#ef4444]'}`} />
                <span className={`text-sm flex-1 ${tenant.id === viewingId ? 'text-[#e2e8f0] font-medium' : 'text-[#94a3b8]'}`}>
                  {tenant.name}
                </span>
                {tenant.id === ownTenantId && (
                  <span className="text-[10px] text-[#94a3b8]">(yours)</span>
                )}
                {!tenant.isActive && (
                  <span className="text-[10px] text-[#64748b]">inactive</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingTenant !== null}
        onCancel={() => setPendingTenant(null)}
        onConfirm={() => { if (pendingTenant) switchTenant(pendingTenant.id) }}
        title="Switch tenant?"
        confirmLabel="Switch tenant"
        message={`Switch to ${pendingTenant?.name ?? 'this tenant'}? Unsaved changes on this page will be lost.`}
      />
    </div>
  )
}
