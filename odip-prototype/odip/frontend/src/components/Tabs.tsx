import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

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
 * - Overflow: the tablist scrolls horizontally on small viewports so 11-tab pages like
 *   `ParticipantDetailPage` don't overflow the page gutter. Long strips wrap via `flex-wrap`
 *   too — billing-style 3-tab pages stay on one line; longer strips roll over gracefully.
 */
export function Tabs({ tabs, active, onChange, ariaLabel = 'Tabs', className }: TabsProps) {
  const baseId = useId()
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})

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
        role="tablist"
        aria-label={ariaLabel}
        // flex-wrap keeps short strips on one line (billing's 3-tab look) but lets 11-tab
        // participant detail roll onto a second row instead of overflowing. overflow-x-auto
        // is the safety net for >7ish tabs on narrow viewports — it scrolls rather than
        // overflowing the page gutter.
        className="flex flex-wrap gap-x-4 gap-y-1 border-b border-[var(--color-border)] overflow-x-auto"
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
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-1 whitespace-nowrap ${
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
                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
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
