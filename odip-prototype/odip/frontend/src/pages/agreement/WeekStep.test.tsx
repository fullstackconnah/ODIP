import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PlanDayName } from '@/api/types'
import { emptyBlock } from '@/lib/planBlocks'
import { shiftBlockOf, type Shift } from '@/lib/agreementShifts'
import { settings as makeSettings } from '@/test/fixtures/planPricing'
import { WeekStep } from './WeekStep'

const screenSize = vi.hoisted(() => ({ belowLg: true }))
vi.mock('@/hooks/useIsBelowLg', () => ({ useIsBelowLg: () => screenSize.belowLg }))

const shift = (day: PlanDayName, changes: Partial<Shift['block']> = {}, id = `s-${day}-${changes.start ?? '0900'}`): Shift => {
  return { id, day, block: { ...shiftBlockOf(emptyBlock('x', 'NSW')), onPublicHoliday: 'Charge', ...changes }, requirements: { workerGender: 'NoPreference', driver: false, skills: [] } }
}
const weekdays = () => (['Monday', 'Tuesday', 'Wednesday'] as const).map(day => shift(day))

function Harness({ initial = [], readOnly = false, flagged = [] }: { initial?: Shift[]; readOnly?: boolean; flagged?: string[] }) {
  const [shifts, setShifts] = useState(initial)
  const [selected, setSelected] = useState<string[]>([])
  return (
    <>
      <WeekStep
        shifts={shifts} onChange={setShifts} selected={selected} onSelect={setSelected} state="NSW" zone="National" settings={makeSettings()}
        flagged={new Set(flagged)} from="2026-07-01" to="2027-06-30" readOnly={readOnly} limits={{ blocks: 1, patterns: 3, exceeded: null }}
      />
      <pre data-testid="shifts">{JSON.stringify(shifts.map(s => [s.day, s.block.start, s.block.end]))}</pre>
    </>
  )
}
const shiftsOnScreen = () => JSON.parse(screen.getByTestId('shifts').textContent ?? '[]') as [string, string, string][]

