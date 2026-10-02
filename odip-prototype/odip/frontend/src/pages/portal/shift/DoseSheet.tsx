import { useMemo, useState } from 'react'
import { useRecordShiftDose, useStaff } from '@/api/hooks'
import { usePermissions } from '@/lib/permissions'
import { Modal } from '@/components/Modal'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { newCompletionRequestId } from '@/lib/completionRequestId'
import {
  apiErrorMessages, apiErrorStatus, existingAdministrationFromError, hasApiErrorCode, isCompetencyError, isDoseTimeError,
} from '@/lib/shiftPackageErrors'
import { SHIFT_PACKAGE_ERROR_CODES } from '@/api/types'
import { clockLabel } from './checklist'
import { providerLocalToUtcInstant, utcInstantToProviderLocal } from './shiftTime'
import type { CreateAdministrationDto, MedicationAdministrationStatus, PortalDoseSlotDto, PortalPrnDto, PortalShiftDetailDto } from '@/api/types'

/** What the sheet is recording: a scheduled slot, or an "as needed" dose. */
export type DoseTarget =
  | { kind: 'slot'; slot: PortalDoseSlotDto }
  | { kind: 'prn'; prn: PortalPrnDto }

type Outcome = Extract<MedicationAdministrationStatus, 'Administered' | 'Refused' | 'Withheld' | 'Missed'>

const OUTCOME_LABEL: Record<Outcome, string> = {
  Administered: 'Given',
  Refused: 'Refused',
  Withheld: 'Withheld',
  Missed: 'Not given this shift',
}

const fieldClass = 'w-full px-3 py-2 min-h-[44px] rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]'

interface Props {
  open: boolean
  onClose: () => void
  shift: Pick<PortalShiftDetailDto, 'id' | 'timeZoneId' | 'canRecordDoses' | 'canRecordDosesReason'>
  target: DoseTarget | null
  /** The outcome to start on. The End checklist opens it on "Not given this shift". */
  initialOutcome?: Outcome
  /** Offer "Not given this shift" (the End checklist). */
  allowMissed?: boolean
  online: boolean
}

/**
 * The dose sheet: Given / Refused / Withheld (and, at the End, "Not given this shift") with a required reason for anything not given, the
 * witness for a high-risk dose, and the competency state. Remounted per target (the parent keys it), so each opening gets a fresh
 * idempotency key; a failed save keeps every entry and the same key, so a retry can never record the dose twice.
 */
export function DoseSheet(props: Props) {
  if (!props.target) return null
  return <DoseSheetBody key={props.target.kind === 'slot' ? `${props.target.slot.medicationId}-${props.target.slot.scheduledAt}` : props.target.prn.medicationId} {...props} target={props.target} />
}

