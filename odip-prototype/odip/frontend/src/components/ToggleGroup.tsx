import type { KeyboardEvent } from 'react'

export type ToggleOption = {
  key: string
  label: string
}

export type ToggleGroupProps = {
  options: ToggleOption[]
  value: string
  onChange: (key: string) => void
  className?: string
  /**
   * Accessible name for the `role="radiogroup"` element. Optional but strongly recommended
   * whenever the group isn't already labelled another way (e.g. a FormField wrapper whose
   * `cloneElement` labelling can reach the control directly) — a bare ToggleGroup carries no
   * accessible name of its own otherwise. In particular, a ToggleGroup passed as the render
   * output of an RHF `<Controller>` inside FormField is NOT reachable by FormField's
   * `aria-labelledby` cloning (FormField clones onto the `<Controller>` element itself, which
   * doesn't forward unknown props to its render function — see FormField.tsx's own comment on
   * this), so that shape must pass `ariaLabel` explicitly to get a real name at all.
   */
  ariaLabel?: string
}

// Every ToggleGroup caller passes a single tracked `value` and picks exactly one option — that's
// single-select-from-a-set, i.e. a radio group, not a set of independent toggle buttons (which is
// what aria-pressed communicates). role="radiogroup"/"radio" + aria-checked matches what this
// actually is, and gets a roving tabindex with arrow-key movement per the ARIA APG radio pattern
// (Tab enters/exits the group once; Left/Right/Up/Down move — and select — within it).
export function ToggleGroup({ options, value, onChange, className, ariaLabel }: ToggleGroupProps) {
  const selectedIndex = options.findIndex(opt => opt.key === value)

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      nextIndex = (index + 1) % options.length
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      nextIndex = (index - 1 + options.length) % options.length
    } else if (e.key === 'Home') {
      nextIndex = 0
    } else if (e.key === 'End') {
      nextIndex = options.length - 1
    }
    if (nextIndex === null) return
    e.preventDefault()
    const next = options[nextIndex]
    onChange(next.key)
    // Move focus with the roving tabindex so the newly-checked radio is the one Tab lands on next time.
    const group = e.currentTarget.closest('[role="radiogroup"]')
    const target = group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex]
    target?.focus()
  }

  return (
    <div role="radiogroup" aria-label={ariaLabel} className={`flex gap-2 ${className ?? ''}`}>
      {options.map((opt, index) => {
        const checked = value === opt.key
        // Roving tabindex: only the checked option (or the first, if none matches) is a Tab stop;
        // arrow keys move focus + selection between the rest, per the native radio-group pattern.
        const isTabStop = checked || (selectedIndex === -1 && index === 0)
        return (
          <button
            key={opt.key}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={isTabStop ? 0 : -1}
            onClick={() => onChange(opt.key)}
            onKeyDown={e => handleKeyDown(e, index)}
            className={`h-[var(--control-h)] px-3 rounded-[var(--radius-sm)] text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] ${
              checked
                ? 'bg-[var(--color-primary)] text-white'
                : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]'
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
