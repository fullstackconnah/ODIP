/**
 * PF-10.4 — Profile wizard, "Cultural Depth & Consents" step (task brief: "Cultural depth /
 * Consents"). Cultural Background's 9 tri-state flags are Shared/Intake-owned: editable toggles when
 * `sharedFieldsEditable` (the Profile wizard), read-only otherwise (the caregiver wizard);
 * Personal Interests/Choice & Control and the full Consent & Terms block are Profile-owned.
 *
 * Holiday/STA consent gating (SPEC-05, settled product decision): PhotoVideo/Privacy/
 * EmergencyMedical are always shown; Alcohol/OtcMedication/TravelInsurance/TermsAndConditions
 * render only when `staVisible` (serviceStreams includes 'STA') — see
 * participantSchema.ts's PROFILE_CONDITIONAL_SECTIONS `holidaySta` entry and
 * participantPatchGroups.ts's filterConsentsForSave for the save-time half of this gate.
 */
import type { Control, UseFormRegister, UseFieldArrayReturn } from 'react-hook-form'
import { Controller, useWatch } from 'react-hook-form'
import { Card } from '@/components/Card'
import { FormField } from '@/components/FormField'
import { TextAreaField } from '@/components/TextAreaField'
import { CompactGridRow } from '@/components/wizard'
import type { ParticipantFormData } from '@/lib/participantSchema'
import type { ParticipantDetailDto } from '@/api/types/participants'
import { CONSENT_TYPE_LABELS } from '@/api/types/consents'
import { HOLIDAY_STA_CONSENT_TYPES } from '@/lib/participantPatchGroups'
import type { ConsentType } from '@/api/types/enums'
import { ReadOnlyField } from '../profileHelpers'
import { yesNoUnknown } from '../profileFormat'
import { CulturalBackgroundFields, FromIntakeNote, InformationReceivedFields } from '../sharedFieldControls'
import { formGrid, span } from '@/lib/formGrid'

const GRANTED_OPTIONS = [
  { value: 'true', label: 'Granted' },
  { value: 'false', label: 'Declined' },
  { value: '', label: 'Not recorded' },
]

export function CulturalDepthConsentsStep({ control, register, participant, consentsFieldArray, staVisible, sharedFieldsEditable = false }: {
  control: Control<ParticipantFormData>
  register: UseFormRegister<ParticipantFormData>
  participant: ParticipantDetailDto
  consentsFieldArray: UseFieldArrayReturn<ParticipantFormData, 'consents'>
  staVisible: boolean
  /** Render the cultural-background and information-received flags as editable toggles (the Profile
   * wizard) instead of read-only values (the caregiver wizard, the default). */
  sharedFieldsEditable?: boolean
}) {
  const consents = useWatch({ control, name: 'consents' }) ?? []

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {sharedFieldsEditable ? (
        <>
          <Card title="Cultural Background (from Intake)">
            <FromIntakeNote />
            <div className={formGrid}>
              <CulturalBackgroundFields control={control} />
            </div>
          </Card>

          <Card title="Information Received (from Intake)">
            <div className={formGrid}>
              <InformationReceivedFields control={control} />
            </div>
          </Card>
        </>
      ) : (
        <ReadOnlyCulturalCards participant={participant} />
      )}

      <Card title="Cultural Depth">
        <div className={formGrid}>
          <TextAreaField label="Personal Interests" id="personalInterests" rows={3} {...register('personalInterests')} className={span.long} />
          <TextAreaField label="Choice & Control Notes" id="choiceControlNotes" rows={3} {...register('choiceControlNotes')} className={span.long} />
        </div>
      </Card>

      <Card title="Consent & Terms" className="space-y-0">
        {consentsFieldArray.fields.map((field, index) => {
          const type = field.consentType as ConsentType
          if (HOLIDAY_STA_CONSENT_TYPES.includes(type) && !staVisible) return null
          const row = consents[index]
          return (
            <CompactGridRow
              key={field.id}
              label={CONSENT_TYPE_LABELS[type]}
              control={
                <Controller
                  control={control}
                  name={`consents.${index}.granted` as const}
                  render={({ field: f }) => (
                    <select id={`consents.${index}.granted`} aria-label={CONSENT_TYPE_LABELS[type]} value={f.value ?? ''} onChange={(e) => f.onChange(e.target.value)}>
                      {GRANTED_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  )}
                />
              }
              expanded={row?.granted === 'true' ? (
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Signed By" className="mb-0">
                    <input {...register(`consents.${index}.signedByName` as const)} />
                  </FormField>
                  <FormField label="Signed Date" className="mb-0">
                    <input type="date" {...register(`consents.${index}.signedDate` as const)} />
                  </FormField>
                </div>
              ) : undefined}
            />
          )
        })}
        {!staVisible && (
          <p className="text-xs text-[var(--color-muted-foreground)] pt-3">
            Alcohol, OTC Medication, Travel Insurance, and Terms &amp; Conditions consents apply only to
            Short Term Accommodation (STA) participants — hidden here, any previously recorded values are retained.
          </p>
        )}
      </Card>
    </div>
  )
}

