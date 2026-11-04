import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ServiceLocationsSection from './ServiceLocationsSection'

const { create, update, archive, perms, query } = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  perms: { current: { isSuperAdmin: false, isAdmin: true, isCoordinator: false } },
  query: { current: {} as Record<string, unknown> },
}))

vi.mock('@/api/hooks', () => ({
  useServiceLocations: () => query.current,
  useCreateServiceLocation: () => ({ mutateAsync: create, isPending: false }),
  useUpdateServiceLocation: () => ({ mutateAsync: update, isPending: false }),
  useArchiveServiceLocation: () => ({ mutateAsync: archive, isPending: false }),
  useProviderSettings: () => ({ data: { timeZoneId: 'Australia/Sydney' } }),
}))
vi.mock('@/lib/permissions', () => ({ usePermissions: () => perms.current }))

const hub = { id: 'p1', name: 'Southside hub', address: '12 Park Rd', latitude: -33.9, longitude: 151.2, radiusMetres: 200, timeZoneId: null, isActive: true }
const perth = { id: 'p2', name: 'Perth office', address: null, latitude: -31.95, longitude: 115.86, radiusMetres: 300, timeZoneId: 'Australia/Perth', isActive: true }
const old = { id: 'p3', name: 'Old depot', address: null, latitude: -33.8, longitude: 151.1, radiusMetres: 100, timeZoneId: null, isActive: false }
const loaded = (data: unknown[]) => ({ data, isLoading: false, isError: false, refetch: vi.fn() })

function setSecure(value: boolean) {
  Object.defineProperty(window, 'isSecureContext', { value, configurable: true })
}

beforeEach(() => {
  create.mockReset().mockResolvedValue({})
  update.mockReset().mockResolvedValue({})
  archive.mockReset().mockResolvedValue({})
  perms.current = { isSuperAdmin: false, isAdmin: true, isCoordinator: false }
  query.current = loaded([hub, perth, old])
  setSecure(true)
  Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: vi.fn() }, configurable: true })
})
afterEach(() => { Reflect.deleteProperty(window, 'isSecureContext') })

async function openAdd(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Add a place' }))
}

