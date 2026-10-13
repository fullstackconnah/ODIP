import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import StaffNewRoute from './StaffNewRoute'

const { providerSettings } = vi.hoisted(() => ({ providerSettings: { current: { data: undefined as { employmentHeroConnected?: boolean } | undefined, isLoading: false } } }))
vi.mock('@/api/hooks', () => ({ useProviderSettings: () => providerSettings.current }))
vi.mock('./StaffCreatePage', () => ({ default: () => <p>Staff form</p> }))

afterEach(() => { providerSettings.current = { data: undefined, isLoading: false } })

describe('/staff/new', () => {
  it('shows the staff form when the organisation is not connected', () => {
    render(<MemoryRouter><StaffNewRoute /></MemoryRouter>)
    expect(screen.getByText('Staff form')).toBeInTheDocument()
  })

  it('says where staff come from, with the way back, when the organisation is connected', () => {
    providerSettings.current = { data: { employmentHeroConnected: true }, isLoading: false }
    render(<MemoryRouter><StaffNewRoute /></MemoryRouter>)
    expect(screen.queryByText('Staff form')).toBeNull()
    expect(screen.getByText('Staff come from Employment Hero for this organisation. Add them there; they appear here within 30 minutes.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to staff' })).toHaveAttribute('href', '/staff')
  })
})
