import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RosterFillDto } from '@/api/types'
import { RosterFillCard } from './RosterFillCard'

const { mockUseRosterFill } = vi.hoisted(() => ({ mockUseRosterFill: vi.fn() }))
vi.mock('@/api/hooks', () => ({ useRosterFill: mockUseRosterFill }))

const mondays = ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21']
const rows: Array<[number, number, number]> = [[22, 0, 0], [24, 6, 4], [18, 3, 0], [12, 7, 0], [9, 5, 9], [0, 0, 0], [3, 3, 3], [1, 1, 1]]
const FILL: RosterFillDto = {
  today: '2026-11-04',
  weeks: mondays.map((weekStart, i) => ({ weekStart, shifts: rows[i][0], filled: rows[i][0] - rows[i][1], open: rows[i][1], hoursFilled: (rows[i][0] - rows[i][1]) * 8, hoursOpen: rows[i][1] * 8, draft: rows[i][2] })),
}
const ok = (data: RosterFillDto = FILL, extra = {}) => mockUseRosterFill.mockReturnValue({ data, isLoading: false, isError: false, error: null, refetch: vi.fn(), ...extra })

let width = 700
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width })
  // jsdom has no PointerEvent; React listens for the native pointer events, so a MouseEvent carrying pointerType stands in.
  if (typeof window.PointerEvent === 'undefined') {
    class PointerEventStub extends MouseEvent {
      pointerType: string
      constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerType = init.pointerType ?? 'mouse' }
    }
    window.PointerEvent = PointerEventStub as unknown as typeof PointerEvent
  }
})
beforeEach(() => { width = 700; window.localStorage.clear(); mockUseRosterFill.mockReset(); ok() })
afterEach(() => vi.restoreAllMocks())

const renderCard = (boardWeek = '2026-11-09', onSelectWeek = vi.fn()) => ({ onSelectWeek, ...render(<RosterFillCard boardWeek={boardWeek} onSelectWeek={onSelectWeek} />) })
const plot = () => screen.getByRole('group', { name: /Shifts filled and open for each of the next 8 weeks/ })

