import { useState } from 'react'
import { Search } from 'lucide-react'
import { useVehicles, useCreateVehicleAssignment, useCreateVehicle } from '@/api/hooks'
import { Modal } from '@/components/Modal'
import type { VehicleType } from '@/api/types'
import { Dropdown } from './Dropdown'

interface AddVehicleModalProps {
  tripInstanceId: string
  assignedVehicleIds: Set<string>
  onClose: () => void
}

export default function AddVehicleModal({ tripInstanceId, assignedVehicleIds, onClose }: AddVehicleModalProps) {
  const [activeTab, setActiveTab] = useState<'existing' | 'new'>('existing')

  // Tab 1 state
  const [search, setSearch] = useState('')
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)

  // Tab 2 state
  const [vehicleName, setVehicleName] = useState('')
  const [registration, setRegistration] = useState('')
  const [vehicleType, setVehicleType] = useState('')
  const [totalSeats, setTotalSeats] = useState('')
  const [wheelchairPositions, setWheelchairPositions] = useState('0')
  const [isInternal, setIsInternal] = useState(true)
  const [isActive, setIsActive] = useState(true)
  const [noIdReturned, setNoIdReturned] = useState(false)

  const { data: allVehicles = [] } = useVehicles()
  const createAssignment = useCreateVehicleAssignment()
  const createVehicle = useCreateVehicle()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filteredVehicles = (allVehicles as any[])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((v: any) => v.isActive && !assignedVehicleIds.has(v.id))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((v: any) => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return v.vehicleName?.toLowerCase().includes(q) || v.registration?.toLowerCase().includes(q)
    })

  const handleAssignExisting = () => {
    if (!selectedVehicleId) return
    createAssignment.mutate(
      { tripInstanceId, vehicleId: selectedVehicleId },
      { onSuccess: () => onClose() }
    )
  }

  const handleCreateAndAssign = async () => {
    if (!vehicleName || !vehicleType || totalSeats === '') return
    setNoIdReturned(false)
    let newVehicleId: string | undefined
    try {
      const res = await createVehicle.mutateAsync({
        vehicleName,
        registration: registration || undefined,
        vehicleType: vehicleType as VehicleType,
        totalSeats: Number(totalSeats),
        wheelchairPositions: Number(wheelchairPositions),
        isInternal,
        isActive,
      })
      newVehicleId = res.data?.id
    } catch {
      return // createVehicle.isError shows the inline error
    }
    if (!newVehicleId) {
      // Mutation succeeded but response had no ID — unexpected API shape.
      // Vehicle was created; user can assign it manually from the fleet list.
      setNoIdReturned(true)
      return
    }
    try {
      await createAssignment.mutateAsync({ tripInstanceId, vehicleId: newVehicleId })
      onClose()
    } catch {
      // createAssignment.isError shows the inline error.
      // Vehicle was already created — ['vehicles'] was invalidated by useCreateVehicle's onSuccess.
      // User can find and assign it manually from the fleet.
    }
  }

  const tab1CanSubmit = !!selectedVehicleId && !createAssignment.isPending
  const tab2CanSubmit =
    !!vehicleName && !!vehicleType && totalSeats !== '' &&
    !createVehicle.isPending && !createAssignment.isPending

  return (
    <Modal
      open
      onClose={onClose}
      title="Add Vehicle"
      footer={
        activeTab === 'existing' ? (
          <>
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors">
              Cancel
            </button>
            <button
              onClick={handleAssignExisting}
              disabled={!tab1CanSubmit}
              className="px-4 py-2 text-sm rounded-lg bg-[var(--color-primary)] text-[var(--color-primary-foreground)] font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {createAssignment.isPending ? 'Assigning...' : 'Assign Vehicle'}
            </button>
          </>
        ) : (
          <>
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors">
              Cancel
            </button>
            <button
              onClick={handleCreateAndAssign}
              disabled={!tab2CanSubmit}
              className="px-4 py-2 text-sm rounded-lg bg-[var(--color-primary)] text-[var(--color-primary-foreground)] font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {createVehicle.isPending || createAssignment.isPending ? 'Saving...' : 'Create Vehicle & Assign'}
            </button>
          </>
        )
      }
    >

        {/* Tabs */}
        <div className="flex border-b border-[var(--color-border)] mb-5">
          {(['existing', 'new'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); createAssignment.reset(); createVehicle.reset(); setNoIdReturned(false) }}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'border-b-2 border-[var(--color-primary)] text-[var(--color-primary)]'
                  : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]'
              }`}
            >
              {tab === 'existing' ? 'Select Existing' : 'Add New Vehicle'}
            </button>
          ))}
        </div>

        {/* Tab 1 — Select Existing */}
        {activeTab === 'existing' && (
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-muted-foreground)]" />
              <input
                type="text"
                placeholder="Search by name or rego..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm bg-[var(--color-background)] border border-[var(--color-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/50"
              />
            </div>

            <p className="text-xs text-[var(--color-muted-foreground)]">
              {filteredVehicles.length} vehicle{filteredVehicles.length !== 1 ? 's' : ''} available
            </p>

            <div className="space-y-2 max-h-64 overflow-y-auto">
              {filteredVehicles.length === 0 ? (
                <p className="text-sm text-[var(--color-muted-foreground)] text-center py-4">No vehicles found</p>
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ) : filteredVehicles.map((v: any) => (
                <button
                  key={v.id}
                  onClick={() => setSelectedVehicleId(v.id)}
                  className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                    selectedVehicleId === v.id
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5'
                      : 'border-[var(--color-border)] hover:border-[var(--color-primary)]/40'
                  }`}
                >
                  <p className="font-medium text-sm">{v.vehicleName}</p>
                  <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
                    {v.registration || 'No rego'} · {v.vehicleType} · {v.totalSeats} seats
                    {v.wheelchairPositions ? <> · <span className="material-symbols-outlined text-base leading-none">accessible</span> {v.wheelchairPositions}</> : ''}
                  </p>
                </button>
              ))}
            </div>

            {createAssignment.isError && (
              <p className="text-sm text-[var(--color-destructive)]">Failed to assign vehicle. Please try again.</p>
            )}
          </div>
        )}

        {/* Tab 2 — Add New Vehicle */}
        {activeTab === 'new' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">
                Vehicle name <span className="text-[var(--color-destructive)]">*</span>
              </label>
              <input
                type="text"
                value={vehicleName}
                onChange={e => setVehicleName(e.target.value)}
                placeholder="e.g. Toyota HiAce"
                className="w-full px-3 py-2 text-sm bg-[var(--color-background)] border border-[var(--color-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/50"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">Registration</label>
                <input
                  type="text"
                  value={registration}
                  onChange={e => setRegistration(e.target.value)}
                  placeholder="ABC-123"
                  className="w-full px-3 py-2 text-sm bg-[var(--color-background)] border border-[var(--color-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">
                  Type <span className="text-[var(--color-destructive)]">*</span>
                </label>
                <Dropdown
                  variant="form"
                  items={['Car', 'Van', 'Bus', 'MiniBus', 'AccessibleVan', 'Other'].map(t => ({ value: t, label: t }))}
                  value={vehicleType}
                  onChange={setVehicleType}
                  label="Select type"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">
                  Total seats <span className="text-[var(--color-destructive)]">*</span>
                </label>
                <input
                  type="number"
                  min={0}
                  value={totalSeats}
                  onChange={e => setTotalSeats(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[var(--color-background)] border border-[var(--color-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">Wheelchair positions</label>
                <input
                  type="number"
                  min={0}
                  value={wheelchairPositions}
                  onChange={e => setWheelchairPositions(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[var(--color-background)] border border-[var(--color-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/50"
                />
              </div>
            </div>

            <div className="flex gap-5">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={isInternal} onChange={e => setIsInternal(e.target.checked)} className="rounded" />
                Internal fleet
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="rounded" />
                Active
              </label>
            </div>

            {createVehicle.isError && (
              <p className="text-sm text-[var(--color-destructive)]">Failed to create vehicle. Please try again.</p>
            )}
            {(createAssignment.isError || noIdReturned) && !createVehicle.isError && (
              <p className="text-sm text-[var(--color-destructive)]">
                Vehicle was created but could not be assigned. Find it in the Vehicles list and assign it manually.
              </p>
            )}
          </div>
        )}
    </Modal>
  )
}
