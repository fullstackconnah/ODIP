// TripStatusBadge component

export default function TripStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    Draft: 'bg-[var(--color-surface-container)] text-[var(--color-muted-foreground)]',
    Planning: 'bg-[var(--color-secondary-container)]/60 text-[var(--color-secondary)]',
    OpenForBookings: 'bg-[var(--color-primary-fixed)]/30 text-[var(--color-primary)]',
    WaitlistOnly: 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]',
    Confirmed: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
    InProgress: 'bg-[var(--color-accessible-container)]/60 text-[var(--color-on-accessible-container)]',
    Completed: 'bg-[var(--color-surface-container)] text-[var(--color-muted-foreground)]',
  }
  // 12px, sentence case: the shared badge size (StatusBadge) instead of the old 10px tracked-uppercase pill.
  return (
    <span className={`shrink-0 whitespace-nowrap text-xs px-2 py-0.5 rounded-full font-semibold ${styles[status] || 'bg-[var(--color-surface-container)] text-[var(--color-muted-foreground)]'}`}>
      {status.replace(/([A-Z])/g, ' $1').trim()}
    </span>
  )
}
