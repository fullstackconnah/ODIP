import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import RegisterTab from './RegisterTab'

vi.mock('@/api/hooks', () => ({ useMedicationRegister: () => ({ data: [], isLoading: false }) }))
vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ canManageMedications: true }) }))

// PARTICIPANTS-1: a medication belongs to a participant, and /medications/new without one is a dead end, so the register offers no "New medication".
describe('Medication register', () => {
  it('offers no participant-less "New medication" link, and says where medications are added', () => {
    render(<MemoryRouter><RegisterTab /></MemoryRouter>)

    expect(screen.queryByRole('link', { name: /new medication/i })).toBeNull()
    expect(screen.getByText("Medications are added from a participant's Medications tab.")).toBeInTheDocument()
  })
})
