import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import {
  useVehicles, useCreateVehicleAssignment, useCreateVehicle,
  useCheckVehicleAssignment, getRosterFindings,
} from '@/api/hooks'
import { modalGrid, modalSpan } from '@/lib/formGrid'
import { Modal } from '@/components/Modal'
import { RosterGateFields } from '@/pages/rostering/components/RosterGateFields'
import { getRosterGate } from '@/pages/rostering/lib/rosterGate'
import type { VehicleType, RosterFindingDto } from '@/api/types'
import { Dropdown } from './Dropdown'
import { plural } from '@/lib/format'

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
  const [findings, setFindings] = useState<RosterFindingDto[]>([])
  const [overrideReason, setOverrideReason] = useState('')
  const [reasonRequired, setReasonRequired] = useState(false)
  const [assignError, setAssignError] = useState<string | null>(null)

  // Tab 2 state
  const [vehicleName, setVehicleName] = useState('')
  const [registration, setRegistration] = useState('')
  const [vehicleType, setVehicleType] = useState('')
  const [totalSeats, setTotalSeats] = useState('')
  const [wheelchairPositions, setWheelchairPositions] = useState('0')
  const [isInternal, setIsInternal] = useState(true)
  const [isActive, setIsActive] = useState(true)
  const [noIdReturned, setNoIdReturned] = useState(false)
  // The vehicle this form already created: when its assignment is refused, the next click assigns it instead of creating another.
  const [newVehicleId, setNewVehicleId] = useState<string>()

  const { data: allVehicles = [] } = useVehicles()
  const createAssignment = useCreateVehicleAssignment()
  const createVehicle = useCreateVehicle()
  const checkAssignment = useCheckVehicleAssignment()

  const gate = getRosterGate(findings)

  // Live dry-run: re-checks findings whenever the selected existing vehicle changes, debounced
  // 400ms — mirrors StaffTab's Add Staff effect. Only runs on the "existing" tab, where a
  // vehicleId is known up front; the "new vehicle" tab has no id to check against until the
  // vehicle is created. Never writes — POST /vehicle-assignments/check is a pure preview.
  useEffect(() => {
    if (activeTab !== 'existing' || !selectedVehicleId) return
    const handle = setTimeout(() => {
      checkAssignment.mutate(
        { vehicleId: selectedVehicleId, tripInstanceId },
        { onSuccess: setFindings },
      )
    }, 400)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedVehicleId, tripInstanceId])

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
    if (gate.isBlocked) return
    if (gate.needsReason && !overrideReason.trim()) {
      setReasonRequired(true)
      return
    }
    setReasonRequired(false)
    setAssignError(null)

    createAssignment.mutate(
      {
        tripInstanceId,
        vehicleId: selectedVehicleId,
        overrideReason: overrideReason.trim() || undefined,
        acknowledgedFindingCodes: findings.map(f => f.code),
      },
      {
        onSuccess: () => onClose(),
        onError: (err: unknown) => {
          const serverFindings = getRosterFindings(err)
          if (serverFindings) {
            setFindings(serverFindings)
            if (getRosterGate(serverFindings).needsReason && !overrideReason.trim()) setReasonRequired(true)
          } else {
            setAssignError('Failed to assign vehicle. Please try again.')
          }
        },
      }
    )
  }

  const handleCreateAndAssign = async () => {
    if (!vehicleName || !vehicleType || totalSeats === '') return
    setNoIdReturned(false)
    let vehicleId = newVehicleId
    if (!vehicleId) {
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
        vehicleId = res.data?.id
      } catch {
        return // createVehicle.isError shows the inline error
      }
      if (!vehicleId) {
        // Mutation succeeded but response had no ID — unexpected API shape.
        // Vehicle was created; user can assign it manually from the fleet list.
        setNoIdReturned(true)
        return
      }
      setNewVehicleId(vehicleId)
    }
    try {
      await createAssignment.mutateAsync({ tripInstanceId, vehicleId })
      onClose()
    } catch {
      // createAssignment.isError shows the inline error.
      // Vehicle was already created — ['vehicles'] was invalidated by useCreateVehicle's onSuccess.
      // User can find and assign it manually from the fleet.
    }
  }

  const tab1CanSubmit = !!selectedVehicleId && !createAssignment.isPending && !gate.isBlocked
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
            <button onClick={onClose} className="inline-flex items-center justify-center h-[var(--control-h)] px-4 text-sm rounded-[var(--radius-md)] border border-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors">
              Cancel
            </button>
            <button
              onClick={handleAssignExisting}
              disabled={!tab1CanSubmit}
              className="inline-flex items-center justify-center h-[var(--control-h)] px-4 text-sm rounded-[var(--radius-md)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {createAssignment.isPending ? 'Assigning...' : gate.needsReason ? 'Assign with override' : 'Assign Vehicle'}
            </button>
          </>
        ) : (
          <>
            <button onClick={onClose} className="inline-flex items-center justify-center h-[var(--control-h)] px-4 text-sm rounded-[var(--radius-md)] border border-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors">
              Cancel
            </button>
            <button
              onClick={handleCreateAndAssign}
              disabled={!tab2CanSubmit}
              className="inline-flex items-center justify-center h-[var(--control-h)] px-4 text-sm rounded-[var(--radius-md)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
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
              onClick={() => {
                setActiveTab(tab)
                createAssignment.reset()
                createVehicle.reset()
                setNoIdReturned(false)
                setFindings([])
                setOverrideReason('')
                setReasonRequired(false)
                setAssignError(null)
              }}
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
                className="w-full pl-9 pr-3 py-2 text-sm bg-[var(--color-background)] border border-[var(--color-border)] rounded-[var(--radius-md)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
              />
            </div>

            <p className="text-xs text-[var(--color-muted-foreground)]">
              {plural(filteredVehicles.length, 'vehicle')} available
            </p>

            <div className="space-y-2 max-h-64 overflow-y-auto">
              {filteredVehicles.length === 0 ? (
                <p className="text-sm text-[var(--color-muted-foreground)] text-center py-4">No vehicles found</p>
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ) : filteredVehicles.map((v: any) => (
                <button
                  key={v.id}
                  onClick={() => setSelectedVehicleId(v.id)}
                  className={`w-full text-left px-4 py-3 rounded-[var(--radius-md)] border transition-colors ${
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

            <RosterGateFields
              findings={findings}
              overrideReason={overrideReason}
              onOverrideReasonChange={setOverrideReason}
              reasonRequired={reasonRequired}
            />

            {assignError && (
              <p className="text-sm text-[var(--color-destructive)]">{assignError}</p>
            )}
          </div>
        )}

        {/* Tab 2 — Add New Vehicle */}
        {activeTab === 'new' && (
          <div className={modalGrid}>
            <div className={modalSpan.full}>
              <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">
                Vehicle name <span className="text-[var(--color-destructive)]">*</span>
              </label>
              <input
                type="text"
                value={vehicleName}
                onChange={e => setVehicleName(e.target.value)}
                placeholder="e.g. Toyota HiAce"
                className="w-full px-3 h-[var(--control-h)] text-sm bg-[var(--color-background)] border border-[var(--color-border)] rounded-[var(--radius-md)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
              />
            </div>

            <div className="contents">
              <div className={modalSpan.half}>
                <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">Registration</label>
                <input
                  type="text"
                  value={registration}
                  onChange={e => setRegistration(e.target.value)}
                  placeholder="ABC-123"
                  className="w-full px-3 h-[var(--control-h)] text-sm bg-[var(--color-background)] border border-[var(--color-border)] rounded-[var(--radius-md)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
                />
              </div>
              <div className={modalSpan.half}>
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
              <div className={modalSpan.half}>
                <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">
                  Total seats <span className="text-[var(--color-destructive)]">*</span>
                </label>
                <input
                  type="number"
                  min={0}
                  value={totalSeats}
                  onChange={e => setTotalSeats(e.target.value)}
                  className="w-full px-3 h-[var(--control-h)] text-sm bg-[var(--color-background)] border border-[var(--color-border)] rounded-[var(--radius-md)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
                />
              </div>
              <div className={modalSpan.half}>
                <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">Wheelchair positions</label>
                <input
                  type="number"
                  min={0}
                  value={wheelchairPositions}
                  onChange={e => setWheelchairPositions(e.target.value)}
                  className="w-full px-3 h-[var(--control-h)] text-sm bg-[var(--color-background)] border border-[var(--color-border)] rounded-[var(--radius-md)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
                />
              </div>
            </div>

            <div className={`flex gap-5 ${modalSpan.full}`}>
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
              <p className={`text-sm text-[var(--color-destructive)] ${modalSpan.full}`}>Failed to create vehicle. Please try again.</p>
            )}
            {(createAssignment.isError || noIdReturned) && !createVehicle.isError && (
              <p className={`text-sm text-[var(--color-destructive)] ${modalSpan.full}`}>
                Vehicle was created but could not be assigned. Find it in the Vehicles list and assign it manually.
              </p>
            )}
          </div>
        )}
    </Modal>
  )
}
