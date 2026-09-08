import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SchedulePage from './SchedulePage'
import type { ScheduleOverviewDto } from '@/api/types'

vi.mock('@/lib/permissions', () => ({
  usePermissions: () => ({ canWrite: true }),
}))

const overview: ScheduleOverviewDto = {
  trips: [{
    id: 'trip-1', tripName: 'Gold Coast Beach Break', tripCode: null, destination: null, region: null,
    startDate: '2026-09-10', endDate: '2026-09-12', durationDays: 3, status: 'Confirmed',
    maxParticipants: null, currentParticipantCount: 0, minStaffRequired: null, staffRequired: 1,
    staffAssignedCount: 0, vehicleAssignedCount: 0, leadCoordinatorName: null, preferenceMatchCount: 0,
  }],
  staff: [{
    id: 'staff-1', firstName: 'Alex', lastName: 'Rivera', fullName: 'Alex Rivera', role: 'SupportWorker',
    region: null, isDriverEligible: true, isFirstAidQualified: true, isMedicationCompetent: true,
    isManualHandlingCompetent: true, isOvernightEligible: true,
    tripStatuses: [{ tripId: 'trip-1', status: 'Tentative', assignmentRole: null, assignmentStatus: null, assignmentId: null }],
    availability: [], preferredForTrips: [],
  }],
  vehicles: [],
}

vi.mock('@/api/hooks', () => ({
  useScheduleOverview: () => ({ data: overview, isLoading: false, error: null }),
  useCreateStaffAssignment: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useCreateVehicleAssignment: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useDeleteStaffAssignment: () => ({ mutate: vi.fn(), isPending: false }),
}))

function renderPage() {
  const qc = new QueryClient()
  return render(<QueryClientProvider client={qc}><SchedulePage /></QueryClientProvider>)
}

describe('SchedulePage — Tentative badge for pending leave', () => {
  it('renders a Tentative badge for a staff/trip cell with pending leave', () => {
    renderPage()
    expect(screen.getByText('Tentative')).toBeInTheDocument()
  })
})
