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
})
