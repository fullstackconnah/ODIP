import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export type TabItem = {
  /** Stable identifier used by `active` / `onChange` and for the tab's id + aria-controls. */
  id: string
  /** Visible label. */
  label: ReactNode
  /** Panel content rendered when this tab is active. */
  content: ReactNode
  /** Optional: disable a tab without removing it from the strip. */
  disabled?: boolean
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
 * Accessible vertical-stacked tab strip with full keyboard support, per the WAI-ARIA APG
 * tabs-with-automatic-activation pattern.
 *
 * - Container is a real `role="tablist"`.
 * - Each tab is a `role="tab"` button with `aria-selected` and `aria-controls` pointing at
 *   its panel.
 * - Each panel is a `role="tabpanel"` with `aria-labelledby` pointing back at its tab and
 *   `tabIndex={0}` so a screen-reader user can land focus inside it.
 * - Roving tabindex: only the active tab is in the page tab order (`tabIndex={0}`); the
 *   rest are `tabIndex={-1}` but reachable via arrow keys.
 * - Keyboard: ArrowLeft / ArrowRight (with wrap) move between tabs; Home / End jump to the
 *   first / last. Disabled tabs are skipped when moving.
 */
export function Tabs({ tabs, active, onChange, ariaLabel = 'Tabs', className }: TabsProps) {
  const baseId = useId()
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  // `focusedId` tracks the tab that currently has DOM focus inside the tablist — this can
  // be ahead of `active` because arrow keys move focus first and the click/activation
  // commits the change. For automatic-activation mode the two stay in lockstep; the
  // explicit state is what drives the roving tabindex on each render.
  const [focusedId, setFocusedId] = useState(active)

  // Keep `focusedId` aligned with the controlled `active` when it changes from outside
  // (programmatic change, parent re-render) so the roving tabindex doesn't strand the focus
  // marker on a tab that is no longer active. Adjusting during render rather than in an
  // effect (React's "derive state from props" pattern) avoids a wasted commit and the
  // `react-hooks/set-state-in-effect` error.
  const [lastActive, setLastActive] = useState(active)
  if (active !== lastActive) {
    setLastActive(active)
    setFocusedId(active)
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

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="flex flex-wrap gap-1 border-b border-[var(--color-border)] mb-4"
      >
        {tabs.map(tab => {
          const isActive = tab.id === active
          const isFocused = tab.id === focusedId
          return (
            <button
              key={tab.id}
              ref={el => { tabRefs.current[tab.id] = el }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={isFocused && !tab.disabled ? 0 : -1}
              disabled={tab.disabled}
              onClick={() => {
                if (tab.disabled) return
                setFocusedId(tab.id)
                onChange(tab.id)
              }}
              onKeyDown={e => onKeyDown(e, tab.id)}
              className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-1 ${
                isActive
                  ? 'text-[var(--color-primary)] border-b-2 border-[var(--color-primary)] -mb-px bg-[var(--color-card)]'
                  : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-accent)]/50'
              } ${tab.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
      {tabs.map(tab => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${baseId}-panel-${tab.id}`}
          aria-labelledby={`${baseId}-tab-${tab.id}`}
          tabIndex={0}
          hidden={tab.id !== active}
        >
          {tab.id === active ? tab.content : null}
        </div>
      ))}
    </div>
  )
}
