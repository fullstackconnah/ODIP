import { useState } from 'react'
import type { AxiosError } from 'axios'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ToggleGroup } from '@/components/ToggleGroup'
import { FormField } from '@/components/FormField'
import { Dropdown } from '@/components/Dropdown'
import { useRecordAdministration, useAmendAdministration, useStaff } from '@/api/hooks'
import { ADMIN_STATUS_LABELS } from '@/api/types/medications'
import type { MedicationAdministrationStatus } from '@/api/types/enums'
import type { AdministrationDto, CreateAdministrationDto, UpdateAdministrationDto } from '@/api/types/medications'

export type RecordAdministrationModalProps = {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  medicationId: string
  medicationName: string
  strength?: string | null
  doseDescription?: string | null
  isHighRisk: boolean
  isPrn: boolean
  scheduledAt?: string | null
  tripInstanceId?: string | null
  /** When set, the modal amends this existing administration (PUT) instead of recording a new one (POST). */
  existingAdministration?: AdministrationDto
}

const STATUS_OPTIONS: { key: MedicationAdministrationStatus; label: string }[] = [
  { key: 'Administered', label: ADMIN_STATUS_LABELS.Administered },
  { key: 'Refused', label: ADMIN_STATUS_LABELS.Refused },
  { key: 'Withheld', label: ADMIN_STATUS_LABELS.Withheld },
  { key: 'Missed', label: ADMIN_STATUS_LABELS.Missed },
]

const SUBMIT_LABEL: Record<MedicationAdministrationStatus, string> = {
  Administered: 'Record dose',
  Refused: 'Record refusal',
  Withheld: 'Record withheld dose',
  Missed: 'Record missed dose',
}

/** Animates a conditional field in/out using the same grid-template-rows collapse
 * trick used for AppLayout's nav groups — respects prefers-reduced-motion globally.
 * `grid-rows-[0fr]` only hides the content visually (overflow-hidden clips it to 0 height);
 * the fields inside stay in the DOM and, without more, stay in the tab order — a keyboard user
 * could Tab into an invisible textarea. `inert` while collapsed removes the subtree from both
 * the tab order and the accessibility tree without touching the grid-rows animation itself, and
 * is dropped the instant `show` flips so focus/tabbing work normally once the field is visible. */
