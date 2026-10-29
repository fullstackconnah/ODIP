import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ShiftDto } from '@/api/types'
import { makeShift } from '../test-fixtures'
import { PersonWeekGrid, type PersonWeekGridProps } from './PersonWeekGrid'

const DAYS = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']
const at = (id: string, start: string, end: string, extra: Partial<ShiftDto> = {}) =>
  makeShift({ id, serviceDate: '2026-11-03', startTime: `${start}:00`, endTime: `${end}:00`, ...extra })

function setup(over: Partial<PersonWeekGridProps> = {}) {
  const props: PersonWeekGridProps = {
    kind: 'staff', personId: 's1', weekStart: '2026-11-02', days: DAYS, shifts: [], prevWeekShifts: [], bars: [], renderBar: () => null,
    width: 1000, ready: true, canWrite: true, DayHeading: 'h4', onOpen: vi.fn(), onAddAt: vi.fn(), ...over,
  }
  const view = render(<MemoryRouter><PersonWeekGrid {...props} /></MemoryRouter>)
  return { props, ...view }
}

afterEach(() => vi.restoreAllMocks())

describe('PersonWeekGrid', () => {
  it('seven columns with gutter labels 1am-11pm and no 12am', () => {
    setup()
    expect(document.querySelectorAll('[data-day]')).toHaveLength(7)
    expect(screen.getByRole('region', { name: 'Shifts by hour' })).toBeInTheDocument()
    const labels = Array.from(document.querySelectorAll('.tabular-nums.-translate-y-1\\/2')).map(n => n.textContent)
    expect(labels).toHaveLength(23)
    expect(labels[0]).toBe('1am')
    expect(labels[22]).toBe('11pm')
    expect(labels).not.toContain('12am')
  })

  it("a block's top/height styles come from packDay", () => {
    setup({ shifts: [at('a', '09:00', '17:00')] })
    const block = document.querySelector<HTMLElement>('[data-shift-open="a"]')!
    expect(block.style.top).toBe('432px')
    expect(block.style.height).toBe('384px')
  })

  it('a slot click calls onAddAt with the half-hour, and focuses the scroller first', async () => {
    const { props } = setup()
    await userEvent.click(document.querySelector('[data-day="2026-11-05"] [data-minute="570"]')!)
    expect(props.onAddAt).toHaveBeenCalledWith('2026-11-05', 570)
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Shifts by hour' }))
  })

  it('!canWrite renders no slot layer', () => {
    setup({ canWrite: false })
    expect(document.querySelector('[data-minute]')).toBeNull()
  })

  it('the coarse pointer floors a 15-minute block at 44px', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(pointer: coarse)', addEventListener: () => {}, removeEventListener: () => {} }))
    setup({ shifts: [at('a', '09:00', '09:15')] })
    expect(document.querySelector<HTMLElement>('[data-shift-open="a"]')!.style.height).toBe('44px')
    vi.unstubAllGlobals()
  })

  it('the +n tile lists the hidden shifts and opens the chosen one', async () => {
    const shifts = [at('a', '09:00', '11:00'), at('b', '09:30', '11:00'), at('c', '10:00', '11:00', { participantName: 'Zed Last' })]
    const { props } = setup({ shifts, width: 672 })
    expect(document.querySelectorAll('[data-shift-open]')).toHaveLength(1)
    const tile = screen.getByRole('button', { name: '2 more shifts from 9:30am' })
    expect(tile).toHaveTextContent('+2')
    expect(tile.className).toContain('flex-1')
    await userEvent.click(tile)
    await userEvent.click(await screen.findByText(/10am–11am, Zed Last/))
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'c' }))
  })

  it("the +n tile resolves a previous Sunday's tail among the hidden", async () => {
    const tail = at('t', '22:00', '01:00', { serviceDate: '2026-11-01', endsNextDay: true })
    const shifts = [
      at('a', '00:00', '02:00', { serviceDate: '2026-11-02' }),
      at('b', '00:00', '02:00', { serviceDate: '2026-11-02' }),
    ]
    const { props } = setup({ shifts, prevWeekShifts: [tail], width: 672 })
    await userEvent.click(screen.getByRole('button', { name: /more shifts from 12am/ }))
    await userEvent.click(await screen.findByText(/10pm–1am/))
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 't' }))
  })

  it('the scroller sets scrollTop once and not again on a new shifts array for the same week', () => {
    const set = vi.spyOn(Element.prototype, 'scrollTop', 'set')
    const view = setup({ shifts: [at('a', '09:00', '10:00')] })
    const after = set.mock.calls.length
    expect(after).toBeGreaterThan(0)
    expect(set).toHaveBeenLastCalledWith(384)
    view.rerender(<MemoryRouter><PersonWeekGrid {...view.props} shifts={[at('a', '09:00', '10:00'), at('b', '06:00', '07:00')]} /></MemoryRouter>)
    expect(set.mock.calls.length).toBe(after)
  })

  it('under 672px it is a one-day view: seven tabs, arrows move, only that day shows', async () => {
    setup({ width: 390, shifts: [at('a', '09:00', '10:00'), at('b', '09:00', '10:00', { serviceDate: '2026-11-04' })] })
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(7)
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(document.querySelectorAll('[data-day]')).toHaveLength(1)
    expect(tabs[1].getAttribute('aria-label')).toBe('Tuesday 3 November, 1 shift')
    tabs[0].focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
    expect(document.querySelector('[data-day="2026-11-03"]')).not.toBeNull()
    expect(document.querySelector('[data-shift-open="a"]')).not.toBeNull()
    expect(screen.getByRole('region', { name: 'Shifts on Tuesday 3 November' })).toBeInTheDocument()
    await userEvent.keyboard('{End}')
    expect(tabs[6]).toHaveAttribute('aria-selected', 'true')
    const panel = within(screen.getByRole('tabpanel'))
    expect(panel.queryAllByRole('button')).toHaveLength(0)
  })
})