function DoseSheetBody({ open, onClose, shift, target, initialOutcome = 'Administered', allowMissed = false, online }: Props & { target: DoseTarget }) {
  const record = useRecordShiftDose()
  const { data: staff } = useStaff()
  const { id: currentUserId } = usePermissions()
  const [idempotencyKey] = useState(() => newCompletionRequestId())
  const [outcome, setOutcome] = useState<Outcome>(initialOutcome)
  const [reason, setReason] = useState('')
  const [givenAt, setGivenAt] = useState(() => utcInstantToProviderLocal(new Date().toISOString(), shift.timeZoneId))
  const [doseGiven, setDoseGiven] = useState('')
  const [witnessId, setWitnessId] = useState('')
  const [prnReason, setPrnReason] = useState('')
  const [ackLimit, setAckLimit] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [timeError, setTimeError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)

  const med = target.kind === 'slot' ? target.slot : target.prn
  const isPrn = target.kind === 'prn'
  const needsWitness = med.isHighRisk && outcome === 'Administered'
  const needsReason = outcome !== 'Administered'
  const overLimit = target.kind === 'prn' && target.prn.maxDosesReached
  const witnesses = useMemo(() => (staff ?? []).filter(s => s.isActive && s.id !== currentUserId), [staff, currentUserId])
  const outcomes: Outcome[] = isPrn ? ['Administered'] : allowMissed ? ['Administered', 'Refused', 'Withheld', 'Missed'] : ['Administered', 'Refused', 'Withheld']

  const problems: string[] = []
  if (needsReason && !reason.trim()) problems.push('Say why it was not given.')
  if (needsWitness && !witnessId) problems.push('Choose who witnessed this dose.')
  if (outcome === 'Administered' && !providerLocalToUtcInstant(givenAt, shift.timeZoneId)) problems.push('Enter the time it was given.')
  if (isPrn && outcome === 'Administered' && !prnReason.trim()) problems.push('Say why it was needed.')
  if (overLimit && outcome === 'Administered' && !ackLimit) problems.push('Confirm you are over the daily limit on purpose.')
  const blockedByCompetency = !shift.canRecordDoses

  async function submit() {
    setTouched(true)
    setSubmitError(null)
    setTimeError(null)
    if (problems.length || blockedByCompetency || !online) return
    const data: CreateAdministrationDto = {
      status: outcome,
      acknowledgeLimitBreach: overLimit && ackLimit,
      idempotencyKey,
    }
    // A scheduled dose echoes its provider-local slot unchanged (a wall clock, sent zone-less); an "as needed" dose has none.
    if (target.kind === 'slot') data.scheduledAt = target.slot.scheduledAt
    if (outcome === 'Administered') {
      // administeredAt is an INSTANT: the digits the worker picked are in the provider's zone, so convert and send with Z.
      data.administeredAt = providerLocalToUtcInstant(givenAt, shift.timeZoneId)!
      data.administeredAtTimeZone = shift.timeZoneId
      if (doseGiven.trim()) data.doseGiven = doseGiven.trim()
      if (needsWitness) data.witnessStaffId = witnessId
      if (isPrn) data.prnReason = prnReason.trim()
    } else {
      data.reason = reason.trim()
    }
    try {
      await record.mutateAsync({ shiftId: shift.id, medicationId: med.medicationId, data })
      onClose()
    } catch (err) {
      const existing = existingAdministrationFromError(err)
      if (existing) {
        setSubmitError(`This dose was already recorded${existing.recordedByName ? ` by ${existing.recordedByName}` : ''}. The list has been refreshed.`)
      } else if (isDoseTimeError(err)) {
        setTimeError(apiErrorMessages(err)[0] ?? 'That time is not allowed for this dose.')
      } else if (isCompetencyError(err)) {
        setSubmitError(apiErrorMessages(err)[0] ?? "You can't record doses until your Medication Competency is current.")
      } else if (hasApiErrorCode(err, SHIFT_PACKAGE_ERROR_CODES.administrationSlotBusy)) {
        setSubmitError('Someone else is recording this dose right now. Look at the list, then try again.')
      } else if (apiErrorStatus(err) !== undefined) {
        setSubmitError(apiErrorMessages(err)[0] ?? "Couldn't save this dose. Your entries are kept. Try again.")
      } else {
        setSubmitError("Couldn't save this dose. Check your connection. Your entries are kept: try again.")
      }
    }
  }

  const title = target.kind === 'slot'
    ? `${target.slot.medicationName}${target.slot.strength ? ` ${target.slot.strength}` : ''}, give by ${clockLabel(target.slot.scheduledAt)}`
    : `${target.prn.medicationName}${target.prn.strength ? ` ${target.prn.strength}` : ''}, as needed`

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="md"
      closeOnBackdrop={false}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" size="lg" onClick={onClose} disabled={record.isPending}>Cancel</Button>
          <Button size="lg" onClick={submit} disabled={record.isPending || blockedByCompetency || !online}>
            {record.isPending ? 'Saving…' : submitError ? 'Try again' : `Record: ${OUTCOME_LABEL[outcome]}`}
          </Button>
        </div>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm">{med.doseDescription}{med.directions ? `. ${med.directions}` : ''}</p>

        {blockedByCompetency && (
          <Callout tone="warning" title="You can't record doses">{shift.canRecordDosesReason ?? 'Your Medication Competency is not current.'}</Callout>
        )}
        {!blockedByCompetency && shift.canRecordDosesReason && (
          <Callout tone="warning">{shift.canRecordDosesReason}</Callout>
        )}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium mb-1">Outcome</legend>
          <div className="flex flex-wrap gap-2">
            {outcomes.map(o => (
              <label
                key={o}
                className={`min-h-[44px] inline-flex items-center gap-2 px-3 rounded-lg border text-sm cursor-pointer ${outcome === o ? 'border-[var(--color-primary)] bg-[var(--color-primary-fixed)]/40 font-medium' : 'border-[var(--color-border)]'}`}
              >
                <input type="radio" name="dose-outcome" checked={outcome === o} onChange={() => setOutcome(o)} />
                {OUTCOME_LABEL[o]}
              </label>
            ))}
          </div>
        </fieldset>

        {outcome === 'Administered' ? (
          <>
            <div>
              <label htmlFor="dose-given-at" className="text-sm font-medium">Time given</label>
              <input id="dose-given-at" type="datetime-local" className={fieldClass} value={givenAt} onChange={e => { setGivenAt(e.target.value); setTimeError(null) }} />
              {timeError && <p role="alert" className="mt-1 text-sm text-[var(--color-destructive)]">{timeError}</p>}
            </div>
            <div>
              <label htmlFor="dose-amount" className="text-sm font-medium">Dose given <span className="text-[var(--color-muted-foreground)] font-normal">(optional)</span></label>
              <input id="dose-amount" className={fieldClass} value={doseGiven} onChange={e => setDoseGiven(e.target.value)} placeholder={med.doseDescription} />
            </div>
            {isPrn && (
              <div>
                <label htmlFor="dose-prn-reason" className="text-sm font-medium">Why was it needed?</label>
                <input id="dose-prn-reason" className={fieldClass} value={prnReason} onChange={e => setPrnReason(e.target.value)} />
              </div>
            )}
            {overLimit && (
              <label className="flex items-start gap-2 text-sm min-h-[44px]">
                <input type="checkbox" className="mt-1" checked={ackLimit} onChange={e => setAckLimit(e.target.checked)} />
                <span>The most doses in 24 hours has been reached. I am giving another on purpose.</span>
              </label>
            )}
            {needsWitness && (
              <div>
                <label htmlFor="dose-witness" className="text-sm font-medium">Witness</label>
                <select id="dose-witness" className={fieldClass} value={witnessId} onChange={e => setWitnessId(e.target.value)}>
                  <option value="">Choose a staff member</option>
                  {witnesses.map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}
                </select>
                <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">High-risk medicine. They will be asked to confirm it in their portal.</p>
              </div>
            )}
          </>
        ) : (
          <div>
            <label htmlFor="dose-reason" className="text-sm font-medium">Reason</label>
            <textarea id="dose-reason" rows={3} className={fieldClass} value={reason} onChange={e => setReason(e.target.value)} />
          </div>
        )}

        {touched && problems.length > 0 && (
          <ul role="alert" className="text-sm text-[var(--color-destructive)] list-disc pl-5">
            {problems.map(p => <li key={p}>{p}</li>)}
          </ul>
        )}
        {submitError && <p role="alert" className="text-sm text-[var(--color-destructive)]">{submitError}</p>}
        {!online && <p className="text-sm text-[var(--color-muted-foreground)]">You're offline. Recording needs a connection.</p>}
      </div>
    </Modal>
  )
}
