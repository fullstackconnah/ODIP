import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FieldErrors, UseFormGetValues, UseFormSetValue } from 'react-hook-form'
import { ShieldCheck, ShieldAlert, Info } from 'lucide-react'
import { useRestrictivePractices } from '@/api/hooks'
import { FormField } from '@/components/FormField'
import { CheckboxField } from '@/components/CheckboxField'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { Dropdown } from '@/components/Dropdown'
import { RESTRICTIVE_PRACTICE_TYPES, RESTRICTIVE_PRACTICE_TYPE_LABELS } from '@/api/types/restrictive-practices'
import type { RestrictivePracticeDto, RestrictivePracticeType } from '@/api/types/restrictive-practices'
import { previewRpAuthorisation, buildRpIncidentDescriptionSkeleton, isRpAuthorised, editedRpAuthorisation } from '@/lib/incidentPrefill'
import { usePermissions } from '@/lib/permissions'
import { formatDateAu } from '@/lib/utils'
import type { IncidentFormData } from '../incidentFormSchema'
import type { IncidentDetailDto } from '@/api/types'
import { formGrid, span } from '@/lib/formGrid'
import { RpAuthorisationBadge } from '../RpAuthorisationBadge'
import { AddRestrictivePracticeDialog } from '../../participant-detail/AddRestrictivePracticeDialog'

export type RestrictivePracticeStepProps = {
  getValues: UseFormGetValues<IncidentFormData>
  setValue: UseFormSetValue<IncidentFormData>
  errors: FieldErrors<IncidentFormData>
  involvedParticipantId: string | undefined
  restrictivePracticeType: string | undefined
  restrictivePracticeId: string | undefined
  unapprovedRestrictivePracticeDetails: string | undefined
  usedWithoutAuthorisation: boolean | undefined
  description: string | undefined
  isEdit: boolean
  existingIncident: IncidentDetailDto | undefined
}

/**
 * IN-4 — wizard step 1, "Restrictive Practice". Only ever rendered while
 * incidentType === 'RestrictivePracticeUse' (the parent page's computed step list removes this
 * step entirely otherwise — see IN-1).
 *
 * THE central rule this step's UI exists to enforce: exactly one of "linked to one of the
 * participant's active register entries" (restrictivePracticeId) or "a practice not on the register
 * was used" (unapprovedRestrictivePracticeDetails, free text) is ever set — never both, never
 * neither. Selecting one clears the other. Submitting the incident NEVER creates or updates a row
 * in the participant's RestrictivePractices register; "Add to restrictive practice register" is a
 * separate, explicit save through the register's own role-checked endpoint, after which the
 * incident links the new entry.
 *
 * Each entry is badged Authorised or Not authorised by the shared rule (isRpAuthorised). Choosing a
 * registered practice offers "This use was not authorised", ticked and locked for a Not authorised
 * entry: the incident is then stored unauthorised, like "None of these", with the link kept.
 */
