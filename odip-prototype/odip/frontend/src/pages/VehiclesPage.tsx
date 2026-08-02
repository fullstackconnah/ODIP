import { useVehicles, useDeleteVehicle, useUpdateVehicle } from '@/api/hooks'
import type { VehicleListDto } from '@/api/types'
import { Link } from 'react-router-dom'
import { formatDateAu } from '@/lib/utils'
import { Plus, Pencil, Trash2, ArchiveRestore, Car, Bus, Truck, Users, Wrench, Calendar, Accessibility } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/StatusBadge'
import { useState } from 'react'
import { usePermissions } from '@/lib/permissions'

type VehicleTypeKey = 'Car' | 'Van' | 'Bus' | 'MiniBus' | 'AccessibleVan' | 'Other'

const vehicleTypeConfig: Record<VehicleTypeKey, { icon: React.ElementType; iconBg: string; iconColor: string }> = {
  Car: { icon: Car, iconBg: 'bg-[var(--color-primary-fixed)]', iconColor: 'text-[var(--color-primary)]' },
  Van: { icon: Truck, iconBg: 'bg-[var(--color-secondary-container)]', iconColor: 'text-[var(--color-secondary)]' },
  Bus: { icon: Bus, iconBg: 'bg-[var(--color-surface-container)]', iconColor: 'text-[var(--color-muted-foreground)]' },
  MiniBus: { icon: Bus, iconBg: 'bg-[var(--color-surface-container)]', iconColor: 'text-[var(--color-muted-foreground)]' },
  AccessibleVan: { icon: Bus, iconBg: 'bg-[#ffd7ef]', iconColor: 'text-[#7a2169]' },
  Other: { icon: Truck, iconBg: 'bg-[var(--color-surface-container-high)]', iconColor: 'text-[var(--color-muted-foreground)]' },
}

