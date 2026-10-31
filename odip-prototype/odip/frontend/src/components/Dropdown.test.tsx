import { describe, it, expect, vi } from 'vitest'
import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dropdown } from './Dropdown'
import { Button } from './Button'
import { TAP_AREA } from './tapArea'

const ITEMS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
]
const pad = TAP_AREA.split(' ')

// The pill (24px, 36 in a table row) and the menu trigger (40px) are shorter than 44px. Under `pointer: coarse` each
// gets the TAP_AREA pad — a transparent centred ::before sized max(100%, --tap-min) — so a finger lands on the trigger
// without the trigger growing (density spec §1). `form` is --control-h (44px there) and needs nothing; `icon` is left
// alone on purpose (see below).
describe('Dropdown — 44px coarse-pointer hit area on the compact triggers', () => {
  it('pads the pill trigger (the Trips "All Statuses" filter and every status pill)', () => {
    render(<Dropdown variant="pill" value="" onChange={() => {}} label="All Statuses" items={ITEMS} colorClass="bg-[var(--color-surface-container-low)]" />)
    const pill = screen.getByRole('button', { name: 'All Statuses' })
    expect(pill).toHaveClass(...pad)
    // Still the compact pill: 24px comes from py-1 + the 16px line, and the colour class rides along untouched.
    expect(pill).toHaveClass('py-1', 'text-xs', 'rounded-full', 'bg-[var(--color-surface-container-low)]')
  })

  it('keeps the pill\'s caller-supplied height class next to the pad (the table rows pass h-[var(--control-h-sm)])', () => {
    render(<Dropdown variant="pill" value="a" onChange={() => {}} items={ITEMS} colorClass="bg-red-100 h-[var(--control-h-sm)] whitespace-nowrap" />)
    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveClass('h-[var(--control-h-sm)]', 'whitespace-nowrap', ...pad)
  })

  it('deliberately leaves the icon trigger unpadded: its one consumer (the roster chip kebab) is flush against the chip body, so a pad would overlap it', () => {
    render(<Dropdown variant="icon" label="More actions" icon={<span>i</span>} items={ITEMS} onSelect={() => {}} />)
    const trigger = screen.getByRole('button', { name: 'More actions' })
    expect(trigger).toHaveClass('p-1.5')
    expect(trigger.className).not.toContain('before:')
    expect(trigger).not.toHaveClass('relative')
  })

  it('lets the caller replace the icon trigger look with triggerClassName', () => {
    render(<Dropdown variant="icon" label="Theme" icon={<span>i</span>} items={ITEMS} onSelect={() => {}} triggerClassName="w-8 h-8 rounded-full" />)
    const trigger = screen.getByRole('button', { name: 'Theme' })
    expect(trigger).toHaveClass('w-8', 'h-8', 'rounded-full')
    expect(trigger).not.toHaveClass('p-1.5')
  })

  it('opens on the chosen row from the keyboard, and on the first row when nothing is chosen', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Dropdown variant="icon" label="Pick" icon={<span>i</span>} items={ITEMS} value="b" onSelect={() => {}} />)
    await user.tab()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Pick' })).toHaveAttribute('aria-activedescendant', 'dd-opt-b')
    await user.keyboard('{Escape}')
    rerender(<Dropdown variant="icon" label="Pick" icon={<span>i</span>} items={ITEMS} onSelect={() => {}} />)
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Pick' })).toHaveAttribute('aria-activedescendant', 'dd-opt-a')
  })

  // The panel scrolls past 320px, so a keyboard open on a far-down chosen row, and each arrow press, must bring the active row into view.
  it('scrolls the keyboard-active row into view on open and on ArrowDown', async () => {
    // Record the panel's position at call time: scrolling while it is still static at the end of body scrolls the WINDOW.
    const positions: string[] = []
    const scrollIntoView = vi.fn(() => { positions.push(screen.getByRole('listbox').style.position) })
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      const items = Array.from({ length: 40 }, (_, i) => ({ value: `v${i + 1}`, label: `Row ${i + 1}` }))
      const user = userEvent.setup()
      render(<Dropdown variant="icon" label="Pick" icon={<span>i</span>} items={items} value="v30" onSelect={() => {}} />)
      await user.tab()
      await user.keyboard('{Enter}')
      expect(scrollIntoView.mock.contexts.at(-1)).toBe(document.getElementById('dd-opt-v30'))
      expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' })
      expect(positions).toEqual(['fixed'])
      await user.keyboard('{ArrowDown}')
      expect(scrollIntoView.mock.contexts.at(-1)).toBe(document.getElementById('dd-opt-v31'))
      expect(positions).toEqual(['fixed', 'fixed'])
      // Close and reopen: the panel is positioned afresh and the scroll still waits for it.
      await user.keyboard('{Escape}')
      scrollIntoView.mockClear()
      positions.length = 0
      await user.keyboard('{Enter}')
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(scrollIntoView.mock.contexts.at(-1)).toBe(document.getElementById('dd-opt-v30'))
      expect(positions.every(p => p === 'fixed')).toBe(true)
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  // The search input is focused as the panel opens, while it is still unstyled at the end of body; focus() without preventScroll scrolls the WINDOW to it.
  it('focuses the search input without scrolling, on first open and on reopen, while the panel is unstyled', async () => {
    // Record the panel's position at focus time: '' (unstyled) both times proves the close reset; a stale style would read 'fixed' on reopen.
    const positions: string[] = []
    const original = HTMLElement.prototype.focus
    const focus = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      if (this.tagName === 'INPUT') positions.push(screen.getByRole('listbox').style.position)
      original.call(this, options)
    })
    try {
      const user = userEvent.setup()
      render(<Dropdown variant="icon" label="Pick" icon={<span>i</span>} items={ITEMS} searchable onSelect={() => {}} />)
      const searchFocuses = () => focus.mock.calls.filter((_, i) => (focus.mock.contexts[i] as HTMLElement).tagName === 'INPUT')
      await user.tab()
      await user.keyboard('{Enter}')
      expect(screen.getByRole('textbox')).toHaveFocus()
      expect(searchFocuses()).toEqual([[{ preventScroll: true }]])
      expect(positions).toEqual([''])
      // Close and reopen: the focus still lands unscrolled, on a panel whose style was reset.
      await user.keyboard('{Escape}')
      focus.mockClear()
      await user.keyboard('{Enter}')
      expect(screen.getByRole('textbox')).toHaveFocus()
      expect(searchFocuses()).toEqual([[{ preventScroll: true }]])
      expect(positions).toEqual(['', ''])
    } finally {
      focus.mockRestore()
    }
  })

  // A header action is one primary md Button (UI survey s.1), menu or not: no gradient pill. md is --control-h, 44px on a touch screen,
  // so the menu trigger needs no pad, like the form trigger.
  it('draws the menu trigger exactly as a primary md Button', () => {
    render(<><Dropdown variant="menu" label="Export" items={ITEMS} onSelect={() => {}} /><Button>Plain</Button></>)
    const classesOf = (el: HTMLElement) => el.className.split(/\s+/).filter(Boolean).sort()
    expect(classesOf(screen.getByRole('button', { name: 'Export' }))).toEqual(classesOf(screen.getByRole('button', { name: 'Plain' })))
  })

  // A page has one filled primary: an in-page menu (Export trip package, the agreement week presets) reads as a secondary md Button.
  it('draws the menu trigger as a secondary md Button when triggerVariant="secondary"', () => {
    render(<><Dropdown variant="menu" triggerVariant="secondary" label="Export" items={ITEMS} onSelect={() => {}} /><Button variant="secondary">Plain</Button></>)
    const classesOf = (el: HTMLElement) => el.className.split(/\s+/).filter(Boolean).sort()
    expect(classesOf(screen.getByRole('button', { name: 'Export' }))).toEqual(classesOf(screen.getByRole('button', { name: 'Plain' })))
  })

  it('does not pad the form trigger: it is --control-h tall, 44px on a touch screen already', () => {
    render(<Dropdown variant="form" value="" onChange={() => {}} label="Pick one" items={ITEMS} />)
    const trigger = screen.getByRole('button', { name: 'Pick one' })
    expect(trigger).toHaveClass('h-[var(--control-h)]')
    expect(trigger.className).not.toContain('before:')
  })

  it('leaves the chevron sibling out of the pad: it is pointer-events-none, so a tap on it reaches the pill', () => {
    const { container } = render(<Dropdown variant="pill" value="a" onChange={() => {}} items={ITEMS} />)
    const chevronWrap = container.querySelector('span.absolute') as HTMLElement
    expect(chevronWrap).toHaveClass('pointer-events-none')
    expect(chevronWrap.previousElementSibling).toBe(screen.getByRole('button', { name: 'Alpha' }))
  })
})

