import { TAP_AREA } from './tapArea'

// Button's look, in a file of its own so a control that must look like a Button without being one (Dropdown's menu trigger) can share it.
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'ghost-danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

const BASE = 'inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]'

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:bg-[var(--color-primary)]/90 shadow-md shadow-[var(--color-primary)]/20',
  secondary: 'border border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-foreground)] hover:bg-[var(--color-accent)]',
  danger: 'bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)] hover:opacity-90',
  // Touch has no hover: keep the action's boundary visible without changing its density or hit area.
  ghost: 'text-[var(--color-muted-foreground)] pointer-coarse:bg-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-primary)]',
  // A ghost button for a destructive action (Delete, Remove): destructive text at rest, an error-container wash on hover.
  // It is a variant, not a ghost plus a colour className, because Button does not merge classNames: two text-colour
  // utilities on one element are resolved by stylesheet order (alphabetical among arbitrary values), not attribute order,
  // and ghost's muted / primary colours won, so those buttons lost their red. A variant carries ONE colour set.
  'ghost-danger': 'text-[var(--color-destructive)] pointer-coarse:bg-[var(--color-error-container)] hover:bg-[var(--color-error-container)] hover:text-[var(--color-destructive)]',
}

// Heights come from the density tokens (h-[var(--control-h-sm)] = 24px / h-[var(--control-h)] =
// 32px, both flipping to their Comfortable value automatically under `pointer: coarse`). `lg`
// has no dedicated token in the spec's table, so it's derived as control-h + 4px, which lands on
// the spec's 36px compact / 48px coarse values without hard-coding either.
const SIZE: Record<ButtonSize, string> = {
  sm: 'h-[var(--control-h-sm)] px-3 text-xs',
  md: 'h-[var(--control-h)] px-4 text-sm',
  lg: 'h-[calc(var(--control-h)+4px)] px-4 text-sm',
}

// iconOnly is a fixed square off the same token as `sm` (h/w = --control-h-sm, no padding — the
// centred icon supplies the visual weight). shrink-0 keeps the square from being squeezed in a
// crowded flex row of actions.
const ICON_ONLY = 'h-[var(--control-h-sm)] w-[var(--control-h-sm)] p-0 shrink-0'

/** The class list of a `Button` of this variant and size. */
export function buttonClasses(variant: ButtonVariant, size: ButtonSize, iconOnly = false, className?: string): string {
  const sizeClass = iconOnly ? ICON_ONLY : SIZE[size]
  // `sm` and `iconOnly` are --control-h-sm: 24px on a mouse, 36px under `pointer: coarse` — the only
  // Button shapes that stay below a 44px target on touch. Spec §1 pads their hit area to 44px; TAP_AREA
  // does it without changing the size (a 0px floor on a mouse, so the desktop look is byte-for-byte
  // what it was). `md` (32 / 44) and `lg` (36 / 48) already reach 44px there and need nothing.
  const hitArea = iconOnly || size === 'sm' ? TAP_AREA : ''
  return `${BASE} ${VARIANT[variant]} ${sizeClass} ${hitArea} ${className ?? ''}`
}
