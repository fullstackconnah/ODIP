// TripStatusBadge component

export default function TripStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    Draft: 'bg-[var(--color-surface-container)] text-[var(--color-muted-foreground)]',
    Planning: 'bg-[var(--color-secondary-container)]/60 text-[var(--color-secondary)]',
    OpenForBookings: 'bg-[var(--color-primary-fixed)]/30 text-[var(--color-primary)]',
    WaitlistOnly: 'bg-amber-100 text-amber-700',
    Confirmed: 'bg-[var(--color-primary-fixed)] text-[#0f2000]',
    InProgress: 'bg-[#ffd7ef]/60 text-[#8e337b]',
    Completed: 'bg-[var(--color-surface-container)] text-[var(--color-muted-foreground)]',
  }
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${styles[status] || 'bg-[var(--color-surface-container)] text-[var(--color-muted-foreground)]'}`}>
      {status.replace(/([A-Z])/g, ' $1').trim()}
    </span>
  )
}
