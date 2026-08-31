import { useState } from 'react'
import type { AxiosError } from 'axios'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ToggleGroup } from '@/components/ToggleGroup'
import { FormField, labelClass } from '@/components/FormField'
import { SearchableSelect } from '@/components/SearchableSelect'
import { useRecordAdministration, useAmendAdministration, useStaff } from '@/api/hooks'
import { usePermissions } from '@/lib/permissions'
import { getClientTimeZone } from '@/lib/utils'
import { ADMIN_STATUS_LABELS } from '@/api/types/medications'
import { isIncidentTriggerOutcome } from '@/lib/incidentPrefill'
import type { MarIncidentPrefillState } from '@/lib/incidentPrefill'
import { MissedMedicationGuidance } from './MissedMedicationGuidance'
import type { MedicationAdministrationStatus, PackagingType } from '@/api/types/enums'
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
  /** MED-01: threaded through to the missed-medication guidance's packaging-check step and
   * "call the pharmacy on ..." line when a trigger outcome is recorded. */
  packaging?: PackagingType
  pharmacyName?: string | null
  pharmacyPhone?: string | null
  /** When set, the modal amends this existing administration (PUT) instead of recording a new one (POST). */
  existingAdministration?: AdministrationDto
}

const STATUS_OPTIONS: { key: MedicationAdministrationStatus; label: string }[] = [
  { key: 'Administered', label: ADMIN_STATUS_LABELS.Administered },
  { key: 'Refused', label: ADMIN_STATUS_LABELS.Refused },
  { key: 'Withheld', label: ADMIN_STATUS_LABELS.Withheld },
  { key: 'Missed', label: ADMIN_STATUS_LABELS.Missed },
  { key: 'WrongMedication', label: ADMIN_STATUS_LABELS.WrongMedication },
]

