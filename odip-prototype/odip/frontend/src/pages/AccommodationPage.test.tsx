import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AccommodationPage from './AccommodationPage'

const { mockUseAccommodation, mockUsePermissions } = vi.hoisted(() => ({
  mockUseAccommodation: vi.fn(),
  mockUsePermissions: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useAccommodation: mockUseAccommodation,
  useDeleteAccommodation: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateAccommodation: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/lib/permissions', () => ({
  usePermissions: mockUsePermissions,
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <AccommodationPage />
    </MemoryRouter>
  )
}

function makeProperty(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'acc-1',
    propertyName: 'Sunrise House',
    location: 'Gold Coast',
    region: null,
    isActive: true,
    isWheelchairAccessible: false,
    isFullyModified: false,
    isSemiModified: false,
    bedCount: 2,
    bedroomCount: 1,
    maxCapacity: 4,
    ...overrides,
  }
}

beforeEach(() => {
  mockUsePermissions.mockReturnValue({ canWrite: true })
})

describe('AccommodationPage — card is not a nested interactive element (PP-68)', () => {
  it('renders the archive button outside of any <a> ancestor', () => {
    mockUseAccommodation.mockReturnValue({ data: [makeProperty()], isLoading: false })
    renderPage()

    const archiveButton = screen.getByRole('button', { name: 'Archive' })
    expect(archiveButton.closest('a')).toBeNull()
  })
})

describe('AccommodationPage — accessible names on action buttons (PP-69)', () => {
  it('gives the Archive button an accessible name', () => {
    mockUseAccommodation.mockReturnValue({ data: [makeProperty()], isLoading: false })
    renderPage()

    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument()
  })
})

describe('AccommodationPage — empty states (PP-94)', () => {
  it('shows a "no properties yet" empty state when the list is genuinely empty', () => {
    mockUseAccommodation.mockReturnValue({ data: [], isLoading: false })
    renderPage()

    expect(screen.getByText(/no properties yet/i)).toBeInTheDocument()
  })
})
