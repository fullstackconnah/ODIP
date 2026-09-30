import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle } from 'lucide-react'

export type ScheduleSummaryProps = {
  tripCount: number
  staffAssigned: number
  staffTotal: number
  vehiclesAssigned: number
  vehiclesTotal: number
  conflicts: number
  /** 0–100, already rounded. */
  utilization: number
}

function Segment({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1 md:border-l md:border-[var(--color-border)] md:first:border-l-0">
      <dt className="text-[13px] text-[var(--color-muted-foreground)]">{label}</dt>
      <dd className="flex items-center gap-1.5 text-sm font-semibold tabular-nums text-[var(--color-foreground)]">{children}</dd>
    </div>
  )
}

/**
 * The schedule's one summary strip (density-redesign §7): what used to be a 126px "Active Trips" hero
 * tile plus a Resource Health card, as a single one-line strip of `label value` segments carrying the
 * same numbers. Kept local rather than a FactBar because FactBar stacks label over value (~48px); this
 * runs label and value on one line so it stays at the 34px row height (`--row-h`).
 */
export default function ScheduleSummary({
  tripCount, staffAssigned, staffTotal, vehiclesAssigned, vehiclesTotal, conflicts, utilization,
}: ScheduleSummaryProps) {
  return (
    <div
      role="group"
      aria-label="Resource health"
      className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)]"
    >
      <dl className="flex min-h-[var(--row-h)] flex-wrap items-center">
        <Segment label="Active Trips">{tripCount}</Segment>
        <Segment label="Staff">
          {staffAssigned}/{staffTotal}
          <CheckCircle className="h-4 w-4 text-[var(--color-primary)]" aria-hidden="true" />
        </Segment>
        <Segment label="Vehicles">
          {vehiclesAssigned}/{vehiclesTotal}
          <CheckCircle className="h-4 w-4 text-[var(--color-primary)]" aria-hidden="true" />
        </Segment>
        <Segment label="Conflicts">
          <span className={conflicts > 0 ? 'text-[var(--color-conflict)]' : undefined}>
            {String(conflicts).padStart(2, '0')}
          </span>
          {conflicts > 0
            ? <AlertTriangle className="h-4 w-4 text-[var(--color-conflict)]" aria-hidden="true" />
            : <CheckCircle className="h-4 w-4 text-[var(--color-primary)]" aria-hidden="true" />}
        </Segment>
        <Segment label="Utilization">
          <span className="text-[var(--color-primary)]">{utilization}%</span>
        </Segment>
      </dl>
    </div>
  )
}
