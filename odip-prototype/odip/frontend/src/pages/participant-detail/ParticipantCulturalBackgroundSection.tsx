import { useState } from 'react'
import { usePatchParticipant } from '@/api/hooks'
import { FormField } from '@/components/FormField'
import { ToggleGroup } from '@/components/ToggleGroup'
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
    <SectionEditPanel title="Cultural Background" className="md:col-span-2" canEdit={canEdit} isDirty={isDirty} onEditStart={() => setDraft(saved)} onCancel={() => setDraft(saved)} onSave={handleSave}>
      {(editing) => editing ? (
        <div className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <FormField label="Culturally and Linguistically Diverse (CALD)" className="mb-0">
              <ToggleGroup options={YES_NO_UNANSWERED_OPTIONS} value={draft.isCald} onChange={(v) => setDraft((d) => ({ ...d, isCald: v }))} ariaLabel="CALD" />
            </FormField>
            <FormField label="LGBTIQA+" className="mb-0">
              <ToggleGroup options={YES_NO_UNANSWERED_OPTIONS} value={draft.isLgbtqi} onChange={(v) => setDraft((d) => ({ ...d, isLgbtqi: v }))} ariaLabel="LGBTIQA+" />
            </FormField>
            <FormField label="Family / Community" className="mb-0">
              <ToggleGroup options={YES_NO_UNANSWERED_OPTIONS} value={draft.isFamilyCommunity} onChange={(v) => setDraft((d) => ({ ...d, isFamilyCommunity: v }))} ariaLabel="Family / Community" />
            </FormField>
            <FormField label="Aboriginal and/or Torres Strait Islander" className="mb-0">
              <ToggleGroup options={YES_NO_UNANSWERED_OPTIONS} value={draft.isAboriginalOrTorresStraitIslander} onChange={(v) => setDraft((d) => ({ ...d, isAboriginalOrTorresStraitIslander: v }))} ariaLabel="Aboriginal and/or Torres Strait Islander" />
            </FormField>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <FormField label="Received: Rights and Responsibilities" className="mb-0">
              <ToggleGroup options={YES_NO_UNANSWERED_OPTIONS} value={draft.receivedRightsAndResponsibilitiesInfo} onChange={(v) => setDraft((d) => ({ ...d, receivedRightsAndResponsibilitiesInfo: v }))} ariaLabel="Received: Rights and Responsibilities" />
            </FormField>
            <FormField label="Received: Privacy and Confidentiality" className="mb-0">
              <ToggleGroup options={YES_NO_UNANSWERED_OPTIONS} value={draft.receivedPrivacyAndConfidentialityInfo} onChange={(v) => setDraft((d) => ({ ...d, receivedPrivacyAndConfidentialityInfo: v }))} ariaLabel="Received: Privacy and Confidentiality" />
            </FormField>
            <FormField label="Received: Feedback Information and Form" className="mb-0">
              <ToggleGroup options={YES_NO_UNANSWERED_OPTIONS} value={draft.receivedFeedbackInfo} onChange={(v) => setDraft((d) => ({ ...d, receivedFeedbackInfo: v }))} ariaLabel="Received: Feedback Information and Form" />
            </FormField>
            <FormField label="Received: Being Safe Information" className="mb-0">
              <ToggleGroup options={YES_NO_UNANSWERED_OPTIONS} value={draft.receivedBeingSafeInfo} onChange={(v) => setDraft((d) => ({ ...d, receivedBeingSafeInfo: v }))} ariaLabel="Received: Being Safe Information" />
            </FormField>
            <FormField label="Received: Advocacy Information" className="mb-0">
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 text-sm">
          <span className="text-[var(--color-muted-foreground)]">CALD</span><span>{yesNoUnset(p.isCald)}</span>
          <span className="text-[var(--color-muted-foreground)]">LGBTIQA+</span><span>{yesNoUnset(p.isLgbtqi)}</span>
          <span className="text-[var(--color-muted-foreground)]">Family / Community</span><span>{yesNoUnset(p.isFamilyCommunity)}</span>
          <span className="text-[var(--color-muted-foreground)]">Aboriginal and/or Torres Strait Islander</span><span>{yesNoUnset(p.isAboriginalOrTorresStraitIslander)}</span>
          <span className="text-[var(--color-muted-foreground)]">Received: Rights and Responsibilities</span><span>{yesNoUnset(p.receivedRightsAndResponsibilitiesInfo)}</span>
          <span className="text-[var(--color-muted-foreground)]">Received: Privacy and Confidentiality</span><span>{yesNoUnset(p.receivedPrivacyAndConfidentialityInfo)}</span>
          <span className="text-[var(--color-muted-foreground)]">Received: Feedback Information and Form</span><span>{yesNoUnset(p.receivedFeedbackInfo)}</span>
          <span className="text-[var(--color-muted-foreground)]">Received: Being Safe Information</span><span>{yesNoUnset(p.receivedBeingSafeInfo)}</span>
          <span className="text-[var(--color-muted-foreground)]">Received: Advocacy Information</span><span>{yesNoUnset(p.receivedAdvocacyInfo)}</span>
          {p.personalInterests && (
            <>
              <span className="text-[var(--color-muted-foreground)]">Personal Interests</span>
              <span className="whitespace-pre-line">{p.personalInterests}</span>
            </>
          )}
          {p.choiceControlNotes && (
            <>
              <span className="text-[var(--color-muted-foreground)]">Choice & Control Notes</span>
              <span className="whitespace-pre-line">{p.choiceControlNotes}</span>
            </>
          )}
        </div>
      )}
    </SectionEditPanel>
  )
}

export default ParticipantCulturalBackgroundSection
