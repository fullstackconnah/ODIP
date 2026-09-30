import { useState } from 'react'
import { usePatchParticipant } from '@/api/hooks'
import { FormField } from '@/components/FormField'
import { FactList } from '@/components/FactList'
import { ToggleGroup } from '@/components/ToggleGroup'
import { formGrid, span } from '@/lib/formGrid'
import { SectionEditPanel } from './SectionEditPanel'
import type { ParticipantDetailDto } from '@/api/types/participants'
import { extractErrorMessage } from '@/lib/utils'

/** INTAKE sub-wave B tri-state idiom, duplicated locally per this codebase's per-file-helper convention (see SupportProfileTab.tsx). */
const YES_NO_UNANSWERED_OPTIONS = [
  { key: 'true', label: 'Yes' },
  { key: 'false', label: 'No' },
  { key: '', label: 'Not recorded' },
]
function triToKey(v: boolean | null | undefined): string {
  return v === true ? 'true' : v === false ? 'false' : ''
}
function keyToTri(k: string): boolean | null {
  return k === 'true' ? true : k === 'false' ? false : null
}
function yesNoUnset(value: boolean | null | undefined): string {
  return value === true ? 'Yes' : value === false ? 'No' : '—'
}

const pl = (v?: string | null) => (v ? <span className="whitespace-pre-line">{v}</span> : undefined)

/** PD-7: Cultural Background card — CORE-02's `culturalBackground` group, fully rendered (all 11 fields optional, no merge needed). */
type CulturalBackgroundDraft = {
  isCald: string; isLgbtqi: string; isFamilyCommunity: string; isAboriginalOrTorresStraitIslander: string
  receivedRightsAndResponsibilitiesInfo: string; receivedPrivacyAndConfidentialityInfo: string
  receivedFeedbackInfo: string; receivedBeingSafeInfo: string; receivedAdvocacyInfo: string
  personalInterests: string; choiceControlNotes: string
}

function readCulturalBackground(p: ParticipantDetailDto): CulturalBackgroundDraft {
  return {
    isCald: triToKey(p.isCald), isLgbtqi: triToKey(p.isLgbtqi), isFamilyCommunity: triToKey(p.isFamilyCommunity),
    isAboriginalOrTorresStraitIslander: triToKey(p.isAboriginalOrTorresStraitIslander),
    receivedRightsAndResponsibilitiesInfo: triToKey(p.receivedRightsAndResponsibilitiesInfo),
    receivedPrivacyAndConfidentialityInfo: triToKey(p.receivedPrivacyAndConfidentialityInfo),
    receivedFeedbackInfo: triToKey(p.receivedFeedbackInfo), receivedBeingSafeInfo: triToKey(p.receivedBeingSafeInfo),
    receivedAdvocacyInfo: triToKey(p.receivedAdvocacyInfo),
    personalInterests: p.personalInterests ?? '', choiceControlNotes: p.choiceControlNotes ?? '',
  }
}