// Fix round 1 (intake booking): the menu's rows are a phone's actions too. Under `pointer: coarse` each option is at least --tap-min (44px)
// tall; on a mouse --tap-min is 0px, so the desktop rows keep their size. jsdom has no media queries, so this pins the class contract.
describe('Dropdown — 44px option rows under a coarse pointer', () => {
  it('gives every option the --tap-min floor', async () => {
    render(<Dropdown variant="icon" label="More actions" icon={<span>i</span>} items={ITEMS} onSelect={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))

    const options = await screen.findAllByRole('option')
    expect(options).toHaveLength(2)
    for (const option of options) expect(option).toHaveClass('min-h-[var(--tap-min)]')
  })
})

// Finish review 2026-10-26: a tall list (Jump to) has no 320px cap and, when it still overflows, ends on half a row so the cut says it scrolls.
describe('Dropdown — maxPanelHeight', () => {
  function openWith(maxPanelHeight?: number) {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 })
    const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
    const offset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return this.getAttribute('role') === 'listbox' ? 440 : 0 } })
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.getAttribute('role') === 'option' ? 44 : 0 } })
    render(<Dropdown variant="menu" onSelect={() => {}} label="Jump" items={ITEMS} maxPanelHeight={maxPanelHeight} />)
    const trigger = screen.getByRole('button', { name: 'Jump' })
    trigger.getBoundingClientRect = () => ({ top: 400, bottom: 430, height: 30, left: 300, right: 340, width: 40, x: 300, y: 400, toJSON: () => ({}) })
    fireEvent.click(trigger)
    return () => {
      if (scroll) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scroll)
      if (offset) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offset)
    }
  }

  it('keeps the 320px cap when the prop is not passed', async () => {
    const restore = openWith()
    try { expect((await screen.findByRole('listbox')).style.maxHeight).toBe('320px') } finally { restore() }
  })

  it('lifts the cap, and trims an overflowing list to end on half a row', async () => {
    const restore = openWith(Number.POSITIVE_INFINITY)
    try {
      // 406px of room below: 8 whole rows (352) plus half of the ninth (22).
      expect((await screen.findByRole('listbox')).style.maxHeight).toBe('374px')
    } finally { restore() }
  })
})