function AnimatedField({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${show ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      // React 19 forwards `inert` as the native DOM boolean attribute.
      inert={!show}
    >
      <div className="min-h-0">{children}</div>
    </div>
  )
}

function extractErrorMessage(err: unknown): string {
  const axiosErr = err as AxiosError<{ message?: string; errors?: string[] }>
  return axiosErr?.response?.data?.errors?.[0] || axiosErr?.response?.data?.message || 'Failed to record administration.'
}

export function RecordAdministrationModal({
  open, onClose, onSuccess, medicationId, medicationName, strength, doseDescription,
  isHighRisk, isPrn, scheduledAt, tripInstanceId, existingAdministration,
}: RecordAdministrationModalProps) {
  const isAmend = !!existingAdministration
  const recordAdministration = useRecordAdministration()
  const amendAdministration = useAmendAdministration()
  const isPending = isAmend ? amendAdministration.isPending : recordAdministration.isPending
  const { data: staffList } = useStaff()
  const activeStaff = (staffList ?? []).filter(s => s.isActive)

  const [status, setStatus] = useState<MedicationAdministrationStatus>(existingAdministration?.status ?? 'Administered')
  const [doseGiven, setDoseGiven] = useState(existingAdministration?.doseGiven ?? doseDescription ?? '')
  const [reason, setReason] = useState(existingAdministration?.reason ?? '')
  const [prnReason, setPrnReason] = useState(existingAdministration?.prnReason ?? '')
  // Legacy free-text witness — only ever shown/edited when amending an administration that
  // already used it (the create flow below always uses the staff picker instead).
  const [witnessName, setWitnessName] = useState(existingAdministration?.witnessName ?? '')
  const [witnessStaffId, setWitnessStaffId] = useState(existingAdministration?.witnessStaffId ?? '')
  const [notes, setNotes] = useState(existingAdministration?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  // When the PRN dose ceiling is hit, backend returns a 400 explaining the limit —
  // offer to retry the same submission with acknowledgeLimitBreach: true.
  const [limitBreachMessage, setLimitBreachMessage] = useState<string | null>(null)

  const requiresReason = status !== 'Administered'
  const requiresPrnReason = isPrn && status === 'Administered'
  const requiresWitness = isHighRisk && status === 'Administered'

  function reset() {
    setStatus(existingAdministration?.status ?? 'Administered')
    setDoseGiven(existingAdministration?.doseGiven ?? doseDescription ?? '')
    setReason(existingAdministration?.reason ?? '')
    setPrnReason(existingAdministration?.prnReason ?? '')
    setWitnessName(existingAdministration?.witnessName ?? '')
    setWitnessStaffId(existingAdministration?.witnessStaffId ?? '')
    setNotes(existingAdministration?.notes ?? '')
    setError(null)
    setFieldErrors({})
    setLimitBreachMessage(null)
  }

  function handleClose() {
    reset()
    onClose()
  }

  function clearFieldError(key: string) {
    setFieldErrors(prev => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  function validate(): boolean {
    const errs: Record<string, string> = {}
    if (requiresReason && !reason.trim()) errs.reason = 'Required — e.g. participant declined after prompting'
    if (requiresPrnReason && !prnReason.trim()) errs.prnReason = 'Required for a PRN dose'
    if (requiresWitness) {
      if (isAmend && !witnessName.trim()) errs.witnessName = 'A second worker must witness this dose'
      if (!isAmend && !witnessStaffId) errs.witnessStaffId = 'Select the staff member who witnessed this dose'
    }
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  function buildCommonFields() {
    return {
      administeredAt: status === 'Administered' ? (existingAdministration?.administeredAt ?? new Date().toISOString()) : undefined,
      status,
      doseGiven: doseGiven || undefined,
      reason: requiresReason ? reason : undefined,
      prnReason: requiresPrnReason ? prnReason : undefined,
      notes: notes || undefined,
    }
  }

  function buildCreateFields(acknowledgeLimitBreach: boolean): CreateAdministrationDto {
    return {
      ...buildCommonFields(),
      witnessStaffId: requiresWitness ? witnessStaffId : undefined,
      scheduledAt: scheduledAt ?? undefined,
      tripInstanceId: tripInstanceId ?? undefined,
      acknowledgeLimitBreach,
    }
  }

  function buildAmendFields(): UpdateAdministrationDto {
    return {
      ...buildCommonFields(),
      // Amending only ever edits the legacy free-text witness field — the staff-witness
      // Pending/Approved/Declined workflow (see the portal's Witness approvals queue) is managed
      // separately and isn't reassignable through this form.
      witnessName: requiresWitness ? witnessName : undefined,
      // The backend unconditionally overwrites prnOutcome/prnOutcomeAt on PUT — pass through
      // the existing values so amending an administration doesn't silently wipe a previously
      // recorded PRN outcome.
      prnOutcome: existingAdministration?.prnOutcome ?? undefined,
      prnOutcomeAt: existingAdministration?.prnOutcomeAt ?? undefined,
    }
  }

  // Matches the backend's two PRN-limit breach messages exactly:
  // "Maximum {N} doses in 24 hours reached" and "Minimum interval of {N} minutes not yet elapsed".
  const LIMIT_BREACH_PATTERN = /maximum \d+ doses in 24 hours|minimum interval of \d+ minutes/i

  async function submit(acknowledgeLimitBreach: boolean) {
    setError(null)
    try {
      const res = isAmend
        ? await amendAdministration.mutateAsync({ id: existingAdministration!.id, data: buildAmendFields() })
        : await recordAdministration.mutateAsync({
            medicationId,
            data: buildCreateFields(acknowledgeLimitBreach),
          })
      if (res.success) {
        setLimitBreachMessage(null)
        reset()
        onSuccess?.()
        onClose()
      } else {
        const message = res.errors?.[0] || res.message || 'Failed to record administration.'
        // A 400 surfaced as a resolved envelope should also open the acknowledge dialog,
        // not dead-end into a plain error message.
        if (!acknowledgeLimitBreach && LIMIT_BREACH_PATTERN.test(message)) {
          setLimitBreachMessage(message)
        } else {
          setError(message)
        }
      }
    } catch (err) {
      const message = extractErrorMessage(err)
      if (!acknowledgeLimitBreach && LIMIT_BREACH_PATTERN.test(message)) {
        setLimitBreachMessage(message)
      } else {
        setError(message)
      }
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    submit(false)
  }

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        title={`${isAmend ? 'Amend administration' : 'Record administration'} — ${medicationName}${strength ? ` ${strength}` : ''}`}
        size="md"
        footer={
          <>
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="record-administration-form"
              disabled={isPending}
              className="px-4 py-2 text-sm rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary)]/90 disabled:opacity-50 transition-all"
            >
              {isPending ? 'Saving...' : (isAmend ? 'Save amendment' : SUBMIT_LABEL[status])}
            </button>
          </>
        }
      >
        <form id="record-administration-form" onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
              {error}
            </div>
          )}

          <FormField label="Status" required>
            <ToggleGroup options={STATUS_OPTIONS.map(o => ({ key: o.key, label: o.label }))} value={status} onChange={v => setStatus(v as MedicationAdministrationStatus)} />
          </FormField>

          <FormField label="Dose given">
            <input value={doseGiven} onChange={e => setDoseGiven(e.target.value)} placeholder="e.g. 1 tablet" />
          </FormField>

          <AnimatedField show={requiresReason}>
            <FormField label="Reason" required error={fieldErrors.reason} hint={!fieldErrors.reason ? 'Required — e.g. participant declined after prompting' : undefined}>
              <textarea rows={2} value={reason} onChange={e => { setReason(e.target.value); clearFieldError('reason') }} />
            </FormField>
          </AnimatedField>

          <AnimatedField show={requiresPrnReason}>
            <FormField label="Why was this PRN dose needed?" required error={fieldErrors.prnReason}>
              <textarea rows={2} value={prnReason} onChange={e => { setPrnReason(e.target.value); clearFieldError('prnReason') }} />
            </FormField>
          </AnimatedField>

          <AnimatedField show={requiresWitness}>
            {isAmend ? (
              <FormField label="Witness name" required error={fieldErrors.witnessName} hint={!fieldErrors.witnessName ? 'High-risk medication — a second worker must witness this dose' : undefined}>
                <input value={witnessName} onChange={e => { setWitnessName(e.target.value); clearFieldError('witnessName') }} />
              </FormField>
            ) : (
              <FormField label="Witness" required error={fieldErrors.witnessStaffId} hint={!fieldErrors.witnessStaffId ? 'High-risk medication — select the staff member who witnessed this dose. They will need to approve it in their portal.' : undefined}>
                <Dropdown
                  variant="form"
                  value={witnessStaffId}
                  onChange={v => { setWitnessStaffId(v); clearFieldError('witnessStaffId') }}
                  items={activeStaff.map(s => ({ value: s.id, label: s.fullName }))}
                  aria-invalid={fieldErrors.witnessStaffId ? 'true' : undefined}
                />
              </FormField>
            )}
          </AnimatedField>

          <FormField label="Notes">
            <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
          </FormField>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!limitBreachMessage}
        onCancel={() => setLimitBreachMessage(null)}
        onConfirm={() => submit(true)}
        title="PRN dose limit reached"
        message={limitBreachMessage ?? ''}
        confirmLabel="Record anyway (acknowledged)"
        variant="danger"
        loading={isPending}
      />
    </>
  )
}
