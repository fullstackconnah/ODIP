import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, CalendarClock, Info, ShieldAlert } from 'lucide-react'
import { useMar, useParticipants, useRecordPrnOutcome } from '@/api/hooks'
import { Dropdown } from '@/components/Dropdown'
import { Card } from '@/components/Card'
import { Modal } from '@/components/Modal'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/StatusBadge'
import { formatDateAu, formatWithTimeZone } from '@/lib/utils'
import { usePermissions } from '@/lib/permissions'
import { RecordAdministrationModal } from './RecordAdministrationModal'
import { MissedMedicationGuidance } from './MissedMedicationGuidance'
import { ROUTE_LABELS, FORM_LABELS, PACKAGING_LABELS } from '@/api/types/medications'
import type { MarEntryDto, MarPrnDto, AdministrationDto } from '@/api/types/medications'
import { isIncidentTriggerOutcome, buildMarIncidentPrefill } from '@/lib/incidentPrefill'

/**
 * Connection map: for a Refused/Withheld/Missed/WrongMedication administration, either a link to
 * the incident already filed for it, or an action to file one now — reused as-is by the scheduled
 * slots below. PRN rows in this tab (MarPrnDto) don't carry a completed administration inline
 * (see MarPrnDto — no `administration` field), so this only applies to scheduled-slot rows here;
 * participant-detail/MedicationsTab's administration-history rows cover PRN doses via the flat
 * history list instead.
 */
function IncidentLinkOrAction({
  administration, strength, canFile,
}: { administration: AdministrationDto; strength?: string | null; canFile: boolean }) {
  const navigate = useNavigate()
  if (!isIncidentTriggerOutcome(administration.status)) return null
  if (administration.incidentId) {
    return (
      <Link
        to={`/incidents/${administration.incidentId}`}
        className="block text-xs text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded"
      >
        Incident filed
      </Link>
    )
  }
  if (!canFile) return null
  return (
    <button
      type="button"
      onClick={() => navigate('/incidents/new', { state: buildMarIncidentPrefill(administration, { strength }) })}
      className="block text-xs text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded"
    >
      File incident
    </button>
  )
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

const ADMIN_STATUS_COLOR_MAP: Record<string, string> = {
  administered: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
  refused: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
  withheld: 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]',
  missed: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
  wrongmedication: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
}

function SkeletonRow() {
  return (
    <div className="p-4 flex items-center gap-4 animate-pulse">
      <div className="h-4 w-32 bg-[var(--color-muted)] rounded" />
      <div className="h-4 w-40 bg-[var(--color-muted)] rounded" />
      <div className="h-4 flex-1 bg-[var(--color-muted)] rounded" />
      <div className="h-8 w-24 bg-[var(--color-muted)] rounded-lg" />
    </div>
  )
}

