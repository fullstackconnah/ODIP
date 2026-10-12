import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import VehiclesTab from './VehiclesTab'
import type { VehicleAssignmentDto } from '@/api/types/vehicles'

vi.mock('@/components/AddVehicleModal', () => ({ default: () => null }))

// Q4/V-A follow-up: one wheelchair wording across Vehicles and the trip tabs, "N wheelchair positions", not an icon and a bare number.
describe('VehiclesTab — wheelchair wording', () => {
  it('spells the positions out', () => {
    const vehicles = [
      { id: 'va1', vehicleId: 'v1', vehicleName: 'Big Red', registration: 'ABC123', status: 'Confirmed', seatRequirement: 8, wheelchairPositionRequirement: 2 },
      { id: 'va2', vehicleId: 'v2', vehicleName: 'Car', registration: 'XYZ', status: 'Confirmed', seatRequirement: 4, wheelchairPositionRequirement: 0 },
    ] as unknown as VehicleAssignmentDto[]
    render(<VehiclesTab tripId="trip-1" vehicles={vehicles} staff={[]} canWrite={false} />)

    expect(screen.getByText('ABC123 · 8 seats · 2 wheelchair positions')).toBeInTheDocument()
    expect(screen.getByText('XYZ · 4 seats')).toBeInTheDocument()
  })
})
