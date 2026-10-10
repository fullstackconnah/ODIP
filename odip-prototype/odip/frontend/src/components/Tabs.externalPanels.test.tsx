import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Layers, Users, FileText, Pill } from 'lucide-react'
import { Tabs, type TabItem } from './Tabs'

// These tests focus on the parent-rendered-panel mode (`content` omitted) that all 8
// migrated pages now use (Billing, Participant detail, Staff detail, Medications, Settings,
// Incidents, Qualifications, PortalLeave, Trip detail). The inline-panel mode is covered
// by `Tabs.test.tsx`. Both modes share the same keyboard + ARIA + roving-tabindex + fallback
// contracts; the tests below pin those contracts for the external-panel branch too so a
// future regression in either branch can't pass without failing both.

afterEach(() => cleanup())

const externalTabs: TabItem[] = [
  { id: 'funding', label: 'Funding Sources', icon: Layers },
  { id: 'bookings', label: 'Service Bookings', icon: Users },
  { id: 'events', label: 'Billable Events', icon: FileText },
]

// The parent owns panel rendering — same call shape as the pages that own their panels.
function ExternalHarness({
  tabs = externalTabs,
  initial = 'funding',
  withPanelIds = false,
}: {
  tabs?: TabItem[]
  initial?: string
  withPanelIds?: boolean
}) {
  const [active, setActive] = useState(initial)
  return (
    <div>
      <Tabs
        tabs={withPanelIds ? tabs.map(t => ({ ...t, panelId: `panel-${t.id}` })) : tabs}
        active={active}
        onChange={setActive}
        ariaLabel="Billing sections"
      />
      {/* Parent owns panel content; the parent-conditional pattern the migrated pages use. */}
      <div data-testid="panels">
        {tabs.map(t => (
          <div
            key={t.id}
            id={withPanelIds ? `panel-${t.id}` : undefined}
            role={withPanelIds ? 'tabpanel' : undefined}
            hidden={t.id !== active}
          >
            {t.id} content
          </div>
        ))}
      </div>
    </div>
  )
}

