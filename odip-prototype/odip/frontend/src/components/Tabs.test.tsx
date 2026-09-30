import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Tabs, type TabItem } from './Tabs'

function Harness({ tabs, initial }: { tabs: TabItem[]; initial: string }) {
  const [active, setActive] = useState(initial)
  return <Tabs tabs={tabs} active={active} onChange={setActive} ariaLabel="Demo tabs" />
}

const demoTabs: TabItem[] = [
  { id: 'one', label: 'One', content: <div>panel-one</div> },
  { id: 'two', label: 'Two', content: <div>panel-two</div> },
  { id: 'three', label: 'Three', content: <div>panel-three</div> },
]

afterEach(() => cleanup())

describe('Tabs primitive — accessibility and keyboard', () => {
  it('renders a tablist with role=tablist and exposes every tab as role=tab with aria-selected/aria-controls', () => {
    render(<Harness tabs={demoTabs} initial="one" />)
    expect(screen.getByRole('tablist', { name: 'Demo tabs' })).toBeInTheDocument()
    for (const tab of demoTabs) {
      const t = screen.getByRole('tab', { name: tab.label as string })
      expect(t).toHaveAttribute('aria-selected', tab.id === 'one' ? 'true' : 'false')
      expect(t.getAttribute('aria-controls')).toMatch(new RegExp(`-panel-${tab.id}$`))
    }
  })

  it('shows only the active panel and points aria-labelledby at its tab', () => {
    render(<Harness tabs={demoTabs} initial="two" />)
    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveTextContent('panel-two')
    expect(panel.getAttribute('aria-labelledby')).toMatch(/-tab-two$/)
    expect(panel).toHaveAttribute('tabindex', '0')
    // The active panel is the only one with rendered content; the others are hidden so their
    // content is not materialised (the inactive branch returns null).
    expect(screen.queryByText('panel-two')).toBeInTheDocument()
    expect(screen.queryByText('panel-one')).not.toBeInTheDocument()
  })

  it('updates the active tab on click and updates aria-selected + panel content', async () => {
    const user = userEvent.setup()
    render(<Harness tabs={demoTabs} initial="one" />)
    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('tab', { name: 'Three' }))
    expect(screen.getByRole('tab', { name: 'Three' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('panel-three')
  })

  it('moves focus and selection with ArrowRight (wraps from last to first)', async () => {
    const user = userEvent.setup()
    render(<Harness tabs={demoTabs} initial="three" />)
    screen.getByRole('tab', { name: 'Three' }).focus()
    await user.keyboard('{ArrowRight}')
    const one = screen.getByRole('tab', { name: 'One' })
    expect(one).toHaveFocus()
    expect(one).toHaveAttribute('aria-selected', 'true')
  })

  it('moves focus and selection with ArrowLeft (wraps from first to last)', async () => {
    const user = userEvent.setup()
    render(<Harness tabs={demoTabs} initial="one" />)
    screen.getByRole('tab', { name: 'One' }).focus()
    await user.keyboard('{ArrowLeft}')
    const three = screen.getByRole('tab', { name: 'Three' })
    expect(three).toHaveFocus()
    expect(three).toHaveAttribute('aria-selected', 'true')
  })

  it('Home jumps to the first tab and End jumps to the last', async () => {
    const user = userEvent.setup()
    render(<Harness tabs={demoTabs} initial="two" />)
    screen.getByRole('tab', { name: 'Two' }).focus()
    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Three' })).toHaveFocus()
    await user.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: 'One' })).toHaveFocus()
  })

  it('uses roving tabindex so only the active tab is in the page tab order', async () => {
    const user = userEvent.setup()
    render(<Harness tabs={demoTabs} initial="two" />)
    // Initially only Two is tabbable (tabindex=0); the rest are tabindex=-1.
    const one = screen.getByRole('tab', { name: 'One' })
    const two = screen.getByRole('tab', { name: 'Two' })
    const three = screen.getByRole('tab', { name: 'Three' })
    expect(one).toHaveAttribute('tabindex', '-1')
    expect(two).toHaveAttribute('tabindex', '0')
    expect(three).toHaveAttribute('tabindex', '-1')

    // After activating Three via keyboard, the roving tabindex should follow.
    two.focus()
    await user.keyboard('{ArrowRight}')
    expect(three).toHaveAttribute('tabindex', '0')
    expect(two).toHaveAttribute('tabindex', '-1')
  })

  it('skips disabled tabs when navigating with arrow keys', async () => {
    const user = userEvent.setup()
    const tabs: TabItem[] = [
      { id: 'one', label: 'One', content: <div>panel-one</div> },
      { id: 'two', label: 'Two', content: <div>panel-two</div>, disabled: true },
      { id: 'three', label: 'Three', content: <div>panel-three</div> },
    ]
    render(<Harness tabs={tabs} initial="one" />)
    screen.getByRole('tab', { name: 'One' }).focus()
    await user.keyboard('{ArrowRight}')
    // Arrow right from One would normally land on Two, but Two is disabled — skip to Three.
    const three = screen.getByRole('tab', { name: 'Three' })
    expect(three).toHaveFocus()
    expect(three).toHaveAttribute('aria-selected', 'true')
  })

  it('fires onChange only when an enabled tab is clicked (disabled tabs are inert)', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const tabs: TabItem[] = [
      { id: 'one', label: 'One', content: <div>panel-one</div> },
      { id: 'two', label: 'Two', content: <div>panel-two</div>, disabled: true },
    ]
    render(<Tabs tabs={tabs} active="one" onChange={onChange} />)
    await user.click(screen.getByRole('tab', { name: 'Two' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  // ---------- Three explicit defect-coverage tests (DS-01) ----------
  // Each test below corresponds to one of the three defects called out in the
  // primitives brief; the body is designed so a regression in the corresponding
  // behaviour would be caught here.

  it('Defect 1 — every tab aria-controls points at the panel id that actually renders', () => {
    // The wiring must be reflexive: every tab button's aria-controls resolves to a panel id
    // present in the same render. We assert each pair explicitly so a future id refactor
    // can't quietly drop the linkage for one tab without breaking this test.
    render(<Harness tabs={demoTabs} initial="one" />)
    for (const tab of demoTabs) {
      const t = screen.getByRole('tab', { name: tab.label as string })
      const controlsId = t.getAttribute('aria-controls')
      expect(controlsId, `tab "${tab.id}" must advertise an aria-controls id`).toBeTruthy()
      const panel = document.getElementById(controlsId as string)
      expect(panel, `aria-controls of "${tab.id}" must resolve to a real panel`).not.toBeNull()
      expect(panel!.getAttribute('role')).toBe('tabpanel')
      expect(panel!.getAttribute('aria-labelledby')).toMatch(new RegExp(`-tab-${tab.id}$`))
    }
  })

  it('Defect 2 — roving tabindex follows when the parent changes the active prop from outside', async () => {
    // External `active` change (e.g. router-driven query param, programmatic switch) must
    // move the tabbable slot to the new active tab. The fix derives focusedId from active
    // during render so the next paint already has the right tabindex.
    function ExternalHarness() {
      const [active, setActive] = useState('one')
      return (
        <div>
          <button type="button" onClick={() => setActive('three')}>switch</button>
          <Tabs tabs={demoTabs} active={active} onChange={setActive} ariaLabel="Demo tabs" />
        </div>
      )
    }
    const user = userEvent.setup()
    render(<ExternalHarness />)
    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('tab', { name: 'Three' })).toHaveAttribute('tabindex', '-1')

    // Parent flips `active` programmatically — no focus event, no keydown.
    await user.click(screen.getByRole('button', { name: 'switch' }))

    expect(screen.getByRole('tab', { name: 'Three' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('tabindex', '-1')
  })

  it('Defect 3 — disabled tabs are skipped by Home/End and are not activatable by Enter or Space', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const tabs: TabItem[] = [
      { id: 'one', label: 'One', content: <div>panel-one</div> },
      { id: 'two', label: 'Two', content: <div>panel-two</div>, disabled: true },
      { id: 'three', label: 'Three', content: <div>panel-three</div> },
    ]
    render(<Tabs tabs={tabs} active="one" onChange={onChange} />)
    screen.getByRole('tab', { name: 'One' }).focus()

    // Home would normally focus the first tab, but it's already the first — End must skip
    // the disabled middle and land on Three.
    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Three' })).toHaveFocus()
    expect(onChange).toHaveBeenLastCalledWith('three')

    // Home from Three lands back on One, again skipping the disabled Two.
    await user.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: 'One' })).toHaveFocus()
    expect(onChange).toHaveBeenLastCalledWith('one')

    // Re-focus the disabled tab and try Enter + Space — the button is `disabled`, so the
    // browser itself blocks activation, and the click handler's early-return belt-and-braces
    // it. We assert onChange was not invoked for a disabled tab id.
    onChange.mockClear()
    const disabledTab = screen.getByRole('tab', { name: 'Two' })
    disabledTab.focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onChange).not.toHaveBeenCalledWith('two')
  })

  it('falls back to the first enabled tab when the initial active prop points at a disabled tab', () => {
    // Regression guard: previously, `useState(active)` seeded focusedId with the disabled id,
    // so every tab rendered tabindex=-1 on first paint (nothing in the page tab order).
    const tabs: TabItem[] = [
      { id: 'one', label: 'One', content: <div>panel-one</div>, disabled: true },
      { id: 'two', label: 'Two', content: <div>panel-two</div> },
      { id: 'three', label: 'Three', content: <div>panel-three</div> },
    ]
    render(<Tabs tabs={tabs} active="one" onChange={() => {}} />)
    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('tabindex', '0')
  })

  it('hides inactive panels from the page tab order (only the visible panel has tabindex=0)', () => {
    render(<Harness tabs={demoTabs} initial="one" />)
    // All three panels are in the DOM; hidden ones are removed from the a11y tree, so we
    // must query with `{ hidden: true }` to inspect the inactive ones.
    const panels = screen.getAllByRole('tabpanel', { hidden: true })
    expect(panels).toHaveLength(3)
    const active = panels.find(p => !p.hasAttribute('hidden'))!
    const hidden = panels.filter(p => p.hasAttribute('hidden'))
    expect(active).toHaveAttribute('tabindex', '0')
    for (const p of hidden) expect(p).toHaveAttribute('tabindex', '-1')
  })
})

