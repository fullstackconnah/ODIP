import { useMemo, useState } from 'react'
import type { FieldErrors, UseFormGetValues, UseFormSetValue } from 'react-hook-form'
import { ShieldCheck, ShieldAlert, Info } from 'lucide-react'
import { useRestrictivePractices } from '@/api/hooks'
import { FormField } from '@/components/FormField'
import { Card } from '@/components/Card'
import { Dropdown } from '@/components/Dropdown'
import { RESTRICTIVE_PRACTICE_TYPES, RESTRICTIVE_PRACTICE_TYPE_LABELS } from '@/api/types/restrictive-practices'
import { previewRpAuthorisation, buildRpIncidentDescriptionSkeleton } from '@/lib/incidentPrefill'
import { formatDateAu } from '@/lib/utils'
import type { IncidentFormData } from '../incidentFormSchema'
import type { IncidentDetailDto } from '@/api/types'
import { formGrid, span } from '@/lib/formGrid'

export type RestrictivePracticeStepProps = {
  getValues: UseFormGetValues<IncidentFormData>
  setValue: UseFormSetValue<IncidentFormData>
  errors: FieldErrors<IncidentFormData>
  involvedParticipantId: string | undefined
  restrictivePracticeType: string | undefined
  restrictivePracticeId: string | undefined
  unapprovedRestrictivePracticeDetails: string | undefined
  isEdit: boolean
  existingIncident: IncidentDetailDto | undefined
}

/**
 * IN-4 — wizard step 1, "Restrictive Practice". Only ever rendered while
 * incidentType === 'RestrictivePracticeUse' (the parent page's computed step list removes this
 * step entirely otherwise — see IN-1).
 *
 * THE central rule this step's UI exists to enforce: exactly one of "linked to one of the
 * participant's approved/active practices" (restrictivePracticeId) or "an unapproved practice was
 * used" (unapprovedRestrictivePracticeDetails, free text) is ever set — never both, never
 * neither. Selecting one clears the other. Recording the unapproved-practice text NEVER creates
 * or updates a row in the participant's RestrictivePractices register — there is no such code
 * path anywhere in this component or the backend it submits to.
 */
