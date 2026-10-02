import { useState } from 'react'
import { Check, Pill, ListChecks } from 'lucide-react'
import { useCheckRoutine, useUncheckRoutine } from '@/api/hooks'
import { Button } from '@/components/Button'
import { TAP_AREA } from '@/components/tapArea'
import { TONE } from '@/lib/tone'
import { formatWithTimeZone, extractErrorMessage } from '@/lib/utils'
import { apiErrorMessages } from '@/lib/shiftPackageErrors'
import { buildChecklist, clockLabel, type ChecklistItem } from './checklist'
import { Chip, Section } from './ui'
import type { DoseTarget } from './DoseSheet'
import type { PortalDoseSlotDto, PortalPrnDto, PortalShiftDetailDto, PortalShiftRoutineDto } from '@/api/types'

const OUTCOME_WORDS: Record<string, string> = {
  Administered: 'Given',
  Refused: 'Refused',
  Withheld: 'Withheld',
  Missed: 'Not given this shift',
  WrongMedication: 'Wrong medication',
}

function DoseRow({ slot, tz, canAct, onRecord }: { slot: PortalDoseSlotDto; tz: string; canAct: boolean; onRecord: (t: DoseTarget) => void }) {
  const outcome = slot.outcome
  const overdue = slot.state === 'Overdue'
  return (
    <li className={`rounded-lg border px-3 py-2 text-sm ${overdue ? `${TONE.warning.soft} border-[var(--color-on-warning-container)]/30` : 'border-[var(--color-border)]'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium flex items-center gap-1.5 flex-wrap">
            <Pill className="w-4 h-4 shrink-0" aria-hidden="true" />
            {slot.medicationName}{slot.strength ? ` ${slot.strength}` : ''}
            {slot.isHighRisk && <Chip>High risk</Chip>}
          </p>
          <p className="text-[var(--color-muted-foreground)]">{slot.doseDescription}</p>
          <p className={overdue ? `font-medium ${TONE.warning.ink}` : 'text-[var(--color-muted-foreground)]'}>
            {overdue ? 'Overdue. ' : ''}Give by {clockLabel(slot.scheduledAt)}
          </p>
          {slot.directions && <p className="text-xs text-[var(--color-muted-foreground)]">{slot.directions}</p>}
          {outcome && (
            <div className="mt-1 space-y-0.5">
              <p className="font-medium">
                {OUTCOME_WORDS[outcome.status] ?? outcome.status}
                {outcome.status === 'Administered' && outcome.administeredAt
                  ? ` at ${formatWithTimeZone(outcome.administeredAt, outcome.administeredAtTimeZone ?? tz, { hour: 'numeric', minute: '2-digit' })}`
                  : ''}
                {' '}by {outcome.recordedByName}
              </p>
              {outcome.reason && <p className="text-[var(--color-muted-foreground)]">Reason: {outcome.reason}</p>}
              {outcome.recordedWithoutCompetency && <Chip>Recorded without a current Medication Competency</Chip>}
            </div>
          )}
          {slot.witness.required && slot.outcome?.status === 'Administered' && (
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Witness: {slot.witness.witnessName ?? 'not chosen'}{slot.witness.status ? `, ${slot.witness.status}` : ''}
            </p>
          )}
        </div>
        {!outcome && canAct && (
          <Button size="lg" variant={overdue ? 'primary' : 'secondary'} onClick={() => onRecord({ kind: 'slot', slot })} aria-label={`Record ${slot.medicationName}, give by ${clockLabel(slot.scheduledAt)}`}>
            Record
          </Button>
        )}
      </div>
    </li>
  )
}

function RoutineRow({ routine, shiftId, canAct, online }: { routine: PortalShiftRoutineDto; shiftId: string; canAct: boolean; online: boolean }) {
  const check = useCheckRoutine()
  const uncheck = useUncheckRoutine()
  const [error, setError] = useState<string | null>(null)
  const busy = check.isPending || uncheck.isPending

  async function toggle() {
    setError(null)
    try {
      if (routine.isChecked) await uncheck.mutateAsync({ id: shiftId, routineId: routine.id })
      else await check.mutateAsync({ id: shiftId, routineId: routine.id })
    } catch (err) {
      setError(apiErrorMessages(err)[0] ?? extractErrorMessage(err, "Couldn't save the tick. Try again."))
    }
  }

  return (
    <li className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
      <button
        type="button"
        role="checkbox"
        aria-checked={routine.isChecked}
        onClick={toggle}
        disabled={!canAct || !online || busy}
        className={`${TAP_AREA} w-full flex items-start gap-3 text-left min-h-[44px] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded-sm`}
      >
        <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded border ${routine.isChecked ? 'bg-[var(--color-primary)] border-[var(--color-primary)] text-white' : 'border-[var(--color-border)]'}`}>
          {routine.isChecked && <Check className="w-4 h-4" aria-hidden="true" />}
        </span>
        <span className="min-w-0">
          <span className="font-medium">{routine.title}</span>
          {routine.isCritical && <span className="ml-2 text-xs font-medium text-[var(--color-muted-foreground)]">Critical</span>}
          {routine.description && <span className="block text-[var(--color-muted-foreground)] whitespace-pre-wrap">{routine.description}</span>}
          {routine.isChecked && (
            <span className="block text-xs text-[var(--color-muted-foreground)]">
              Done{routine.checkedByName ? ` by ${routine.checkedByName}` : ''}
            </span>
          )}
        </span>
      </button>
      {error && <p role="alert" className="mt-1 text-sm text-[var(--color-destructive)]">{error}</p>}
    </li>
  )
}

