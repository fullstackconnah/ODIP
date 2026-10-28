import { beforeAll, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { budgetSeries, expectedOk, seriesScope } from '@/test/fixtures/budgetSeries'
import { liveLine } from '@/lib/budgetTrack'
import { writtenDay, writtenSpan } from '@/lib/fundingPlan'
import { BudgetTrackChart } from './BudgetTrackChart'

// The budget graph's view (Funding tab), rendered from the fixture at a fixed width: no query, no measuring.

beforeAll(() => {
  // jsdom has no PointerEvent; React listens for the native pointer events, so a MouseEvent carrying pointerType stands in.
  if (typeof window.PointerEvent === 'undefined') {
    class PointerEventStub extends MouseEvent {
      pointerType: string
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init)
        this.pointerType = init.pointerType ?? 'mouse'
      }
    }
    window.PointerEvent = PointerEventStub as unknown as typeof PointerEvent
  }
})

const series = budgetSeries()
const plot = () => document.querySelector<HTMLElement>('[data-plot]')!
const readout = () => document.querySelector<HTMLElement>('[data-readout]')
const path = (s: string) => document.querySelector(`path[data-series="${s}"]`)
const live = () => screen.getByRole('status')
const week = (iso: string) => 'Week to ' + writtenDay(iso)
const stopsOf = (s = series, i = 0) => s.scopes[i].points.filter(p => !p.isEdge)

/** Puts the plot at the page's left edge, so clientX is the x inside it. */
function placePlot(width: number) {
  plot().getBoundingClientRect = () => ({ left: 0, top: 0, right: width, bottom: 300, width, height: 300, x: 0, y: 0, toJSON: () => ({}) })
}
/** The clientX of a point, by the chart's own scale: margins 48 and 12, the plan's days across. */
function xOf(date: string, width: number, s = series) {
  const day = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))
  return 48 + ((day(date) - day(s.planStart!)) / (day(s.planEnd!) - day(s.planStart!))) * (width - 60)
}