export function ParticipantCulturalBackgroundSection({ p, participantId, canEdit }: { p: ParticipantDetailDto; participantId: string; canEdit: boolean }) {
  const patchParticipant = usePatchParticipant()
  const saved = readCulturalBackground(p)
  const [draft, setDraft] = useState<CulturalBackgroundDraft>(saved)
  const isDirty = (Object.keys(saved) as (keyof CulturalBackgroundDraft)[]).some((k) => draft[k] !== saved[k])
  const hasAnyData = p.isCald != null || p.isLgbtqi != null || p.isFamilyCommunity != null || p.isAboriginalOrTorresStraitIslander != null
    || p.receivedRightsAndResponsibilitiesInfo != null || p.receivedPrivacyAndConfidentialityInfo != null
    || p.receivedFeedbackInfo != null || p.receivedBeingSafeInfo != null || p.receivedAdvocacyInfo != null
    || !!p.personalInterests || !!p.choiceControlNotes

  if (!canEdit && !hasAnyData) return null

  async function handleSave() {
    try {
      await patchParticipant.mutateAsync({
        id: participantId,
        data: {
          culturalBackground: {
            isCald: keyToTri(draft.isCald), isLgbtqi: keyToTri(draft.isLgbtqi), isFamilyCommunity: keyToTri(draft.isFamilyCommunity),
            isAboriginalOrTorresStraitIslander: keyToTri(draft.isAboriginalOrTorresStraitIslander),
            receivedRightsAndResponsibilitiesInfo: keyToTri(draft.receivedRightsAndResponsibilitiesInfo),
            receivedPrivacyAndConfidentialityInfo: keyToTri(draft.receivedPrivacyAndConfidentialityInfo),
            receivedFeedbackInfo: keyToTri(draft.receivedFeedbackInfo), receivedBeingSafeInfo: keyToTri(draft.receivedBeingSafeInfo),
            receivedAdvocacyInfo: keyToTri(draft.receivedAdvocacyInfo),
            personalInterests: draft.personalInterests.trim() || null, choiceControlNotes: draft.choiceControlNotes.trim() || null,
          },
        },
      })
    } catch (err) {
      throw new Error(extractErrorMessage(err, 'Failed to save Cultural Background.'))
    }
  }

  return (
    <SectionEditPanel title="Cultural Background" canEdit={canEdit} isDirty={isDirty} onEditStart={() => setDraft(saved)} onCancel={() => setDraft(saved)} onSave={handleSave}>
      {(editing) => editing ? (
        <div className="space-y-4">
          <div className={formGrid}>
            <FormField label="Culturally and Linguistically Diverse (CALD)" className={`mb-0 ${span.medium}`}>
              <ToggleGroup options={YES_NO_UNANSWERED_OPTIONS} value={draft.isCald} onChange={(v) => setDraft((d) => ({ ...d, isCald: v }))} ariaLabel="CALD" />
            </FormField>
            <FormField label="LGBTIQA+" className={`mb-0 ${span.medium}`}>
              <ToggleGroup options={YES_NO_UNANSWERED_OPTIONS} value={draft.isLgbtqi} onChange={(v) => setDraft((d) => ({ ...d, isLgbtqi: v }))} ariaLabel="LGBTIQA+" />
            </FormField>
            <FormField label="Family / Community" className={`mb-0 ${span.medium}`}>
              <ToggleGroup options={YES_NO_UNANSWERED_OPTIONS} value={draft.isFamilyCommunity} onChange={(v) => setDraft((d) => ({ ...d, isFamilyCommunity: v }))} ariaLabel="Family / Community" />
            </FormField>
            <FormField label="Aboriginal and/or Torres Strait Islander" className={`mb-0 ${span.medium}`}>
              <ToggleGroup options={YES_NO_UNANSWERED_OPTIONS} value={draft.isAboriginalOrTorresStraitIslander} onChange={(v) => setDraft((d) => ({ ...d, isAboriginalOrTorresStraitIslander: v }))} ariaLabel="Aboriginal and/or Torres Strait Islander" />
            </FormField>
          </div>
          <div className={formGrid}>
            <FormField label="Received: Rights and Responsibilities" className={`mb-0 ${span.medium}`}>
              <ToggleGroup options={YES_NO_UNANSWERED_OPTIONS} value={draft.receivedRightsAndResponsibilitiesInfo} onChange={(v) => setDraft((d) => ({ ...d, receivedRightsAndResponsibilitiesInfo: v }))} ariaLabel="Received: Rights and Responsibilities" />
            </FormField>
            <FormField label="Received: Privacy and Confidentiality" className={`mb-0 ${span.medium}`}>
              <ToggleGroup options={YES_NO_UNANSWERED_OPTIONS} value={draft.receivedPrivacyAndConfidentialityInfo} onChange={(v) => setDraft((d) => ({ ...d, receivedPrivacyAndConfidentialityInfo: v }))} ariaLabel="Received: Privacy and Confidentiality" />
            </FormField>
            <FormField label="Received: Feedback Information and Form" className={`mb-0 ${span.medium}`}>
              <ToggleGroup options={YES_NO_UNANSWERED_OPTIONS} value={draft.receivedFeedbackInfo} onChange={(v) => setDraft((d) => ({ ...d, receivedFeedbackInfo: v }))} ariaLabel="Received: Feedback Information and Form" />
            </FormField>
            <FormField label="Received: Being Safe Information" className={`mb-0 ${span.medium}`}>
              <ToggleGroup options={YES_NO_UNANSWERED_OPTIONS} value={draft.receivedBeingSafeInfo} onChange={(v) => setDraft((d) => ({ ...d, receivedBeingSafeInfo: v }))} ariaLabel="Received: Being Safe Information" />
            </FormField>
            <FormField label="Received: Advocacy Information" className={`mb-0 ${span.medium}`}>
              <ToggleGroup options={YES_NO_UNANSWERED_OPTIONS} value={draft.receivedAdvocacyInfo} onChange={(v) => setDraft((d) => ({ ...d, receivedAdvocacyInfo: v }))} ariaLabel="Received: Advocacy Information" />
            </FormField>
          </div>
          <FormField label="Personal Interests">
            <textarea value={draft.personalInterests} onChange={(e) => setDraft((d) => ({ ...d, personalInterests: e.target.value }))} rows={2} />
          </FormField>
          <FormField label="Choice & Control Notes">
            <textarea value={draft.choiceControlNotes} onChange={(e) => setDraft((d) => ({ ...d, choiceControlNotes: e.target.value }))} rows={2} />
          </FormField>
        </div>
      ) : (
        <FactList
          items={[
            { label: 'CALD', value: yesNoUnset(p.isCald) },
            { label: 'LGBTIQA+', value: yesNoUnset(p.isLgbtqi) },
            { label: 'Family / Community', value: yesNoUnset(p.isFamilyCommunity) },
            { label: 'Aboriginal and/or Torres Strait Islander', value: yesNoUnset(p.isAboriginalOrTorresStraitIslander) },
            { label: 'Received: Rights and Responsibilities', value: yesNoUnset(p.receivedRightsAndResponsibilitiesInfo) },
            { label: 'Received: Privacy and Confidentiality', value: yesNoUnset(p.receivedPrivacyAndConfidentialityInfo) },
            { label: 'Received: Feedback Information and Form', value: yesNoUnset(p.receivedFeedbackInfo) },
            { label: 'Received: Being Safe Information', value: yesNoUnset(p.receivedBeingSafeInfo) },
            { label: 'Received: Advocacy Information', value: yesNoUnset(p.receivedAdvocacyInfo) },
            ...(p.personalInterests ? [{ label: 'Personal Interests', value: pl(p.personalInterests) }] : []),
            ...(p.choiceControlNotes ? [{ label: 'Choice & Control Notes', value: pl(p.choiceControlNotes) }] : []),
          ]}
        />
      )}
    </SectionEditPanel>
  )
}

export default ParticipantCulturalBackgroundSection
