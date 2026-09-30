/**
 * Density redesign §6 "Width by content" — shared 12-column form grid + field-span classes so
 * every create/edit page, wizard step, and modal form body sizes fields by content instead of by
 * card width. Fields declare a span (short/medium/long); the grid collapses responsively:
 *
 *   - < md (768px): 1 column, every field full width.
 *   - md - 1279px:  2 columns; short/medium fields take 1 column, long fields take both.
 *   - >= 1280px:    12 columns; short = 3, medium = 6, long = 12.
 *
 * Usage: `<div className={formGrid}>` wrapping `<FormField className={span.short}>` etc.
 */
export const formGrid =
  'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-x-[var(--field-gap-x)] gap-y-[var(--field-gap-y)]'

export const span = {
  /** Codes, region, numbers, counts, dates, durations, status, small selects. */
  short: 'md:col-span-1 xl:col-span-3',
  /** Names, destination, coordinator/select pickers, email, phone. */
  medium: 'md:col-span-1 xl:col-span-6',
  /** Notes, address, descriptions, textareas. */
  long: 'md:col-span-2 xl:col-span-12',
} as const

/**
 * Modal / side-panel variant: the container is far narrower than the viewport, so the viewport
 * breakpoints above would over-divide it. Two columns from `sm`; long fields span both.
 */
export const modalGrid =
  'grid grid-cols-1 sm:grid-cols-2 gap-x-[var(--field-gap-x)] gap-y-[var(--field-gap-y)]'

export const modalSpan = {
  half: 'sm:col-span-1',
  full: 'sm:col-span-2',
} as const