const SUBMIT_LABEL: Record<MedicationAdministrationStatus, string> = {
  Administered: 'Record dose',
  Refused: 'Record refusal',
  Withheld: 'Record withheld dose',
  Missed: 'Record missed dose',
  WrongMedication: 'Record wrong medication',
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
  isHighRisk, isPrn, scheduledAt, tripInstanceId, packaging, pharmacyName, pharmacyPhone,
  existingAdministration,
}: RecordAdministrationModalProps) {
  const isAmend = !!existingAdministration
  const navigate = useNavigate()
  const recordAdministration = useRecordAdministration()
  const amendAdministration = useAmendAdministration()
  const isPending = isAmend ? amendAdministration.isPending : recordAdministration.isPending
  const { data: staffList } = useStaff()
  const { id: currentUserId, fullName: currentUserFullName, canCreateIncidents } = usePermissions()
  // Who this record will be attributed to — always server-derived (see
  // MedicationsController.RecordAdministration's ResolveCurrentStaffIdAsync), never editable
  // here. For a new record that's the signed-in (or, under SuperAdmin "view as", viewed-as) user;
  // for an amendment the administering identity doesn't change, so show who originally recorded
  // it instead. Falls back to a generic label when no name is resolvable (e.g. a stale odip_user
  // blob) rather than showing nothing.
  const administeredByDisplayName = isAmend
    ? (existingAdministration?.recordedByName || 'Unknown')
    : (currentUserFullName || 'You (signed in)')
  // Excludes the signed-in user from the witness picker outright — a staff member can't witness
  // their own administration (enforced server-side too; see MedicationsController.RecordAdministration).
  // When the account has no resolvable id (currentUserId is null — e.g. a stale odip_user blob
  // from before this field existed), this filter is a no-op and behaviour degrades gracefully
  // rather than crashing; the server still enforces the exclusion regardless.
  const activeStaff = (staffList ?? []).filter(s => s.isActive && s.id !== currentUserId)

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

  // INC-03: once a trigger outcome (refused/withheld/missed/wrong medication) has been saved,
  // this holds the saved record so the form gives way to the "drop into a draft incident"
  // prompt below. Nothing is filed automatically — this is purely an offer to navigate.
  const [savedTriggerAdministration, setSavedTriggerAdministration] = useState<AdministrationDto | null>(null)

  const requiresReason = status !== 'Administered'
  const requiresPrnReason = isPrn && status === 'Administered'
  const requiresWitness = isHighRisk && status === 'Administered'
  // MED-03: wrong-medication recording additionally requires a note on what was actually given
  // instead of the prescribed medication — required both ends (see MedicationsController).
  const requiresWrongMedNote = status === 'WrongMedication'

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
    setSavedTriggerAdministration(null)
  }

  function handleClose() {
    reset()
    onClose()
  }

  /** INC-03 "Not now" — the coordinator/support worker declines to file an incident. The MAR
   * record itself already saved; nothing else happens (no ghost draft anywhere). */
  function dismissIncidentPrompt() {
    handleClose()
  }

  /** INC-03 primary action — navigates to the incident form pre-populated with everything the
   * MAR flow already knows. Nothing is persisted until the coordinator submits that form. */
  function goToIncident() {
    if (!savedTriggerAdministration) return
    const prefill: MarIncidentPrefillState = {
      source: 'mar-administration',
      outcome: savedTriggerAdministration.status,
      participantId: savedTriggerAdministration.participantId,
      participantName: savedTriggerAdministration.participantName,
      medicationName: savedTriggerAdministration.medicationName,
      strength,
      doseDescription: savedTriggerAdministration.doseDescription,
      scheduledAt: savedTriggerAdministration.scheduledAt,
      administeredAt: savedTriggerAdministration.administeredAt,
      administeredAtTimeZone: savedTriggerAdministration.administeredAtTimeZone,
      recordedByName: savedTriggerAdministration.recordedByName,
      recordedByUserId: savedTriggerAdministration.recordedByUserId,
      reason: savedTriggerAdministration.reason,
      notes: savedTriggerAdministration.status === 'WrongMedication' ? savedTriggerAdministration.notes : null,
      tripInstanceId: savedTriggerAdministration.tripInstanceId,
    }
    reset()
    onClose()
    navigate('/incidents/new', { state: prefill })
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
    if (requiresReason && !reason.trim()) {
      errs.reason = requiresWrongMedNote
        ? 'Required — what led to the wrong medication being given'
        : 'Required — e.g. participant declined after prompting'
    }
    if (requiresWrongMedNote && !notes.trim()) errs.notes = 'Required — what was actually given instead'
    if (requiresPrnReason && !prnReason.trim()) errs.prnReason = 'Required for a PRN dose'
    if (requiresWitness) {
      if (isAmend && !witnessName.trim()) errs.witnessName = 'A second worker must witness this dose'
      if (!isAmend && !witnessStaffId) errs.witnessStaffId = 'Select the staff member who witnessed this dose'
      // Belt-and-suspenders: the picker already excludes the signed-in user (see activeStaff
      // above), but catch it here too rather than letting a self-selection reach the backend's
      // 400 (MedicationsController.RecordAdministration) as the first sign anything's wrong.
      else if (!isAmend && currentUserId && witnessStaffId === currentUserId) {
        errs.witnessStaffId = "You can't witness your own administration"
      }
    }
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  function buildCommonFields() {
    const isAdministered = status === 'Administered'
    return {
      // A fresh record captures the client's own local instant (an ISO string already encodes
      // the correct UTC instant regardless of zone) and the zone it was captured in; amending an
      // administration that isn't changing its recorded time reuses both from the existing
      // record instead of overwriting them with "now"/the amending device's zone.
      administeredAt: isAdministered ? (existingAdministration?.administeredAt ?? new Date().toISOString()) : undefined,
      administeredAtTimeZone: isAdministered ? (existingAdministration?.administeredAtTimeZone ?? getClientTimeZone()) : undefined,
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
        onSuccess?.()
        // INC-03: the record is saved either way — for a trigger outcome, hold the modal open
        // on the drop-into-draft-incident prompt instead of closing immediately.
        if (res.data && isIncidentTriggerOutcome(res.data.status)) {
          setSavedTriggerAdministration(res.data)
        } else {
          reset()
          onClose()
        }
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
        title={savedTriggerAdministration
          ? 'Report as incident?'
          : `${isAmend ? 'Amend administration' : 'Record administration'} — ${medicationName}${strength ? ` ${strength}` : ''}`}
        size={savedTriggerAdministration ? 'lg' : 'md'}
        footer={
          savedTriggerAdministration ? (
            canCreateIncidents ? (
              <>
                <button
                  type="button"
                  onClick={dismissIncidentPrompt}
                  className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors"
                >
                  Not now
                </button>
                <button
                  type="button"
                  onClick={goToIncident}
                  className="px-4 py-2 text-sm rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary)]/90 transition-all"
                >
                  Report as incident
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={dismissIncidentPrompt}
                className="px-4 py-2 text-sm rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary)]/90 transition-all"
              >
                Got it
              </button>
            )
          ) : (
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
          )
        }
      >
        {savedTriggerAdministration ? (
          // INC-03: the MAR record above is already saved (this prompt is purely an offer to
          // also open a pre-populated incident report) — dismissing here leaves the record as-is
          // and files nothing. A support-role account without incident access is told to notify
          // their coordinator instead of getting a dead-end "navigate" button (see permissions.ts
          // canCreateIncidents — every role that can record administrations currently also has
          // incident access, but this stays honest if that ever changes).
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 rounded-lg bg-[var(--color-error-container)]/40 border border-[var(--color-error-container)]">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-[var(--color-on-error-container)]" aria-hidden="true" />
              <div className="space-y-1.5 text-sm text-[var(--color-on-error-container)]">
                <p className="font-medium">
                  {ADMIN_STATUS_LABELS[savedTriggerAdministration.status]} recorded for {savedTriggerAdministration.participantName} — {savedTriggerAdministration.medicationName}.
                </p>
                <p>
                  {canCreateIncidents
                    ? 'This is incident-reportable. Report it now with the details already filled in, or come back to it later — nothing is filed until you submit the incident form.'
                    : "This is incident-reportable. Let your coordinator know so they can file an incident report — support workers don't file incident reports directly."}
                </p>
              </div>
            </div>

            {/* MED-01: missed-medication guidance surfaced alongside the incident prompt — manager
                contact first, then the escalation list. Not shown for Administered (this block only
                ever renders for a trigger outcome — see isIncidentTriggerOutcome above). */}
            <MissedMedicationGuidance
              event={{
                outcome: savedTriggerAdministration.status,
                participantName: savedTriggerAdministration.participantName,
                medicationName: savedTriggerAdministration.medicationName,
                packaging,
                pharmacyName,
                pharmacyPhone,
              }}
            />
          </div>
        ) : (
        <form id="record-administration-form" onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
              {error}
            </div>
          )}

          <FormField label="Status" required>
            <ToggleGroup options={STATUS_OPTIONS.map(o => ({ key: o.key, label: o.label }))} value={status} onChange={v => setStatus(v as MedicationAdministrationStatus)} />
          </FormField>

          {/* Read-only — the administering identity is always derived server-side from the
              authenticated caller (never client-supplied); this just tells the person what will
              be recorded rather than asking them to pick or type it. */}
          <div>
            <p className={labelClass}>Administered by</p>
            <p className="text-sm text-[var(--color-foreground)]">{administeredByDisplayName}</p>
          </div>

          <FormField label="Dose given">
            <input value={doseGiven} onChange={e => setDoseGiven(e.target.value)} placeholder="e.g. 1 tablet" />
          </FormField>

          <AnimatedField show={requiresReason}>
            <FormField
              label="Reason"
              required
              error={fieldErrors.reason}
              hint={!fieldErrors.reason ? (requiresWrongMedNote ? 'What led to the wrong medication being given' : 'Required — e.g. participant declined after prompting') : undefined}
            >
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
                <SearchableSelect
                  value={witnessStaffId}
                  onChange={v => { setWitnessStaffId(v); clearFieldError('witnessStaffId') }}
                  items={activeStaff.map(s => ({ value: s.id, label: s.fullName }))}
                  aria-invalid={fieldErrors.witnessStaffId ? 'true' : undefined}
                />
              </FormField>
            )}
          </AnimatedField>

          <FormField
            label={requiresWrongMedNote ? 'What was given instead' : 'Notes'}
            required={requiresWrongMedNote}
            error={fieldErrors.notes}
            hint={requiresWrongMedNote && !fieldErrors.notes ? 'Required — describe the medication and dose actually given' : undefined}
          >
            <textarea
              rows={2}
              value={notes}
              onChange={e => { setNotes(e.target.value); clearFieldError('notes') }}
              placeholder={requiresWrongMedNote ? 'e.g. Paracetamol 500mg, 1 tablet' : 'Optional'}
            />
          </FormField>
        </form>
        )}
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