// Density verdict (mobile) — jsdom applies no CSS, so this asserts the class contract: every tab takes
// a floor from the --tap-min token (0 on a mouse, 44px under `pointer: coarse`) rather than a fixed
// pixel height, so the touch target grows without Tabs branching on the pointer type.
describe('Tabs primitive — touch target height', () => {
  it('gives every tab the --tap-min height floor, disabled or not', () => {
    const tabs: TabItem[] = [
      { id: 'one', label: 'One', content: <div>panel-one</div> },
      { id: 'two', label: 'Two', content: <div>panel-two</div>, disabled: true },
    ]
    render(<Harness tabs={tabs} initial="one" />)

    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).toHaveClass('min-h-[var(--tap-min)]')
    }
  })
})

// Density polish (N1) — on a phone a 10-tab strip used to wrap into five 44px rows (~240px before any
// content). Below md it is now ONE row that scrolls sideways; from md up it wraps as before. jsdom applies
// no CSS, so the layout is pinned as classes and the scroll-into-view behaviour with mocked geometry.
describe('Tabs primitive — one scrolling strip below md', () => {
  it('is a single non-wrapping, horizontally scrolling row below md with its scrollbar hidden', () => {
    render(<Harness tabs={demoTabs} initial="one" />)

    const strip = screen.getByRole('tablist', { name: 'Demo tabs' })
    expect(strip).toHaveClass('flex', 'flex-nowrap', 'overflow-x-auto')
    // The scrollbar is hidden on the strip only below md (Tailwind has no scrollbar-width utility).
    expect(strip).toHaveClass('max-md:[scrollbar-width:none]', 'max-md:[&::-webkit-scrollbar]:hidden')
    // Never a bare `flex-wrap`: that is the five-row phone layout this replaced.
    expect(strip).not.toHaveClass('flex-wrap')
  })

  it('wraps from md up, where the strip has the room, exactly as before', () => {
    render(<Harness tabs={demoTabs} initial="one" />)

    const strip = screen.getByRole('tablist', { name: 'Demo tabs' })
    expect(strip).toHaveClass('md:flex-wrap', 'gap-x-4', 'gap-y-1', 'border-b')
    // The scrollbar stays available from md up: the hiding classes are all `max-md:`.
    expect(strip.className).not.toMatch(/(^|\s)(?:md:)?\[scrollbar-width/)
  })

  it('never lets a tab shrink or wrap its label inside the scrolling row', () => {
    render(<Harness tabs={demoTabs} initial="one" />)

    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).toHaveClass('shrink-0', 'whitespace-nowrap')
    }
  })

  it('keeps the tab semantics of the strip: roving tabindex, aria-selected and ArrowRight/Home/End', async () => {
    const user = userEvent.setup()
    render(<Harness tabs={demoTabs} initial="one" />)

    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('tabindex', '-1')
    screen.getByRole('tab', { name: 'One' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveFocus()
    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Three' })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('Tabs primitive — the active tab scrolls into view inside the strip', () => {
  const manyTabs: TabItem[] = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => ({ id, label: id.toUpperCase() }))

  type Box = { left: number; width: number }
  const rect = ({ left, width }: Box) => ({ left, right: left + width, width, top: 0, bottom: 44, height: 44, x: left, y: 0, toJSON: () => ({}) }) as DOMRect

  /** Gives the strip and its tabs the geometry jsdom does not have: a 300px window on 1000px of tabs. */
  function mockGeometry(strip: HTMLElement, opts: { scrollWidth?: number; scrollLeft?: number; boxes: Record<string, Box> }) {
    Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: opts.scrollWidth ?? 1000 })
    Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 300 })
    strip.scrollLeft = opts.scrollLeft ?? 0
    strip.getBoundingClientRect = () => rect({ left: 0, width: 300 })
    for (const [name, box] of Object.entries(opts.boxes)) {
      screen.getByRole('tab', { name }).getBoundingClientRect = () => rect(box)
    }
  }

  function setup(initial = 'a') {
    const scrollTo = vi.fn()
    const view = render(<Tabs tabs={manyTabs} active={initial} onChange={() => {}} ariaLabel="Many" />)
    const strip = screen.getByRole('tablist', { name: 'Many' })
    strip.scrollTo = scrollTo as unknown as typeof strip.scrollTo
    const select = (id: string) => view.rerender(<Tabs tabs={manyTabs} active={id} onChange={() => {}} ariaLabel="Many" />)
    return { strip, scrollTo, select }
  }

  it('centres a newly active tab that is cut off, clamped to the strip’s scroll range', () => {
    const { strip, scrollTo, select } = setup('a')
    mockGeometry(strip, { boxes: { E: { left: 500, width: 100 } } })

    select('e')

    // 0 + (500 - 0) - (300 - 100) / 2 = 400, inside [0, 1000 - 300].
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith({ left: 400 })
  })

  it('never scrolls past either end of the strip', () => {
    const { strip, scrollTo, select } = setup('a')
    mockGeometry(strip, { boxes: { F: { left: 900, width: 100 }, A: { left: -800, width: 100 } } })

    select('f')
    // 0 + (900 - 0) - 100 = 800, clamped to scrollWidth - clientWidth = 700.
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 700 })
    strip.scrollLeft = 700
    select('a')
    // 700 + (-800 - 0) - 100 = -200, clamped to 0.
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0 })
  })

  it('leaves the strip alone when the active tab is already fully visible', () => {
    const { strip, scrollTo, select } = setup('a')
    mockGeometry(strip, { boxes: { B: { left: 100, width: 100 } } })

    select('b')

    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('does nothing when the strip does not overflow (the wrapping layout from md up)', () => {
    const { strip, scrollTo, select } = setup('a')
    mockGeometry(strip, { scrollWidth: 300, boxes: { E: { left: 500, width: 100 } } })

    select('e')

    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('moves only the strip: it never calls scrollIntoView, which would scroll the page as well', () => {
    const scrollIntoView = vi.fn()
    const proto = Element.prototype as unknown as Record<string, unknown>
    proto.scrollIntoView = scrollIntoView
    try {
      const { strip, select } = setup('a')
      mockGeometry(strip, { boxes: { E: { left: 500, width: 100 } } })
      select('e')
      expect(scrollIntoView).not.toHaveBeenCalled()
    } finally {
      // jsdom has no scrollIntoView of its own: put the prototype back as it was.
      delete proto.scrollIntoView
    }
  })

  it('falls back to assigning scrollLeft where the element has no scrollTo', () => {
    const { strip, select } = setup('a')
    // An environment without Element.scrollTo (jsdom itself has none: setup() had to add one).
    ;(strip as unknown as { scrollTo?: unknown }).scrollTo = undefined
    mockGeometry(strip, { boxes: { E: { left: 500, width: 100 } } })

    select('e')

    expect(strip.scrollLeft).toBe(400)
  })

  it('does nothing for an unknown or disabled active id', () => {
    const { strip, scrollTo, select } = setup('a')
    mockGeometry(strip, { boxes: { E: { left: 500, width: 100 } } })

    select('missing')

    expect(scrollTo).not.toHaveBeenCalled()
  })
})
