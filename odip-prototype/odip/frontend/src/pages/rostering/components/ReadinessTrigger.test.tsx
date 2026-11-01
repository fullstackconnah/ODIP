import { afterEach, describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReadinessTrigger } from './ReadinessTrigger'
import { TONE } from '@/lib/tone'

const ISSUES = ['Intake not complete', 'No signed service agreement']

afterEach(() => vi.useRealTimers())

function trigger() {
  return screen.getByRole('button', { name: /^(Not ready|Blocked)/ })
}

const panel = () => document.getElementById(trigger().getAttribute('aria-controls') ?? 'none')
const hover = (el: Element) => fireEvent.pointerEnter(el, { pointerType: 'mouse' })
const leave = (el: Element) => fireEvent.pointerLeave(el, { pointerType: 'mouse' })

describe('ReadinessTrigger — the word on the row', () => {
  it('Warn: a text-only button "Not ready" with a triangle, in the warning ink, its name starting with the visible word', () => {
    const { container } = render(<ReadinessTrigger issues={ISSUES} blocked={false} onboarding={false} />)
    const btn = trigger()
    expect(btn).toHaveTextContent(/^Not ready$/)
    expect(btn).toHaveAttribute('type', 'button')
    expect(btn).toHaveAttribute('aria-label', 'Not ready: Intake not complete · No signed service agreement')
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    expect(btn).not.toHaveAttribute('title')
    for (const cls of TONE.warning.ink.split(' ')) expect(btn).toHaveClass(cls)
    expect(btn.className).not.toMatch(/\bbg-/)
    expect(container.querySelector('svg')).toHaveClass('lucide-triangle-alert')
    expect(container.querySelector('.sr-only')).toBeNull()
  })

  it('Enforce: "Blocked" with a ban glyph in the danger ink (owner ruling 2026-11-02), and the refusal in its name', () => {
    const { container } = render(<ReadinessTrigger issues={ISSUES} blocked onboarding={false} />)
    const btn = trigger()
    expect(btn).toHaveTextContent(/^Blocked$/)
    expect(btn).toHaveAttribute('aria-label', 'Blocked. Not ready for rostering: Intake not complete · No signed service agreement. New shifts and assignments are refused until this is done.')
    for (const cls of TONE.danger.ink.split(' ')) expect(btn).toHaveClass(cls)
    expect(container.querySelector('svg')).toHaveClass('lucide-ban')
  })

  it('Enforce with no reasons still says Blocked', () => {
    render(<ReadinessTrigger issues={[]} blocked onboarding={false} />)
    expect(trigger()).toHaveAttribute('aria-label', 'Blocked. Not ready for rostering. New shifts and assignments are refused until this is done.')
  })

  it('draws nothing for a ready participant', () => {
    const { container } = render(<ReadinessTrigger issues={[]} blocked={false} onboarding={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('folds the Onboarding sentence into the name', () => {
    render(<ReadinessTrigger issues={['Intake not complete']} blocked={false} onboarding />)
    expect(trigger()).toHaveAttribute('aria-label', 'Not ready: Intake not complete. Services started; onboarding is still open')
  })

  it('keeps the coarse tap pad and a taller coarse box, unclipped', () => {
    render(<ReadinessTrigger issues={ISSUES} blocked={false} onboarding={false} />)
    expect(trigger()).toHaveClass('h-4', 'pointer-coarse:h-5', 'before:absolute')
    expect(trigger().className).not.toMatch(/overflow-hidden|truncate/)
  })
})

describe('ReadinessTrigger — the peek panel', () => {
  it('opens 200ms after the mouse arrives, and closes 150ms after it leaves', () => {
    vi.useFakeTimers()
    render(<ReadinessTrigger issues={ISSUES} blocked={false} onboarding={false} />)
    hover(trigger())
    act(() => { vi.advanceTimersByTime(199) })
    expect(panel()).toBeNull()
    act(() => { vi.advanceTimersByTime(2) })
    expect(panel()).not.toBeNull()
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    leave(trigger())
    act(() => { vi.advanceTimersByTime(100) })
    expect(panel()).not.toBeNull()
    act(() => { vi.advanceTimersByTime(60) })
    expect(panel()).toBeNull()
  })

  it('stays open while the pointer moves from the trigger onto the panel', () => {
    vi.useFakeTimers()
    render(<ReadinessTrigger issues={ISSUES} blocked={false} onboarding={false} />)
    hover(trigger())
    act(() => { vi.advanceTimersByTime(250) })
    leave(trigger())
    hover(panel()!)
    act(() => { vi.advanceTimersByTime(500) })
    expect(panel()).not.toBeNull()
    leave(panel()!)
    act(() => { vi.advanceTimersByTime(200) })
    expect(panel()).toBeNull()
  })

  it('a tap pins it and a second tap closes it', async () => {
    const user = userEvent.setup()
    render(<ReadinessTrigger issues={ISSUES} blocked={false} onboarding={false} />)
    await user.click(trigger())
    expect(panel()).not.toBeNull()
    await user.click(trigger())
    expect(panel()).toBeNull()
  })

  it('a click during a hover-open pins it (leaving does not close it); the second click closes it', () => {
    vi.useFakeTimers()
    render(<ReadinessTrigger issues={ISSUES} blocked={false} onboarding={false} />)
    hover(trigger())
    act(() => { vi.advanceTimersByTime(250) })
    fireEvent.click(trigger())
    leave(trigger())
    act(() => { vi.advanceTimersByTime(500) })
    expect(panel()).not.toBeNull()
    fireEvent.click(trigger())
    expect(panel()).toBeNull()
  })

  it('keyboard focus opens it and Escape closes it with focus kept on the trigger', async () => {
    const user = userEvent.setup()
    render(<ReadinessTrigger issues={ISSUES} blocked={false} onboarding={false} />)
    await user.tab()
    expect(trigger()).toHaveFocus()
    expect(panel()).not.toBeNull()
    await user.keyboard('{Escape}')
    expect(panel()).toBeNull()
    expect(trigger()).toHaveFocus()
  })

  it('Enter pins it, a second Enter closes it, and Escape closes a pinned one', async () => {
    const user = userEvent.setup()
    render(<ReadinessTrigger issues={ISSUES} blocked={false} onboarding={false} />)
    await user.tab()
    await user.keyboard('{Enter}')
    expect(panel()).not.toBeNull()
    await user.keyboard('{Enter}')
    expect(panel()).toBeNull()
    await user.keyboard('{Enter}')
    expect(panel()).not.toBeNull()
    await user.keyboard('{Escape}')
    expect(panel()).toBeNull()
  })

  it('a window resize closes an open panel, even a pinned one', async () => {
    const user = userEvent.setup()
    render(<ReadinessTrigger issues={ISSUES} blocked={false} onboarding={false} />)
    await user.click(trigger())
    expect(panel()).not.toBeNull()
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(panel()).toBeNull()
  })

  it('a touch pointerenter does not open it (the tap does)', () => {
    vi.useFakeTimers()
    render(<ReadinessTrigger issues={ISSUES} blocked={false} onboarding={false} />)
    // jsdom has no PointerEvent, so fireEvent drops pointerType: build the event by hand
    const over = new Event('pointerover', { bubbles: true })
    Object.defineProperty(over, 'pointerType', { value: 'touch' })
    act(() => { trigger().dispatchEvent(over) })
    act(() => { vi.advanceTimersByTime(500) })
    expect(panel()).toBeNull()
  })

  it('blur closes an unpinned panel', async () => {
    const user = userEvent.setup()
    render(<><ReadinessTrigger issues={ISSUES} blocked={false} onboarding={false} /><a href="#x">after</a></>)
    await user.tab()
    expect(panel()).not.toBeNull()
    await user.tab()
    expect(panel()).toBeNull()
  })

  it('an outside pointerdown closes a pinned panel; a pointerdown inside it does not', async () => {
    const user = userEvent.setup()
    render(<><ReadinessTrigger issues={ISSUES} blocked={false} onboarding={false} /><p>elsewhere</p></>)
    await user.click(trigger())
    fireEvent.pointerDown(panel()!)
    expect(panel()).not.toBeNull()
    fireEvent.pointerDown(screen.getByText('elsewhere'))
    expect(panel()).toBeNull()
  })

  it('lists every issue on its own line, whole, with no line clamp, and the Warn footer', async () => {
    const user = userEvent.setup()
    render(<ReadinessTrigger issues={ISSUES} blocked={false} onboarding={false} />)
    await user.click(trigger())
    const items = Array.from(panel()!.querySelectorAll('li'))
    expect(items.map(li => li.textContent)).toEqual(ISSUES)
    for (const li of items) expect(li.className).not.toMatch(/line-clamp|truncate/)
    expect(panel()).toHaveTextContent('Not ready')
    expect(panel()).toHaveTextContent('You can still roster shifts.')
    expect(panel()).not.toHaveTextContent('Services started')
    expect(panel()!.parentElement).toBe(document.body)
  })

  it('Enforce: the title and footer say rostering is refused; with no issues there is no list', async () => {
    const user = userEvent.setup()
    render(<ReadinessTrigger issues={[]} blocked onboarding={false} />)
    await user.click(trigger())
    expect(panel()).toHaveTextContent('Not ready for rostering')
    expect(panel()).toHaveTextContent('New shifts and assignments are refused until this is done.')
    expect(panel()!.querySelector('ul')).toBeNull()
    expect(panel()).not.toHaveTextContent('You can still roster shifts.')
  })

  it('carries the Onboarding sentence when folded in', async () => {
    const user = userEvent.setup()
    render(<ReadinessTrigger issues={ISSUES} blocked={false} onboarding />)
    await user.click(trigger())
    expect(panel()).toHaveTextContent('Services started; onboarding is still open.')
  })

  it('wears the popover surface and the reduced-motion-aware animation class', async () => {
    const user = userEvent.setup()
    render(<ReadinessTrigger issues={ISSUES} blocked={false} onboarding={false} />)
    await user.click(trigger())
    expect(panel()).toHaveClass('readiness-peek', 'fixed', 'z-[70]', 'bg-[var(--color-popover)]')
  })
})
