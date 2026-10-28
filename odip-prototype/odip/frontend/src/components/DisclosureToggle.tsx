import { ChevronDown } from 'lucide-react'

/**
 * The show/hide row for a collapsed list ("Inactive (2)", "Archived (1)"): a muted text button with a chevron that
 * turns over when open. `controls` is the id of the panel it reveals. The `--tap-min` floor is 0px on a mouse and
 * 44px under a coarse pointer, so the desktop row does not grow.
 */
export function DisclosureToggle({ label, open, onToggle, controls }: { label: string; open: boolean; onToggle: () => void; controls?: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      className="flex min-h-[var(--tap-min)] items-center gap-2 text-sm font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded transition-colors"
    >
      <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      {label}
    </button>
  )
}
