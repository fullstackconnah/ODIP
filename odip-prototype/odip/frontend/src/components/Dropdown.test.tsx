import { describe, it, expect } from 'vitest'
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
})
