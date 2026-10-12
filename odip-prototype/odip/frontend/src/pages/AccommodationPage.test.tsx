import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AccommodationPage from './AccommodationPage'

const { mockUseAccommodation, mockUsePermissions, mockRestore, mockDelete } = vi.hoisted(() => ({
  mockRestore: vi.fn(),
  mockDelete: vi.fn(),
  mockUseAccommodation: vi.fn(),
  mockUsePermissions: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useAccommodation: mockUseAccommodation,
  useDeleteAccommodation: () => ({ mutateAsync: mockDelete, isPending: false }),
  useRestoreAccommodation: () => ({ mutateAsync: mockRestore, isPending: false }),
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
  mockRestore.mockReset().mockResolvedValue({})
  mockDelete.mockReset().mockResolvedValue({})
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

describe('AccommodationPage — card grid', () => {
  it('collapses to one column on a phone through a min(22rem,100%) track floor, and stretches the cards in a row to one height', () => {
    mockUseAccommodation.mockReturnValue({ data: [makeProperty()], isLoading: false })
    renderPage()

    // jsdom has no layout, so the class is the only observable proof: a bare minmax(22rem,1fr)
    // floor (352px) overflows a 320-360px phone viewport. A wrapped title made one card taller than its row: no items-start.
    const grid = screen.getByRole('link', { name: 'Sunrise House' }).closest('.grid')!
    expect(grid).toHaveClass('grid-cols-[repeat(auto-fill,minmax(min(22rem,100%),1fr))]')
    expect(grid).not.toHaveClass('items-start')
  })
})

describe('AccommodationPage — empty states (PP-94)', () => {
  it('shows a "no properties yet" empty state when the list is genuinely empty', () => {
    mockUseAccommodation.mockReturnValue({ data: [], isLoading: false })
    renderPage()

    expect(screen.getByText(/no properties yet/i)).toBeInTheDocument()
  })
})

// Density polish (touch): the card's title link was a 24px target. It is a standalone link on the card's header line, so
// it takes the --tap-min floor (inline-flex + centring under `pointer: coarse` only, so a mouse sees the same link).
describe('AccommodationPage — card title link touch target', () => {
  it('floors the property-name link at --tap-min and keeps its destination', () => {
    mockUseAccommodation.mockReturnValue({ data: [makeProperty()], isLoading: false })
    renderPage()

    const title = screen.getAllByRole('link', { name: 'Sunrise House' })[0]
    expect(title).toHaveAttribute('href', '/accommodation/acc-1')
    expect(title).toHaveClass('pointer-coarse:inline-flex', 'min-h-[var(--tap-min)]', 'pointer-coarse:items-center', 'font-semibold', 'hover:underline')
  })
})

describe('AccommodationPage — write controls by role', () => {
  it('offers a role that cannot write no Archive on the card', () => {
    mockUsePermissions.mockReturnValue({ canWrite: false })
    mockUseAccommodation.mockReturnValue({ data: [makeProperty()], isLoading: false })
    renderPage()

    expect(screen.getByText('Sunrise House')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
  })
})

describe('AccommodationPage — Restore changes only the archived state (TRIPS-2)', () => {
  it('restores through the restore endpoint by id, never a PUT of the list row', () => {
    mockUseAccommodation.mockReturnValue({ data: [makeProperty({ isActive: false })], isLoading: false })
    renderPage()
    fireEvent.click(screen.getByRole('radio', { name: 'Archived' }))
    fireEvent.click(screen.getByRole('button', { name: /Restore/ }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Restore' }))

    expect(mockRestore).toHaveBeenCalledWith('acc-1')
  })
})

// V4: one card pattern with Vehicles: labelled Buttons instead of a bare trash icon, and no pill that only repeats the tab.
describe('AccommodationPage — card pattern', () => {
  it('offers labelled Edit and Archive and no Active pill on the Active tab', () => {
    mockUseAccommodation.mockReturnValue({ data: [makeProperty()], isLoading: false })
    renderPage()

    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/accommodation/acc-1/edit')
    expect(screen.getByRole('button', { name: 'Archive' })).toHaveTextContent('Archive')
    expect(screen.getAllByText('Active')).toHaveLength(1) // the tab, not a pill on the card
  })
})

// Q4a follow-up: the confirm only closed on success, so a refusal left it open and said nothing.
describe('AccommodationPage — a refused archive or restore', () => {
  it('closes the confirm and shows the server message', async () => {
    mockDelete.mockRejectedValue({ response: { data: { message: 'Property has upcoming reservations.' } } })
    mockUseAccommodation.mockReturnValue({ data: [makeProperty()], isLoading: false })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Archive' }))

    expect(await screen.findByText('Property has upcoming reservations.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('closes the confirm on a refused restore too, with a fallback message', async () => {
    mockRestore.mockRejectedValue(new Error('network'))
    mockUseAccommodation.mockReturnValue({ data: [makeProperty({ isActive: false })], isLoading: false })
    renderPage()
    fireEvent.click(screen.getByRole('radio', { name: 'Archived' }))
    fireEvent.click(screen.getByRole('button', { name: /Restore/ }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Restore' }))

    expect(await screen.findByText('Could not restore "Sunrise House". Please try again.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })
})
