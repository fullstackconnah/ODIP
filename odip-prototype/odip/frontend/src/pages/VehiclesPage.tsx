import { useVehicles, useDeleteVehicle, useUpdateVehicle } from '@/api/hooks'
import type { VehicleListDto } from '@/api/types'
import { formatDateAu } from '@/lib/utils'
import { Plus, Pencil, Trash2, ArchiveRestore, Car, Bus, Truck, Users, Wrench, Calendar, Accessibility } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/StatusBadge'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button } from '@/components/Button'
import { ToggleGroup } from '@/components/ToggleGroup'
import { StatCard } from '@/components/StatCard'
import { useState } from 'react'
import { usePermissions } from '@/lib/permissions'

type VehicleTypeKey = 'Car' | 'Van' | 'Bus' | 'MiniBus' | 'AccessibleVan' | 'Other'

const vehicleTypeConfig: Record<VehicleTypeKey, { icon: React.ElementType; iconBg: string; iconColor: string }> = {
  Car: { icon: Car, iconBg: 'bg-[var(--color-primary-fixed)]', iconColor: 'text-[var(--color-primary)]' },
  Van: { icon: Truck, iconBg: 'bg-[var(--color-secondary-container)]', iconColor: 'text-[var(--color-secondary)]' },
  Bus: { icon: Bus, iconBg: 'bg-[var(--color-surface-container)]', iconColor: 'text-[var(--color-muted-foreground)]' },
  MiniBus: { icon: Bus, iconBg: 'bg-[var(--color-surface-container)]', iconColor: 'text-[var(--color-muted-foreground)]' },
  AccessibleVan: { icon: Bus, iconBg: 'bg-[var(--color-accessible-container)]', iconColor: 'text-[var(--color-on-accessible-container)]' },
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
    : status === 'warning' ? 'text-[var(--color-warning)]'
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
  const [confirmState, setConfirmState] = useState<{ type: 'archive' | 'restore'; item: VehicleListDto } | null>(null)

  const handleRestore = (e: React.MouseEvent, v: VehicleListDto) => {
    e.stopPropagation()
    setConfirmState({ type: 'restore', item: v })
  }

  const handleDelete = (e: React.MouseEvent, v: VehicleListDto) => {
    e.stopPropagation()
    setConfirmState({ type: 'archive', item: v })
  }

  const totalSeats = vehicles.reduce((sum: number, v: VehicleListDto) => sum + (v.totalSeats || 0), 0)
  const totalWheelchair = vehicles.reduce((sum: number, v: VehicleListDto) => sum + (v.wheelchairPositions || 0), 0)
  const accessibleCount = vehicles.filter((v: VehicleListDto) => v.vehicleType === 'AccessibleVan' || v.wheelchairPositions > 0).length

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      {/* Page header */}
      <PageHeader
        title="Vehicles"
        subtitle={`${vehicles.length} ${showArchived ? 'archived' : 'active'} vehicle${vehicles.length !== 1 ? 's' : ''}`}
        action={!showArchived && canWrite && (
          <Button to="/vehicles/new" size="md">
            <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Add Vehicle</span><span className="sm:hidden">Add</span>
          </Button>
        )}
      >
        <ToggleGroup
          ariaLabel="Filter vehicles by status"
          options={[{ key: 'active', label: 'Active' }, { key: 'archived', label: 'Archived' }]}
          value={showArchived ? 'archived' : 'active'}
          onChange={key => setShowArchived(key === 'archived')}
        />
      </PageHeader>

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
        <div className="grid grid-cols-[repeat(auto-fill,minmax(22rem,1fr))] items-start gap-[var(--section-gap)]">
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
                className="bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] overflow-hidden hover:shadow-md transition-all"
              >
                <div className="p-[var(--card-pad)]">
                  {/* Card header */}
                  <div className="flex items-start gap-3 mb-3">
                    <div className={`w-10 h-10 rounded-[var(--radius-md)] ${iconBg} flex items-center justify-center shrink-0`}>
                      <TypeIcon className={`w-5 h-5 ${iconColor}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="font-bold text-[var(--color-foreground)] text-sm truncate">{v.vehicleName}</h3>
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-[var(--field-gap-x)] gap-y-2 mb-3">
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

                  {/* Action row */}
                  {canWrite && (
                    <div className="border-t border-[var(--color-border)] pt-2 flex gap-2">
                      <Button
                        to={`/vehicles/${v.id}/edit`}
                        onClick={e => e.stopPropagation()}
                        variant="secondary"
                        size="sm"
                        className="flex-1"
                      >
                        <Pencil className="w-3.5 h-3.5" /> Edit
                      </Button>
                      {showArchived ? (
                        <Button
                          onClick={e => handleRestore(e, v)}
                          variant="primary"
                          size="sm"
                          className="flex-1"
                        >
                          <ArchiveRestore className="w-3.5 h-3.5" /> Restore
                        </Button>
                      ) : (
                        <Button
                          onClick={e => handleDelete(e, v)}
                          variant="secondary"
                          size="sm"
                          className="flex-1 hover:bg-[var(--color-error-container)] hover:text-[var(--color-destructive)]"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Archive
                        </Button>
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
        <div className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-2">
          <StatCard label="Total Fleet Capacity" value={`${totalSeats} passengers`} />
          <StatCard label="Wheelchair Positions" value={`${totalWheelchair} available`} />
          <StatCard label="Accessible Vehicles" value={`${accessibleCount} in fleet`} />
        </div>
      )}

      <ConfirmDialog
        open={confirmState !== null}
        onCancel={() => setConfirmState(null)}
        onConfirm={() => {
          if (!confirmState) return
          if (confirmState.type === 'restore') {
            const { id: _id, ...rest } = confirmState.item
            updateVehicle.mutate({ id: confirmState.item.id, data: {
              ...rest,
              isActive: true,
              registration: rest.registration ?? undefined,
              serviceDueDate: rest.serviceDueDate ?? undefined,
              registrationDueDate: rest.registrationDueDate ?? undefined,
            } }, { onSuccess: () => setConfirmState(null) })
          } else {
            deleteVehicle.mutate(confirmState.item.id, { onSuccess: () => setConfirmState(null) })
          }
        }}
        title={confirmState?.type === 'restore' ? 'Restore Vehicle' : 'Archive Vehicle'}
        message={
          confirmState?.type === 'restore'
            ? `Restore "${confirmState.item.vehicleName}"?`
            : `Archive "${confirmState?.item?.vehicleName}"? This can be undone from the Archived view.`
        }
        confirmLabel={confirmState?.type === 'restore' ? 'Restore' : 'Archive'}
        variant={confirmState?.type === 'restore' ? 'default' : 'danger'}
        loading={updateVehicle.isPending || deleteVehicle.isPending}
      />
    </div>
  )
}
