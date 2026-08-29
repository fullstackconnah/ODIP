import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
    render(<MedicationsPage />)

    expect(screen.getByRole('button', { name: 'Administration' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Register' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Report' })).not.toBeInTheDocument()
  })

  it('is shown for a Coordinator (matches the backend Admin/Coordinator/SuperAdmin gate)', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    render(<MedicationsPage />)

    expect(screen.getByRole('button', { name: 'Report' })).toBeInTheDocument()
  })
})
