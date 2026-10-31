import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { IncidentTrendDto } from '@/api/types'
import { IncidentTrendCard } from './IncidentTrendCard'

const { mockUseIncidentTrend } = vi.hoisted(() => ({ mockUseIncidentTrend: vi.fn() }))
vi.mock('@/api/hooks', () => ({ useIncidentTrend: mockUseIncidentTrend }))

const counts: Array<[number, number]> = [[2, 0], [0, 0], [3, 1], [2, 0], [4, 1], [2, 2]]
const TREND: IncidentTrendDto = {
  today: '2026-10-15',
  months: counts.map(([incidents, rpUses], i) => ({ month: `2026-${String(5 + i).padStart(2, '0')}`, incidents, rpUses, otherIncidents: incidents - rpUses })),
}
const ok = (data: IncidentTrendDto = TREND, extra = {}) => mockUseIncidentTrend.mockReturnValue({ data, isLoading: false, isError: false, error: null, refetch: vi.fn(), ...extra })

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
beforeEach(() => { width = 700; window.localStorage.clear(); mockUseIncidentTrend.mockReset(); ok() })
afterEach(() => vi.restoreAllMocks())

const plot = () => screen.getByRole('group', { name: /Incidents in each of the last 6 months/ })
const live = () => document.querySelector('[role="status"][aria-live], [aria-live]')?.textContent

describe('IncidentTrendCard', () => {
  it('loading: busy, with a status and no chart', () => {
    mockUseIncidentTrend.mockReturnValue({ data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn() })
    const { container } = render(<IncidentTrendCard />)
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Loading incidents by month…')
    expect(document.querySelector('[data-trend-month]')).toBeNull()
  })

  it('error: the retry callout, Try again refetches, and there is no toggle', async () => {
    const refetch = vi.fn()
    mockUseIncidentTrend.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error('x'), refetch })
    render(<IncidentTrendCard />)
    expect(screen.getByText("Couldn't load incidents by month. The list below is unaffected.")).toBeTruthy()
    expect(screen.queryByRole('button', { name: /chart/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(refetch).toHaveBeenCalled()
  })

  it('a failed refresh keeps the chart and says it may be out of date', () => {
    ok(TREND, { isError: true })
    render(<IncidentTrendCard />)
    expect(screen.getByText("The chart couldn't be refreshed, so it may be out of date.")).toBeTruthy()
    expect(document.querySelectorAll('[data-trend-month]')).toHaveLength(6)
  })

  it('all six months empty: the sentence alone, no toggle, legend or chart', () => {
    ok({ today: '2026-10-15', months: TREND.months.map(m => ({ ...m, incidents: 0, rpUses: 0, otherIncidents: 0 })) })
    render(<IncidentTrendCard />)
    expect(screen.getByText('No incidents have been reported since May.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /chart/ })).toBeNull()
    expect(document.querySelector('[data-legend]')).toBeNull()
    expect(document.querySelector('[data-trend-month]')).toBeNull()
  })

  it('starts collapsed on a phone and expanded when wide; a stored choice wins either way', () => {
    width = 390
    const phone = render(<IncidentTrendCard />)
    expect(screen.getByRole('button', { name: 'Show chart' }).getAttribute('aria-expanded')).toBe('false')
    phone.unmount()
    window.localStorage.setItem('odip.incidents.trendHidden', '0')
    const stored = render(<IncidentTrendCard />)
    expect(screen.getByRole('button', { name: 'Hide chart' }).getAttribute('aria-expanded')).toBe('true')
    stored.unmount()
    width = 700
    window.localStorage.setItem('odip.incidents.trendHidden', '1')
    render(<IncidentTrendCard />)
    expect(screen.getByRole('button', { name: 'Show chart' })).toBeTruthy()
  })

  it('Hide chart hides the body, remembers it, and keeps the sentence; storage failing falls back to the width', async () => {
    render(<IncidentTrendCard />)
    expect(screen.getByRole('button', { name: 'Hide chart' }).getAttribute('aria-expanded')).toBe('true')
    await userEvent.click(screen.getByRole('button', { name: 'Hide chart' }))
    expect(window.localStorage.getItem('odip.incidents.trendHidden')).toBe('1')
    const toggle = screen.getByRole('button', { name: 'Show chart' })
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)?.hasAttribute('hidden')).toBe(true)
    expect(screen.getByText(/^13 incidents since May/)).toBeTruthy()
  })

  it('keeps working when storage is unreadable or unwritable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    render(<IncidentTrendCard />)
    await userEvent.click(screen.getByRole('button', { name: 'Hide chart' }))
    expect(screen.getByRole('button', { name: 'Show chart' })).toBeTruthy()
  })

  it('draws six months, a zero marker on the empty one, and the table caption', () => {
    render(<IncidentTrendCard />)
    expect(document.querySelectorAll('[data-trend-month]')).toHaveLength(6)
    expect(document.querySelector('[data-trend-month="2026-06"] [data-zero]')).toBeTruthy()
    expect(document.querySelectorAll('[data-zero]')).toHaveLength(1)
    expect(document.querySelector('[data-legend]')).toBeTruthy()
    expect(document.querySelector('caption')?.textContent).toBe('Incidents by month, from May 2026')
  })

  it('keyboard: focus lands on this month and speaks it; the keys move; Enter, Space and click do nothing; Escape hides', async () => {
    render(<IncidentTrendCard />)
    fireEvent.focus(plot())
    expect(document.body.textContent).toContain('October 2026 so far: 2 incidents, all of them restrictive practice uses.')
    fireEvent.keyDown(plot(), { key: 'ArrowLeft' })
    expect(document.body.textContent).toContain('September 2026: 4 incidents, 1 of them a restrictive practice use.')
    fireEvent.keyDown(plot(), { key: 'Home' })
    expect(document.body.textContent).toContain('May 2026: 2 incidents, none of them restrictive practice uses.')
    fireEvent.keyDown(plot(), { key: 'End' })
    expect(document.body.textContent).toContain('October 2026 so far')
    fireEvent.keyDown(plot(), { key: 'PageUp' })
    expect(document.body.textContent).toContain('June 2026: no incidents.')

    expect(document.querySelector('[data-readout]')).toBeTruthy()
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    plot().dispatchEvent(space)
    expect(space.defaultPrevented).toBe(true)
    fireEvent.keyDown(plot(), { key: 'Enter' })
    fireEvent.click(plot())
    expect(document.querySelector('[data-readout]')).toBeTruthy()
    expect(document.querySelector('[data-readout-header]')?.textContent).toBe('June 2026')

    fireEvent.keyDown(plot(), { key: 'Escape' })
    expect(document.querySelector('[data-readout]')).toBeNull()
  })

  it('a touch tap pins the readout for the month under the finger', () => {
    render(<IncidentTrendCard />)
    vi.spyOn(plot(), 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 700, bottom: 166, width: 700, height: 166, x: 0, y: 0, toJSON: () => ({}) })
    fireEvent.pointerDown(plot(), { pointerType: 'touch', clientX: 28 + (700 - 28) / 6 * 2.5, clientY: 40 })
    fireEvent.pointerUp(plot(), { pointerType: 'touch' })
    expect(document.querySelector('[data-readout-header]')?.textContent).toBe('July 2026')
    expect(live()).toBeDefined()
  })
})
