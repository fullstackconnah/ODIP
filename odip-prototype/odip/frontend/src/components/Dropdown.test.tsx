import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
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