describe('WeekStep', () => {
  it('starts an empty week with what to do and the common weeks to start from', () => {
    render(<Harness />)
    expect(screen.getByText('Click a day to add a shift')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start from a common week' })).toBeInTheDocument()
    expect(screen.getByText('Repeats every week from 1 Jul 2026 to 30 Jun 2027.')).toBeInTheDocument()
  })

  it('adds a shift to a day, selects it and opens the editor with what it is editing', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Add a shift on Monday' }))
    expect(shiftsOnScreen()).toEqual([['Monday', '09:00:00', '13:00:00']])
    expect(screen.getByRole('button', { name: /Monday 09:00 to 13:00 · Community access · 1:1/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('dialog', { name: 'Editing 1 shift: Mon' })).toBeInTheDocument()
  })

  it('starts the next shift from the last times and support used, and lets a day hold several', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[shift('Monday', { start: '10:00:00', end: '12:00:00' })]} />)
    await user.click(screen.getByRole('button', { name: 'Add a shift on Monday' }))
    expect(shiftsOnScreen()).toEqual([['Monday', '10:00:00', '12:00:00'], ['Monday', '10:00:00', '12:00:00']])
  })

  it('edits every selected shift at once, and says an overnight shift ends the next day', async () => {
    const user = userEvent.setup()
    render(<Harness initial={weekdays()} />)
    await user.click(screen.getByRole('button', { name: 'Select weekdays' }))
    for (const chip of screen.getAllByRole('button', { name: /09:00 to 13:00/ })) expect(chip).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Edit 3 shifts' }))
    const editor = screen.getByRole('dialog', { name: 'Editing 3 shifts: Mon, Tue, Wed' })
    fireEvent.change(within(editor).getByLabelText('Starts'), { target: { value: '22:00' } })
    fireEvent.change(within(editor).getByLabelText('Ends'), { target: { value: '06:00' } })
    expect(shiftsOnScreen()).toEqual([['Monday', '22:00:00', '06:00:00'], ['Tuesday', '22:00:00', '06:00:00'], ['Wednesday', '22:00:00', '06:00:00']])
    expect(within(editor).getByText(/Ends the next day/)).toBeInTheDocument()
  })

  it('flags two shifts on one day that overlap, and a shift the pricing flagged', () => {
    render(<Harness initial={[shift('Monday', { start: '09:00:00', end: '13:00:00' }, 'a'), shift('Monday', { start: '12:00:00', end: '15:00:00' }, 'b'), shift('Friday', {}, 'c')]} flagged={['c']} />)
    expect(screen.getByRole('button', { name: /Monday 09:00 to 13:00.*overlaps another shift/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Friday 09:00 to 13:00.*needs attention/ })).toBeInTheDocument()
  })

  it('removes the focused shift with Delete and brings it back with Undo', async () => {
    const user = userEvent.setup()
    render(<Harness initial={weekdays()} />)
    screen.getByRole('button', { name: /Tuesday 09:00/ }).focus()
    await user.keyboard('{Delete}')
    expect(shiftsOnScreen().map(s => s[0])).toEqual(['Monday', 'Wednesday'])
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(shiftsOnScreen().map(s => s[0])).toEqual(['Monday', 'Tuesday', 'Wednesday'])
  })

  it('moves between shifts with the arrow keys', async () => {
    const user = userEvent.setup()
    render(<Harness initial={weekdays()} />)
    screen.getByRole('button', { name: /Monday 09:00/ }).focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('button', { name: /Tuesday 09:00/ })).toHaveFocus()
  })

  it('adds the shifts of a common week to the week', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Start from a common week' }))
    await user.click(screen.getByRole('option', { name: /Community access weekdays/ }))
    expect(shiftsOnScreen().map(s => s[0])).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'])
  })

  it('shows the schedule and nothing to change it with when the agreement cannot be edited', () => {
    render(<Harness initial={weekdays()} readOnly />)
    expect(screen.queryByRole('button', { name: /Add a shift/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start from a common week' })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Monday 09:00 to 13:00/)).toBeInTheDocument()
  })
})

describe('WeekStep on a phone', () => {
  it('keeps a bar in view once shifts are selected, in place of the buttons at the top of the list', async () => {
    const user = userEvent.setup()
    render(<Harness initial={weekdays()} />)
    expect(screen.getByText('Tap shifts to select them')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Selected shifts' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Monday 09:00/ }))
    await user.click(screen.getByRole('button', { name: /Tuesday 09:00/ }))
    const bar = screen.getByRole('group', { name: 'Selected shifts' })
    expect(within(bar).getByText('2 selected')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Edit 2 shifts' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Clear selection' })).toHaveLength(1)
    await user.click(within(bar).getByRole('button', { name: 'Clear selection' }))
    expect(screen.queryByRole('group', { name: 'Selected shifts' })).not.toBeInTheDocument()
  })

  it('puts a pressed chip down with a tick as well as a fill', async () => {
    const user = userEvent.setup()
    render(<Harness initial={weekdays()} />)
    const chip = screen.getByRole('button', { name: /Monday 09:00/ })
    expect(chip.querySelector('svg')).toBeNull()
    await user.click(chip)
    expect(chip.querySelector('svg')).not.toBeNull()
  })

  it('Done ends the edit and puts focus back on the first shift that was selected', async () => {
    const user = userEvent.setup()
    render(<Harness initial={weekdays()} />)
    await user.click(screen.getByRole('button', { name: /Tuesday 09:00/ }))
    await user.click(screen.getByRole('button', { name: 'Edit 1 shift' }))
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByRole('button', { name: /Tuesday 09:00/ })).toHaveFocus()
    expect(screen.getByRole('button', { name: /Tuesday 09:00/ })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('WeekStep with the editor beside the grid', () => {
  const wide = () => { screenSize.belowLg = false }
  const narrow = () => { screenSize.belowLg = true }

  it('moves focus into the editor when a shift is added', async () => {
    wide()
    try {
      const user = userEvent.setup()
      render(<Harness />)
      await user.click(screen.getByRole('button', { name: 'Add a shift on Monday' }))
      expect(screen.getByRole('heading', { name: /Editing 1 shift/ })).toHaveFocus()
      expect(screen.queryByText('Tap shifts to select them')).not.toBeInTheDocument()
    } finally { narrow() }
  })

  it('Done, and Escape in the editor, hand focus back to the first selected shift and leave the editor empty', async () => {
    wide()
    try {
      const user = userEvent.setup()
      render(<Harness initial={weekdays()} />)
      await user.click(screen.getByRole('button', { name: /Tuesday 09:00/ }))
      await user.click(screen.getByRole('button', { name: /Wednesday 09:00/ }))
      await user.click(screen.getByRole('button', { name: 'Done' }))
      expect(screen.getByRole('button', { name: /Tuesday 09:00/ })).toHaveFocus()
      expect(screen.getByText(/Select one or more shifts/)).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /Monday 09:00/ }))
      await user.click(screen.getByLabelText('Starts'))
      await user.keyboard('{Escape}')
      expect(screen.getByRole('button', { name: /Monday 09:00/ })).toHaveFocus()
      expect(screen.getByText(/Select one or more shifts/)).toBeInTheDocument()
    } finally { narrow() }
  })
})