describe('BudgetTrackChart', () => {
  it('draws budget, used, booked and expected with their data-series and classes', () => {
    render(<BudgetTrackChart series={series} width={900} />)
    for (const s of ['budget', 'used', 'booked', 'expected']) expect(path(s)).toHaveClass(`bt-${s}`)
    expect(document.querySelector('[data-today]')).not.toBeNull()
    expect(screen.getByText(/^Used \$/)).toBeInTheDocument()
    expect(screen.getByText(`The whole plan: used`, { exact: false })).toHaveAttribute('id', plot().getAttribute('aria-describedby')!)
  })

  it('the legend has 4 items normally, 3 with no agreement, 2 when ended with no agreement', () => {
    const { unmount } = render(<BudgetTrackChart series={series} width={900} />)
    expect(document.querySelectorAll('[data-legend]')).toHaveLength(4)
    unmount()
    const none = expectedOk({ status: 'NoAgreement' })
    const second = render(<BudgetTrackChart series={budgetSeries({ expected: none })} width={900} />)
    expect([...document.querySelectorAll('[data-legend]')].map(l => l.getAttribute('data-legend'))).toEqual(['budget', 'used', 'booked'])
    second.unmount()
    render(<BudgetTrackChart series={budgetSeries({ expected: none }, { today: '2027-08-01' })} width={900} />)
    expect(document.querySelectorAll('[data-legend]')).toHaveLength(2)
  })

  it('an ended plan has no today marker and no booked path', () => {
    render(<BudgetTrackChart series={budgetSeries({}, { today: '2027-08-01' })} width={900} />)
    expect(document.querySelector('[data-today]')).toBeNull()
    expect(path('booked')).toBeNull()
    expect(path('used')).not.toBeNull()
  })

  it('the expected path has a separate subpath per covered run', () => {
    const gap = budgetSeries({}, { covered: [['2026-07-01', '2026-09-30'], ['2026-11-01', '2027-06-30']] })
    render(<BudgetTrackChart series={gap} width={900} />)
    expect(path('expected')!.getAttribute('d')!.match(/M/g)).toHaveLength(2)
  })

  it('keyboard: focus lands on today; → and ← step one week; PageDown steps four; Home and End; Escape hides the readout until the next key; blur clears it', () => {
    render(<BudgetTrackChart series={series} width={900} />)
    const stops = stopsOf()
    const header = () => readout()!.querySelector('[data-readout-header]')!.textContent
    const at = (date: string) => liveLine(stops, stops.findIndex(p => p.date === date), series)

    act(() => plot().focus())
    expect(header()).toBe('Today, 4 Oct')
    expect(live().textContent).toBe(at('2026-10-04'))
    fireEvent.keyDown(plot(), { key: 'ArrowRight' })
    fireEvent.keyDown(plot(), { key: 'ArrowRight' })
    expect(header()).toBe(week('2026-10-13'))
    expect(live().textContent).toBe(at('2026-10-13'))
    expect(live().textContent).toMatch(/^Week to 13.Oct.2026: budget \$[\d,.]+, used and booked \$[\d,.]+, expected \$[\d,.]+\.$/)
    fireEvent.keyDown(plot(), { key: 'ArrowLeft' })
    expect(header()).toBe(week('2026-10-06'))
    fireEvent.keyDown(plot(), { key: 'PageDown' })
    expect(header()).toBe(week('2026-11-03'))
    fireEvent.keyDown(plot(), { key: 'Home' })
    expect(header()).toBe('Plan start, ' + writtenDay('2026-07-01'))
    fireEvent.keyDown(plot(), { key: 'ArrowLeft' })
    expect(header()).toBe('Plan start, ' + writtenDay('2026-07-01'))
    fireEvent.keyDown(plot(), { key: 'End' })
    expect(header()).toBe(week('2027-06-30'))
    fireEvent.keyDown(plot(), { key: 'Escape' })
    expect(readout()).toBeNull()
    fireEvent.keyDown(plot(), { key: 'ArrowLeft' })
    expect(header()).toBe(week('2027-06-29'))
    act(() => plot().blur())
    expect(readout()).toBeNull()
  })

  it('the readout on the revision week carries "Agreement revised 1 Dec"', () => {
    render(<BudgetTrackChart series={budgetSeries({ expected: expectedOk({ revisionChanges: ['2026-12-01'] }) })} width={900} />)
    act(() => plot().focus())
    for (let i = 0; i < 8; i++) fireEvent.keyDown(plot(), { key: 'ArrowRight' })
    expect(readout()).not.toHaveTextContent('Agreement revised')
    fireEvent.keyDown(plot(), { key: 'ArrowRight' })
    expect(readout()!.querySelector('[data-readout-header]')!.textContent).toBe(week('2026-12-01'))
    expect(readout()).toHaveTextContent('Agreement revised 1 Dec')
    expect(document.querySelectorAll('[data-revision]')).toHaveLength(1)
  })

  it('the hidden table has one row per point, the caption, and "none" for an empty cell', () => {
    render(<BudgetTrackChart series={series} width={900} />)
    const table = document.querySelector<HTMLTableElement>('[data-table]')!
    expect(table).toHaveClass('sr-only')
    expect(table.tBodies[0].rows).toHaveLength(stopsOf().length)
    expect(table.caption!.textContent).toBe(`Weekly figures for The whole plan, ${writtenSpan('2026-07-01', '2027-06-30')}`)
    expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Week to', 'Budget, spread evenly', 'Used', 'Used and booked', 'Expected'])
    const lastRow = table.tBodies[0].rows[stopsOf().length - 1]
    expect(lastRow.cells[2]).toHaveTextContent('none')
    expect(lastRow.cells[2].querySelector('[aria-hidden="true"]')).toHaveTextContent('—')
  })

  it('edge points only shape the line', () => {
    const gap = budgetSeries({}, { covered: [['2026-07-01', '2026-09-30'], ['2026-11-01', '2027-06-30']] })
    const points = gap.scopes[0].points
    const edges = points.filter(p => p.isEdge).map(p => p.date)
    expect(edges).toEqual(['2026-09-30', '2026-10-31'])
    render(<BudgetTrackChart series={gap} width={900} />)
    const vertices = path('expected')!.getAttribute('d')!.match(/[ML]/g)!.length
    expect(vertices).toBe(points.filter(p => p.expected !== undefined).length)
    const table = document.querySelector<HTMLTableElement>('[data-table]')!
    expect(table.tBodies[0].rows).toHaveLength(stopsOf(gap).length)
    expect(table.textContent).not.toContain(writtenDay('2026-09-30'))
    act(() => plot().focus())
    fireEvent.keyDown(plot(), { key: 'ArrowLeft' })   // from today, past the 30 Sep edge
    expect(readout()!.querySelector('[data-readout-header]')!.textContent).toBe(week('2026-09-29'))
    placePlot(900)
    fireEvent.pointerMove(plot(), { clientX: xOf('2026-09-30', 900, gap), pointerType: 'mouse' })
    expect(readout()!.querySelector('[data-readout-header]')!.textContent).toBe(week('2026-09-29'))
  })

  it('the switch is absent with one pool, a radiogroup with three options at 600px, and a select with five options or at 400px', () => {
    const one = render(<BudgetTrackChart series={{ ...series, scopes: series.scopes.slice(0, 2) }} width={600} />)
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    one.unmount()

    const three = render(<BudgetTrackChart series={series} width={600} />)
    const group = screen.getByRole('radiogroup', { name: 'Show the budget for' })
    expect(within(group).getAllByRole('radio').map(r => r.textContent)).toEqual(['Whole plan', 'Core', 'Increased Social and Community Participation'])
    expect(screen.queryByRole('combobox')).toBeNull()
    fireEvent.click(within(group).getByRole('radio', { name: 'Core' }))
    expect(plot()).toHaveAttribute('aria-label', 'Weekly budget chart for Core')
    expect(screen.getByText('Core: used', { exact: false })).toBeInTheDocument()
    three.unmount()

    const narrow = render(<BudgetTrackChart series={series} width={400} />)
    expect(screen.getByRole('combobox', { name: 'Show' })).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup')).toBeNull()
    narrow.unmount()

    const pools = [3, 4, 5].map(n => seriesScope({ scopeKey: `pool-${n}`, name: `Pool ${n}` }))
    render(<BudgetTrackChart series={{ ...series, scopes: [...series.scopes, ...pools.slice(0, 2)] }} width={900} />)
    const select = screen.getByRole('combobox', { name: 'Show' })
    expect(within(select).getAllByRole('option')).toHaveLength(5)
    fireEvent.change(select, { target: { value: 'pool-4' } })
    expect(plot()).toHaveAttribute('aria-label', 'Weekly budget chart for Pool 4')
  })

  it('a pointer move snaps to the nearest week', () => {
    render(<BudgetTrackChart series={series} width={900} />)
    placePlot(900)
    const between = (xOf('2026-10-13', 900) * 3 + xOf('2026-10-20', 900)) / 4
    fireEvent.pointerMove(plot(), { clientX: between, pointerType: 'mouse' })
    expect(readout()!.querySelector('[data-readout-header]')!.textContent).toBe(week('2026-10-13'))
    expect(document.querySelector('[data-cross]')).not.toBeNull()
    fireEvent.pointerLeave(plot(), { pointerType: 'mouse' })
    expect(readout()).toBeNull()
  })

  it('a tap keeps the readout until another tap or an outside tap', () => {
    render(<BudgetTrackChart series={series} width={390} />)
    placePlot(390)
    const header = () => readout()?.querySelector('[data-readout-header]')?.textContent
    fireEvent.pointerDown(plot(), { clientX: xOf('2026-10-13', 390), pointerType: 'touch' })
    fireEvent.pointerUp(plot(), { clientX: xOf('2026-10-13', 390), pointerType: 'touch' })
    fireEvent.pointerLeave(plot(), { pointerType: 'touch' })
    expect(header()).toBe(week('2026-10-13'))
    fireEvent.pointerDown(plot(), { clientX: xOf('2027-01-12', 390), pointerType: 'touch' })
    expect(header()).toBe(week('2027-01-12'))
    fireEvent.pointerDown(document.body, { pointerType: 'touch' })
    expect(readout()).toBeNull()
  })

  it('over budget: the top y tick >= used and the used stroke class is unchanged', () => {
    const over = budgetSeries({}, { usedPerWeek: 1500 })
    const used = Math.max(...over.scopes[0].points.map(p => p.usedAndBooked ?? p.used ?? 0))
    expect(used).toBeGreaterThan(over.scopes[0].limit)
    render(<BudgetTrackChart series={over} width={900} />)
    const top = Math.max(...[...document.querySelectorAll('[data-ytick]')].map(t => Number(t.getAttribute('data-ytick'))))
    expect(top).toBeGreaterThanOrEqual(used)
    expect(path('used')!.getAttribute('class')).toBe('bt-used')
  })
})
