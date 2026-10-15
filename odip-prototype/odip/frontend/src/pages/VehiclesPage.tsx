import { useVehicles, useDeleteVehicle, useRestoreVehicle } from '@/api/hooks'
import type { VehicleListDto } from '@/api/types'
import { formatDateAu, extractErrorMessage } from '@/lib/utils'
import { deadlineState } from '@/lib/deadline'
import { Plus, Car, Bus, Truck, Users, Wrench, Calendar, Accessibility } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { PageState } from '@/components/PageState'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button } from '@/components/Button'
import { ToggleGroup } from '@/components/ToggleGroup'
import { SearchInput } from '@/components/SearchInput'
import { ActionButtons } from '@/components/ActionButtons'
import { Callout } from '@/components/Callout'
import { useState } from 'react'
import { usePermissions } from '@/lib/permissions'
import { TONE } from '@/lib/tone'
import { plural } from '@/lib/format'

type VehicleTypeKey = 'Car' | 'Van' | 'Bus' | 'MiniBus' | 'AccessibleVan' | 'Other'

const vehicleTypeConfig: Record<VehicleTypeKey, { icon: React.ElementType; iconBg: string; iconColor: string }> = {
  Car: { icon: Car, iconBg: 'bg-[var(--color-primary-fixed)]', iconColor: 'text-[var(--color-primary)]' },
  Van: { icon: Truck, iconBg: 'bg-[var(--color-secondary-container)]', iconColor: 'text-[var(--color-secondary)]' },
  Bus: { icon: Bus, iconBg: 'bg-[var(--color-surface-container)]', iconColor: 'text-[var(--color-muted-foreground)]' },
  MiniBus: { icon: Bus, iconBg: 'bg-[var(--color-surface-container)]', iconColor: 'text-[var(--color-muted-foreground)]' },
  AccessibleVan: { icon: Bus, iconBg: 'bg-[var(--color-accessible-container)]', iconColor: 'text-[var(--color-on-accessible-container)]' },
  Other: { icon: Truck, iconBg: 'bg-[var(--color-surface-container-high)]', iconColor: 'text-[var(--color-muted-foreground)]' },
}

// The service and registration dates are DateOnly: overdue from the day AFTER, warning today and for the next 30 days (the same rule as the
// Qualifications page, lib/deadline). It read the date as UTC midnight, which is 10:00 in Sydney, and went red mid-morning on the due day.
function getDateStatus(dateStr: string | null | undefined): 'overdue' | 'warning' | 'ok' | null {
  if (!dateStr) return null
  const { status } = deadlineState(dateStr, { warnDays: 30 })
  if (status === 'overdue') return 'overdue'
  if (status === 'today' || status === 'soon') return 'warning'
  return status === 'ok' ? 'ok' : null
}

function StatCell({ icon: Icon, label, value, status }: {
  icon: React.ElementType; label: string; value: string; status?: 'overdue' | 'warning' | 'ok' | null
}) {
  // The warning tone's ink, not --color-warning: amber text on the card is 2.15:1.
  const valueColor = status === 'overdue' ? TONE.danger.ink
    : status === 'warning' ? TONE.warning.ink
    : 'text-[var(--color-foreground)]'
  return (
    <div className="flex items-center gap-3">
      <div className="p-2.5 rounded-full bg-[var(--color-surface-container)] shrink-0">
        <Icon className="w-4 h-4 text-[var(--color-secondary)]" />
      </div>
      <div>
        <p className="text-xs uppercase font-bold text-[var(--color-muted-foreground)] tracking-wider">{label}</p>
        <p className={`font-bold text-sm ${valueColor}`}>{value}</p>
      </div>
    </div>
  )
}

