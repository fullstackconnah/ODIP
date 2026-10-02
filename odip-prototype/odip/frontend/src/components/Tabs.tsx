import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

/**
 * One tab in the consolidated Tabs primitive.
 *
 * - `content` is optional: when present, the primitive renders the panel itself (the legacy
 *   "I render my own panel" usage — currently only `ParticipantsHubPage`). When absent, the
 *   caller renders panels itself outside the tablist (the legacy `TabNav` usage, now used
 *   everywhere else). The two modes share every accessibility and keyboard guarantee; the
 *   only difference is who owns the panel markup.
 * - `icon` is rendered before the label at the same size as billing's pill icon (`w-4 h-4`).
 * - `badge` renders an inline count next to the label (matches the legacy trip-detail pill).
 * - `disabled` marks a tab inert and skips it during keyboard navigation.
 */
export type TabItem = {
  /** Stable identifier used by `active` / `onChange` and for the tab's id + aria-controls. */
  id: string
  /** Visible label. */
  label: ReactNode
  /** Optional inline icon (lucide-style component). */
  icon?: React.ComponentType<{ className?: string }>
  /** Optional count badge — renders inline next to the label (e.g. "Incidents (3)"). */
  badge?: number
  /** Panel content rendered when this tab is active. If omitted, the parent renders panels. */
  content?: ReactNode
  /** Disable a tab without removing it from the strip. */
  disabled?: boolean
  /**
   * When the parent owns panel rendering (no `content` set), pass the id of the element
   * it renders for this tab's panel. The primitive then sets `aria-controls` to that id
   * so screen readers can wire the tab to its panel. Ignored when `content` is provided
   * — the primitive always points at its own inline panel in that case.
   */
  panelId?: string
}

export type TabsProps = {
  tabs: TabItem[]
  active: string
  onChange: (id: string) => void
  /** Accessible name for the tablist. Defaults to "Tabs". */
  ariaLabel?: string
  /**
   * Prefix for the ids this strip generates (`${idPrefix}-tab-${id}`, and `${idPrefix}-panel-${id}` for an inline panel). Defaults to a
   * generated unique one. A page that renders its OWN tabpanel (`panelId`) sets it so that panel can name its tab: `aria-labelledby=
   * "trip-tab-bookings"` is only true when the strip made that id.
   */
  idPrefix?: string
  className?: string
}

/**
 * Consolidated accessible tab primitive. Visual style matches the billing screen
 * (underline + optional lucide icon, no fill on active, no rounded-t-lg card). Behaviour
 * follows the WAI-ARIA APG tabs-with-automatic-activation pattern:
 *
 * - Container is a real `role="tablist"`.
 * - Each tab is a `role="tab"` button with `aria-selected` and `aria-controls` pointing at
 *   its panel (or at a panel id the parent is responsible for rendering when `content` is
 *   omitted).
 * - When `content` is provided on the active tab, a `role="tabpanel"` is rendered with
 *   `aria-labelledby` pointing back at the tab.
 * - Roving tabindex: only the active tab is in the page tab order; the rest are
 *   `tabIndex={-1}` but reachable via arrow keys.
 * - Keyboard: ArrowLeft / ArrowRight (with wrap) move between tabs; Home / End jump to the
 *   first / last enabled tab. Disabled tabs are skipped.
 * - Falls back to the first enabled tab when the parent's `active` doesn't match any tab
 *   or matches a disabled tab, so the roving tabindex never strands every tab at -1.
 * - Touch target: every tab has a `--tap-min` height floor — 0 (no change: `py-2` + a 20px line + the
 *   2px underline is ~38px) on a mouse, 44px under `pointer: coarse` so a fingertip lands on it. The
 *   token flips; the component doesn't branch on the pointer type.
 * - Overflow: below md (768px) the strip is ONE row that scrolls sideways (`flex-nowrap` +
 *   `overflow-x-auto`, scrollbar hidden), so an 11-tab page like `ParticipantDetailPage` costs a
 *   single 44px row on a phone instead of five wrapped ones (~240px before any content). The active
 *   tab is scrolled into view inside the strip when it changes. From md up the strip wraps
 *   (`md:flex-wrap`) instead: billing-style 3-tab pages stay on one line and longer strips roll
 *   over onto a second row, exactly as before.
 */
