import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Pill, CalendarClock, FileText } from 'lucide-react'
import { useIncident } from '@/api/hooks'
import { Card } from '@/components/Card'
import { StatusBadge } from '@/components/StatusBadge'
import { formatDateAu, formatWithTimeZone } from '@/lib/utils'
import { ADMIN_STATUS_LABELS } from '@/api/types/medications'
import { SHIFT_NOTE_FLAG_LABELS, type ShiftNoteFlagCategory } from '@/lib/shiftNoteKeywords'
import { INCIDENT_TYPE_LABELS, INCIDENT_SEVERITY_LABELS, INCIDENT_STATUS_LABELS, QSC_REPORTING_STATUS_LABELS } from '@/api/types/enums'

/**
 * Connection map: a small local chip for a shift note's flagged categories — the portal's own
 * ShiftNotesSection/ShiftSlideOver only ever render this as a joined text sentence
 * (formatFlaggedCategoryList), not as a reusable exported chip component, so this is a
 * purpose-built one rather than an import from the portal (which owns different, larger,
 * page-specific components not meant to be imported cross-domain).
 */
function FlagChip({ category }: { category: ShiftNoteFlagCategory }) {
  return (
    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[var(--color-error-container)] text-[var(--color-on-error-container)] capitalize">
      {SHIFT_NOTE_FLAG_LABELS[category]}
    </span>
  )
}

export default function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: incident, isLoading } = useIncident(id)

  if (isLoading) return <div className="p-8 text-[var(--color-muted-foreground)]">Loading...</div>
  if (!incident) return <div className="p-8 text-[var(--color-muted-foreground)]">Incident not found</div>

  const hasContext = !!(incident.medicationContext || incident.shiftContext || incident.shiftNoteContext)
  const shiftNoteFlags = incident.shiftNoteContext ? incident.shiftNoteContext.flaggedCategories : []

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-4">
        <Link to="/incidents" className="p-2 rounded-lg hover:bg-[var(--color-accent)] transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl md:text-2xl font-bold text-[var(--color-foreground)] truncate">{incident.title}</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {INCIDENT_TYPE_LABELS[incident.incidentType] ?? incident.incidentType}
            {incident.involvedParticipantName ? ` · ${incident.involvedParticipantName}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={incident.severity} label={INCIDENT_SEVERITY_LABELS[incident.severity]} />
          <StatusBadge status={incident.status} label={INCIDENT_STATUS_LABELS[incident.status]} />
        </div>
        <Link
          to={`/incidents/${incident.id}/edit`}
          className="px-4 py-2 rounded-full border border-[var(--color-border)] text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-surface-container-low)] transition-all"
        >
          Edit
        </Link>
      </div>

      <Card className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-[var(--color-muted-foreground)] font-medium">Date &amp; time</p>
            <p className="text-[var(--color-foreground)]">{formatWithTimeZone(incident.incidentDateTime, null, { dateStyle: 'medium', timeStyle: 'short' })}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--color-muted-foreground)] font-medium">Location</p>
            <p className="text-[var(--color-foreground)]">{incident.location || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--color-muted-foreground)] font-medium">Reported by</p>
            <p className="text-[var(--color-foreground)]">{incident.reportedByName || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--color-muted-foreground)] font-medium">QSC reporting status</p>
            <p className="text-[var(--color-foreground)]">{QSC_REPORTING_STATUS_LABELS[incident.qscReportingStatus] ?? incident.qscReportingStatus}</p>
          </div>
        </div>
        <div>
          <p className="text-xs text-[var(--color-muted-foreground)] font-medium mb-1">Description</p>
          <p className="text-sm text-[var(--color-foreground)] whitespace-pre-wrap">{incident.description}</p>
        </div>
      </Card>

      {/* Connection map: only rendered when the incident is actually linked to a medication
          administration, a shift, or a shift note — a bare incident (the common case) shows no
          empty panel. */}
      {hasContext && (
        <Card className="space-y-4">
          <h2 className="font-semibold text-sm text-[var(--color-muted-foreground)]">Context</h2>

          {incident.medicationContext && (
            <div className="flex items-start gap-3">
              <Pill className="w-5 h-5 text-[var(--color-muted-foreground)] shrink-0 mt-0.5" aria-hidden="true" />
              <div className="space-y-0.5 text-sm">
                <p className="font-medium text-[var(--color-foreground)]">
                  {incident.medicationContext.medicationName} · {ADMIN_STATUS_LABELS[incident.medicationContext.status]}
                </p>
                <p className="text-[var(--color-muted-foreground)]">
                  {incident.medicationContext.administeredAt
                    ? formatWithTimeZone(incident.medicationContext.administeredAt, null, { dateStyle: 'medium', timeStyle: 'short' })
                    : 'Not administered'}
                  {incident.medicationContext.recordedByName ? ` · ${incident.medicationContext.recordedByName}` : ''}
                </p>
                {incident.involvedParticipantId && (
                  <Link
                    to={`/participants/${incident.involvedParticipantId}?tab=medications`}
                    className="inline-block text-sm font-medium text-[var(--color-primary)] hover:underline"
                  >
                    Open medications
                  </Link>
                )}
              </div>
            </div>
          )}

          {incident.shiftContext && (
            <div className="flex items-start gap-3">
              <CalendarClock className="w-5 h-5 text-[var(--color-muted-foreground)] shrink-0 mt-0.5" aria-hidden="true" />
              <div className="space-y-0.5 text-sm">
                <p className="font-medium text-[var(--color-foreground)]">
                  {formatDateAu(incident.shiftContext.date)} · {incident.shiftContext.startTime}–{incident.shiftContext.endTime}
                </p>
                <p className="text-[var(--color-muted-foreground)]">
                  {incident.shiftContext.participantName}
                  {incident.shiftContext.staffName ? ` · ${incident.shiftContext.staffName}` : ''}
                </p>
              </div>
            </div>
          )}

          {incident.shiftNoteContext && (
            <div className="flex items-start gap-3">
              <FileText className="w-5 h-5 text-[var(--color-muted-foreground)] shrink-0 mt-0.5" aria-hidden="true" />
              <div className="space-y-1.5 text-sm">
                <p className="text-[var(--color-foreground)]">"{incident.shiftNoteContext.excerpt}"</p>
                {shiftNoteFlags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {shiftNoteFlags.map((c) => <FlagChip key={c} category={c} />)}
                  </div>
                )}
                <p className="text-[var(--color-muted-foreground)]">{formatDateAu(incident.shiftNoteContext.createdAt)}</p>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
