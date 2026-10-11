export function formatDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })
}

// ── Trip column accent colors (cycling) ──

export const tripAccentText = [
  'text-[var(--color-primary)]',
  'text-[var(--color-secondary)]',
  'text-[var(--color-on-accessible-container)]',
  'text-[var(--color-on-warning-container)]',
]
