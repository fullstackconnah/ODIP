/**
 * PF-10.3 — Intake wizard, "Cultural Considerations" step. Per PF-10.1's allocation table, this
 * is "the clearest one-to-one duplicate in the whole set" — the full 9-field Cultural table is
 * `entryPhase: 'intake'` in its entirety; `personalInterests`/`choiceControlNotes`/`consents`
 * (Profile-entry) are absent, matching the requirement to remove common/non-intake content.
 */
import type { Control } from 'react-hook-form'
import { Card } from '@/components/Card'
import type { ParticipantFormData } from '@/lib/participantSchema'
import { YesNoToggleField } from '../intakeHelpers'

export function CulturalConsiderationsStep({ control }: { control: Control<ParticipantFormData> }) {
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <Card title="Cultural Background" className="space-y-4">
        <YesNoToggleField control={control} name="isCald" label="Culturally and Linguistically Diverse (CALD)" />
        <YesNoToggleField control={control} name="isLgbtqi" label="LGBTIQA+" />
        <YesNoToggleField control={control} name="isFamilyCommunity" label="Family / Community" />
        <YesNoToggleField control={control} name="isAboriginalOrTorresStraitIslander" label="Aboriginal and/or Torres Strait Islander" />
      </Card>

      <Card title="Information Received" className="space-y-4">
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Has the participant (or their representative) received and understood the following?
        </p>
        <YesNoToggleField control={control} name="receivedRightsAndResponsibilitiesInfo" label="Rights and Responsibilities" />
        <YesNoToggleField control={control} name="receivedPrivacyAndConfidentialityInfo" label="Privacy and Confidentiality" />
        <YesNoToggleField control={control} name="receivedFeedbackInfo" label="Feedback Information and Form" />
        <YesNoToggleField control={control} name="receivedBeingSafeInfo" label="Being Safe Information" />
        <YesNoToggleField control={control} name="receivedAdvocacyInfo" label="Advocacy Information" />
      </Card>
    </div>
  )
}
