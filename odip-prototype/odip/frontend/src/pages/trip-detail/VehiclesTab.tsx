import { useState } from 'react'
import { Plus, XCircle, AlertTriangle, Car } from 'lucide-react'
import AddVehicleModal from '@/components/AddVehicleModal'
import { getStatusColor } from '@/lib/utils'
import type { VehicleAssignmentDto } from '@/api/types/vehicles'
import type { StaffAssignmentDto } from '@/api/types/staff'

interface VehiclesTabProps {
  tripId: string
  vehicles: VehicleAssignmentDto[]
  staff: StaffAssignmentDto[]
  canWrite: boolean
}

export default function VehiclesTab({ tripId, vehicles, staff, canWrite }: VehiclesTabProps) {
  const [showAddVehicle, setShowAddVehicle] = useState(false)

  const tripDrivers = staff.filter((s: StaffAssignmentDto) => s.isDriver)
  const needed = vehicles.length
  const assigned = tripDrivers.length
  const shortfall = needed - assigned

  return (
    <div className="space-y-4">
      {/* Driver summary header */}
      <div className="flex items-center justify-between gap-4">
        {needed === 0 ? (
          <span className="text-sm text-[#43493a] italic">No vehicles assigned yet</span>
        ) : assigned === 0 ? (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-[#ffdad6]/60 text-[#ba1a1a]">
              <XCircle className="w-4 h-4" />
              <span>0 / {needed}</span>
            </div>
            <span className="text-xs text-[#43493a]">No drivers assigned to this trip yet</span>
          </div>
        ) : assigned < needed ? (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-500/10 text-amber-500">
              <AlertTriangle className="w-4 h-4" />
              <span>{assigned} / {needed} · need {shortfall} more</span>
            </div>
            <span className="text-xs text-[#43493a]">
              {tripDrivers.map((s: StaffAssignmentDto) => s.staffName).join(', ')}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-[#bbf37c]/30 text-[#396200]">
              <Car className="w-4 h-4" />
              <span>{assigned} / {needed}</span>
            </div>
            <span className="text-xs text-[#43493a]">
              {tripDrivers.map((s: StaffAssignmentDto) => s.staffName).join(', ')}
            </span>
          </div>
        )}
        {canWrite && (
          <button
            onClick={() => setShowAddVehicle(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#396200] text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" /> Add Vehicle
          </button>
        )}
      </div>

      {/* Vehicle cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {vehicles.length === 0 ? null : vehicles.map((v: VehicleAssignmentDto) => (
          <div key={v.id} className="bg-white rounded-2xl p-5">
            <div className="flex items-start justify-between">
              <div>
                <h4 className="font-semibold">{v.vehicleName}</h4>
                <p className="text-sm text-[#43493a]">{v.registration || 'No rego'}</p>
              </div>
              <div className="flex gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full ${getStatusColor(v.status)}`}>{v.status}</span>
                {v.hasOverlapConflict && <span className="badge-conflict text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1"><span className="material-symbols-outlined text-xs leading-none">warning</span> Conflict</span>}
              </div>
            </div>
            <div className="mt-3 text-sm text-[#43493a]">
              <p className="flex items-center gap-1">{v.registration || 'N/A'} · {v.seatRequirement ?? '?'} seats{v.wheelchairPositionRequirement ? <> · <span className="material-symbols-outlined text-sm leading-none">accessible</span> {v.wheelchairPositionRequirement}</> : ''}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Add Vehicle Modal */}
      {showAddVehicle && (
        <AddVehicleModal
          tripInstanceId={tripId}
          assignedVehicleIds={new Set(vehicles.map((v: VehicleAssignmentDto) => v.vehicleId))}
          onClose={() => setShowAddVehicle(false)}
        />
      )}
    </div>
  )
}
