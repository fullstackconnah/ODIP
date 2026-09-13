import { Link } from 'react-router-dom'
import { StatusBadge } from '@/components/StatusBadge'
import { formatDateAu } from '@/lib/utils'
import type { IncidentListDto } from '@/api/types'

export default function IncidentsTab({ incidents }: { incidents: IncidentListDto[] }) {
  if (incidents.length === 0) {
    return (
      <p className="text-sm text-[var(--color-muted-foreground)] italic">
        No incidents recorded for this trip.
      </p>
    )
  }

  return (
    <div className="bg-[var(--color-card)] rounded-2xl border border-[var(--color-border)] divide-y divide-[var(--color-border)] overflow-hidden">
      {incidents.map(incident => (
        <Link
          key={incident.id}
          to={`/incidents/${incident.id}`}
          className="flex flex-wrap items-center gap-3 p-4 hover:bg-[var(--color-accent)]/50 transition-colors"
        >
          <span className="w-28 shrink-0 text-sm text-[var(--color-muted-foreground)]">
            {formatDateAu(incident.incidentDateTime)}
          </span>
          <span className="min-w-0 flex-1 truncate font-medium text-[var(--color-foreground)]">
            {incident.title}
          </span>
          <StatusBadge status={incident.severity} />
          <StatusBadge status={incident.status} />
        </Link>
      ))}
    </div>
  )
}
