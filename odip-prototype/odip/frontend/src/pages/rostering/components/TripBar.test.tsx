import { describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
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
    expect(screen.getByRole('link', { name: /Gold Coast Beach Break\s*, 2 staff members short/ })).toBeInTheDocument()
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

describe('TripBar daily times', () => {
  const timed = (days: TripBarDto['days'], isDriver = false): TripBarDto => ({ ...bar(0), isDriver, days })
  const showTimed = (days: TripBarDto['days']) => render(<MemoryRouter><TripBar tripBar={timed(days)} days={DAYS} /></MemoryRouter>)
  const cells = () => [...document.querySelectorAll('[data-trip-day]')].map(c => c.textContent)

  it('draws no second line when no visible day has a time', () => {
    showTimed(undefined)
    expect(document.querySelector('[data-trip-day]')).toBeNull()
    cleanup()
    showTimed([{ date: '2026-11-09', start: '08:00:00', finish: null }])   // outside the bar
    expect(document.querySelector('[data-trip-day]')).toBeNull()
  })

  it('shows one cell per visible day: a range, a start only, a finish only and an empty day', () => {
    showTimed([
      { date: '2026-11-03', start: '08:00:00', finish: '17:00:00' },
      { date: '2026-11-04', start: '09:30:00', finish: null },
      { date: '2026-11-05', start: null, finish: '17:00:00' },
    ])
    expect(cells()).toEqual(['8am–5pm', 'from 9:30am', 'until 5pm'])
    cleanup()
    showTimed([{ date: '2026-11-04', start: '09:00:00', finish: '10:00:00' }])
    expect(cells()).toEqual(['', '9am–10am', ''])
  })

  it('puts the times in the title and the screen-reader name, and hides line 2 from them', () => {
    showTimed([{ date: '2026-11-03', start: '08:00:00', finish: '17:00:00' }, { date: '2026-11-04', start: '09:00:00', finish: null }])
    const link = screen.getByRole('link', { name: /Gold Coast Beach Break\s*,\s*Tuesday 8am to 5pm\s*,\s*Wednesday from 9am/ })
    expect(link).toHaveAttribute('title', 'Gold Coast Beach Break (GC-1) · Tue 8am–5pm · Wed from 9am')
    expect(document.querySelector('[data-trip-day]')?.closest('[aria-hidden="true"]')).not.toBeNull()
  })
})
