import { useState } from 'react'
import type { AxiosError } from 'axios'
import { usePatchParticipant } from '@/api/hooks'
import { FormField } from '@/components/FormField'
import { SectionEditPanel } from './SectionEditPanel'
import type { ParticipantDetailDto } from '@/api/types/participants'

function extractErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as AxiosError<{ message?: string; errors?: string[] }>
  return axiosErr?.response?.data?.errors?.[0] || axiosErr?.response?.data?.message || fallback
}

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
    <SectionEditPanel title="About Me" className="md:col-span-2" canEdit={canEdit} isDirty={isDirty} onEditStart={() => setDraft(saved)} onCancel={() => setDraft(saved)} onSave={handleSave}>
      {(editing) => editing ? (
        <div className="space-y-4">
          <FormField label="Goals">
            <textarea value={draft.goals} onChange={(e) => setDraft((d) => ({ ...d, goals: e.target.value }))} rows={2} />
          </FormField>
          <FormField label="Support Areas">
            <textarea value={draft.supportAreas} onChange={(e) => setDraft((d) => ({ ...d, supportAreas: e.target.value }))} rows={2} />
          </FormField>
          <FormField label="Strengths / Fears">
            <textarea value={draft.strengthsFears} onChange={(e) => setDraft((d) => ({ ...d, strengthsFears: e.target.value }))} rows={2} />
          </FormField>
          <FormField label="Things to Know">
            <textarea value={draft.thingsToKnow} onChange={(e) => setDraft((d) => ({ ...d, thingsToKnow: e.target.value }))} rows={2} />
          </FormField>
          <FormField label="Who/What Is Important">
            <textarea value={draft.whoIsImportant} onChange={(e) => setDraft((d) => ({ ...d, whoIsImportant: e.target.value }))} rows={2} />
          </FormField>
          <FormField label="Likes & Dislikes">
            <textarea value={draft.likesDislikes} onChange={(e) => setDraft((d) => ({ ...d, likesDislikes: e.target.value }))} rows={2} />
          </FormField>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 text-sm">
          {p.goals && (<><span className="text-[var(--color-muted-foreground)]">Goals</span><span className="whitespace-pre-line">{p.goals}</span></>)}
          {p.supportAreas && (<><span className="text-[var(--color-muted-foreground)]">Support Areas</span><span className="whitespace-pre-line">{p.supportAreas}</span></>)}
          {p.strengthsFears && (<><span className="text-[var(--color-muted-foreground)]">Strengths / Fears</span><span className="whitespace-pre-line">{p.strengthsFears}</span></>)}
          {p.thingsToKnow && (<><span className="text-[var(--color-muted-foreground)]">Things to Know</span><span className="whitespace-pre-line">{p.thingsToKnow}</span></>)}
          {p.whoIsImportant && (<><span className="text-[var(--color-muted-foreground)]">Who/What Is Important</span><span className="whitespace-pre-line">{p.whoIsImportant}</span></>)}
          {p.likesDislikes && (<><span className="text-[var(--color-muted-foreground)]">Likes &amp; Dislikes</span><span className="whitespace-pre-line">{p.likesDislikes}</span></>)}
        </div>
      )}
    </SectionEditPanel>
  )
}

export default ParticipantAboutMeSection
