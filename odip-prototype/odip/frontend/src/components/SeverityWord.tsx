const LOUD = new Set(['High', 'Urgent', 'Critical'])

/** A task priority or incident severity as a word, not a second pill: the row's one pill is its status. Quiet for Low and Medium, weighted and red from High up. */
export function SeverityWord({ value, label }: { value: string; label?: string }) {
  return <span className={LOUD.has(value) ? 'font-medium text-[var(--color-destructive)]' : 'text-[var(--color-muted-foreground)]'}>{label ?? value}</span>
}