// Finish review 2026-10-16: on a phone the chip menu (6 items) opened down over the fixed bottom nav and lost Delete. The panel opens on the side that holds all of it, the nav not counted as room.
describe('Dropdown — which way the panel opens', () => {
  it('opens upward when the panel would run under the bottom nav, though 120px are free below', async () => {
    const restore = { h: window.innerHeight }
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 })
    const nav = document.createElement('nav')
    nav.setAttribute('aria-label', 'Mobile')
    nav.getBoundingClientRect = () => ({ top: 776, bottom: 844, height: 68, left: 0, right: 390, width: 390, x: 0, y: 776, toJSON: () => ({}) })
    document.body.appendChild(nav)
    const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return this.getAttribute('role') === 'listbox' ? 270 : 0 } })
    try {
      render(<Dropdown variant="menu" value="" onChange={() => {}} label="Actions" items={ITEMS} />)
      const trigger = screen.getByRole('button', { name: 'Actions' })
      trigger.getBoundingClientRect = () => ({ top: 560, bottom: 590, height: 30, left: 300, right: 340, width: 40, x: 300, y: 560, toJSON: () => ({}) })
      fireEvent.click(trigger)
      const panel = await screen.findByRole('listbox')
      expect(panel.style.bottom).toBe(`${844 - 560 + 8}px`)
      expect(panel.style.top).toBe('')
    } finally {
      nav.remove()
      if (scroll) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scroll)
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: restore.h })
    }
  })

  it('keeps a left-aligned panel inside the viewport when its trigger sits near the right edge of a phone card', async () => {
    const restore = { w: window.innerWidth }
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return this.getAttribute('role') === 'listbox' ? 224 : 0 } })
    try {
      render(<Dropdown variant="icon" align="left" value="" onChange={() => {}} label="More actions" items={ITEMS} />)
      const trigger = screen.getByRole('button', { name: 'More actions' })
      trigger.getBoundingClientRect = () => ({ top: 400, bottom: 444, height: 44, left: 230, right: 274, width: 44, x: 230, y: 400, toJSON: () => ({}) })
      fireEvent.click(trigger)
      const panel = await screen.findByRole('listbox')
      expect(panel.style.left).toBe('158px') // 390 - 224 - 8, not the trigger's 230
    } finally {
      if (width) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', width)
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: restore.w })
    }
  })
})

