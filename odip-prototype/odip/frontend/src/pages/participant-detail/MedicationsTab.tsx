import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown, Plus, Info, Pill } from 'lucide-react'
import { useParticipantMedications, useParticipantAdministrations } from '@/api/hooks'
import { Card } from '@/components/Card'
import { EmptyState } from '@/components/EmptyState'
import { PageState } from '@/components/PageState'
import { StatusBadge } from '@/components/StatusBadge'
import { formatDateAu, formatWithTimeZone } from '@/lib/utils'
import { usePermissions } from '@/lib/permissions'
import { queryPhase } from '@/lib/queryPhase'
import { MedicationBadges, ComplianceFlagChips } from '../medications'
import { SUPPORT_LEVEL_LABELS, ROUTE_LABELS, FORM_LABELS } from '@/api/types/medications'
import type { MedicationListDto, AdministrationDto } from '@/api/types/medications'
import { isIncidentTriggerOutcome, buildMarIncidentPrefill } from '@/lib/incidentPrefill'
import { plural } from '@/lib/format'
import { isPastDue } from '@/lib/deadline'
import { localIsoDate } from '@/lib/dateOnly'

/** The local calendar date `days` ago ("YYYY-MM-DD"). The UTC date (toISOString) is still yesterday before 10:00 in Sydney. */
function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return localIsoDate(d)
}

// NextReviewDue is a date held in a DateTime: overdue from the day AFTER (see lib/deadline isPastDue).
const isReviewOverdue = (dateStr: string | null) => isPastDue(dateStr)

/** Connection map: same helper as MarTab's — link to an already-filed incident, or an action to
 * file one now, for a Refused/Withheld/Missed/WrongMedication administration-history row. */
function IncidentLinkOrAction({ administration, canFile }: { administration: AdministrationDto; canFile: boolean }) {
  const navigate = useNavigate()
  if (!isIncidentTriggerOutcome(administration.status)) return null
  if (administration.incidentId) {
    return (
      <Link
        to={`/incidents/${administration.incidentId}`}
        className="text-xs text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded whitespace-nowrap"
      >
        Incident filed
      </Link>
    )
  }
  if (!canFile) return null
  return (
    <button
      type="button"
      onClick={() => navigate('/incidents/new', { state: buildMarIncidentPrefill(administration) })}
      className="text-xs text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded whitespace-nowrap"
    >
      File incident
    </button>
  )
}

const NO_MEDICATIONS: MedicationListDto[] = []

function MedicationCard({ medication }: { medication: MedicationListDto }) {
  return (
    <Link
      to={`/medications/${medication.id}/edit`}
      className="block p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] hover:border-[var(--color-primary)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-[var(--color-foreground)]">
            {medication.name}{medication.strength ? <span className="text-[var(--color-muted-foreground)]"> {medication.strength}</span> : null}
          </p>
          {medication.doseDescription && <p className="text-sm text-[var(--color-muted-foreground)]">{medication.doseDescription}</p>}
          <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
            {ROUTE_LABELS[medication.route]} · {FORM_LABELS[medication.form]} · {SUPPORT_LEVEL_LABELS[medication.supportLevel]}
            {medication.timesOfDay && ` · ${medication.timesOfDay}`}
          </p>
        </div>
        <StatusBadge status={medication.status} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <MedicationBadges medication={medication} />
        {medication.complianceFlags.length > 0 && <ComplianceFlagChips flags={medication.complianceFlags} />}
        {medication.nextReviewDue && (
          <span className={`text-xs ${isReviewOverdue(medication.nextReviewDue) ? 'text-[var(--color-destructive)] font-medium' : 'text-[var(--color-muted-foreground)]'}`}>
            Review due {formatDateAu(medication.nextReviewDue)}
          </span>
        )}
      </div>
    </Link>
  )
}

export default function MedicationsTab({ participantId }: { participantId: string | undefined }) {
  const { canManageMedications, canCreateIncidents } = usePermissions()
  const [showInactive, setShowInactive] = useState(false)
  const { data: medicationsData, isLoading, isError, refetch } = useParticipantMedications(participantId, true)
  const medications = medicationsData ?? NO_MEDICATIONS
  const { data: administrations = [] } = useParticipantAdministrations(participantId, isoDaysAgo(14), isoDaysAgo(0))

  const activeMeds = useMemo(() => medications.filter(m => m.status !== 'Ceased'), [medications])
  const inactiveMeds = useMemo(() => medications.filter(m => m.status === 'Ceased'), [medications])

  const activePsychotropicCount = useMemo(
    () => medications.filter(m => m.status === 'Active' && m.isPsychotropic).length,
    [medications]
  )
  const activeCount = useMemo(() => medications.filter(m => m.status === 'Active').length, [medications])
  const showPolypharmacyNotice = activeCount >= 5 || activePsychotropicCount >= 2

  // A failed request is not an empty list, and neither is one that has not run (paused offline): without data, say so instead of showing "no medications".
  const phase = queryPhase({ data: medicationsData, isLoading, isError })
  if (phase === 'loading') return <PageState kind="loading" noun="medication list" />
  if (phase === 'error') return <PageState kind="error" noun="medication list" onRetry={() => refetch()} />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-[var(--color-foreground)]">Medications</h2>
        {canManageMedications && participantId && (
          <Link
            to={`/medications/new?participantId=${participantId}`}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 transition-all shadow-md shadow-[var(--color-primary)]/20"
          >
            <Plus className="w-4 h-4" /> New medication
          </Link>
        )}
      </div>

      {showPolypharmacyNotice && (
        <Card className="bg-[var(--color-secondary-container)]/40 border-[var(--color-secondary-container)]">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-[var(--color-secondary)] shrink-0 mt-0.5" />
            <p className="text-sm text-[var(--color-foreground)]">
              <strong className="font-medium">Polypharmacy:</strong> {plural(activeCount, 'concurrent medication')} — NDIS guidance recommends a medication review every 3–6 months.
            </p>
          </div>
        </Card>
      )}

      {activeMeds.length === 0 ? (
        <EmptyState
          icon={Pill}
          title="No active medications"
          description="Add a medication to start tracking doses on the medication administration record."
          action={canManageMedications && participantId ? { label: 'Add medication', to: `/medications/new?participantId=${participantId}` } : undefined}
        />
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {activeMeds.map(m => <MedicationCard key={m.id} medication={m} />)}
        </div>
      )}

      {inactiveMeds.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowInactive(v => !v)}
            className="flex items-center gap-2 text-sm font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded transition-colors"
            aria-expanded={showInactive}
          >
            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${showInactive ? 'rotate-180' : ''}`} />
            Ceased medications ({inactiveMeds.length})
          </button>
          {showInactive && (
            <div className="grid sm:grid-cols-2 gap-3 mt-3">
              {inactiveMeds.map(m => <MedicationCard key={m.id} medication={m} />)}
            </div>
          )}
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-[var(--color-muted-foreground)] mb-2">Recent administrations (last 14 days)</h3>
        {administrations.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">No administrations recorded in the last 14 days.</p>
        ) : (
          <div className="bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] divide-y divide-[var(--color-border)] overflow-x-auto">
            {administrations.map(a => (
              <div key={a.id} className="p-3 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-[var(--color-foreground)]">{a.medicationName}{a.doseGiven ? ` · ${a.doseGiven}` : ''}</p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    {formatWithTimeZone(a.administeredAt, a.administeredAtTimeZone, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    {a.recordedByName ? ` · ${a.recordedByName}` : ''}
                  </p>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1">
                  <StatusBadge status={a.status} />
                  <IncidentLinkOrAction administration={a} canFile={canCreateIncidents} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