export function RestrictivePracticeStep({
  getValues, setValue, errors,
  involvedParticipantId, restrictivePracticeType, restrictivePracticeId, unapprovedRestrictivePracticeDetails,
  usedWithoutAuthorisation, description, isEdit, existingIncident,
}: RestrictivePracticeStepProps) {
  const { canWriteRestrictivePractices } = usePermissions()
  const [showInactive, setShowInactive] = useState(false)
  // Tracks the "None of these" radio being clicked BEFORE any text is typed into the details
  // textarea it reveals — unapprovedRestrictivePracticeDetails alone can't carry that (it's empty
  // until the reporter types), so without this the radio would appear unselected (and the
  // textarea would stay hidden) the instant it's clicked. Reset naturally whenever this whole step
  // unmounts (incidentType changed away from RestrictivePracticeUse), and superseded by
  // unapprovedRestrictivePracticeDetails already having text (e.g. edit mode, or prefill) via the
  // `linkedChoice` derivation below.
  const [manualUnapprovedSelected, setManualUnapprovedSelected] = useState(false)
  const [adding, setAdding] = useState(false)
  // The entry just added from here, shown and linked before the register list refetches with it.
  const [addedPractice, setAddedPractice] = useState<RestrictivePracticeDto | null>(null)

  // INC-04/INC-05: the involved participant's ACTIVE register entries — useRestrictivePractices
  // defaults to active-only, exactly the set both the determination and the linked-entry picker
  // need. Disabled (participantId undefined) until a participant is chosen.
  const { data: activePractices = [] } = useRestrictivePractices(involvedParticipantId || undefined)
  // IN-4's "show inactive/retired practices" disclosure — a second query, only fetched once the
  // toggle is actually on, requesting the full (active + inactive) set.
  const { data: allPractices = [] } = useRestrictivePractices(showInactive ? (involvedParticipantId || undefined) : undefined, true)

  const matchingActivePractices = useMemo(() => {
    const matching = activePractices.filter((p) => p.type === restrictivePracticeType)
    return addedPractice && addedPractice.type === restrictivePracticeType && addedPractice.participantId === involvedParticipantId
      && !matching.some((p) => p.id === addedPractice.id)
      ? [...matching, addedPractice] : matching
  }, [activePractices, restrictivePracticeType, addedPractice, involvedParticipantId])
  const matchingInactivePractices = useMemo(
    () => allPractices.filter((p) => p.type === restrictivePracticeType && !p.isActive),
    [allPractices, restrictivePracticeType],
  )

  const isUnapprovedMode = manualUnapprovedSelected || !!unapprovedRestrictivePracticeDetails?.trim()
  const linkedChoice = restrictivePracticeId ? restrictivePracticeId : (isUnapprovedMode ? 'unapproved' : '')
  const linkedPractice = matchingActivePractices.find((p) => p.id === restrictivePracticeId)
  // A Not authorised entry locks the box ticked. Editing an incident whose link is unchanged keeps what it was stored with (frozen) instead.
  const lockedNotAuthorised = !!linkedPractice && !isRpAuthorised(linkedPractice)
    && !(isEdit && restrictivePracticeId === existingIncident?.restrictivePracticeId)

  // INC-04: live preview of the authorised/unauthorised finding while composing a new incident,
  // following the server's determination step for step. On Edit this preview is not used — the
  // banner below reads the frozen existingIncident.isRestrictivePracticeAuthorised instead.
  const rpAuthorisationPreview = previewRpAuthorisation(involvedParticipantId, restrictivePracticeType, matchingActivePractices, {
    restrictivePracticeId, unapproved: linkedChoice === 'unapproved', usedWithoutAuthorisation: !!restrictivePracticeId && !!usedWithoutAuthorisation,
  })

  // Edit mode: the stored determination as the save will leave it (it can only be lowered).
  const editedAuthorisation = editedRpAuthorisation(existingIncident?.isRestrictivePracticeAuthorised, !!existingIncident?.unapprovedRestrictivePracticeDetails?.trim(), {
    restrictivePracticeId, unapproved: !!unapprovedRestrictivePracticeDetails?.trim(), usedWithoutAuthorisation,
  })

  function handleSelectLinkedPractice(practice: RestrictivePracticeDto) {
    setManualUnapprovedSelected(false)
    setValue('restrictivePracticeId', practice.id, { shouldDirty: true, shouldValidate: true })
    // Mutually exclusive with the unapproved-details text — selecting a registered practice
    // clears whatever unapproved description had been typed.
    setValue('unapprovedRestrictivePracticeDetails', '', { shouldDirty: true, shouldValidate: true })
    const authorised = isRpAuthorised(practice)
    setValue('usedWithoutAuthorisation', !authorised, { shouldDirty: true })
    if (!authorised) clearUntouchedSkeleton()
    // Only prepopulate Description when it's still empty — never clobber what the reporter has
    // already typed (the same "skeleton, don't overwrite" rule INC-03's MAR prefill follows). Not
    // for a Not authorised entry: there the reporter must describe what was actually done.
    if (authorised && !getValues('description')?.trim()) {
      const skeleton = buildRpIncidentDescriptionSkeleton(practice)
      setValue('description', skeleton, { shouldDirty: true })
      setValue('rpDescriptionSkeleton', skeleton)
    }
  }

  // The unauthorised-use path needs the reporter's own words, so an untouched skeleton goes (the schema also treats one as no description).
  function clearUntouchedSkeleton() {
    const skeleton = getValues('rpDescriptionSkeleton')?.trim()
    if (skeleton && getValues('description')?.trim() === skeleton) setValue('description', '', { shouldDirty: true })
  }

  function handleSelectUnapproved() {
    setManualUnapprovedSelected(true)
    // Clears the linked-practice choice — typing into the unapproved-details field is what
    // actually flips this to non-empty; selecting the radio just clears the mutually-exclusive
    // link and focuses the reporter on the textarea below.
    setValue('restrictivePracticeId', '', { shouldDirty: true, shouldValidate: true })
    setValue('usedWithoutAuthorisation', false, { shouldDirty: true })
    clearUntouchedSkeleton()
  }

  // The new entry is linked in place of "None of these": its text moves into the incident's description (the link and the text are mutually
  // exclusive), and, saved without authorisation details, it is Not authorised, so "This use was not authorised" locks ticked.
  function handleAdded(created: RestrictivePracticeDto[]) {
    setAdding(false)
    const entry = created[0]
    if (!entry) return
    const text = unapprovedRestrictivePracticeDetails?.trim() ?? ''
    const current = getValues('description')?.trim() ?? ''
    if (text && !current.includes(text)) {
      setValue('description', current ? `${current}\n\n${text}` : text, { shouldDirty: true })
    }
    setAddedPractice(entry)
    handleSelectLinkedPractice(entry)
  }

  return (
    <Card title="Restrictive practice details" className="space-y-4">
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

          {/* The "None of these" option (and the detail field it reveals) is ALWAYS available once a
              type is picked — an incident can describe an unregistered practice with no participant
              selected at all. The active-practices list above it is necessarily participant-scoped,
              so it's this hint or the list, never both. */}
          {!involvedParticipantId ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Select the involved participant on the Basics step to see the restrictive practices on their register.
            </p>
          ) : matchingActivePractices.length === 0 && (
            <p className="text-sm text-[var(--color-muted-foreground)]">
              No active practices of this type are on this participant's register.
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
                  onChange={() => handleSelectLinkedPractice(p)}
                />
                <span className="text-sm min-w-0 flex-1">
                  <span className="block font-medium">{p.description}</span>
                  <span className="block text-[var(--color-muted-foreground)]">
                    {p.reviewDate ? `Review due ${formatDateAu(p.reviewDate)}` : 'No review date on file'}
                  </span>
                </span>
                <RpAuthorisationBadge authorised={isRpAuthorised(p)} />
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
              <span className="text-sm font-medium">None of these — the practice used is not on this participant's register</span>
            </label>
          </div>

          {restrictivePracticeId && (
            <div className="space-y-3 pl-3 border-l-2 border-[var(--color-border)]">
              <CheckboxField
                label="This use was not authorised"
                checked={lockedNotAuthorised || !!usedWithoutAuthorisation}
                disabled={lockedNotAuthorised}
                onChange={(e) => {
                  if (e.target.checked) clearUntouchedSkeleton()
                  setValue('usedWithoutAuthorisation', e.target.checked, { shouldDirty: true, shouldValidate: true })
                }}
                hint={lockedNotAuthorised
                  ? "This practice's register entry is missing who authorised it or when, so this use can't be recorded as authorised."
                  : 'Tick this if the practice was used outside its authorisation.'}
              />
              {(lockedNotAuthorised || usedWithoutAuthorisation) && (
                <FormField
                  label="Describe what was actually done"
                  required
                  error={errors.description?.message}
                  hint="This is the incident's description, which also appears on the Details step."
                >
                  <textarea
                    value={description ?? ''}
                    onChange={(e) => setValue('description', e.target.value, { shouldDirty: true, shouldValidate: true })}
                    rows={3}
                  />
                </FormField>
              )}
            </div>
          )}

          {linkedChoice === 'unapproved' && (
            <>
              <FormField
                label="Describe the restrictive practice that was used"
                required
                error={errors.unapprovedRestrictivePracticeDetails?.message}
                hint="Recorded on this incident. Submitting the incident doesn't change the participant's register."
              >
                <textarea
                  value={unapprovedRestrictivePracticeDetails ?? ''}
                  onChange={(e) => setValue('unapprovedRestrictivePracticeDetails', e.target.value, { shouldDirty: true, shouldValidate: true })}
                  rows={3}
                  placeholder="Describe what was actually done, since it wasn't one of the registered practices above"
                />
              </FormField>
              {involvedParticipantId && <div>{canWriteRestrictivePractices ? (
                <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
                  Add to restrictive practice register
                </Button>
              ) : (
                <p className="text-sm text-[var(--color-muted-foreground)]">A coordinator will be asked to add this to the register.</p>
              )}</div>}
            </>
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

      {/* The wizard is a form: drawn on document.body, Enter in the dialog's fields can't submit the incident (as PlanBudgetCard does). */}
      {involvedParticipantId && restrictivePracticeType && createPortal(
        <AddRestrictivePracticeDialog
          open={adding}
          participantId={involvedParticipantId}
          defaultType={restrictivePracticeType as RestrictivePracticeType}
          defaultDescription={unapprovedRestrictivePracticeDetails?.trim()}
          onClose={() => setAdding(false)}
          onSaved={handleAdded}
        />,
        document.body,
      )}

      {/* INC-04: the authorised/unauthorised determination. On create this is a live preview that
          updates as the choices above change; on edit it shows the value frozen at creation
          (see IncidentReport.IsRestrictivePracticeAuthorised) and never recomputes against today's
          register — it only shows the lowered state the save will store (editedRpAuthorisation). */}
      {isEdit ? (
        editedAuthorisation != null ? (
          <div
            role="status"
            className={`flex items-start gap-3 p-3 rounded-[var(--radius-sm)] text-sm border ${
              editedAuthorisation
                ? 'bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/20'
                : 'bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] border-[var(--color-destructive)]/20'
            }`}
          >
            {editedAuthorisation
              ? <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
              : <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />}
            <p>
              <strong className="font-medium">
                {editedAuthorisation
                  ? 'Authorised at the time this was reported.'
                  : 'Not authorised — this may be a reportable incident.'}
              </strong>{' '}
              {editedAuthorisation === existingIncident?.isRestrictivePracticeAuthorised
                ? <>Determined when this incident was created and fixed from then on — changing the participant or
                  type above won't re-check it against today's register.</>
                : 'Saving records this use as not authorised.'}
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
              <strong className="font-medium">Authorised — matches an authorised practice on this participant's register.</strong>
            )}
            {rpAuthorisationPreview === 'unauthorised' && (
              <strong className="font-medium">Not authorised — this may be a reportable incident.</strong>
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
