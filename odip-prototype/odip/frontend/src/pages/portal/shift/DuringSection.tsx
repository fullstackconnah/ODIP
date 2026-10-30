import { useState } from 'react'
import { Check, Pill, ListChecks } from 'lucide-react'
import { useCheckRoutine, useUncheckRoutine } from '@/api/hooks'
import { useQueueRecords } from '@/api/hooks/portal'
import { isStillTrying } from '@/lib/offline/queue'
import { waitingTick } from '@/lib/offline/overlay'
import { Button } from '@/components/Button'
import { TAP_AREA } from '@/components/tapArea'
import { TONE } from '@/lib/tone'
import { formatWithTimeZone, extractErrorMessage } from '@/lib/utils'
import { apiErrorMessages } from '@/lib/shiftPackageErrors'
import { buildChecklist, clockLabel, dueDoseKeys, foldDueList, type ChecklistGroup, type ChecklistItem } from './checklist'
import { plural } from '@/lib/format'
import { Chip, Fold, Section, WaitingToSend } from './ui'
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
    <li className={`py-2.5 text-sm ${overdue ? `${TONE.warning.soft} -mx-3 px-3 rounded-lg` : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium flex items-center gap-1.5 flex-wrap">
            <Pill className="w-4 h-4 shrink-0" aria-hidden="true" />
            {slot.medicationName}{slot.strength ? ` ${slot.strength}` : ''}
            {slot.isHighRisk && <Chip>High risk</Chip>}
          </p>
          <p className="text-[var(--color-muted-foreground)]">
            {slot.doseDescription && `${slot.doseDescription} · `}<span className={overdue ? `font-medium ${TONE.warning.ink}` : ''}>{overdue ? 'Overdue. ' : ''}Give by {clockLabel(slot.scheduledAt)}</span>
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

export function RoutineRow({ routine, shiftId, canAct }: { routine: PortalShiftRoutineDto; shiftId: string; canAct: boolean }) {
  const waiting = waitingTick(useQueueRecords(), shiftId, routine.id)
  const subId = `rt-sub-${routine.id}`
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
    <li className="py-2.5 text-sm">
      <button
        type="button"
        role="checkbox"
        aria-checked={routine.isChecked}
        onClick={toggle}
        disabled={!canAct || busy}
        aria-describedby={waiting ? subId : undefined}
        className={`${TAP_AREA} w-full flex items-start gap-3 text-left min-h-[44px] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded-sm`}
      >
        <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded border transition-colors duration-100 ease-out ${routine.isChecked ? 'bg-[var(--color-primary)] border-[var(--color-primary)] text-[var(--color-primary-foreground)]' : 'border-[var(--color-border)]'}`}>
          {routine.isChecked && <Check className="tick-in w-4 h-4" aria-hidden="true" />}
        </span>
        <span className="min-w-0">
          <span className="font-medium">{routine.title}</span>
          {routine.isCritical && <span className="ml-2 text-xs font-medium text-[var(--color-muted-foreground)]">Critical</span>}
          {routine.description && <span className="block text-[var(--color-muted-foreground)] whitespace-pre-wrap">{routine.description}</span>}
          {waiting ? (
            <span id={subId} className="flex flex-wrap items-center gap-x-1 text-xs text-[var(--color-muted-foreground)]">
              {routine.isChecked ? 'Done' : 'Not done'}<span className="whitespace-nowrap">&middot;&nbsp;<WaitingToSend stuck={isStillTrying(waiting)} /></span>
            </span>
          ) : routine.isChecked && (
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

export function PrnRow({ prn, tz, canAct, onRecord }: { prn: PortalPrnDto; tz: string; canAct: boolean; onRecord: (t: DoseTarget) => void }) {
  return (
    <li className="py-2.5 text-sm">
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
  const plan = foldDueList(groups, dueDoseKeys(shift.finishBlockers))
  const canRecord = canAct && online && shift.canRecordDoses
  const tz = shift.timeZoneId

  const rowsOf = (group: ChecklistGroup) => <ul className="divide-y divide-[var(--color-border)]">{group.items.map(renderItem)}</ul>
  const renderItem = (item: ChecklistItem) => item.kind === 'dose'
    ? <DoseRow key={item.key} slot={item.slot} tz={tz} canAct={canRecord} onRecord={onRecord} />
    : <RoutineRow key={item.key} routine={item.routine} shiftId={shift.id} canAct={canAct} />

  return (
    <Section id="during" title="During the shift" icon={<ListChecks className="w-4 h-4" aria-hidden="true" />}>
      {!shift.canRecordDoses && shift.canRecordDosesReason && (
        <p role="status" className="text-sm">{shift.canRecordDosesReason}</p>
      )}
      {shift.medicationsDue.length === 0 && <p className="text-sm text-[var(--color-muted-foreground)]">No doses due this shift.</p>}
      {/* Rows divided inside the one card, not a card per item. Overdue and the next time stay open; done times fold to a count, and every
          later time folds, with the as-needed medicines, into the one-line folds at the end (finish review fix 1). */}
      {plan.shown.map(({ group, fold }) => fold
        ? <Fold key={group.id} summary={fold}>{rowsOf(group)}</Fold>
        : (
          <div key={group.id} className="space-y-1">
            <h3 className={`text-sm font-semibold ${group.tone === 'warning' ? TONE.warning.ink : ''}`}>{group.label}</h3>
            {rowsOf(group)}
          </div>
        ))}
      {(plan.later || shift.prn.length > 0) && (
        <div>
          {plan.later && (
            <Fold summary={plan.later.summary}>
              {plan.later.groups.map(group => (
                <div key={group.id} className="space-y-1">
                  <h3 className="text-sm font-semibold">{group.label}</h3>
                  {rowsOf(group)}
                </div>
              ))}
            </Fold>
          )}
          {shift.prn.length > 0 && (
            <Fold summary={`As needed · ${plural(shift.prn.length, 'medicine')}`}>
              <ul className="divide-y divide-[var(--color-border)]">
                {shift.prn.map(prn => <PrnRow key={prn.medicationId} prn={prn} tz={tz} canAct={canRecord} onRecord={onRecord} />)}
              </ul>
            </Fold>
          )}
        </div>
      )}
    </Section>
  )
}
