import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ShiftSlideOverProps } from './ShiftSlideOver'
import { PersonWeekPanel } from './PersonWeekPanel'

const { mockUseStaff, mockUseParticipants } = vi.hoisted(() => ({ mockUseStaff: vi.fn(), mockUseParticipants: vi.fn() }))
vi.mock('@/api/hooks', () => ({ useStaff: mockUseStaff, useParticipants: mockUseParticipants }))
vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ canWrite: true }) }))

// The panel's job is the lists it hands the shift form, so the form itself is a stub that shows what it was given.
vi.mock('./ShiftSlideOver', () => ({
  ShiftSlideOver: (p: ShiftSlideOverProps) => (
    <div>
      <p>staff: {p.staffOptions.map(o => o.label).join(',')}</p>
      <p>participants: {p.participantOptions.map(o => o.label).join(',')}</p>
      {p.participantsNote && <p>{p.participantsNote}</p>}
      {p.loadFailed?.staff && <button onClick={p.loadFailed.staff}>retry staff</button>}
      {p.loadFailed?.participants && <button onClick={p.loadFailed.participants}>retry participants</button>}
    </div>
  ),
}))

const ok = (data: unknown[]) => ({ data, isError: false, refetch: vi.fn() })

beforeEach(() => {
  mockUseStaff.mockReset().mockReturnValue(ok([{ id: 's1', fullName: 'Sam Lee' }]))
  mockUseParticipants.mockReset().mockReturnValue(ok([{ id: 'p1', fullName: 'Mia Chen' }]))
})

describe('PersonWeekPanel', () => {
  it('hands the form both lists and no failure when they loaded', () => {
    render(<PersonWeekPanel kind="staff" target={{ mode: 'create' }} onClose={vi.fn()} />)
    expect(screen.getByText('staff: Sam Lee')).toBeInTheDocument()
    expect(screen.getByText('participants: Mia Chen')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /retry/ })).not.toBeInTheDocument()
  })

  it('hands the form a retry for each list that failed to load', () => {
    const staff = { data: undefined, isError: true, refetch: vi.fn() }
    mockUseStaff.mockReturnValue(staff)
    mockUseParticipants.mockReturnValue({ data: undefined, isError: true, refetch: vi.fn() })
    render(<PersonWeekPanel kind="staff" target={{ mode: 'create' }} onClose={vi.fn()} />)
    screen.getByRole('button', { name: 'retry staff' }).click()
    expect(staff.refetch).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'retry participants' })).toBeInTheDocument()
  })
  it('hands the form the cut note when the server cut the participant list, and none for a whole one', () => {
    const cut = Object.assign([{ id: 'p1', fullName: 'Mia Chen' }], { totalCount: 250, isTruncated: true })
    mockUseParticipants.mockReturnValue(ok(cut))
    const { unmount } = render(<PersonWeekPanel kind="staff" target={{ mode: 'create' }} onClose={vi.fn()} />)
    expect(screen.getByText('Showing the first 1 of 250 participants.')).toBeInTheDocument()
    unmount()
    mockUseParticipants.mockReturnValue(ok([{ id: 'p1', fullName: 'Mia Chen' }]))
    render(<PersonWeekPanel kind="staff" target={{ mode: 'create' }} onClose={vi.fn()} />)
    expect(screen.queryByText(/showing the first/i)).not.toBeInTheDocument()
  })
})