export default function MarTab() {
  const { canRecordAdministrations, canManageMedications, canCreateIncidents } = usePermissions()
  const [date, setDate] = useState(todayIso())
  const [participantId, setParticipantId] = useState('')
  const { data: mar, isLoading } = useMar(date, participantId || undefined)
  // INTAKE-08: the medication picker excludes drafts.
  const { data: participants = [] } = useParticipants({ isDraft: 'false' })
  const recordPrnOutcome = useRecordPrnOutcome()

  const [recordingSlot, setRecordingSlot] = useState<MarEntryDto | null>(null)
  const [recordingPrn, setRecordingPrn] = useState<MarPrnDto | null>(null)
  const [amendingSlot, setAmendingSlot] = useState<MarEntryDto | null>(null)
  const [outcomeFor, setOutcomeFor] = useState<MarPrnDto | null>(null)
  const [outcomeText, setOutcomeText] = useState('')
  // MED-01: lets a coordinator/support worker review the missed-medication guidance calmly,
  // outside the moment it's triggered by a MAR record — not tied to any specific medication.
  const [showGuidance, setShowGuidance] = useState(false)

  const groups = useMemo(() => {
    const entries = mar?.entries ?? []
    const byTime = new Map<string, MarEntryDto[]>()
    for (const e of entries) {
      const list = byTime.get(e.scheduledTime) ?? []
      list.push(e)
      byTime.set(e.scheduledTime, list)
    }
    return Array.from(byTime.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [mar])

  const participantItems = [
    { value: '', label: 'All participants' },
    ...participants.map(p => ({ value: p.id, label: p.fullName })),
  ]

  async function submitPrnOutcome() {
    if (!outcomeFor?.outcomePendingAdministrationId || !outcomeText.trim()) return
    await recordPrnOutcome.mutateAsync({ id: outcomeFor.outcomePendingAdministrationId, prnOutcome: outcomeText.trim() })
    setOutcomeFor(null)
    setOutcomeText('')
  }

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {/* Date navigation + participant filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 bg-[var(--color-muted)] rounded-lg p-1">
          <button
            type="button"
            onClick={() => setDate(d => addDays(d, -1))}
            className="p-2 rounded-md hover:bg-[var(--color-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 transition-colors"
            aria-label="Previous day"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setDate(todayIso())}
            className="px-3 py-1.5 text-sm font-medium rounded-md hover:bg-[var(--color-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 transition-colors"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setDate(d => addDays(d, 1))}
            className="p-2 rounded-md hover:bg-[var(--color-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 transition-colors"
            aria-label="Next day"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
          aria-label="Select date"
        />
        <span className="text-sm text-[var(--color-muted-foreground)]">{formatDateAu(date)}</span>
        <button
          type="button"
          onClick={() => setShowGuidance(true)}
          className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 transition-colors"
        >
          <Info className="w-4 h-4" aria-hidden="true" />
          Missed medication — what to do
        </button>
        <div className="ml-auto w-full sm:w-64">
          <Dropdown
            variant="form"
            value={participantId}
            onChange={setParticipantId}
            items={participantItems}
            searchable
            label="All participants"
          />
        </div>
      </div>

      {/* Scheduled slots */}
      {isLoading ? (
        <div className="bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] divide-y divide-[var(--color-border)] overflow-hidden">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No medications are scheduled for this date"
          description="Add medications from a participant's Medications tab."
        />
      ) : (
        <div className="space-y-5">
          {groups.map(([time, rows]) => (
            <div key={time}>
              <h3 className="text-sm font-semibold text-[var(--color-muted-foreground)] mb-2">{time}</h3>
              <div className="bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] divide-y divide-[var(--color-border)] overflow-hidden">
                {rows.map(entry => (
                  <div
                    key={entry.medicationId + entry.scheduledAt}
                    className={`p-4 flex flex-col md:flex-row md:items-center gap-3 md:gap-4 ${entry.isOverdue ? 'bg-[var(--color-error-container)]/35' : ''}`}
                  >
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          to={`/participants/${entry.participantId}?tab=medications`}
                          className="font-medium text-[var(--color-foreground)] hover:underline"
                        >
                          {entry.participantName}
                        </Link>
                        {entry.isOverdue && (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--color-destructive)] text-white">Overdue</span>
                        )}
                      </div>
                      <p className="text-sm text-[var(--color-foreground)]">
                        {entry.medicationName}{entry.strength ? ` ${entry.strength}` : ''}
                        {entry.doseDescription && <span className="text-[var(--color-muted-foreground)]"> · {entry.doseDescription}</span>}
                      </p>
                      <p className="text-xs text-[var(--color-muted-foreground)]">
                        {ROUTE_LABELS[entry.route]} · {FORM_LABELS[entry.form]}
                        {entry.packaging !== 'OriginalPackaging' && ` · ${PACKAGING_LABELS[entry.packaging]}`}
                      </p>
                      {entry.isHighRisk && (
                        <span
                          className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--color-error-container)] text-[var(--color-on-error-container)]"
                          title="Requires a witness for every administered dose"
                        >
                          <ShieldAlert className="w-3 h-3" /> High risk
                        </span>
                      )}
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      {entry.administration ? (
                        <div className="text-right space-y-1">
                          <StatusBadge status={entry.administration.status} colorMap={ADMIN_STATUS_COLOR_MAP} />
                          <p className="text-xs text-[var(--color-muted-foreground)]">
                            {formatWithTimeZone(entry.administration.administeredAt, entry.administration.administeredAtTimeZone, { hour: '2-digit', minute: '2-digit' })}
                            {entry.administration.recordedByName ? ` · ${entry.administration.recordedByName}` : ''}
                          </p>
                          {canManageMedications && (
                            <button
                              type="button"
                              onClick={() => setAmendingSlot(entry)}
                              className="text-xs text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded"
                            >
                              Amend
                            </button>
                          )}
                          <IncidentLinkOrAction
                            administration={entry.administration}
                            strength={entry.strength}
                            canFile={canCreateIncidents}
                          />
                        </div>
                      ) : canRecordAdministrations ? (
                        <button
                          type="button"
                          onClick={() => setRecordingSlot(entry)}
                          className="min-h-[44px] px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 active:scale-[0.98] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 transition-all"
                        >
                          Record
                        </button>
                      ) : (
                        <span className="text-xs text-[var(--color-muted-foreground)]">Not recorded</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* PRN medications */}
      {(mar?.prnMedications?.length ?? 0) > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--color-muted-foreground)]">PRN (as-needed) medications</h3>
          <div className="grid md:grid-cols-2 gap-4">
            {mar!.prnMedications.map(prn => {
              const remaining = prn.prnMaxDosesPer24h != null ? Math.max(prn.prnMaxDosesPer24h - prn.dosesInLast24h, 0) : null
              const ceilingReached = remaining === 0
              return (
                <Card key={prn.medicationId} className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link
                        to={`/participants/${prn.participantId}?tab=medications`}
                        className="font-medium hover:underline"
                      >
                        {prn.participantName}
                      </Link>
                      <p className="text-sm text-[var(--color-foreground)]">{prn.name}{prn.strength ? ` ${prn.strength}` : ''}</p>
                      {prn.doseDescription && <p className="text-xs text-[var(--color-muted-foreground)]">{prn.doseDescription}</p>}
                    </div>
                    {prn.outcomePendingAdministrationId && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)] whitespace-nowrap">Outcome due</span>
                    )}
                  </div>
                  {prn.prnIndication && (
                    <p className="text-xs text-[var(--color-muted-foreground)]"><strong className="font-medium text-[var(--color-foreground)]">Indication:</strong> {prn.prnIndication}</p>
                  )}
                  <div className="flex items-center justify-between text-sm">
                    <span className={ceilingReached ? 'font-medium text-[var(--color-destructive)]' : 'text-[var(--color-foreground)]'}>
                      {prn.dosesInLast24h}{prn.prnMaxDosesPer24h != null ? ` of ${prn.prnMaxDosesPer24h}` : ''} doses in last 24h
                      {remaining != null && <span className="text-[var(--color-muted-foreground)]"> · {remaining} remaining</span>}
                    </span>
                    <span className="text-xs text-[var(--color-muted-foreground)]">Last dose {relativeTime(prn.lastDoseAt)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {canRecordAdministrations && (
                      <button
                        type="button"
                        title={ceilingReached ? 'Dose ceiling reached for the last 24 hours — you can still record it, but it will require acknowledgement.' : undefined}
                        onClick={() => setRecordingPrn(prn)}
                        className="min-h-[44px] px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 transition-all"
                      >
                        Record
                      </button>
                    )}
                    {prn.outcomePendingAdministrationId && (
                      <button
                        type="button"
                        onClick={() => setOutcomeFor(prn)}
                        className="text-sm text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded"
                      >
                        Record outcome
                      </button>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>
        </div>
      )}

      {recordingSlot && (
        <RecordAdministrationModal
          open
          onClose={() => setRecordingSlot(null)}
          medicationId={recordingSlot.medicationId}
          medicationName={recordingSlot.medicationName}
          strength={recordingSlot.strength}
          doseDescription={recordingSlot.doseDescription}
          isHighRisk={recordingSlot.isHighRisk}
          isPrn={false}
          scheduledAt={recordingSlot.scheduledAt}
          packaging={recordingSlot.packaging}
          pharmacyName={recordingSlot.pharmacyName}
          pharmacyPhone={recordingSlot.pharmacyPhone}
        />
      )}

      {amendingSlot?.administration && (
        <RecordAdministrationModal
          open
          onClose={() => setAmendingSlot(null)}
          medicationId={amendingSlot.medicationId}
          medicationName={amendingSlot.medicationName}
          strength={amendingSlot.strength}
          doseDescription={amendingSlot.doseDescription}
          isHighRisk={amendingSlot.isHighRisk}
          isPrn={false}
          scheduledAt={amendingSlot.scheduledAt}
          packaging={amendingSlot.packaging}
          pharmacyName={amendingSlot.pharmacyName}
          pharmacyPhone={amendingSlot.pharmacyPhone}
          existingAdministration={amendingSlot.administration}
        />
      )}

      {recordingPrn && (
        <RecordAdministrationModal
          open
          onClose={() => setRecordingPrn(null)}
          medicationId={recordingPrn.medicationId}
          medicationName={recordingPrn.name}
          strength={recordingPrn.strength}
          doseDescription={recordingPrn.doseDescription}
          isHighRisk={false}
          isPrn
          packaging={recordingPrn.packaging}
          pharmacyName={recordingPrn.pharmacyName}
          pharmacyPhone={recordingPrn.pharmacyPhone}
        />
      )}

      <Modal
        open={showGuidance}
        onClose={() => setShowGuidance(false)}
        title="Missed medication — what to do"
        size="lg"
        footer={
          <button
            type="button"
            onClick={() => setShowGuidance(false)}
            className="px-4 py-2 text-sm rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary)]/90 transition-all"
          >
            Close
          </button>
        }
      >
        <MissedMedicationGuidance />
      </Modal>

      <Modal
        open={!!outcomeFor}
        onClose={() => { setOutcomeFor(null); setOutcomeText('') }}
        title={`Record PRN outcome — ${outcomeFor?.name ?? ''}`}
        size="sm"
        footer={
          <>
            <button
              type="button"
              onClick={() => { setOutcomeFor(null); setOutcomeText('') }}
              className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!outcomeText.trim() || recordPrnOutcome.isPending}
              onClick={submitPrnOutcome}
              className="px-4 py-2 text-sm rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary)]/90 disabled:opacity-50 transition-all"
            >
              {recordPrnOutcome.isPending ? 'Saving...' : 'Save outcome'}
            </button>
          </>
        }
      >
        <label className="block text-sm font-medium mb-1.5 text-[var(--color-muted-foreground)]" htmlFor="prn-outcome-text">
          Outcome <span aria-hidden="true">*</span>
        </label>
        <textarea
          id="prn-outcome-text"
          rows={4}
          required
          value={outcomeText}
          onChange={e => setOutcomeText(e.target.value)}
          placeholder="Describe the effect of the dose — e.g. settled within 30 minutes"
          className="w-full px-4 py-2.5 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
        />
      </Modal>
    </div>
  )
}