describe('Tabs primitive — parent-rendered panels (migrated pages)', () => {
  it('renders the tablist with role=tablist and every tab as role=tab, but no tabpanel', () => {
    // When `content` is omitted, the primitive deliberately does NOT emit tabpanels — the
    // parent owns them. This keeps the migrated pages from rendering empty/duplicate panels.
    render(<ExternalHarness initial="funding" />)
    expect(screen.getByRole('tablist', { name: 'Billing sections' })).toBeInTheDocument()
    for (const t of externalTabs) {
      expect(screen.getByRole('tab', { name: t.label as string })).toBeInTheDocument()
    }
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument()
  })

  it('does not advertise aria-controls when the parent does not pass panelId (no dangling refs)', () => {
    // Without panelId we omit aria-controls entirely — dangling aria-controls confuse screen
    // readers more than the missing hint does (WAI-ARIA APG allows tabs to omit it).
    render(<ExternalHarness initial="funding" />)
    for (const t of externalTabs) {
      const tab = screen.getByRole('tab', { name: t.label as string })
      expect(tab.getAttribute('aria-controls')).toBeNull()
    }
  })

  it('uses parent-supplied panelId for aria-controls when the parent owns the panel', () => {
    render(<ExternalHarness initial="funding" withPanelIds />)
    for (const t of externalTabs) {
      const tab = screen.getByRole('tab', { name: t.label as string })
      expect(tab.getAttribute('aria-controls')).toBe(`panel-${t.id}`)
      // And the id it points at actually exists in the DOM (the parent's panel).
      expect(document.getElementById(`panel-${t.id}`)).not.toBeNull()
    }
  })

  it('renders an icon next to the label when one is supplied', () => {
    render(<ExternalHarness initial="funding" />)
    // The icon is decorative — it must not be announced as part of the tab's name.
    const fundingTab = screen.getByRole('tab', { name: 'Funding Sources' })
    // lucide-react icons render an <svg>; we just confirm at least one svg lives inside the
    // tab so the visual billing style (icon + label) is preserved.
    expect(fundingTab.querySelector('svg')).not.toBeNull()
  })

  it('navigates between tabs with ArrowRight / ArrowLeft', async () => {
    const user = userEvent.setup()
    render(<ExternalHarness initial="funding" />)
    screen.getByRole('tab', { name: 'Funding Sources' }).focus()
    await user.keyboard('{ArrowRight}')
    const bookings = screen.getByRole('tab', { name: 'Service Bookings' })
    expect(bookings).toHaveFocus()
    expect(bookings).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Funding Sources' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'Funding Sources' })).toHaveAttribute('aria-selected', 'true')
  })

  it('wraps ArrowRight from the last tab back to the first', async () => {
    const user = userEvent.setup()
    render(<ExternalHarness initial="events" />)
    screen.getByRole('tab', { name: 'Billable Events' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Funding Sources' })).toHaveFocus()
  })

  it('Home jumps to the first tab and End jumps to the last', async () => {
    const user = userEvent.setup()
    render(<ExternalHarness initial="bookings" />)
    screen.getByRole('tab', { name: 'Service Bookings' }).focus()
    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Billable Events' })).toHaveFocus()
    await user.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: 'Funding Sources' })).toHaveFocus()
  })

  it('calls onChange with the tab id (string) when a tab is activated', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Tabs tabs={externalTabs} active="funding" onChange={onChange} ariaLabel="x" />)
    await user.click(screen.getByRole('tab', { name: 'Service Bookings' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('bookings')
  })

  it('falls back to the first enabled tab when `active` does not match any tab', () => {
    // This is the deliberate fallback behaviour the Tabs primitive has had since its first
    // a11y hardening — the migrated pages' URL-state (`?tab=`) can land on a stale id when
    // a tab is removed/hidden by permissions. The primitive must never render with no
    // active tab in the page tab order.
    render(<ExternalHarness initial="does-not-exist" />)
    // Funding Sources is the first enabled tab → it's the focused one (tabindex=0).
    expect(screen.getByRole('tab', { name: 'Funding Sources' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: 'Service Bookings' })).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('tab', { name: 'Billable Events' })).toHaveAttribute('tabindex', '-1')
  })

  it('falls back to the first ENABLED tab when `active` matches a disabled tab', () => {
    // Same contract the inline-panel tests cover, but pinned here for the external branch
    // — Participant detail's conditional Claims/Rostering/History tabs can leave `active`
    // pointing at a tab this role doesn't see, and the primitive must not strand the user.
    const tabs: TabItem[] = [
      { id: 'details', label: 'Details', icon: Users, disabled: true },
      { id: 'support', label: 'Support Profile', icon: FileText },
      { id: 'claims', label: 'Claims', icon: Pill, disabled: true },
    ]
    render(<ExternalHarness tabs={tabs} initial="details" />)
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('tab', { name: 'Support Profile' })).toHaveAttribute('tabindex', '0')
  })

  it('skips disabled tabs when navigating with arrow keys', async () => {
    const user = userEvent.setup()
    const tabs: TabItem[] = [
      { id: 'a', label: 'A', icon: Users },
      { id: 'b', label: 'B', icon: Layers, disabled: true },
      { id: 'c', label: 'C', icon: FileText },
    ]
    render(<ExternalHarness tabs={tabs} initial="a" />)
    screen.getByRole('tab', { name: 'A' }).focus()
    await user.keyboard('{ArrowRight}')
    const c = screen.getByRole('tab', { name: 'C' })
    expect(c).toHaveFocus()
    expect(c).toHaveAttribute('aria-selected', 'true')
  })

  it('renders a count badge when `badge` is provided on a tab', () => {
    // TripDetailPage uses the badge field for per-tab counts; we pin the contract here.
    const tabs: TabItem[] = [
      { id: 'overview', label: 'Overview', icon: Layers, badge: 0 },
      { id: 'bookings', label: 'Bookings', icon: Users, badge: 4 },
    ]
    render(<ExternalHarness tabs={tabs} initial="overview" />)
    // badge=0 → no count chip rendered. The label "Overview" should be present with no
    // numeric sibling (matches the Trip detail pill that hid zero counts so an empty list
    // doesn't shout "0" at users).
    const overviewTab = screen.getByRole('tab', { name: 'Overview' })
    expect(overviewTab.querySelector('span[aria-hidden="true"]')).toBeNull()
    // badge=4 → a chip with the count is rendered next to the label.
    const bookingsTab = screen.getByRole('tab', { name: 'Bookings' })
    const badge = bookingsTab.querySelector('span[aria-hidden="true"]')
    expect(badge).not.toBeNull()
    expect(badge!.textContent).toBe('4')
  })

  it('is one scrolling row below md and wraps from md up with many tabs (Participant detail has 11)', () => {
    // Construct the worst-case Participant detail tab set (Details + Contacts + Bookings +
    // Support + Medications + Notes + Routines + Restrictive + Claims + Rostering + History).
    const manyTabs: TabItem[] = [
      { id: 'details', label: 'Details', icon: Users },
      { id: 'contacts', label: 'Contacts', icon: Users },
      { id: 'bookings', label: 'Bookings', icon: Users },
      { id: 'support', label: 'Support Profile', icon: Users },
      { id: 'medications', label: 'Medications', icon: Users },
      { id: 'notes', label: 'Notes', icon: Users },
      { id: 'routines', label: 'Routines', icon: Users },
      { id: 'restrictive-practices', label: 'Restrictive Practices', icon: Users },
      { id: 'claims', label: 'Claims', icon: Users },
      { id: 'rostering', label: 'Rostering', icon: Users },
      { id: 'history', label: 'History', icon: Users },
    ]
    render(<ExternalHarness tabs={manyTabs} initial="details" />)
    // All 11 are rendered (the tablist scrolls horizontally below md and wraps from md up, instead
    // of overflowing the page gutter).
    expect(screen.getAllByRole('tab')).toHaveLength(11)
    // The tablist container itself owns the overflow handling: below md a single row that scrolls
    // sideways (`flex-nowrap` + `overflow-x-auto`; five wrapped 44px rows cost ~240px of a phone),
    // from md up `md:flex-wrap` so the strip rolls onto a second row on medium viewports (matches the
    // live layout observed on Participant detail with 11 tabs). A regression that drops the wrapper,
    // the nowrap or the md wrap would be caught here.
    const tablist = screen.getByRole('tablist', { name: 'Billing sections' })
    expect(tablist).toHaveClass('flex', 'flex-nowrap', 'overflow-x-auto', 'md:flex-wrap')
    expect(tablist).not.toHaveClass('flex-wrap')
    // And every tab is `whitespace-nowrap` so a long label like "Restrictive Practices"
    // doesn't reflow inside the tab button itself.
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.className).toContain('whitespace-nowrap')
    }
  })
})
