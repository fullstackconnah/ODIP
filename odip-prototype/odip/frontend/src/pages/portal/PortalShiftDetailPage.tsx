import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, AlertTriangle, Accessibility, Armchair, Pill } from 'lucide-react'
import { usePortalShiftDetail } from '@/api/hooks'
import { StatusBadge } from '@/components/StatusBadge'
import { MedicationBadges } from '@/pages/medications/MedicationBadges'
import { ROUTINE_CATEGORY_LABELS } from '@/api/types/routines'
import { AT_RISK_PARTY_LABELS } from '@/api/types/risk-entries'
import { getRelevantRoutines } from '@/pages/rostering/lib/routines'
import { formatShiftTimeRange, formatDayAccessibleName, RATIO_LABELS } from '@/pages/rostering/lib/roster'
import { OVERNIGHT_SUPPORT_LABELS } from './lib/portal'

function Chip({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'warning' }) {
  const toneClass = tone === 'warning'
    ? 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]'
    : 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]'
  return <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${toneClass}`}>{children}</span>
}

export default function PortalShiftDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: shift, isLoading, isError, refetch } = usePortalShiftDetail(id)

  if (isLoading) {
    return (
      <div className="space-y-6 animate-fade-in pb-8">
        <span className="sr-only" role="status" aria-live="polite">Loading shift…</span>
        <div aria-hidden="true" className="space-y-6">
          <div className="h-4 w-32 rounded bg-[var(--color-accent)] animate-pulse" />
          <div className="bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] p-5 space-y-3">
            <div className="h-5 w-40 rounded bg-[var(--color-accent)] animate-pulse" />
            <div className="h-4 w-56 rounded bg-[var(--color-accent)] animate-pulse" />
          </div>
          <div className="bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] p-5 space-y-3">
            <div className="h-4 w-32 rounded bg-[var(--color-accent)] animate-pulse" />
            <div className="h-4 w-full rounded bg-[var(--color-accent)] animate-pulse" />
            <div className="h-4 w-2/3 rounded bg-[var(--color-accent)] animate-pulse" />
          </div>
        </div>
      </div>
    )
  }

  if (isError || !shift) {
    return (
      <div className="space-y-4 animate-fade-in">
        <Link to="/portal" className="inline-flex items-center gap-1 py-3 text-sm text-[var(--color-primary)] hover:underline">
          <ArrowLeft className="w-4 h-4" /> Back to My Shifts
        </Link>
        <p className="text-sm text-[var(--color-muted-foreground)]" role="alert">
          This shift couldn't be found. It may not be yours, it may have been removed from the roster, or the
          request may have failed to load — check your connection and try again.
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          className="inline-flex items-center justify-center h-11 px-4 rounded-lg border border-[var(--color-border)] text-sm font-medium hover:bg-[var(--color-accent)] transition-colors"
        >
          Try again
        </button>
      </div>
    )
  }

  const { participant } = shift
  const relevantRoutines = getRelevantRoutines(shift.routines, {
    serviceDate: shift.serviceDate,
    startTime: shift.startTime,
    endTime: shift.endTime,
    endsNextDay: shift.endsNextDay,
  })

  const mobilityChips: React.ReactNode[] = []
  if (participant.mobilityAidWheelchair) mobilityChips.push(<Chip key="wheelchair"><Accessibility className="w-3 h-3" /> Wheelchair</Chip>)
  if (participant.mobilityAidWalker) mobilityChips.push(<Chip key="walker">Walker</Chip>)
  for (const option of participant.mobilitySupportOptions) mobilityChips.push(<Chip key={option}>{option}</Chip>)

  const equipmentChips: React.ReactNode[] = []
  if (participant.requiresHiLoBed) equipmentChips.push(<Chip key="hilo">Hi-lo bed</Chip>)
  if (participant.requiresHoist) equipmentChips.push(<Chip key="hoist">Hoist</Chip>)
  if (participant.requiresShowerChair) equipmentChips.push(<Chip key="shower">Shower chair</Chip>)
  if (participant.requiresCommode) equipmentChips.push(<Chip key="commode">Commode</Chip>)
  if (participant.requiresStandingMachine) equipmentChips.push(<Chip key="standing">Standing machine</Chip>)

  return (
    <div className="space-y-6 animate-fade-in pb-8">
      <Link to="/portal" className="inline-flex items-center gap-1 py-3 text-sm text-[var(--color-primary)] hover:underline">
        <ArrowLeft className="w-4 h-4" /> Back to My Shifts
      </Link>

      {/* Shift time/status */}
      <div className="bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">{participant.fullName}</h1>
            <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
              {formatDayAccessibleName(shift.serviceDate)} · {formatShiftTimeRange(shift.startTime, shift.endTime)}
              {shift.endsNextDay && ' (+1 day)'}
            </p>
          </div>
          <StatusBadge status={shift.status} />
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <Chip>{RATIO_LABELS[shift.ratio] ?? shift.ratio}</Chip>
          {shift.nightType !== 'None' && <Chip>{shift.nightType}</Chip>}
          {participant.isHighSupport && <Chip tone="warning">High support</Chip>}
          {participant.isIntensiveSupport && <Chip tone="warning">Intensive support</Chip>}
          {participant.hasRestrictivePracticeFlag && (
            <Chip tone="warning"><AlertTriangle className="w-3 h-3" /> Restrictive practice</Chip>
          )}
        </div>
        {shift.notes && <p className="mt-3 text-sm whitespace-pre-wrap">{shift.notes}</p>}
      </div>

      {/* Participant summary */}
      <div className="bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] p-5 space-y-4">
        <h2 className="font-semibold flex items-center gap-2"><Armchair className="w-4 h-4" /> Participant summary</h2>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div>
            <p className="text-[var(--color-muted-foreground)] text-xs">Support ratio</p>
            <p>{RATIO_LABELS[participant.supportRatio] ?? participant.supportRatio}</p>
          </div>
          <div>
            <p className="text-[var(--color-muted-foreground)] text-xs">Overnight support</p>
            <p>{OVERNIGHT_SUPPORT_LABELS[participant.overnightSupport] ?? participant.overnightSupport}</p>
          </div>
        </div>
        {mobilityChips.length > 0 && (
          <div>
            <p className="text-[var(--color-muted-foreground)] text-xs mb-1">Mobility</p>
            <div className="flex flex-wrap gap-1.5">{mobilityChips}</div>
          </div>
        )}
        {equipmentChips.length > 0 && (
          <div>
            <p className="text-[var(--color-muted-foreground)] text-xs mb-1">Equipment</p>
            <div className="flex flex-wrap gap-1.5">{equipmentChips}</div>
          </div>
        )}
        {participant.mobilityNotes && (
          <div>
            <p className="text-[var(--color-muted-foreground)] text-xs mb-1">Mobility notes</p>
            <p className="text-sm whitespace-pre-wrap">{participant.mobilityNotes}</p>
          </div>
        )}
        {participant.equipmentRequirements && (
          <div>
            <p className="text-[var(--color-muted-foreground)] text-xs mb-1">Equipment requirements</p>
            <p className="text-sm whitespace-pre-wrap">{participant.equipmentRequirements}</p>
          </div>
        )}
        {participant.transportRequirements && (
          <div>
            <p className="text-[var(--color-muted-foreground)] text-xs mb-1">Transport requirements</p>
            <p className="text-sm whitespace-pre-wrap">{participant.transportRequirements}</p>
          </div>
        )}
        {participant.medicalSummary && (
          <div>
            <p className="text-[var(--color-muted-foreground)] text-xs mb-1">Medical summary</p>
            <p className="text-sm whitespace-pre-wrap">{participant.medicalSummary}</p>
          </div>
        )}
        {participant.behaviourRiskSummary && (
          <div>
            <p className="text-[var(--color-muted-foreground)] text-xs mb-1">Behaviour / risk summary</p>
            <p className="text-sm whitespace-pre-wrap">{participant.behaviourRiskSummary}</p>
          </div>
        )}
      </div>

      {/* Routines relevant to this shift */}
      <div className="bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] p-5 space-y-3">
        <h2 className="font-semibold">Routines for this shift</h2>
        {relevantRoutines.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">No routines recorded for this shift.</p>
        ) : (
          <ul className="space-y-2">
            {relevantRoutines.map(routine => (
              <li
                key={routine.id}
                className={`rounded-sm border px-3 py-2 text-sm ${
                  routine.isCritical ? 'border-[var(--color-error-container)] bg-[var(--color-error-container)]/20' : 'border-[var(--color-border)]'
                }`}
              >
                <div className="flex items-center gap-1.5 flex-wrap">
                  {routine.isCritical && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[var(--color-on-error-container)]" aria-label="Critical" />}
                  <span className="font-medium">{routine.title}</span>
                  <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-[var(--color-muted)] text-[var(--color-muted-foreground)] whitespace-nowrap">
                    {ROUTINE_CATEGORY_LABELS[routine.category]}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
                  {routine.startTime && routine.endTime ? formatShiftTimeRange(routine.startTime, routine.endTime) : 'Untimed'}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{routine.description}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Risks for this participant (INTAKE-09) — active entries only, same read-only pattern as
          Routines above; not shift-window filtered, since a risk applies regardless of time of day. */}
      <div className="bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] p-5 space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Risks</h2>
        {shift.riskEntries.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">No risks recorded for this participant.</p>
        ) : (
          <ul className="space-y-2">
            {shift.riskEntries.map(entry => (
              <li key={entry.id} className="rounded-sm border border-[var(--color-border)] px-3 py-2 text-sm">
                <Chip>{AT_RISK_PARTY_LABELS[entry.atRiskParty]}</Chip>
                <p className="mt-1 whitespace-pre-wrap">{entry.description}</p>
                {entry.mitigationNotes && (
                  <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                    <span className="font-medium">Mitigation:</span> {entry.mitigationNotes}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Active medications summary */}
      <div className="bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] p-5 space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><Pill className="w-4 h-4" /> Active medications</h2>
        {shift.medications.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">No active medications recorded for this participant.</p>
        ) : (
          <ul className="space-y-2">
            {shift.medications.map(med => (
              <li key={med.id} className="rounded-sm border border-[var(--color-border)] px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-medium">
                    {med.name}{med.strength ? ` ${med.strength}` : ''}
                  </span>
                  <MedicationBadges medication={med} />
                </div>
                {med.doseDescription && <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">{med.doseDescription}</p>}
                <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
                  {med.type === 'Prn'
                    ? med.prnIndication ?? 'PRN — as needed'
                    : med.timesOfDay ? `Times: ${med.timesOfDay}` : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
