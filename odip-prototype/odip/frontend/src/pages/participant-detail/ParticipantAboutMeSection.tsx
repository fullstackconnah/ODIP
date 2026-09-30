import { useState } from 'react'
import { usePatchParticipant } from '@/api/hooks'
import { FormField } from '@/components/FormField'
import { FactList } from '@/components/FactList'
import { formGrid, span } from '@/lib/formGrid'
import { SectionEditPanel } from './SectionEditPanel'
import type { ParticipantDetailDto } from '@/api/types/participants'
import { extractErrorMessage } from '@/lib/utils'

const pl = (v?: string | null) => (v ? <span className="whitespace-pre-line">{v}</span> : undefined)

/** PD-7: About Me card — CORE-02's `aboutMe` group, fully rendered (all 6 fields optional, no merge needed). */
type AboutMeDraft = {
  goals: string; supportAreas: string; strengthsFears: string; thingsToKnow: string; whoIsImportant: string; likesDislikes: string
}

function readAboutMe(p: ParticipantDetailDto): AboutMeDraft {
  return {
    goals: p.goals ?? '', supportAreas: p.supportAreas ?? '', strengthsFears: p.strengthsFears ?? '',
    thingsToKnow: p.thingsToKnow ?? '', whoIsImportant: p.whoIsImportant ?? '', likesDislikes: p.likesDislikes ?? '',
  }
}

export function ParticipantAboutMeSection({ p, participantId, canEdit }: { p: ParticipantDetailDto; participantId: string; canEdit: boolean }) {
  const patchParticipant = usePatchParticipant()
  const saved = readAboutMe(p)
  const [draft, setDraft] = useState<AboutMeDraft>(saved)
  const isDirty = (Object.keys(saved) as (keyof AboutMeDraft)[]).some((k) => draft[k] !== saved[k])

  const hasAnyData = !!(p.goals || p.supportAreas || p.strengthsFears || p.thingsToKnow || p.whoIsImportant || p.likesDislikes)

  if (!canEdit && !hasAnyData) return null

  async function handleSave() {
    try {
      await patchParticipant.mutateAsync({
        id: participantId,
        data: {
          aboutMe: {
            goals: draft.goals.trim() || null,
            supportAreas: draft.supportAreas.trim() || null,
            strengthsFears: draft.strengthsFears.trim() || null,
            thingsToKnow: draft.thingsToKnow.trim() || null,
            whoIsImportant: draft.whoIsImportant.trim() || null,
            likesDislikes: draft.likesDislikes.trim() || null,
          },
        },
      })
    } catch (err) {
      throw new Error(extractErrorMessage(err, 'Failed to save About Me.'))
    }
  }

  return (
    <SectionEditPanel title="About Me" canEdit={canEdit} isDirty={isDirty} onEditStart={() => setDraft(saved)} onCancel={() => setDraft(saved)} onSave={handleSave}>
      {(editing) => editing ? (
        <div className={formGrid}>
          <FormField label="Goals" className={span.medium}>
            <textarea value={draft.goals} onChange={(e) => setDraft((d) => ({ ...d, goals: e.target.value }))} rows={2} />
          </FormField>
          <FormField label="Support Areas" className={span.medium}>
            <textarea value={draft.supportAreas} onChange={(e) => setDraft((d) => ({ ...d, supportAreas: e.target.value }))} rows={2} />
          </FormField>
          <FormField label="Strengths / Fears" className={span.medium}>
            <textarea value={draft.strengthsFears} onChange={(e) => setDraft((d) => ({ ...d, strengthsFears: e.target.value }))} rows={2} />
          </FormField>
          <FormField label="Things to Know" className={span.medium}>
            <textarea value={draft.thingsToKnow} onChange={(e) => setDraft((d) => ({ ...d, thingsToKnow: e.target.value }))} rows={2} />
          </FormField>
          <FormField label="Who/What Is Important" className={span.medium}>
            <textarea value={draft.whoIsImportant} onChange={(e) => setDraft((d) => ({ ...d, whoIsImportant: e.target.value }))} rows={2} />
          </FormField>
          <FormField label="Likes & Dislikes" className={span.medium}>
            <textarea value={draft.likesDislikes} onChange={(e) => setDraft((d) => ({ ...d, likesDislikes: e.target.value }))} rows={2} />
          </FormField>
        </div>
      ) : (
        <FactList
          items={[
            { label: 'Goals', value: pl(p.goals) },
            { label: 'Support Areas', value: pl(p.supportAreas) },
            { label: 'Strengths / Fears', value: pl(p.strengthsFears) },
            { label: 'Things to Know', value: pl(p.thingsToKnow) },
            { label: 'Who/What Is Important', value: pl(p.whoIsImportant) },
            { label: 'Likes & Dislikes', value: pl(p.likesDislikes) },
          ].filter((item) => item.value)}
        />
      )}
    </SectionEditPanel>
  )
}

export default ParticipantAboutMeSection
