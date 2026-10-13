import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import MedicationsPage from './MedicationsPage'

// Only the API layer needs mocking — MarTab is the default active tab, so its hooks must not
// throw. TabNav/permissions are exercised for real.
vi.mock('@/api/hooks', () => ({
  useMar: () => ({ data: undefined, isLoading: false }),
  useParticipants: () => ({ data: [] }),
  useRecordPrnOutcome: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMedicationRegister: () => ({ data: [], isLoading: false }),
  useAdministrationsReport: () => ({ data: undefined, isLoading: false }),
}))

afterEach(() => {
  localStorage.clear()
})

describe('MedicationsPage — Report tab visibility', () => {
  it('is hidden for a SupportWorker (the report endpoint 403s for that role)', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'SupportWorker' }))
    render(<MemoryRouter><MedicationsPage /></MemoryRouter>)

    expect(screen.getByRole('tab', { name: 'Administration' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Register' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Report' })).not.toBeInTheDocument()
  })

  it('is shown for a Coordinator (matches the backend Admin/Coordinator/SuperAdmin gate)', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    render(<MemoryRouter><MedicationsPage /></MemoryRouter>)

    expect(screen.getByRole('tab', { name: 'Report' })).toBeInTheDocument()
  })
})

// NAV F7: the medication form returns to the page it was opened from; the register is a tab, so it must live in the URL to be returned to.
describe('MedicationsPage — the tab lives in the URL', () => {
  it('opens on the tab ?tab= names', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    render(<MemoryRouter initialEntries={['/medications?tab=register']}><MedicationsPage /></MemoryRouter>)

    expect(screen.getByRole('tab', { name: 'Register' })).toHaveAttribute('aria-selected', 'true')
  })
})