function PrnRow({ prn, tz, canAct, onRecord }: { prn: PortalPrnDto; tz: string; canAct: boolean; onRecord: (t: DoseTarget) => void }) {
  return (
    <li className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium flex items-center gap-1.5 flex-wrap">
            <Pill className="w-4 h-4 shrink-0" aria-hidden="true" />
            {prn.medicationName}{prn.strength ? ` ${prn.strength}` : ''}
            {prn.isHighRisk && <Chip>High risk</Chip>}
          </p>
          <p className="text-[var(--color-muted-foreground)]">{prn.doseDescription}</p>
          {prn.indication && <p>For: {prn.indication}</p>}
          <p className="text-xs text-[var(--color-muted-foreground)]">
            {prn.dosesInLast24h} in the last 24 hours{prn.maxDosesPer24h != null ? `, up to ${prn.maxDosesPer24h}` : ''}
            {prn.lastDoseAt ? `. Last given ${formatWithTimeZone(prn.lastDoseAt, tz, { hour: 'numeric', minute: '2-digit' })}` : ''}
          </p>
          {prn.nextAvailableAt && (
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Next dose from {formatWithTimeZone(prn.nextAvailableAt, tz, { hour: 'numeric', minute: '2-digit' })}
            </p>
          )}
          {prn.maxDosesReached && <p className="text-xs font-medium">Most doses in 24 hours reached</p>}
        </div>
        {canAct && (
          <Button size="lg" variant="secondary" onClick={() => onRecord({ kind: 'prn', prn })} aria-label={`Record a dose of ${prn.medicationName}`}>
            Record dose
          </Button>
        )}
      </div>
    </li>
  )
}

/**
 * During: what is due, in time order. Overdue doses rise to the top in the warning tone; "As needed" medicines are their own group.
 * Recording happens in place through the dose sheet. A worker who cannot record (Enforce mode, no current competency) sees the
 * reason once and no Record buttons.
 */
export function DuringSection({ shift, canAct, online, onRecord }: {
  shift: PortalShiftDetailDto
  canAct: boolean
  online: boolean
  onRecord: (t: DoseTarget) => void
}) {
  const { groups } = buildChecklist(shift)
  const canRecord = canAct && online && shift.canRecordDoses
  const tz = shift.timeZoneId

  const renderItem = (item: ChecklistItem) => item.kind === 'dose'
    ? <DoseRow key={item.key} slot={item.slot} tz={tz} canAct={canRecord} onRecord={onRecord} />
    : <RoutineRow key={item.key} routine={item.routine} shiftId={shift.id} canAct={canAct} online={online} />

  return (
    <Section id="during" title="During the shift" icon={<ListChecks className="w-4 h-4" aria-hidden="true" />}>
      {!shift.canRecordDoses && shift.canRecordDosesReason && (
        <p role="status" className="text-sm">{shift.canRecordDosesReason}</p>
      )}
      {shift.medicationsDue.length === 0 && <p className="text-sm text-[var(--color-muted-foreground)]">No doses due this shift.</p>}
      {groups.map(group => (
        <div key={group.id} className="space-y-2">
          <h3 className={`text-sm font-semibold ${group.tone === 'warning' ? TONE.warning.ink : ''}`}>{group.label}</h3>
          <ul className="space-y-2">{group.items.map(renderItem)}</ul>
        </div>
      ))}
      {shift.prn.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">As needed</h3>
          <ul className="space-y-2">
            {shift.prn.map(prn => <PrnRow key={prn.medicationId} prn={prn} tz={tz} canAct={canRecord} onRecord={onRecord} />)}
          </ul>
        </div>
      )}
    </Section>
  )
}
