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
  /**
   * Native date and date-time controls. A `type="date"` input is 165px wide at the 32px control height and a
   * `datetime-local` 241px (measured, Chrome), and `short` is narrower than that wherever these fields sit: 233px
   * for the incident wizard's Date & Time at 1280 (the AM/PM segment was cut off), and 105-137px in a participant-
   * detail section card at 1280-1536 (the year was cut off: "14/03/19"). The 12 columns are a viewport breakpoint
   * but the grid often lives in a much narrower card, so a date needs a span that clears its control everywhere:
   * six columns is the smallest that fits a date in the narrowest section card (26rem = 416px, 188px wide) and a
   * date-time in the narrowest wizard column at 1280 (358px). Below xl it is one of the two columns, as `short` is.
   */
  date: 'md:col-span-1 xl:col-span-6',
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