describe('RosterFillCard', () => {
  it('shows the title, the honest sentence and a week slot for every week, with the board week marked once', () => {
    renderCard()
    expect(screen.getByRole('heading', { name: 'How full the next weeks are' })).toBeTruthy()
    expect(screen.getByText(/^25 of the 89 shifts in the next 8 weeks are open\. The week of 23 Nov has the most: 7 of its 12\./)).toBeTruthy()
    expect(document.querySelectorAll('[data-fill-week]')).toHaveLength(8)
    expect(document.querySelectorAll('[data-on-board]')).toHaveLength(1)
    expect(document.querySelector('[data-fill-week="2026-11-09"]')?.hasAttribute('data-on-board')).toBe(true)
    expect(document.querySelectorAll('[data-fill-empty]')).toHaveLength(1)
  })

  it('draws rows under 480px, with a detail line for the board week', () => {
    width = 390
    window.localStorage.setItem('odip.roster.fillHidden', '0')
    renderCard()
    expect(document.querySelectorAll('[data-fill-row]')).toHaveLength(8)
    expect(document.querySelector('[data-detail]')?.textContent).toContain('Week of 9 Nov: 144 hours filled, 48 open. 4 still drafts. On the board now.')
  })

  it('starts collapsed on a phone and expanded when wide; a stored choice wins either way', () => {
    width = 390
    const phone = renderCard()
    expect(screen.getByRole('button', { name: 'Show chart' }).getAttribute('aria-expanded')).toBe('false')
    phone.unmount()
    width = 700
    renderCard()
    expect(screen.getByRole('button', { name: 'Hide chart' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('Hide chart hides the body, remembers it, and keeps the sentence', async () => {
    renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Hide chart' }))
    expect(window.localStorage.getItem('odip.roster.fillHidden')).toBe('1')
    const toggle = screen.getByRole('button', { name: 'Show chart' })
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)?.hasAttribute('hidden')).toBe(true)
    expect(screen.getByText(/shifts in the next 8 weeks are open/)).toBeTruthy()
    await userEvent.click(toggle)
    expect(window.localStorage.getItem('odip.roster.fillHidden')).toBe('0')
  })

  it('keeps working when storage is unreadable or unwritable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Hide chart' }))
    expect(screen.getByRole('button', { name: 'Show chart' })).toBeTruthy()
  })

  it('loading: busy, with a status and no chart', () => {
    mockUseRosterFill.mockReturnValue({ data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn() })
    const { container } = renderCard()
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Loading how full the next weeks are…')
    expect(document.querySelector('[data-fill-week]')).toBeNull()
  })

  it('error: says the board is unaffected, has no toggle, and Try again retries', async () => {
    const refetch = vi.fn()
    mockUseRosterFill.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error('x'), refetch })
    renderCard()
    expect(screen.getByText("Couldn't load how full the next weeks are. The board below is unaffected.")).toBeTruthy()
    expect(screen.queryByRole('button', { name: /chart/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('a failed background refresh keeps the chart and says it may be out of date', () => {
    ok(FILL, { isError: true })
    renderCard()
    expect(screen.getByText("The chart couldn't be refreshed, so it may be out of date.")).toBeTruthy()
    expect(document.querySelectorAll('[data-fill-week]')).toHaveLength(8)
  })

  it('nothing rostered: one sentence, no toggle, no legend', () => {
    ok({ today: FILL.today, weeks: FILL.weeks.map(w => ({ ...w, shifts: 0, filled: 0, open: 0, draft: 0, hoursFilled: 0, hoursOpen: 0 })) })
    renderCard()
    expect(screen.getByText('Nothing is rostered for the next 8 weeks yet.')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(document.querySelector('[data-legend]')).toBeNull()
  })

  it('a mouse click on a week shows it on the board; arrows only read, Enter moves, Escape hides the readout', async () => {
    const { onSelectWeek } = renderCard()
    const p = plot()
    p.focus()
    fireEvent.keyDown(p, { key: 'ArrowRight' })
    expect(onSelectWeek).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toBe('Week of 16 Nov: 15 of 18 filled, 3 open. Press Enter to show it on the board.')
    fireEvent.keyDown(p, { key: 'Enter' })
    expect(onSelectWeek).toHaveBeenCalledWith('2026-11-16')
    expect(screen.getByRole('status').textContent).toBe('Showing the week of 16 Nov on the board.')
    fireEvent.keyDown(p, { key: 'Escape' })
    expect(document.querySelector('[data-readout]')).toBeNull()
  })

  it('on touch the first tap reads a week and only a second tap on the same week moves the board', () => {
    const { onSelectWeek } = renderCard()
    const p = plot()
    const tap = (clientX: number) => { fireEvent.pointerDown(p, { clientX, clientY: 10, pointerType: 'touch' }); fireEvent.click(p, { clientX, clientY: 10 }) }
    vi.spyOn(p, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 700, bottom: 170, width: 700, height: 170, x: 0, y: 0, toJSON: () => ({}) })
    tap(300)
    expect(onSelectWeek).not.toHaveBeenCalled()
    expect(within(document.querySelector('[data-readout]') as HTMLElement).getByText(/Tap again to show it on the board|Select to show it on the board/)).toBeTruthy()
    tap(300)
    expect(onSelectWeek).toHaveBeenCalledTimes(1)
  })

  it('has a screen-reader table with the board week named', () => {
    renderCard()
    const table = screen.getByRole('table')
    expect(within(table).getByRole('rowheader', { name: '9 Nov (on the board)' })).toBeTruthy()
    expect(within(table).getByRole('cell', { name: 'Not rostered yet' })).toBeTruthy()
  })
})
