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