/** The caregiver wizard's version of the two intake cards: the same flags, read-only. */
function ReadOnlyCulturalCards({ participant }: { participant: ParticipantDetailDto }) {
  return (
    <>
      <Card title="Cultural Background (from Intake)">
        <div className={formGrid}>
          <ReadOnlyField field="isCald" label="CALD" value={yesNoUnknown(participant.isCald === null ? '' : String(participant.isCald))} className={span.short} />
          <ReadOnlyField field="isLgbtqi" label="LGBTIQA+" value={yesNoUnknown(participant.isLgbtqi === null ? '' : String(participant.isLgbtqi))} className={span.short} />
          <ReadOnlyField field="isFamilyCommunity" label="Family / Community" value={yesNoUnknown(participant.isFamilyCommunity === null ? '' : String(participant.isFamilyCommunity))} className={span.short} />
          <ReadOnlyField
            field="isAboriginalOrTorresStraitIslander"
            label="Aboriginal and/or Torres Strait Islander"
            value={yesNoUnknown(participant.isAboriginalOrTorresStraitIslander === null ? '' : String(participant.isAboriginalOrTorresStraitIslander))}
            className={span.medium}
          />
        </div>
      </Card>

      <Card title="Information Received (from Intake)">
        <div className={formGrid}>
          <ReadOnlyField field="receivedRightsAndResponsibilitiesInfo" label="Received: Rights and Responsibilities" value={yesNoUnknown(participant.receivedRightsAndResponsibilitiesInfo === null ? '' : String(participant.receivedRightsAndResponsibilitiesInfo))} className={span.medium} />
          <ReadOnlyField field="receivedPrivacyAndConfidentialityInfo" label="Received: Privacy and Confidentiality" value={yesNoUnknown(participant.receivedPrivacyAndConfidentialityInfo === null ? '' : String(participant.receivedPrivacyAndConfidentialityInfo))} className={span.medium} />
          <ReadOnlyField field="receivedFeedbackInfo" label="Received: Feedback Information and Form" value={yesNoUnknown(participant.receivedFeedbackInfo === null ? '' : String(participant.receivedFeedbackInfo))} className={span.medium} />
          <ReadOnlyField field="receivedBeingSafeInfo" label="Received: Being Safe Information" value={yesNoUnknown(participant.receivedBeingSafeInfo === null ? '' : String(participant.receivedBeingSafeInfo))} className={span.medium} />
          <ReadOnlyField field="receivedAdvocacyInfo" label="Received: Advocacy Information" value={yesNoUnknown(participant.receivedAdvocacyInfo === null ? '' : String(participant.receivedAdvocacyInfo))} className={span.medium} />
        </div>
      </Card>
    </>
  )
}