export function Tabs({ tabs, active, onChange, ariaLabel = 'Tabs', idPrefix, className }: TabsProps) {
  const generatedId = useId()
  const baseId = idPrefix ?? generatedId
  const listRef = useRef<HTMLDivElement | null>(null)
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  // Keep the active tab in view *inside the strip*. Below md the strip is a single scrolling row, so a
  // tab chosen near the edge (or arrived at by `?tab=`) can sit half off-screen. Only the strip's own
  // horizontal scroll is moved: `scrollIntoView` would also scroll the page to reveal the strip, which
  // is the wrong side effect on load. A tab that is already fully visible is left alone, and from md up
  // (a wrapping strip that never overflows) this does nothing. `scroll-smooth` on the strip animates
  // the move, and the global reduced-motion rule turns that off. jsdom has no `scrollTo` on elements,
  // hence the `scrollLeft` fallback.
  useEffect(() => {
    const list = listRef.current
    const tab = tabRefs.current[active]
    if (!list || !tab || list.scrollWidth <= list.clientWidth) return
    const listBox = list.getBoundingClientRect()
    const tabBox = tab.getBoundingClientRect()
    if (tabBox.left >= listBox.left && tabBox.right <= listBox.right) return
    const centred = list.scrollLeft + (tabBox.left - listBox.left) - (listBox.width - tabBox.width) / 2
    const left = Math.max(0, Math.min(centred, list.scrollWidth - list.clientWidth))
    if (typeof list.scrollTo === 'function') list.scrollTo({ left })
    else list.scrollLeft = left
  }, [active])

  // Resolve the initial focus target before seeding state: if the parent passes an
  // `active` id that doesn't correspond to a tab at all, or that corresponds to a disabled
  // tab, the roving tabindex would otherwise strand every tab at -1 on first render (no tab
  // in the page tab order until the user arrow-keys in). Falling back to the first enabled
  // tab keeps the keyboard contract intact on first paint.
  const initialFocusedId = (() => {
    const match = tabs.find(t => t.id === active && !t.disabled)
    if (match) return match.id
    return tabs.find(t => !t.disabled)?.id ?? active
  })()

  // `focusedId` tracks the tab that currently has DOM focus inside the tablist — this can
  // be ahead of `active` because arrow keys move focus first and the click/activation
  // commits the change. For automatic-activation mode the two stay in lockstep; the
  // explicit state is what drives the roving tabindex on each render.
  const [focusedId, setFocusedId] = useState(initialFocusedId)

  // Keep `focusedId` aligned with the controlled `active` when it changes from outside
  // (programmatic change, parent re-render) so the roving tabindex doesn't strand the focus
  // marker on a tab that is no longer active. Adjusting during render rather than in an
  // effect (React's "derive state from props" pattern) avoids a wasted commit and the
  // `react-hooks/set-state-in-effect` error. If the new `active` is disabled or unknown,
  // fall back to the first enabled tab (or keep the previous focus) so we never strand
  // every tab at tabindex=-1.
  const [lastActive, setLastActive] = useState(active)
  if (active !== lastActive) {
    setLastActive(active)
    const nextFocused = tabs.find(t => t.id === active && !t.disabled)?.id
      ?? tabs.find(t => !t.disabled)?.id
      ?? focusedId
    setFocusedId(nextFocused)
  }

  const enabledTabs = tabs.filter(t => !t.disabled)
  const move = (currentId: string, delta: number) => {
    if (enabledTabs.length === 0) return
    const idx = enabledTabs.findIndex(t => t.id === currentId)
    if (idx === -1) return
    const nextIdx = (idx + delta + enabledTabs.length) % enabledTabs.length
    const next = enabledTabs[nextIdx]
    setFocusedId(next.id)
    onChange(next.id)
    tabRefs.current[next.id]?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, tabId: string) => {
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault()
        move(tabId, -1)
        break
      case 'ArrowRight':
        event.preventDefault()
        move(tabId, 1)
        break
      case 'Home': {
        event.preventDefault()
        const first = enabledTabs[0]
        if (!first) return
        setFocusedId(first.id)
        onChange(first.id)
        tabRefs.current[first.id]?.focus()
        break
      }
      case 'End': {
        event.preventDefault()
        const last = enabledTabs[enabledTabs.length - 1]
        if (!last) return
        setFocusedId(last.id)
        onChange(last.id)
        tabRefs.current[last.id]?.focus()
        break
      }
    }
  }

  // Render panels only when at least one tab actually provides content. When the parent
  // owns panel rendering (every caller except ParticipantsHubPage), we leave the parent
  // free to mount its own conditional panels below — emitting empty tabpanel divs would
  // be misleading both for screen readers and for tests that count tabpanels.
  const renderPanels = tabs.some(t => t.content !== undefined)

  return (
    <div className={className}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel}
        // Below md: one row (`flex-nowrap`) that scrolls sideways (`overflow-x-auto`) with its scrollbar
        // hidden, like a native tab bar; each tab keeps its full 44px `--tap-min` height under a coarse
        // pointer. From md up: `md:flex-wrap` keeps short strips on one line (billing's 3-tab look) and
        // lets 11-tab participant detail roll onto a second row instead of overflowing; `overflow-x-auto`
        // stays as the safety net there too. The scrollbar is hidden only below md, where the strip is
        // the scrolling surface (Tailwind has no scrollbar-width utility, hence the arbitrary property
        // and the WebKit pseudo).
        className="flex flex-nowrap gap-x-4 gap-y-1 border-b border-[var(--color-border)] overflow-x-auto scroll-smooth md:flex-wrap max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden"
      >
        {tabs.map(tab => {
          const isActive = tab.id === active
          const isFocused = tab.id === focusedId
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              ref={el => { tabRefs.current[tab.id] = el }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={isActive}
              // `aria-controls` only points at a real element when we either own the panel
              // (inline `content`) or the caller handed us a `panelId` for its externally
              // rendered panel. Otherwise omit it — dangling references confuse screen
              // readers more than the missing hint does.
              aria-controls={tab.content !== undefined || tab.panelId !== undefined
                ? (tab.panelId ?? `${baseId}-panel-${tab.id}`)
                : undefined}
              tabIndex={isFocused && !tab.disabled ? 0 : -1}
              disabled={tab.disabled}
              onClick={() => {
                if (tab.disabled) return
                setFocusedId(tab.id)
                onChange(tab.id)
              }}
              onKeyDown={e => onKeyDown(e, tab.id)}
              className={`flex shrink-0 min-h-[var(--tap-min)] items-center gap-2 px-3 py-2 text-sm font-medium border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-1 whitespace-nowrap ${
                isActive
                  ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                  : 'border-transparent text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]'
              } ${tab.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              {Icon && <Icon className="w-4 h-4" />}
              <span>{tab.label}</span>
              {tab.badge !== undefined && tab.badge > 0 && (
                <span
                  aria-hidden="true"
                  className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                    isActive
                      ? 'bg-[var(--color-primary)]/15 text-[var(--color-primary)]'
                      : 'bg-[var(--color-surface-container)] text-[var(--color-muted-foreground)]'
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {renderPanels && tabs.map(tab => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${baseId}-panel-${tab.id}`}
          aria-labelledby={`${baseId}-tab-${tab.id}`}
          // Only the visible panel participates in the page tab order. Hidden panels are
          // already removed from focus by the `hidden` attribute, but a conditional tabIndex
          // keeps assistive tech from inferring a focusable hidden region.
          hidden={tab.id !== active}
          tabIndex={tab.id === active ? 0 : -1}
          className="mt-4 focus:outline-none"
        >
          {tab.id === active ? tab.content : null}
        </div>
      ))}
    </div>
  )
}
