import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PipelineDto } from '@/api/types'
import { ClaimsPipelineCard } from './ClaimsPipelineCard'

const { mockUsePipeline } = vi.hoisted(() => ({ mockUsePipeline: vi.fn() }))
vi.mock('@/api/hooks/claimHub', () => ({ useClaimPipeline: mockUsePipeline }))

const MONDAYS = ['2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']
// sent, paid, rejected, rejected lines
const money: Array<[number, number, number, number]> = [[0, 0, 0, 0], [0, 0, 0, 0], [500, 0, 0, 0], [1200.5, 300, 0, 0], [0, 900, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [2000, 0, 80, 1], [0, 1500, 0, 0], [750, 750, 120.5, 2], [0, 0, 0, 0], [300, 0, 0, 0]]
const PIPE: PipelineDto = {
  today: '2026-10-30',
  weeks: MONDAYS.map((weekStart, i) => ({ weekStart, sent: money[i][0], paid: money[i][1], rejected: money[i][2], rejectedLines: money[i][3] })),
  withNdia: 300, acceptedUnpaid: 0, undatedPaid: 0,
}
const ok = (data: PipelineDto = PIPE, extra = {}) => mockUsePipeline.mockReturnValue({ data, isLoading: false, isError: false, error: null, refetch: vi.fn(), ...extra })
const renderCard = (props: { rejectedCount?: number; onShowRejected?: () => void } = {}) => render(<ClaimsPipelineCard rejectedCount={props.rejectedCount ?? 0} onShowRejected={props.onShowRejected ?? vi.fn()} />)

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
beforeEach(() => { width = 700; window.localStorage.clear(); mockUsePipeline.mockReset(); ok() })
afterEach(() => vi.restoreAllMocks())

const plot = () => screen.getByRole('group', { name: /Dollars sent to the NDIA and paid in each of the last 12 weeks/ })
const xLabels = () => [...document.querySelectorAll('[data-xlabel]')].map(t => t.textContent)

describe('ClaimsPipelineCard', () => {
  it('loading: busy, with a status and no chart', () => {
    mockUsePipeline.mockReturnValue({ data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn() })
    const { container } = renderCard()
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Loading claims sent and paid by week…')
    expect(document.querySelector('[data-cp-week]')).toBeNull()
  })

  it('error: the retry callout, Try again refetches, and there is no toggle', async () => {
    const refetch = vi.fn()
    mockUsePipeline.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error('x'), refetch })
    renderCard()
    expect(screen.getByText("Couldn't load claims sent and paid by week. The rest of this page is unaffected.")).toBeTruthy()
    expect(screen.queryByRole('button', { name: /chart/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(refetch).toHaveBeenCalled()
  })

  it('a failed refresh keeps the chart and says it may be out of date', () => {
    ok(PIPE, { isError: true })
    renderCard()
    expect(screen.getByText("The chart couldn't be refreshed, so it may be out of date.")).toBeTruthy()
    expect(document.querySelectorAll('[data-cp-week]')).toHaveLength(12)
  })

  it('empty weeks: the sentence alone (with the owed clause), no toggle, keys or chart', () => {
    ok({ ...PIPE, weeks: PIPE.weeks.map(w => ({ ...w, sent: 0, paid: 0, rejected: 0, rejectedLines: 0 })), withNdia: 0 })
    renderCard()
    expect(screen.getByText('Nothing has been sent to the NDIA from this page in the last 12 weeks. Nothing is waiting on the NDIA.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /chart/ })).toBeNull()
    expect(document.querySelector('[data-legend]')).toBeNull()
    expect(document.querySelector('[data-cp-week]')).toBeNull()
  })

  it('normal: the sentence, 12 week groups, 2 keys, the scope line, a bar only where there are dollars, and the table', () => {
    renderCard()
    expect(screen.getByText("$4,750.50 sent to the NDIA in the last 12 weeks and $3,450.00 paid. $300.00 is waiting on the NDIA's results.")).toBeTruthy()
    expect(document.querySelectorAll('[data-cp-week]')).toHaveLength(12)
    expect(document.querySelectorAll('[data-bar="sent"]')).toHaveLength(5)
    expect(document.querySelectorAll('[data-bar="paid"]')).toHaveLength(4)
    expect(document.querySelectorAll('span[data-legend]')).toHaveLength(2)
    expect(screen.getByText(/^NDIA-managed claims sent in files from this page/)).toBeTruthy()
    expect(document.querySelectorAll('tbody tr')).toHaveLength(12)
    expect(document.querySelector('caption')?.textContent).toBe('Claims sent and paid by week, from the week of 10 August 2026')
  })

  it('x labels: every week when wide; every third from the current week, then "so far", when narrow', () => {
    const wide = renderCard()
    expect(xLabels()).toHaveLength(13)
    wide.unmount()
    width = 390
    renderCard()
    expect(xLabels()).toEqual(['24 Aug', '14 Sep', '5 Oct', '26 Oct', 'so far'])
  })

  it('the hide toggle persists, hides the chart body and keeps the sentence', async () => {
    renderCard()
    expect(screen.getByRole('button', { name: 'Hide chart' }).getAttribute('aria-expanded')).toBe('true')
    await userEvent.click(screen.getByRole('button', { name: 'Hide chart' }))
    expect(window.localStorage.getItem('odip.claims.pipelineHidden')).toBe('1')
    const toggle = screen.getByRole('button', { name: 'Show chart' })
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)?.hasAttribute('hidden')).toBe(true)
    expect(screen.getByText(/sent to the NDIA in the last 12 weeks/)).toBeTruthy()
  })

  it('keeps working when storage is unreadable or unwritable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Hide chart' }))
    expect(screen.getByRole('button', { name: 'Show chart' })).toBeTruthy()
  })

  it('the rejected link shows only when there are rejected lines, and calls onShowRejected', async () => {
    const onShowRejected = vi.fn()
    const none = renderCard({ rejectedCount: 0, onShowRejected })
    expect(screen.queryByRole('button', { name: /rejected/ })).toBeNull()
    none.unmount()
    renderCard({ rejectedCount: 1, onShowRejected })
    await userEvent.click(screen.getByRole('button', { name: '1 rejected line needs action' }))
    expect(onShowRejected).toHaveBeenCalledOnce()
  })

  it('the undated footnote shows only when dollars were paid before payments were dated', () => {
    const plain = renderCard()
    expect(screen.queryByText(/paid before payments were dated/)).toBeNull()
    plain.unmount()
    ok({ ...PIPE, undatedPaid: 1234.5 })
    renderCard()
    expect(screen.getByText("$1,234.50 paid before payments were dated isn't shown in the weeks.")).toBeTruthy()
  })

  it('keyboard: focus lands on this week and speaks it; the keys move; Escape hides the readout', () => {
    renderCard()
    fireEvent.focus(plot())
    expect(document.body.textContent).toContain('Week of 26 October: $300.00 sent, $0.00 paid, $0.00 rejected.')
    fireEvent.keyDown(plot(), { key: 'ArrowLeft' })
    fireEvent.keyDown(plot(), { key: 'ArrowLeft' })
    expect(document.body.textContent).toContain('Week of 12 October: $750.00 sent, $750.00 paid, $120.50 rejected.')
    expect(document.querySelector('[data-readout-header]')?.textContent).toBe('Week of 12 October')
    fireEvent.keyDown(plot(), { key: 'Home' })
    expect(document.querySelector('[data-readout-header]')?.textContent).toBe('Week of 10 August')
    expect(document.querySelector('[data-readout]')?.textContent).toContain('Nothing sent or paid')
    fireEvent.keyDown(plot(), { key: 'Escape' })
    expect(document.querySelector('[data-readout]')).toBeNull()
  })
})
