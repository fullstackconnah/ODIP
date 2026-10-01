import { describe, it, expect, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { DataTable } from './DataTable'
import type { Column } from './DataTable'

// L3-04: the #161 overflow fix worked by DELETING columns below 1536px/1792px (Overnight, Manual, Trip, Type, Ref, Nights, Claimed...), so the
// data was not on the page at all. The rule now: a column is never removed at md+. A table wider than its box scrolls sideways inside the
// box, and the first column (who the row is) and the actions column stay pinned, so the row's name and its actions are always on screen.
// jsdom does no layout, so these pin the classes and the scroll-edge state; the Playwright audit in the fix report measures the real thing.
describe('DataTable — the column rule: nothing is removed, the box scrolls, the first and last columns stay put', () => {
  type Item = { id: string; a: string; b: string; c: string; d: string; e: string; actions: string }
  const items: Item[] = [{ id: '1', a: 'alpha', b: 'bravo', c: 'charlie', d: 'delta', e: 'echo', actions: 'Open' }]
  const columns: Column<Item>[] = [
    { key: 'a', header: 'A' },
    { key: 'b', header: 'B', priority: 'high' },
    { key: 'c', header: 'C', priority: 'medium' },
    { key: 'd', header: 'D', priority: 'low' },
    { key: 'e', header: 'E', priority: 'lowest' },
    { key: 'actions', header: '' },
  ]
  const headerOf = (name: string) => screen.getByRole('columnheader', { name })

  it('hides no column at any width, whatever its (deprecated) priority: header and cell alike', () => {
    render(<DataTable data={items} columns={columns} keyField="id" />)

    for (const el of [...screen.getAllByRole('columnheader'), ...screen.getAllByRole('cell')]) {
      expect(el.className).not.toMatch(/max-[\w[\]]+:hidden/)
      expect(el.className).not.toMatch(/(^|\s)hidden(\s|$)/)
    }
    // Every column of the card view keeps its label too.
    expect(screen.getByText('delta').closest('td')).toHaveAttribute('data-label', 'D')
    expect(screen.getByText('echo').closest('td')).toHaveAttribute('data-label', 'E')
  })

  it('does not hide an editing cell either', () => {
    const editable: Column<Item>[] = [
      { key: 'a', header: 'A' },
      { key: 'd', header: 'D', priority: 'low', editable: { render: (row, onChange) => <input aria-label="edit-d" defaultValue={row.d} onChange={e => onChange(e.target.value)} /> } },
    ]
    render(<DataTable data={items} columns={editable} keyField="id" editingRow="1" onEditChange={vi.fn()} />)

    expect(screen.getByLabelText('edit-d').closest('td')!.className).not.toMatch(/hidden/)
    expect(headerOf('D').className).not.toMatch(/hidden/)
  })

  it('pins the first column to the start edge and the actions column to the end edge, on the header and on every body cell, from md up', () => {
    render(<DataTable data={items} columns={columns} keyField="id" />)

    const cells = screen.getAllByRole('cell')
    const headers = screen.getAllByRole('columnheader')
    for (const el of [headers[0], cells[0]]) expect(el, 'first column').toHaveClass('md:sticky', 'md:left-0')
    // The last column is the one keyed "actions"; it has no header text, so it is found by position.
    for (const el of [headers[5], cells[5]]) expect(el, 'actions column').toHaveClass('md:sticky', 'md:right-0')
    for (const i of [1, 2, 3, 4]) {
      expect(headers[i].className, `header ${i}`).not.toMatch(/sticky/)
      expect(cells[i].className, `cell ${i}`).not.toMatch(/sticky/)
    }
    // md up only: below md the rows are cards and nothing is pinned.
    for (const el of [headers[0], cells[0], headers[5], cells[5]]) expect(el.className).not.toMatch(/(^|\s)(sticky|left-0|right-0)(\s|$)/)
  })

  it('lets a column choose its edge or opt out: pin "end" on any column, pin false on the first', () => {
    const custom: Column<Item>[] = [
      { key: 'a', header: 'A', pin: false },
      { key: 'b', header: 'B' },
      { key: 'c', header: 'C', pin: 'end' },
    ]
    render(<DataTable data={items} columns={custom} keyField="id" />)

    expect(headerOf('A').className).not.toMatch(/sticky/)
    expect(headerOf('B')).toHaveClass('md:sticky', 'md:left-0') // with A opted out, the first column that is not is the pinned one
    expect(headerOf('C')).toHaveClass('md:sticky', 'md:right-0')
  })

  it('pins the first LABELLED column: an unlabelled control column (a tick button, an avatar) scrolls away and the name stays', () => {
    const withTick: Column<Item>[] = [
      { key: 'tick', header: '', render: () => <button type="button">tick</button> },
      { key: 'a', header: 'A' },
      { key: 'b', header: 'B' },
    ]
    render(<DataTable data={items} columns={withTick} keyField="id" />)

    const tick = screen.getByRole('button', { name: 'tick' }).closest('td')!
    expect(tick.className).not.toMatch(/sticky/)
    expect(headerOf('A')).toHaveClass('md:sticky', 'md:left-0')
    expect(headerOf('B').className).not.toMatch(/sticky/)
  })

  it('keeps the select-all checkbox column out of the pinning (it scrolls away; the name stays)', () => {
    render(<DataTable data={items} columns={columns} keyField="id" selectable selectedRows={new Set()} onSelectionChange={vi.fn()} />)

    const checkbox = screen.getByLabelText('Select all rows').closest('th')!
    expect(checkbox.className).not.toMatch(/sticky/)
    expect(headerOf('A')).toHaveClass('md:sticky', 'md:left-0')
  })

  describe('the pinned cells are opaque only while content is scrolled under them (a tinted row keeps its tint at rest)', () => {
    function scrollBox(container: HTMLElement, { scrollLeft, clientWidth, scrollWidth }: { scrollLeft: number; clientWidth: number; scrollWidth: number }) {
      const box = container.firstElementChild as HTMLElement
      Object.defineProperty(box, 'clientWidth', { configurable: true, value: clientWidth })
      Object.defineProperty(box, 'scrollWidth', { configurable: true, value: scrollWidth })
      Object.defineProperty(box, 'scrollLeft', { configurable: true, value: scrollLeft })
      act(() => { box.dispatchEvent(new Event('scroll')) })
    }

    it('fills the end column while content is to its left, the start column once content has scrolled under it, both with a hairline', () => {
      const { container } = render(<DataTable data={items} columns={columns} keyField="id" />)
      const first = screen.getAllByRole('cell')[0]
      const last = screen.getAllByRole('cell')[5]

      // At rest and fitting: nothing is under either pinned column, so neither is filled.
      expect(first.className).not.toMatch(/md:bg-\[var\(--pin-bg\)\]/)
      expect(last.className).not.toMatch(/md:bg-\[var\(--pin-bg\)\]/)

      // Wider than the box, at the left edge: the end column covers content scrolled off to the right.
      scrollBox(container, { scrollLeft: 0, clientWidth: 500, scrollWidth: 900 })
      expect(last).toHaveClass('md:bg-[var(--pin-bg)]', 'md:shadow-[-1px_0_0_var(--color-border)]')
      expect(first.className).not.toMatch(/md:bg-\[var\(--pin-bg\)\]/)

      // Scrolled into the middle: both are over content.
      scrollBox(container, { scrollLeft: 200, clientWidth: 500, scrollWidth: 900 })
      expect(first).toHaveClass('md:bg-[var(--pin-bg)]', 'md:shadow-[1px_0_0_var(--color-border)]')
      expect(last).toHaveClass('md:bg-[var(--pin-bg)]')

      // At the far right: only the start column has content under it.
      scrollBox(container, { scrollLeft: 400, clientWidth: 500, scrollWidth: 900 })
      expect(first).toHaveClass('md:bg-[var(--pin-bg)]')
      expect(last.className).not.toMatch(/md:bg-\[var\(--pin-bg\)\]/)
    })

    it('follows the row hover tint (the fill is a custom property the row hover switches), so a hovered row shows no seam', () => {
      const { container } = render(<DataTable data={items} columns={columns} keyField="id" />)
      scrollBox(container, { scrollLeft: 200, clientWidth: 500, scrollWidth: 900 })

      expect(screen.getAllByRole('cell')[0]).toHaveClass(
        'md:[--pin-bg:var(--color-card)]',
        'md:group-hover/row:[--pin-bg:color-mix(in_srgb,var(--color-accent)_50%,var(--color-card))]',
      )
    })
  })

  it('still caps a long first-column text, so a pinned name never takes the whole box', () => {
    const long: Item[] = [{ ...items[0], a: 'A very long first column value that would otherwise stretch the pinned column across the whole table' }]
    render(<DataTable data={long} columns={columns} keyField="id" />)

    expect(screen.getByText(/A very long first column/)).toHaveClass('md:truncate', 'md:max-w-[var(--cell-max,24rem)]')
  })
})