describe('ServiceLocationsSection', () => {
  it('says how to start when there are no places', () => {
    query.current = loaded([])
    render(<ServiceLocationsSection />)
    expect(screen.getByText(/No service locations yet/)).toBeInTheDocument()
  })

  it('lists active places, then archived ones with no actions', () => {
    render(<ServiceLocationsSection />)
    expect(screen.getByText('Southside hub')).toBeInTheDocument()
    expect(screen.getByText('12 Park Rd')).toBeInTheDocument()
    expect(screen.getAllByText('Same as your organisation')).toHaveLength(2)
    expect(screen.getByText('Perth (WA)')).toBeInTheDocument()
    const archived = screen.getByRole('heading', { name: 'Archived' }).closest('section')!
    expect(within(archived).getByText('Old depot')).toBeInTheDocument()
    expect(within(archived).queryByRole('button')).toBeNull()
  })

  it('adds a place with its pin, distance and organisation zone', async () => {
    const user = userEvent.setup()
    render(<ServiceLocationsSection />)
    await openAdd(user)
    await user.type(screen.getByLabelText(/^Name/), '  North hub ')
    await user.type(screen.getByLabelText(/^Map pin/), '-33.8688, 151.2093')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(create).toHaveBeenCalledWith({ name: 'North hub', address: null, latitude: -33.8688, longitude: 151.2093, radiusMetres: 200, timeZoneId: null })
    expect(screen.queryByLabelText(/^Map pin/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Add a place' })).toHaveFocus()
  })

  it('names the organisation zone in the first time zone option', async () => {
    const user = userEvent.setup()
    render(<ServiceLocationsSection />)
    await openAdd(user)
    expect(screen.getByRole('option', { name: 'Same as your organisation (Sydney (NSW, ACT))' })).toBeInTheDocument()
  })

  it('refuses a blank name, a bad pin and a distance outside 50 to 2000, and sends nothing', async () => {
    const user = userEvent.setup()
    render(<ServiceLocationsSection />)
    await openAdd(user)
    await user.type(screen.getByLabelText(/^Map pin/), '95, 10')
    await user.clear(screen.getByLabelText(/^Check-in distance/))
    await user.type(screen.getByLabelText(/^Check-in distance/), '10')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(create).not.toHaveBeenCalled()
    expect(screen.getByText('Enter a name.')).toBeInTheDocument()
    expect(screen.getByText('Latitude must be between -90 and 90.')).toBeInTheDocument()
    expect(screen.getByText('Use a check-in distance from 50 to 2000 metres.')).toBeInTheDocument()
  })

  it('shows the server sentence on a 409 and keeps the form open', async () => {
    create.mockRejectedValue({ isAxiosError: true, response: { status: 409, data: { success: false, errors: ['That place is already on the list.'], message: 'That place is already on the list.' } } })
    const user = userEvent.setup()
    render(<ServiceLocationsSection />)
    await openAdd(user)
    await user.type(screen.getByLabelText(/^Name/), 'Southside hub')
    await user.type(screen.getByLabelText(/^Map pin/), '-33.9 151.2')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('That place is already on the list.')).toBeInTheDocument()
    expect(screen.getByLabelText(/^Name/)).toHaveValue('Southside hub')
  })

  it('edits a place and sends its zone', async () => {
    const user = userEvent.setup()
    render(<ServiceLocationsSection />)
    await user.click(screen.getByRole('button', { name: 'Edit: Perth office' }))
    expect(screen.getByLabelText(/^Map pin/)).toHaveValue('-31.95, 115.86')
    expect(screen.getByLabelText('Time zone')).toHaveValue('Australia/Perth')
    await user.clear(screen.getByLabelText(/^Check-in distance/))
    await user.type(screen.getByLabelText(/^Check-in distance/), '500')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(update).toHaveBeenCalledWith({ id: 'p2', data: { name: 'Perth office', address: null, latitude: -31.95, longitude: 115.86, radiusMetres: 500, timeZoneId: 'Australia/Perth' } })
  })

  it('archives only after the confirm, and says shifts keep the place', async () => {
    const user = userEvent.setup()
    render(<ServiceLocationsSection />)
    await user.click(screen.getByRole('button', { name: 'Archive: Southside hub' }))
    expect(archive).not.toHaveBeenCalled()
    expect(screen.getByText("Archive Southside hub? Shifts already at this place keep it. You can't pick it for new shifts.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Archive' }))
    expect(archive).toHaveBeenCalledWith('p1')
  })

  it('is read-only for a role that cannot write', () => {
    perms.current = { isSuperAdmin: false, isAdmin: false, isCoordinator: false }
    render(<ServiceLocationsSection />)
    expect(screen.getByText('Only Admins and Coordinators can change this list.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add a place' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit: Southside hub' })).toBeNull()
    expect(screen.getByText('Southside hub')).toBeInTheDocument()
  })

  it('fills the pin from the device and shows its accuracy', async () => {
    const getCurrentPosition = vi.fn((ok: (p: unknown) => void) => ok({ coords: { latitude: -33.8688, longitude: 151.2093, accuracy: 12.4 } }))
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true })
    const user = userEvent.setup()
    render(<ServiceLocationsSection />)
    await openAdd(user)
    await user.click(screen.getByRole('button', { name: 'Use my current location' }))
    expect(screen.getByLabelText(/^Map pin/)).toHaveValue('-33.8688, 151.2093')
    expect(screen.getByText('Accuracy about 12 m')).toBeInTheDocument()
  })

  it('on a plain-HTTP page disables the location button and says why, leaving the pin to type', async () => {
    setSecure(false)
    const user = userEvent.setup()
    render(<ServiceLocationsSection />)
    await openAdd(user)
    expect(screen.getByRole('button', { name: 'Use my current location' })).toBeDisabled()
    expect(screen.getByText('Your browser only shares location over a secure connection. Type the pin instead.')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/^Map pin/), '-33.9, 151.2')
    expect(screen.getByLabelText(/^Map pin/)).toHaveValue('-33.9, 151.2')
  })
})