function getDateStatus(dateStr: string | null | undefined): 'overdue' | 'warning' | 'ok' | null {
  if (!dateStr) return null
  const date = new Date(dateStr)
  const now = new Date()
  const diffDays = (date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  if (diffDays < 0) return 'overdue'
  if (diffDays < 30) return 'warning'
  return 'ok'
}

function StatCell({ icon: Icon, label, value, status }: {
  icon: React.ElementType; label: string; value: string; status?: 'overdue' | 'warning' | 'ok' | null
}) {
  const valueColor = status === 'overdue' ? 'text-[var(--color-destructive)]'
    : status === 'warning' ? 'text-[#f59e0b]'
    : 'text-[var(--color-foreground)]'
  return (
    <div className="flex items-center gap-3">
      <div className="p-2.5 rounded-full bg-[var(--color-surface-container)] shrink-0">
        <Icon className="w-4 h-4 text-[var(--color-secondary)]" />
      </div>
      <div>
        <p className="text-[10px] uppercase font-bold text-[var(--color-muted-foreground)] tracking-wider">{label}</p>
        <p className={`font-bold text-sm ${valueColor}`}>{value}</p>
      </div>
    </div>
  )
}

export default function VehiclesPage() {
  const { canWrite } = usePermissions()
  const [showArchived, setShowArchived] = useState(false)
  const params: Record<string, string> = { isActive: showArchived ? 'false' : 'true' }
  const { data: vehicles = [], isLoading } = useVehicles(params)
  const deleteVehicle = useDeleteVehicle()
  const updateVehicle = useUpdateVehicle()

  const handleRestore = (e: React.MouseEvent, v: VehicleListDto) => {
    e.stopPropagation()
    if (window.confirm(`Restore "${v.vehicleName}"?`)) {
      const { id: _id, ...rest } = v
      updateVehicle.mutate({ id: v.id, data: {
        ...rest,
        isActive: true,
        registration: rest.registration ?? undefined,
        serviceDueDate: rest.serviceDueDate ?? undefined,
        registrationDueDate: rest.registrationDueDate ?? undefined,
      } })
    }
  }

  const handleDelete = (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation()
    if (window.confirm(`Archive "${name}"? This can be undone from the Archived view.`)) {
      deleteVehicle.mutate(id)
    }
  }

  const totalSeats = vehicles.reduce((sum: number, v: VehicleListDto) => sum + (v.totalSeats || 0), 0)
  const totalWheelchair = vehicles.reduce((sum: number, v: VehicleListDto) => sum + (v.wheelchairPositions || 0), 0)
  const accessibleCount = vehicles.filter((v: VehicleListDto) => v.vehicleType === 'AccessibleVan' || v.wheelchairPositions > 0).length

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header */}
      <PageHeader
        title="Vehicles"
        subtitle={`${vehicles.length} ${showArchived ? 'archived' : 'active'} vehicle${vehicles.length !== 1 ? 's' : ''}`}
        action={!showArchived && canWrite && (
          <Link
            to="/vehicles/new"
            className="flex items-center gap-2 px-4 md:px-5 py-2 md:py-2.5 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-container)] text-white text-sm font-bold hover:opacity-90 transition-all shadow-md flex-shrink-0"
          >
            <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Add Vehicle</span><span className="sm:hidden">Add</span>
          </Link>
        )}
      />

      {/* Filter chips */}
      <div className="flex gap-2">
        <button
          onClick={() => setShowArchived(false)}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            !showArchived
              ? 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)] font-bold'
              : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-surface-container)]'
          }`}
        >
          Active
        </button>
        <button
          onClick={() => setShowArchived(true)}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            showArchived
              ? 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)] font-bold'
              : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-surface-container)]'
          }`}
        >
          Archived
        </button>
      </div>

      {/* Loading state */}
      {isLoading ? (
        <div className="text-center py-16 text-[var(--color-muted-foreground)]">Loading...</div>
      ) : vehicles.length === 0 ? (
        /* Empty state */
        <EmptyState
          icon={Bus}
          title="No vehicles found"
          action={!showArchived ? { label: 'Add your first vehicle', to: '/vehicles/new' } : undefined}
        />
      ) : (
        /* Vehicle grid */
        <div className="grid md:grid-cols-2 gap-4 md:gap-6">
          {vehicles.map((v: VehicleListDto) => {
            const typeKey = (v.vehicleType as VehicleTypeKey) in vehicleTypeConfig
              ? (v.vehicleType as VehicleTypeKey)
              : 'Other'
            const { icon: TypeIcon, iconBg, iconColor } = vehicleTypeConfig[typeKey]
            const serviceDueStatus = getDateStatus(v.serviceDueDate)
            const regoDueStatus = getDateStatus(v.registrationDueDate)

            return (
              <div
                key={v.id}
                className="bg-[var(--color-card)] rounded-2xl overflow-hidden hover:shadow-xl hover:shadow-[#1b1c1a]/5 transition-all duration-500"
              >
                <div className="p-6">
                  {/* Card header */}
                  <div className="flex items-start gap-4 mb-5">
                    <div className={`w-14 h-14 rounded-2xl ${iconBg} flex items-center justify-center shrink-0`}>
                      <TypeIcon className={`w-7 h-7 ${iconColor}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="font-bold text-[var(--color-foreground)] text-base truncate">{v.vehicleName}</h3>
                          <p className="text-xs text-[var(--color-muted-foreground)] font-mono mt-0.5">
                            {v.registration || 'No registration'}
                          </p>
                          <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
                            {v.vehicleType} · {v.isInternal ? 'Internal' : 'External'}
                          </p>
                        </div>
                        <StatusBadge status={v.isActive ? 'Active' : 'Archived'} className="shrink-0 font-semibold" />
                      </div>
                    </div>
                  </div>

                  {/* Stats grid */}
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4 mb-6">
                    <StatCell icon={Users} label="Seating" value={`${v.totalSeats} seats`} />
                    <StatCell
                      icon={Accessibility}
                      label="Wheelchair"
                      value={v.wheelchairPositions > 0 ? `${v.wheelchairPositions} positions` : 'None'}
                    />
                    <StatCell
                      icon={Wrench}
                      label="Next Service"
                      value={v.serviceDueDate ? formatDateAu(v.serviceDueDate) : 'Not set'}
                      status={serviceDueStatus}
                    />
                    <StatCell
                      icon={Calendar}
                      label="Rego Due"
                      value={v.registrationDueDate ? formatDateAu(v.registrationDueDate) : 'Not set'}
                      status={regoDueStatus}
                    />
                  </div>

                  {/* Accessibility note (available when detail data is present) */}
                  {('rampHoistDetails' in v) && (v as import('@/api/types').VehicleDetailDto).rampHoistDetails && (
                    <div className="bg-[var(--color-surface-container-low)] rounded-xl px-4 py-3 mb-5 text-sm">
                      <span className="font-bold text-[#7a2169]">Accessibility: </span>
                      <span className="text-[var(--color-muted-foreground)]">{(v as import('@/api/types').VehicleDetailDto).rampHoistDetails}</span>
                    </div>
                  )}

                  {/* Notes preview (available when detail data is present) */}
                  {('notes' in v) && (v as import('@/api/types').VehicleDetailDto).notes && (
                    <p className="text-sm text-[var(--color-muted-foreground)] line-clamp-2 mb-4">{(v as import('@/api/types').VehicleDetailDto).notes}</p>
                  )}

                  {/* Action row */}
                  {canWrite && (
                    <div className="border-t border-[rgba(195,201,181,0.15)] pt-4 flex gap-3">
                      <Link
                        to={`/vehicles/${v.id}/edit`}
                        onClick={e => e.stopPropagation()}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-[var(--color-surface-container-high)] text-[var(--color-foreground)] text-sm font-bold hover:opacity-80 transition-all"
                      >
                        <Pencil className="w-4 h-4" /> Edit
                      </Link>
                      {showArchived ? (
                        <button
                          onClick={e => handleRestore(e, v)}
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)] text-sm font-bold hover:opacity-80 transition-all"
                        >
                          <ArchiveRestore className="w-4 h-4" /> Restore
                        </button>
                      ) : (
                        <button
                          onClick={e => handleDelete(e, v.id, v.vehicleName)}
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-[var(--color-surface-container-high)] text-[var(--color-muted-foreground)] text-sm font-bold hover:bg-[var(--color-error-container)] hover:text-[var(--color-destructive)] transition-all"
                        >
                          <Trash2 className="w-4 h-4" /> Archive
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Summary stats */}
      {!isLoading && vehicles.length > 0 && (
        <div className="mt-8 grid sm:grid-cols-3 gap-4">
          <div className="bg-[var(--color-surface-container-low)] rounded-2xl p-5">
            <p className="text-[10px] uppercase font-bold text-[var(--color-muted-foreground)] tracking-wider mb-1">Total Fleet Capacity</p>
            <p className="text-2xl font-bold text-[var(--color-primary)]">{totalSeats} <span className="text-base font-semibold">Passengers</span></p>
          </div>
          <div className="bg-[var(--color-surface-container-low)] rounded-2xl p-5">
            <p className="text-[10px] uppercase font-bold text-[var(--color-muted-foreground)] tracking-wider mb-1">Wheelchair Positions</p>
            <p className="text-2xl font-bold text-[#8e337b]">{totalWheelchair} <span className="text-base font-semibold">Available</span></p>
          </div>
          <div className="bg-[var(--color-primary-fixed)] rounded-2xl p-5">
            <p className="text-[10px] uppercase font-bold text-[var(--color-on-primary-fixed)] tracking-wider mb-1 opacity-70">Accessible Vehicles</p>
            <p className="text-2xl font-bold text-[var(--color-on-primary-fixed)]">{accessibleCount} <span className="text-base font-semibold">in Fleet</span></p>
          </div>
        </div>
      )}
    </div>
  )
}
