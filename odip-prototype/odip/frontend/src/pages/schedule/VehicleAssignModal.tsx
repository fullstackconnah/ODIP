import React, { useState } from 'react'
import { Truck, X } from 'lucide-react'
import { Dropdown } from '@/components/Dropdown'
import { formatDate } from './helpers'
import type { ScheduleVehicleDto, ScheduleTripDto, ScheduleStaffDto, CreateVehicleAssignmentDto } from '@/api/types'

interface VehicleAssignModalProps {
  vehicle: ScheduleVehicleDto
  trip: ScheduleTripDto
  staff: ScheduleStaffDto[]
  onClose: () => void
  onAssign: (data: CreateVehicleAssignmentDto) => void
  isLoading: boolean
}

export default function VehicleAssignModal({ vehicle, trip, staff, onClose, onAssign, isLoading }: VehicleAssignModalProps) {
  const [driverStaffId, setDriverStaffId] = useState('')
  const [comments, setComments] = useState('')

  const eligibleDrivers = staff?.filter((s: ScheduleStaffDto) => s.isDriverEligible) || []

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onAssign({
      tripInstanceId: trip.id,
      vehicleId: vehicle.id,
      driverStaffId: driverStaffId || undefined,
      seatRequirement: undefined,
      wheelchairPositionRequirement: undefined,
      comments: comments || undefined,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-6" style={{ borderBottom: '1px solid rgba(195,201,181,0.25)' }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[var(--color-secondary-container)]/60 flex items-center justify-center">
              <Truck className="w-4 h-4 text-[var(--color-secondary)]" />
            </div>
            <h3 className="font-display font-bold text-base">Assign Vehicle</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-[var(--color-surface-container)] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="bg-[var(--color-surface-container-low)] rounded-[1rem] p-4 space-y-1">
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
              className="w-full px-4 py-2.5 rounded-[1rem] bg-[var(--color-surface-container-low)] border-none text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 resize-none"
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-full bg-[var(--color-surface-container)] text-sm font-semibold hover:bg-[var(--color-surface-container-high)] transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={isLoading}
              className="flex-1 px-4 py-2.5 rounded-full bg-gradient-to-r from-[#396200] to-[#4d7c0f] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
              {isLoading ? 'Assigning...' : 'Assign Vehicle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
