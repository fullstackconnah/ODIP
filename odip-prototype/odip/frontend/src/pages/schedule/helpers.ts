export function formatDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })
}

export function toDateInput(dt: string) { return dt.slice(0, 10) }
export function toStartDt(d: string) { return d + 'T00:00:00' }
export function toEndDt(d: string) { return d + 'T23:59:59' }

// ── Trip column accent colors (cycling) ──

export const tripAccentText = [
  'text-[var(--color-primary)]',
  'text-[var(--color-secondary)]',
  'text-[#8e337b]',
  'text-amber-700',
]
