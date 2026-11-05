import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { TripBarDto } from '@/api/types'
import { TripBar } from './TripBar'

const DAYS = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']
const bar = (staffShort: number): TripBarDto => ({
  tripInstanceId: 't1', tripCode: 'GC-1', tripName: 'Gold Coast Beach Break',
  startDate: '2026-11-03', endDate: '2026-11-05', isDriver: false, staffShort,
})
const show = (staffShort: number) => render(<MemoryRouter><TripBar tripBar={bar(staffShort)} days={DAYS} /></MemoryRouter>)

describe('TripBar staffing shortfall', () => {
  it('shows how many staff the trip is short, and says it in the link name', () => {
    show(2)
    expect(document.querySelector('[data-staff-short]')).toHaveTextContent('2 short')
    expect(screen.getByRole('link', { name: /Gold Coast Beach Break, 2 staff members short/ })).toBeInTheDocument()
  })

  it('uses the singular for one', () => {
    show(1)
    expect(document.querySelector('[data-staff-short]')).toHaveTextContent('1 short')
    expect(screen.getByRole('link', { name: /1 staff member short/ })).toBeInTheDocument()
  })

  it('renders nothing extra when nothing is short', () => {
    show(0)
    expect(document.querySelector('[data-staff-short]')).toBeNull()
    expect(screen.getByRole('link', { name: 'Gold Coast Beach Break' })).toBeInTheDocument()
  })
})
