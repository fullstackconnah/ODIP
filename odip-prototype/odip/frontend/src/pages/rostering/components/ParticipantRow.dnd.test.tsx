import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ParticipantRow } from './ParticipantRow'
import { makeParticipantRow, makeShift, WEEK_DAYS } from '../test-fixtures'

const { droppables, draggables } = vi.hoisted(() => ({ droppables: [] as unknown[], draggables: [] as unknown[] }))

vi.mock('@dnd-kit/core', async importOriginal => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  return {
    ...actual,
    useDroppable: (args: Parameters<typeof actual.useDroppable>[0]) => { droppables.push(args); return actual.useDroppable(args) },
    useDraggable: (args: Parameters<typeof actual.useDraggable>[0]) => { draggables.push(args); return actual.useDraggable(args) },
  }
})

function renderRow(draggable: boolean) {
  droppables.length = 0
  draggables.length = 0
  const shift = makeShift({ id: 'mon', participantId: 'p-1', serviceDate: WEEK_DAYS[0], staffId: 'staff-2', staffName: 'Sam Wilson', status: 'Draft' })
  render(
    <MemoryRouter>
      <ParticipantRow
        row={makeParticipantRow({ participantId: 'p-1', fullName: 'Mia Chen', shifts: [shift] })}
        days={WEEK_DAYS} canWrite draggable={draggable} hideCoverageBadge={false}
        onOpen={vi.fn()} onAssignTo={vi.fn()} onUnassign={vi.fn()} onDelete={vi.fn()} onAddShift={vi.fn()}
      />
    </MemoryRouter>,
  )
  return shift
}

describe('ParticipantRow drop targets (roster drag and drop)', () => {
  it('makes each EMPTY day a drop target naming the participant and the day, and each puck one carrying its shift', () => {
    const shift = renderRow(true)
    expect(droppables).toContainEqual({ id: 'drop-day:p-1:2026-08-18', data: { kind: 'day', participantId: 'p-1', participantName: 'Mia Chen', day: '2026-08-18' }, disabled: false })
    // A day that has pucks is a target too, through its new-shift slot, which exists only while a person is carried (spec 2026-10-15, decision D).
    expect(droppables).toContainEqual({ id: 'drop-day:p-1:2026-08-17', data: { kind: 'day', participantId: 'p-1', participantName: 'Mia Chen', day: '2026-08-17', beside: 1 }, disabled: false })
    expect(droppables).toContainEqual({ id: 'drop-shift:mon', data: { kind: 'shift', shift }, disabled: false })
    expect(draggables).toContainEqual({ id: 'shift:mon', data: { staffId: 'staff-2', staffName: 'Sam Wilson', fromShift: shift }, disabled: false })
  })

  it('offers no drop target and no grip without draggable (phones, read-only)', () => {
    renderRow(false)
    expect(droppables.every(d => (d as { disabled: boolean }).disabled)).toBe(true)
    expect(screen.queryByRole('button', { name: /drag to move/i })).not.toBeInTheDocument()
  })
})
