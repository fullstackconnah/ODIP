import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import AvailabilityEditor from './AvailabilityEditor'
import type { StaffAvailabilityDto } from '@/api/types'

const { mockUpdateMutate, mockDeleteMutate } = vi.hoisted(() => ({
  mockUpdateMutate: vi.fn(),
  mockDeleteMutate: vi.fn(),
}))

vi.mock('../../api/hooks', () => ({
  useUpdateStaffAvailability: () => ({ mutate: mockUpdateMutate, isPending: false }),
  useDeleteStaffAvailability: () => ({ mutate: mockDeleteMutate, isPending: false }),
}))

function makeAvailability(overrides: Partial<StaffAvailabilityDto> = {}): StaffAvailabilityDto {
  return {
    id: 'avail-1',
    staffId: 'staff-1',
    startDateTime: '2026-09-01T00:00:00',
    endDateTime: '2026-09-05T23:59:59',
    availabilityType: 'Unavailable',
    isRecurring: false,
    recurrenceNotes: null,
    notes: null,
    ...overrides,
  }
}

function renderEditor(availability: StaffAvailabilityDto[] = []) {
  render(
    <MemoryRouter>
      <AvailabilityEditor staffId="staff-1" staffName="Alex Rivera" availability={availability} />
    </MemoryRouter>,
  )
}

describe('AvailabilityEditor — Leave creation removed', () => {
  it('renders no "Add Leave" action', () => {
    renderEditor([makeAvailability()])
    expect(screen.queryByRole('button', { name: /add leave/i })).not.toBeInTheDocument()
  })

  it('links to /rostering/leave from the header', () => {
    renderEditor([makeAvailability()])
    expect(screen.getByRole('link', { name: /manage leave requests/i })).toHaveAttribute('href', '/rostering/leave')
  })

  it('links to /rostering/leave from the empty state', () => {
    renderEditor([])
    expect(screen.getByRole('link', { name: /leave approvals/i })).toHaveAttribute('href', '/rostering/leave')
  })

  it('still renders and lets a coordinator delete an existing legacy availability record', () => {
    renderEditor([makeAvailability()])
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(screen.getByTitle('Delete')).toBeInTheDocument()
  })
})
