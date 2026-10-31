import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useChartPoints } from './useChartPoints'

// A bare harness: five points, each 100px wide, so clientX / 100 picks the point.

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

function Harness({ onCommit, restIndex = 0 }: { onCommit: (i: number) => void; restIndex?: number }) {
  const chart = useChartPoints({
    count: 5, restIndex, onCommit, label: 'Test chart', sentenceId: 'sentence',
    nearest: e => Math.min(Math.floor(e.clientX / 100), 4),
    describe: i => `point ${i}`,
  })
  return (
    <div onKeyDown={() => outerKey()}>
      <div data-testid="plot" {...chart.plotProps} />
      <output data-testid="state">{String(chart.active)}|{String(chart.shown)}|{String(chart.pinned)}|{chart.message}</output>
    </div>
  )
}
const outerKey = vi.fn()
const plot = () => screen.getByTestId('plot')
const state = () => screen.getByTestId('state').textContent
const tap = (clientX: number) => { fireEvent.pointerDown(plot(), { clientX, pointerType: 'touch' }); fireEvent.click(plot(), { clientX }) }

describe('useChartPoints', () => {
  it('moves with the arrows, clamps at both ends and never commits', () => {
    const onCommit = vi.fn()
    render(<Harness onCommit={onCommit} />)
    fireEvent.focus(plot())
    expect(state()).toContain('point 0')
    fireEvent.keyDown(plot(), { key: 'ArrowLeft' })
    expect(state()!.startsWith('0|')).toBe(true)
    fireEvent.keyDown(plot(), { key: 'ArrowRight' })
    fireEvent.keyDown(plot(), { key: 'ArrowDown' })
    expect(state()!.startsWith('2|')).toBe(true)
    fireEvent.keyDown(plot(), { key: 'End' })
    fireEvent.keyDown(plot(), { key: 'ArrowRight' })
    expect(state()!.startsWith('4|')).toBe(true)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('jumps with Home, End and PageDown', () => {
    render(<Harness onCommit={vi.fn()} />)
    fireEvent.focus(plot())
    fireEvent.keyDown(plot(), { key: 'PageDown' })
    expect(state()!.startsWith('4|')).toBe(true)
    fireEvent.keyDown(plot(), { key: 'Home' })
    expect(state()!.startsWith('0|')).toBe(true)
    fireEvent.keyDown(plot(), { key: 'End' })
    expect(state()!.startsWith('4|')).toBe(true)
  })

  it('commits the active point on Enter and on Space, and Space does not scroll', () => {
    const onCommit = vi.fn()
    render(<Harness onCommit={onCommit} restIndex={1} />)
    fireEvent.focus(plot())
    fireEvent.keyDown(plot(), { key: 'ArrowRight' })
    fireEvent.keyDown(plot(), { key: 'Enter' })
    expect(onCommit).toHaveBeenLastCalledWith(2)
    const space = fireEvent.keyDown(plot(), { key: ' ' })
    expect(space).toBe(false)
    expect(onCommit).toHaveBeenCalledTimes(2)
  })

  it('Escape with a readout showing stops the event; with nothing showing it leaves the event alone', () => {
    outerKey.mockClear()
    render(<Harness onCommit={vi.fn()} />)
    fireEvent.keyDown(plot(), { key: 'Escape' })
    expect(outerKey).toHaveBeenCalledTimes(1)
    fireEvent.focus(plot())
    outerKey.mockClear()
    fireEvent.keyDown(plot(), { key: 'Escape' })
    expect(outerKey).not.toHaveBeenCalled()
    expect(state()!.split('|')[1]).toBe('null')
  })

  it('a mouse click commits at once', () => {
    const onCommit = vi.fn()
    render(<Harness onCommit={onCommit} />)
    fireEvent.pointerDown(plot(), { clientX: 250, pointerType: 'mouse' })
    fireEvent.click(plot(), { clientX: 250 })
    expect(onCommit).toHaveBeenCalledWith(2)
  })

  it('on touch the first tap reads and a second tap on the same point commits', () => {
    const onCommit = vi.fn()
    render(<Harness onCommit={onCommit} />)
    tap(250)
    expect(onCommit).not.toHaveBeenCalled()
    expect(state()!.startsWith('2|2|true')).toBe(true)
    tap(250)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(2)
  })

  it('on touch a tap on a different point only moves the reading', () => {
    const onCommit = vi.fn()
    render(<Harness onCommit={onCommit} />)
    tap(250)
    tap(450)
    expect(onCommit).not.toHaveBeenCalled()
    expect(state()!.startsWith('4|')).toBe(true)
  })

  it('a tap outside the plot clears the pin', () => {
    render(<Harness onCommit={vi.fn()} />)
    tap(250)
    fireEvent.pointerDown(document.body)
    expect(state()!.startsWith('null|null|false')).toBe(true)
  })
})
