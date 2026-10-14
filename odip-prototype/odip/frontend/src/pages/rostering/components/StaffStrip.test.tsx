import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DndContext } from '@dnd-kit/core'
import type { StaffListDto } from '@/api/types'
import { DropStateContext } from '../lib/rosterDrag'
import { CarriedPuck, StaffStrip } from './StaffStrip'

const { draggables } = vi.hoisted(() => ({ draggables: [] as unknown[] }))
vi.mock('@dnd-kit/core', async importOriginal => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  return { ...actual, useDraggable: (args: Parameters<typeof actual.useDraggable>[0]) => { draggables.push(args); return actual.useDraggable(args) } }
})

function person(overrides: Partial<StaffListDto>): StaffListDto {
  return {
    id: 's-1', firstName: 'Sam', lastName: 'Wilson', fullName: 'Sam Wilson', username: 'swilson', role: 'SupportWorker', position: 'SupportWorker',
    email: null, mobile: null, region: 'North', isDriverEligible: false, isFirstAidQualified: false, isMedicationCompetent: false,
    isManualHandlingCompetent: false, isOvernightEligible: false, isActive: true, firstAidExpiryDate: null, driverLicenceExpiryDate: null,
    manualHandlingExpiryDate: null, medicationCompetencyExpiryDate: null, workerScreeningNumber: null, workerScreeningExpiryDate: null,
    hasExpiredQualifications: false, notes: null, ...overrides,
  }
}

const STAFF = [
  person({ id: 's-1', fullName: 'Sam Wilson', region: 'North', hasExpiredQualifications: true }),
  person({ id: 's-2', fullName: 'Alex Ng', region: 'South' }),
  person({ id: 's-3', fullName: 'Old Hand', isActive: false }),
]

function renderStrip(props: Partial<React.ComponentProps<typeof StaffStrip>> = {}, disabled = false) {
  draggables.length = 0
  return render(
    <DndContext>
      <DropStateContext.Provider value={{ disabled, pending: null }}>
        <StaffStrip staff={STAFF} isLoading={false} hours={new Map([['s-1', 12], ['s-2', 40.5]])} regionOptions={[]} regionFilter="" onRegionFilterChange={vi.fn()} {...props} />
      </DropStateContext.Provider>
    </DndContext>,
  )
}

describe('StaffStrip', () => {
  it('shows every active person, in the order given, as a puck named with their hours this week', () => {
    renderStrip()
    expect(screen.getByRole('region', { name: 'Staff' })).toBeInTheDocument()
    const pucks = screen.getAllByRole('button', { name: /hours this week/ })
    expect(pucks.map(p => p.getAttribute('aria-label'))).toEqual([
      'Sam Wilson, 12 of 38 hours this week, qualifications expired',
      'Alex Ng, 40.5 of 38 hours this week',
    ])
    expect(screen.getByText('12 / 38 h')).toBeInTheDocument()
  })

  it('carries the person (no shift) when a puck is lifted, and waits while a drop is pending', () => {
    renderStrip({}, true)
    expect(draggables).toContainEqual({ id: 'staff:s-1', data: { staffId: 's-1', staffName: 'Sam Wilson' }, disabled: true })
  })

  it('finds staff by any part of the name, ignoring case, and says when nobody matches', async () => {
    const user = userEvent.setup()
    renderStrip()
    await user.type(screen.getByRole('textbox', { name: 'Find staff' }), 'NG')
    expect(screen.getAllByRole('button', { name: /hours this week/ })).toHaveLength(1)
    expect(screen.getByRole('button', { name: /^Alex Ng,/ })).toBeInTheDocument()
    await user.clear(screen.getByRole('textbox', { name: 'Find staff' }))
    await user.type(screen.getByRole('textbox', { name: 'Find staff' }), 'zz')
    expect(screen.getByText('No staff match “zz”.')).toBeInTheDocument()
  })

  it('shows only the chosen region', () => {
    renderStrip({ regionFilter: 'South' })
    expect(screen.getAllByRole('button', { name: /hours this week/ }).map(p => p.getAttribute('aria-label'))).toEqual(['Alex Ng, 40.5 of 38 hours this week'])
  })

  it('says so when nobody is active, and shows muted bars while staff load', () => {
    const { unmount } = renderStrip({ staff: [person({ isActive: false })] })
    expect(screen.getByText('No active staff.')).toBeInTheDocument()
    unmount()
    renderStrip({ isLoading: true })
    expect(screen.queryAllByRole('button', { name: /hours this week/ })).toHaveLength(0)
  })
})

describe('CarriedPuck', () => {
  it('shows the person and their hours, and no outcome line while over nothing', () => {
    render(<DndContext><CarriedPuck carry={{ staffId: 's-1', staffName: 'Sam Wilson' }} hours={12} /></DndContext>)
    expect(screen.getByText('Sam Wilson')).toBeInTheDocument()
    expect(screen.getByText('12 / 38 h')).toBeInTheDocument()
    expect(screen.queryByText(/Assign|Replace|New shift/)).not.toBeInTheDocument()
  })
})
