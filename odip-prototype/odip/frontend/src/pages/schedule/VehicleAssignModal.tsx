import React, { useEffect, useState } from 'react'
import { Truck, X } from 'lucide-react'
import { Button } from '@/components/Button'
import { Dropdown } from '@/components/Dropdown'
import { formatDate } from './helpers'
import { useCheckVehicleAssignment, getRosterFindings } from '@/api/hooks'
import { RosterGateFields } from '@/pages/rostering/components/RosterGateFields'
import { getRosterGate } from '@/pages/rostering/lib/rosterGate'
import type { ScheduleVehicleDto, ScheduleTripDto, ScheduleStaffDto, CreateVehicleAssignmentDto, RosterFindingDto } from '@/api/types'
import { Callout } from '@/components/Callout'

interface VehicleAssignModalProps {
  vehicle: ScheduleVehicleDto
  trip: ScheduleTripDto
  staff: ScheduleStaffDto[]
  onClose: () => void
  onAssign: (data: CreateVehicleAssignmentDto) => Promise<void>
  isLoading: boolean
}

export default function VehicleAssignModal({ vehicle, trip, staff, onClose, onAssign, isLoading }: VehicleAssignModalProps) {
  const [driverStaffId, setDriverStaffId] = useState('')
  const [comments, setComments] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const [findings, setFindings] = useState<RosterFindingDto[]>([])
  const [reasonRequired, setReasonRequired] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const eligibleDrivers = staff?.filter((s: ScheduleStaffDto) => s.isDriverEligible) || []

  const checkAssignment = useCheckVehicleAssignment()

  // Live dry-run: vehicle and trip are fixed props for this modal's whole lifetime — one
  // un-debounced check on mount is enough, mirroring StaffAssignModal. Never writes —
  // POST /vehicle-assignments/check is a pure preview.
  useEffect(() => {
    checkAssignment.mutate(
      { vehicleId: vehicle.id, tripInstanceId: trip.id },
      { onSuccess: setFindings },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle.id, trip.id])

  const gate = getRosterGate(findings)
  const isBusy = isLoading

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (gate.isBlocked) return
    if (gate.needsReason && !overrideReason.trim()) {
      setReasonRequired(true)
      return
    }
    setReasonRequired(false)

    try {
      await onAssign({
        tripInstanceId: trip.id,
        vehicleId: vehicle.id,
        driverStaffId: driverStaffId || undefined,
        seatRequirement: undefined,
        wheelchairPositionRequirement: undefined,
        comments: comments || undefined,
        overrideReason: overrideReason.trim() || undefined,
        acknowledgedFindingCodes: findings.map(f => f.code),
      })
    } catch (err: unknown) {
      const serverFindings = getRosterFindings(err)
      if (serverFindings) {
        setFindings(serverFindings)
        if (getRosterGate(serverFindings).needsReason && !overrideReason.trim()) setReasonRequired(true)
      } else {
        setError('Something went wrong assigning this vehicle. Please try again.')
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-[var(--radius-lg)] shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex h-12 items-center justify-between px-4" style={{ borderBottom: '1px solid rgba(195,201,181,0.25)' }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[var(--color-secondary-container)]/60 flex items-center justify-center">
              <Truck className="w-4 h-4 text-[var(--color-secondary)]" />
            </div>
            <h3 className="font-display font-bold text-base">Assign Vehicle</h3>
          </div>
          <Button variant="ghost" size="sm" iconOnly onClick={onClose} aria-label="Close">
            <X className="w-4 h-4" />
          </Button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-[var(--section-gap)]">
          <div className="bg-[var(--color-surface-container-low)] rounded-[var(--radius-md)] p-[var(--card-pad)] space-y-1">
            <div className="text-sm font-bold">{vehicle.vehicleName}</div>
            <div className="text-xs text-[var(--color-muted-foreground)]">
              {vehicle.registration || '—'} · {vehicle.totalSeats} seats
              {vehicle.wheelchairPositions > 0 && ` · ${vehicle.wheelchairPositions} wheelchair`}
            </div>
            <div className="text-xs text-[var(--color-muted-foreground)]">
              → {trip.tripName} ({formatDate(trip.startDate)} — {formatDate(trip.endDate)})
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-[var(--color-muted-foreground)] block mb-1.5">Assigned Driver (optional)</label>
            <Dropdown
              variant="form"
              value={driverStaffId}
              onChange={setDriverStaffId}
              label="— No driver selected —"
              items={[
                { value: '', label: '— No driver selected —' },
                ...eligibleDrivers.map((s: ScheduleStaffDto) => ({ value: String(s.id), label: s.fullName })),
              ]}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-[var(--color-muted-foreground)] block mb-1.5">Comments (optional)</label>
            <textarea
              value={comments}
              onChange={e => setComments(e.target.value)}
              rows={2}
              placeholder="E.g. pickup from depot, needs fuel..."
              className="w-full px-4 py-2.5 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] border-none text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] resize-none"
            />
          </div>

          <RosterGateFields
            findings={findings}
            overrideReason={overrideReason}
            onOverrideReasonChange={setOverrideReason}
            reasonRequired={reasonRequired}
          />

          {error && (
            <Callout tone="error">{error}</Callout>
          )}

          <div className="flex gap-3 pt-1">
            <Button variant="secondary" size="md" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" size="md" disabled={isBusy || gate.isBlocked} className="flex-1">
              {isBusy ? 'Assigning...' : gate.needsReason ? 'Assign with override' : 'Assign Vehicle'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