export function RestrictivePracticeStep({
  getValues, setValue, errors,
  involvedParticipantId, restrictivePracticeType, restrictivePracticeId, unapprovedRestrictivePracticeDetails,
  isEdit, existingIncident,
}: RestrictivePracticeStepProps) {
  const [showInactive, setShowInactive] = useState(false)
  // Tracks the "None of these — unapproved" radio being clicked BEFORE any text is typed into
  // the details textarea it reveals — unapprovedRestrictivePracticeDetails alone can't carry
  // that (it's empty until the reporter types), so without this the radio would appear
  // unselected (and the textarea would stay hidden) the instant it's clicked. Reset naturally
  // whenever this whole step unmounts (incidentType changed away from RestrictivePracticeUse),
  // and superseded by unapprovedRestrictivePracticeDetails already having text (e.g. edit mode,
  // or prefill) via the `linkedChoice` derivation below.
  const [manualUnapprovedSelected, setManualUnapprovedSelected] = useState(false)

  // INC-04/INC-05: the involved participant's ACTIVE register entries — useRestrictivePractices
  // defaults to active-only, exactly the set both the determination and the linked-entry picker
  // need. Disabled (participantId undefined) until a participant is chosen.
  const { data: activePractices = [] } = useRestrictivePractices(involvedParticipantId || undefined)
  // IN-4's "show inactive/retired practices" disclosure — a second query, only fetched once the
  // toggle is actually on, requesting the full (active + inactive) set.
  const { data: allPractices = [] } = useRestrictivePractices(showInactive ? (involvedParticipantId || undefined) : undefined, true)

  const matchingActivePractices = useMemo(
    () => activePractices.filter((p) => p.type === restrictivePracticeType),
    [activePractices, restrictivePracticeType],
  )
  const matchingInactivePractices = useMemo(
    () => allPractices.filter((p) => p.type === restrictivePracticeType && !p.isActive),
    [allPractices, restrictivePracticeType],
  )

  // INC-04: live preview of the authorised/unauthorised finding while composing a new incident —
  // updates as the participant/type selections change, pre-submit. The backend computes and
  // freezes the real value at Create; on Edit this preview is not used — the banner below reads
  // the frozen existingIncident.isRestrictivePracticeAuthorised instead.
  const rpAuthorisationPreview = previewRpAuthorisation(involvedParticipantId, restrictivePracticeType, matchingActivePractices)

  const isUnapprovedMode = manualUnapprovedSelected || !!unapprovedRestrictivePracticeDetails?.trim()
  const linkedChoice = restrictivePracticeId ? restrictivePracticeId : (isUnapprovedMode ? 'unapproved' : '')

  function handleSelectLinkedPractice(practiceId: string) {
    setManualUnapprovedSelected(false)
    setValue('restrictivePracticeId', practiceId, { shouldDirty: true, shouldValidate: true })
    // Mutually exclusive with the unapproved-details text — selecting a registered practice
    // clears whatever unapproved description had been typed.
    setValue('unapprovedRestrictivePracticeDetails', '', { shouldDirty: true, shouldValidate: true })
    const practice = matchingActivePractices.find((p) => p.id === practiceId)
    // Only prepopulate Description when it's still empty — never clobber what the reporter has
    // already typed (the same "skeleton, don't overwrite" rule INC-03's MAR prefill follows).
    if (practice && !getValues('description')?.trim()) {
      setValue('description', buildRpIncidentDescriptionSkeleton(practice), { shouldDirty: true })
    }
  }

  function handleSelectUnapproved() {
    setManualUnapprovedSelected(true)
    // Clears the linked-practice choice — typing into the unapproved-details field is what
    // actually flips this to non-empty; selecting the radio just clears the mutually-exclusive
    // link and focuses the reporter on the textarea below.
    setValue('restrictivePracticeId', '', { shouldDirty: true, shouldValidate: true })
  }

  return (
    <Card title="Restrictive Practice Details" className="space-y-4">
      <div className={formGrid}>
        <FormField label="Restrictive Practice Type" required error={errors.restrictivePracticeType?.message} className={span.medium}>
          <Dropdown
            variant="form"
            value={restrictivePracticeType ?? ''}
            onChange={(v) => setValue('restrictivePracticeType', v, { shouldDirty: true, shouldValidate: true })}
            label="Select restrictive practice type..."
            items={RESTRICTIVE_PRACTICE_TYPES.map((t) => ({ value: t, label: RESTRICTIVE_PRACTICE_TYPE_LABELS[t] }))}
          />
        </FormField>
      </div>

      {restrictivePracticeType && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-[var(--color-foreground)] mb-1">
            Which practice was used?
          </legend>

          {/* The "None of these — unapproved" option (and the detail field it reveals) is
              ALWAYS available once a type is picked — an incident can describe an unapproved
              practice with no participant selected at all. The active-practices list above it is
              necessarily participant-scoped, so it's this hint or the list, never both. */}
          {!involvedParticipantId ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Select the involved participant on the Basics step to see their authorised restrictive practices.
            </p>
          ) : matchingActivePractices.length === 0 && (
            <p className="text-sm text-[var(--color-muted-foreground)]">
              No active authorised practices of this type are on file for this participant.
            </p>
          )}

          <div role="radiogroup" aria-label="Which practice was used?" className="space-y-2">
            {matchingActivePractices.map((p) => (
              <label
                key={p.id}
                className="flex items-start gap-3 p-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-accent)]"
              >
                <input
                  type="radio"
                  name="linkedRestrictivePractice"
                  className="mt-1 w-4 h-4"
                  checked={linkedChoice === p.id}
                  onChange={() => handleSelectLinkedPractice(p.id)}
                />
                <span className="text-sm">
                  <span className="block font-medium">{p.description}</span>
                  <span className="block text-[var(--color-muted-foreground)]">
                    {p.reviewDate ? `Review due ${formatDateAu(p.reviewDate)}` : 'No review date on file'}
                  </span>
                </span>
              </label>
            ))}

            <label className="flex items-start gap-3 p-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-accent)]">
              <input
                type="radio"
                name="linkedRestrictivePractice"
                className="mt-1 w-4 h-4"
                checked={linkedChoice === 'unapproved'}
                onChange={handleSelectUnapproved}
              />
              <span className="text-sm font-medium">None of these — an unapproved practice was used</span>
            </label>
          </div>

          {linkedChoice === 'unapproved' && (
            <FormField
              label="Describe the restrictive practice that was used"
              required
              error={errors.unapprovedRestrictivePracticeDetails?.message}
              hint="This is recorded on the incident only — it will never create or update an entry on the participant's restrictive practice register."
            >
              <textarea
                value={unapprovedRestrictivePracticeDetails ?? ''}
                onChange={(e) => setValue('unapprovedRestrictivePracticeDetails', e.target.value, { shouldDirty: true, shouldValidate: true })}
                rows={3}
                placeholder="Describe what was actually done, since it wasn't one of the registered practices above"
              />
            </FormField>
          )}

          <button
            type="button"
            onClick={() => setShowInactive((v) => !v)}
            className="text-sm font-medium text-[var(--color-primary)] hover:underline"
            aria-expanded={showInactive}
          >
            {showInactive ? 'Hide' : 'Show'} inactive/retired practices
          </button>

          {showInactive && (
            <div className="space-y-2">
              {matchingInactivePractices.length === 0 ? (
                <p className="text-sm text-[var(--color-muted-foreground)]">No inactive practices of this type on file.</p>
              ) : (
                matchingInactivePractices.map((p) => (
                  <div key={p.id} className="p-3 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border)] text-sm text-[var(--color-muted-foreground)]">
                    <span className="block">{p.description}</span>
                    <span className="block text-xs">Retired — not selectable as the practice used.</span>
                  </div>
                ))
              )}
            </div>
          )}
        </fieldset>
      )}

      {/* INC-04: the authorised/unauthorised determination. On create this is a live preview that
          updates as the participant/type change; on edit it shows the value frozen at creation
          (see IncidentReport.IsRestrictivePracticeAuthorised) and never recomputes, even if the
          fields above are changed in this edit session. */}
      {isEdit ? (
        existingIncident && existingIncident.isRestrictivePracticeAuthorised !== null ? (
          <div
            role="status"
            className={`flex items-start gap-3 p-3 rounded-[var(--radius-sm)] text-sm border ${
              existingIncident.isRestrictivePracticeAuthorised
                ? 'bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/20'
                : 'bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] border-[var(--color-destructive)]/20'
            }`}
          >
            {existingIncident.isRestrictivePracticeAuthorised
              ? <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
              : <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />}
            <p>
              <strong className="font-medium">
                {existingIncident.isRestrictivePracticeAuthorised
                  ? 'Authorised at the time this was reported.'
                  : 'No matching authorised practice — this may be a reportable incident.'}
              </strong>{' '}
              Determined when this incident was created and fixed from then on — changing the participant or
              type above won't re-check it against today's register.
            </p>
          </div>
        ) : (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            No authorisation determination on record for this incident.
          </p>
        )
      ) : (
        <div
          role="status"
          aria-live="polite"
          className={`flex items-start gap-3 p-3 rounded-[var(--radius-sm)] text-sm border ${
            rpAuthorisationPreview === 'authorised'
              ? 'bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/20'
              : rpAuthorisationPreview === 'unauthorised'
              ? 'bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] border-[var(--color-destructive)]/20'
              : 'bg-[var(--color-secondary-container)]/40 text-[var(--color-foreground)] border-[var(--color-secondary-container)]'
          }`}
        >
          {rpAuthorisationPreview === 'authorised' && <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />}
          {rpAuthorisationPreview === 'unauthorised' && <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />}
          {rpAuthorisationPreview === 'unknown' && <Info className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />}
          <p>
            {rpAuthorisationPreview === 'authorised' && (
              <strong className="font-medium">Authorised — matches an active practice on this participant's register.</strong>
            )}
            {rpAuthorisationPreview === 'unauthorised' && (
              <strong className="font-medium">No matching authorised practice — this may be a reportable incident.</strong>
            )}
            {rpAuthorisationPreview === 'unknown' && (
              <>Select the involved participant and restrictive practice type to check this against their authorised practices.</>
            )}
          </p>
        </div>
      )}
    </Card>
  )
}
