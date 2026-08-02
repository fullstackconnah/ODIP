import type { VehicleType, VehicleAssignmentStatus } from './enums'

export interface VehicleListDto {
  id: string
  vehicleName: string
  registration: string | null
  vehicleType: VehicleType
  totalSeats: number
  wheelchairPositions: number
  isInternal: boolean
  isActive: boolean
  serviceDueDate: string | null
  registrationDueDate: string | null
}

export interface VehicleDetailDto extends VehicleListDto {
  rampHoistDetails: string | null
  driverRequirements: string | null
  notes: string | null
}

export interface CreateVehicleDto {
  vehicleName: string
  registration?: string
  vehicleType: VehicleType
  totalSeats: number
  wheelchairPositions: number
  rampHoistDetails?: string
  driverRequirements?: string
  isInternal?: boolean
  isActive?: boolean
  serviceDueDate?: string
  registrationDueDate?: string
  notes?: string
}

export type UpdateVehicleDto = CreateVehicleDto

export interface VehicleAssignmentDto {
  id: string
  tripInstanceId: string
  vehicleId: string
  vehicleName: string | null
  registration: string | null
  status: VehicleAssignmentStatus
  requestedDate: string | null
  confirmedDate: string | null
  driverStaffId: string | null
  driverName: string | null
  seatRequirement: number | null
  wheelchairPositionRequirement: number | null
  pickupTravelNotes: string | null
  comments: string | null
  hasOverlapConflict: boolean
}

export interface CreateVehicleAssignmentDto {
  tripInstanceId: string
  vehicleId: string
  driverStaffId?: string
  seatRequirement?: number
  wheelchairPositionRequirement?: number
  pickupTravelNotes?: string
  comments?: string
}

export interface UpdateVehicleAssignmentDto extends CreateVehicleAssignmentDto {
  status: VehicleAssignmentStatus
  confirmedDate?: string
}