// Agreements FIX3 (M8): a disabled menu item with a reason dims only its label, so the reason stays readable (4.5:1).
describe('Dropdown — disabled item with a description', () => {
  const open = (items: { value: string; label: string; description?: string; disabled?: boolean; icon?: ReactNode }[], onSelect = () => {}) => {
    render(<Dropdown variant="menu" label="Actions" items={items} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }))
  }

  it('dims the label and icon but not the reason', async () => {
    open([{ value: 'a', label: 'Approve', description: 'No draft waiting.', disabled: true, icon: <svg data-testid="ic" /> }])
    const option = await screen.findByRole('option')
    expect(option).not.toHaveClass('opacity-40')
    expect(screen.getByText('Approve')).toHaveClass('opacity-40')
    expect(screen.getByTestId('ic').parentElement).toHaveClass('opacity-40')
    expect(screen.getByText('No draft waiting.')).not.toHaveClass('opacity-40')
  })

  it('keeps the whole-item dimming when there is no description, and a click still does nothing', async () => {
    const onSelect = vi.fn()
    open([{ value: 'a', label: 'Approve', disabled: true }], onSelect)
    const option = await screen.findByRole('option')
    expect(option).toHaveClass('opacity-40')
    fireEvent.click(option)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('does not select a disabled item that has a description', async () => {
    const onSelect = vi.fn()
    open([{ value: 'a', label: 'Approve', description: 'No draft waiting.', disabled: true }], onSelect)
    fireEvent.click(await screen.findByRole('option'))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('leaves an enabled item undimmed', async () => {
    open([{ value: 'a', label: 'Approve', description: 'Ready.' }])
    expect(screen.getByText('Approve')).not.toHaveClass('opacity-40')
    expect(await screen.findByRole('option')).not.toHaveClass('opacity-40')
  })
})

describe('Dropdown — keyboard-only focus ring on the value triggers', () => {
  it.each(['pill', 'form'] as const)('%s trigger rings on focus-visible, not on every focus', (variant) => {
    render(<Dropdown variant={variant} value="a" onChange={() => {}} label="Pick" items={ITEMS} />)
    const trigger = screen.getByRole('button')
    expect(trigger).toHaveClass('focus-visible:ring-2', 'focus-visible:ring-[var(--color-ring)]')
    expect(trigger).not.toHaveClass('focus:ring-2')
  })
})

describe('Dropdown — menu trigger width', () => {
  it('applies triggerClassName to the menu trigger, so a label that changes (Documents, Preparing…) can hold one width', () => {
    render(<Dropdown variant="menu" label="Export" items={ITEMS} onSelect={() => {}} triggerClassName="sm:min-w-[9.75rem]" />)
    expect(screen.getByRole('button', { name: 'Export' })).toHaveClass('sm:min-w-[9.75rem]')
  })
})