export default function VehiclesPage() {
  const { canWrite } = usePermissions()
  const [showArchived, setShowArchived] = useState(false)
  const params: Record<string, string> = { isActive: showArchived ? 'false' : 'true' }
  const { data: vehicles = [], isLoading, isError, refetch } = useVehicles(params)
  const deleteVehicle = useDeleteVehicle()
  const restoreVehicle = useRestoreVehicle()
  const [confirmState, setConfirmState] = useState<{ type: 'archive' | 'restore'; item: VehicleListDto } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const q = search.toLowerCase()
  const filtered = q
    ? vehicles.filter((v: VehicleListDto) => v.vehicleName.toLowerCase().includes(q) || v.registration?.toLowerCase().includes(q))
    : vehicles
  const totalSeats = filtered.reduce((sum: number, v: VehicleListDto) => sum + (v.totalSeats || 0), 0)

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      {/* Page header */}
      <PageHeader
        title="Vehicles"
        subtitle={`${plural(filtered.length, `${showArchived ? 'archived' : 'active'} vehicle`)}, ${plural(totalSeats, 'seat')}`}
        action={!showArchived && canWrite && (
          <Button to="/vehicles/new" size="md">
            <Plus className="w-4 h-4" /> New vehicle
          </Button>
        )}
      >
        <ToggleGroup
          ariaLabel="Filter vehicles by status"
          options={[{ key: 'active', label: 'Active' }, { key: 'archived', label: 'Archived' }]}
          value={showArchived ? 'archived' : 'active'}
          onChange={key => { setShowArchived(key === 'archived'); setActionError(null) }}
        />
        <SearchInput value={search} onChange={setSearch} placeholder="Search vehicles..." />
      </PageHeader>

      {actionError && <Callout tone="error">{actionError}</Callout>}

      {/* Loading state */}
      {isLoading ? (
        <PageState kind="loading" noun="vehicles" />
      ) : isError && vehicles.length === 0 ? (
        <PageState kind="error" noun="vehicle list" onRetry={() => refetch()} />
      ) : filtered.length === 0 ? (
        /* Empty state */
        <EmptyState
          icon={Bus}
          title={vehicles.length === 0 ? 'No vehicles found' : 'No results for your search'}
          description={vehicles.length === 0 ? undefined : 'Try a different search term.'}
        />
      ) : (
        /* Vehicle grid: cards in a row stretch to one height, so the action rows line up */
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(22rem,100%),1fr))] gap-[var(--section-gap)]">
          {filtered.map((v: VehicleListDto) => {
            const typeKey = (v.vehicleType as VehicleTypeKey) in vehicleTypeConfig
              ? (v.vehicleType as VehicleTypeKey)
              : 'Other'
            const { icon: TypeIcon, iconBg, iconColor } = vehicleTypeConfig[typeKey]
            const serviceDueStatus = getDateStatus(v.serviceDueDate)
            const regoDueStatus = getDateStatus(v.registrationDueDate)

            return (
              <div
                key={v.id}
                className="bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] overflow-hidden hover:shadow-md transition-all flex flex-col"
              >
                <div className="p-[var(--card-pad)] flex flex-1 flex-col">
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
                      </div>
                    </div>
                  </div>

                  {/* Stats grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-[var(--field-gap-x)] gap-y-2 mb-3">
                    <StatCell icon={Users} label="Seating" value={`${v.totalSeats} seats`} />
                    <StatCell
                      icon={Accessibility}
                      label="Wheelchair"
                      value={v.wheelchairPositions > 0 ? plural(v.wheelchairPositions, 'wheelchair position') : 'None'}
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

                  {/* Action row: the card pattern Accommodation shares, pinned to the foot of a stretched card */}
                  {canWrite && (
                    <div className="mt-auto">
                      <ActionButtons
                        labelled
                        editTo={`/vehicles/${v.id}/edit`}
                        onDelete={() => setConfirmState({ type: 'archive', item: v })}
                        onRestore={() => setConfirmState({ type: 'restore', item: v })}
                        showArchived={showArchived}
                      />
                    </div>
                  )}
                  {/* ReadOnly has no detail page for a vehicle: it opens the form as a view (notes, ramp, driver requirements). */}
                  {!canWrite && (
                    <div className="mt-auto border-t border-[var(--color-border)] pt-2 flex gap-2">
                      <Button to={`/vehicles/${v.id}/edit`} variant="secondary" size="sm" className="flex-1">View</Button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirmState !== null}
        onCancel={() => setConfirmState(null)}
        onConfirm={() => {
          if (!confirmState) return
          const { type, item } = confirmState
          setActionError(null)
          // Its own promise (Q4a): the confirm closes either way, and a refusal shows above the cards.
          const call = type === 'restore' ? restoreVehicle.mutateAsync(item.id) : deleteVehicle.mutateAsync(item.id)
          call
            .catch(err => setActionError(extractErrorMessage(err, `Could not ${type} "${item.vehicleName}". Please try again.`)))
            .finally(() => setConfirmState(null))
        }}
        title={confirmState?.type === 'restore' ? 'Restore Vehicle' : 'Archive Vehicle'}
        message={
          confirmState?.type === 'restore'
            ? `Restore "${confirmState.item.vehicleName}"?`
            : `Archive "${confirmState?.item?.vehicleName}"? This can be undone from the Archived view.`
        }
        confirmLabel={confirmState?.type === 'restore' ? 'Restore' : 'Archive'}
        variant={confirmState?.type === 'restore' ? 'default' : 'danger'}
        loading={restoreVehicle.isPending || deleteVehicle.isPending}
      />
    </div>
  )
}
