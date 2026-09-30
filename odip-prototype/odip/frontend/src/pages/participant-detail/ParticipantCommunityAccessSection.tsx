import { useState } from 'react'
import { usePatchParticipant } from '@/api/hooks'
import { FormField } from '@/components/FormField'
import { FactList } from '@/components/FactList'
import { formGrid, span } from '@/lib/formGrid'
import { SectionEditPanel } from './SectionEditPanel'
import { CHECKLIST_ITEM_TYPES, CHECKLIST_ITEM_TYPE_LABELS, CHECKLIST_ITEM_VALUE_LABELS } from '@/api/types/enums'
import { parseServiceStreams } from '@/api/types/participants'
import type { ChecklistItemType } from '@/api/types/enums'
import type { ParticipantDetailDto } from '@/api/types/participants'
import { extractErrorMessage } from '@/lib/utils'

const pl = (v?: string | null) => (v ? <span className="whitespace-pre-line">{v}</span> : undefined)

function Tag({ label }: { label: string }) {
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
      {label}
    </span>
  )
}

/**
 * PD-7: Community Access card — covers TWO CORE-02 groups fully rendered by this one section:
 * `communityAccessBehaviour` (signsHappyAndSettled..bocWhatNotToDo) and `supportsLookLike`
 * (supportsLookLikeMorning/Day/AfternoonEvening/Overnight). Both saved together in one PATCH.
 *
 * The `checklistItems` collection (Community Mobility & Transport Risk / Behaviours of Concern
 * checklist) is deliberately OUT OF SCOPE here, same as `RiskEntriesSection` is out of scope for
 * the Risks & Hazards Summary card — SPEC-03's PD-7 field table does not list it under this
 * card's "Key fields", and it's a collection with its own upsert-by-key/split-ownership
 * semantics (rows 9-20 of a 21-row array shared with the wizard's Behaviour & Communication
 * step) that a section-level edit panel isn't a safe fit for without its own dedicated pass.
 * Left read-only, matching the pre-PD-7 behaviour.
 *
 * Gated on the CommunityAccessDailyLiving service stream itself (unaffected by `canEdit`) — this
 * card's fields are meaningless for a participant outside that stream, so the gate is about
 * relevance, not write-permission, and stays exactly as it was pre-PD-7.
 */
type CommunityAccessDraft = {
  signsHappyAndSettled: string; whatHelpsMeCalmDown: string
  bocTriggers: string; bocEarlyWarningSigns: string; bocDeEscalationStrategies: string; bocWhatNotToDo: string
  supportsLookLikeMorning: string; supportsLookLikeDay: string; supportsLookLikeAfternoonEvening: string; supportsLookLikeOvernight: string
}

function readCommunityAccess(p: ParticipantDetailDto): CommunityAccessDraft {
  return {
    signsHappyAndSettled: p.signsHappyAndSettled ?? '', whatHelpsMeCalmDown: p.whatHelpsMeCalmDown ?? '',
    bocTriggers: p.bocTriggers ?? '', bocEarlyWarningSigns: p.bocEarlyWarningSigns ?? '',
    bocDeEscalationStrategies: p.bocDeEscalationStrategies ?? '', bocWhatNotToDo: p.bocWhatNotToDo ?? '',
    supportsLookLikeMorning: p.supportsLookLikeMorning ?? '', supportsLookLikeDay: p.supportsLookLikeDay ?? '',
    supportsLookLikeAfternoonEvening: p.supportsLookLikeAfternoonEvening ?? '', supportsLookLikeOvernight: p.supportsLookLikeOvernight ?? '',
  }
}

export function ParticipantCommunityAccessSection({ p, participantId, canEdit }: { p: ParticipantDetailDto; participantId: string; canEdit: boolean }) {
  const patchParticipant = usePatchParticipant()
  const saved = readCommunityAccess(p)
  const [draft, setDraft] = useState<CommunityAccessDraft>(saved)
  const isDirty = (Object.keys(saved) as (keyof CommunityAccessDraft)[]).some((k) => draft[k] !== saved[k])

  const isCommunityAccess = parseServiceStreams(p.serviceStreams).includes('CommunityAccessDailyLiving')
  if (!isCommunityAccess) return null

  const answeredChecklistItems = CHECKLIST_ITEM_TYPES
    .map((type) => p.checklistItems?.find((row) => row.itemType === type))
    .filter((row): row is NonNullable<typeof row> => !!row?.value)

  async function handleSave() {
    try {
      await patchParticipant.mutateAsync({
        id: participantId,
        data: {
          communityAccessBehaviour: {
            signsHappyAndSettled: draft.signsHappyAndSettled.trim() || null,
            whatHelpsMeCalmDown: draft.whatHelpsMeCalmDown.trim() || null,
            bocTriggers: draft.bocTriggers.trim() || null,
            bocEarlyWarningSigns: draft.bocEarlyWarningSigns.trim() || null,
            bocDeEscalationStrategies: draft.bocDeEscalationStrategies.trim() || null,
            bocWhatNotToDo: draft.bocWhatNotToDo.trim() || null,
          },
          supportsLookLike: {
            supportsLookLikeMorning: draft.supportsLookLikeMorning.trim() || null,
            supportsLookLikeDay: draft.supportsLookLikeDay.trim() || null,
            supportsLookLikeAfternoonEvening: draft.supportsLookLikeAfternoonEvening.trim() || null,
            supportsLookLikeOvernight: draft.supportsLookLikeOvernight.trim() || null,
          },
        },
      })
    } catch (err) {
      throw new Error(extractErrorMessage(err, 'Failed to save Community Access.'))
    }
  }

  return (
    <SectionEditPanel title="Community Access" canEdit={canEdit} isDirty={isDirty} onEditStart={() => setDraft(saved)} onCancel={() => setDraft(saved)} onSave={handleSave}>
      {(editing) => editing ? (
        <div className={formGrid}>
          <FormField label="Signs I Am Happy and Settled" className={span.medium}>
            <textarea value={draft.signsHappyAndSettled} onChange={(e) => setDraft((d) => ({ ...d, signsHappyAndSettled: e.target.value }))} rows={2} />
          </FormField>
          <FormField label="What Helps Me Calm Down" className={span.medium}>
            <textarea value={draft.whatHelpsMeCalmDown} onChange={(e) => setDraft((d) => ({ ...d, whatHelpsMeCalmDown: e.target.value }))} rows={2} />
          </FormField>
          <FormField label="BOC — Triggers" className={span.medium}>
            <textarea value={draft.bocTriggers} onChange={(e) => setDraft((d) => ({ ...d, bocTriggers: e.target.value }))} rows={2} />
          </FormField>
          <FormField label="BOC — Early Warning Signs" className={span.medium}>
            <textarea value={draft.bocEarlyWarningSigns} onChange={(e) => setDraft((d) => ({ ...d, bocEarlyWarningSigns: e.target.value }))} rows={2} />
          </FormField>
          <FormField label="BOC — De-Escalation Strategies" className={span.medium}>
            <textarea value={draft.bocDeEscalationStrategies} onChange={(e) => setDraft((d) => ({ ...d, bocDeEscalationStrategies: e.target.value }))} rows={2} />
          </FormField>
          <FormField label="BOC — What Not To Do" className={span.medium}>
            <textarea value={draft.bocWhatNotToDo} onChange={(e) => setDraft((d) => ({ ...d, bocWhatNotToDo: e.target.value }))} rows={2} />
          </FormField>
          <p className={`text-sm font-medium text-[var(--color-muted-foreground)] ${span.long}`}>What My Supports Look Like</p>
          <FormField label="Morning" className={span.medium}>
            <textarea value={draft.supportsLookLikeMorning} onChange={(e) => setDraft((d) => ({ ...d, supportsLookLikeMorning: e.target.value }))} rows={2} />
          </FormField>
          <FormField label="Day" className={span.medium}>
            <textarea value={draft.supportsLookLikeDay} onChange={(e) => setDraft((d) => ({ ...d, supportsLookLikeDay: e.target.value }))} rows={2} />
          </FormField>
          <FormField label="Afternoon-Evening" className={span.medium}>
            <textarea value={draft.supportsLookLikeAfternoonEvening} onChange={(e) => setDraft((d) => ({ ...d, supportsLookLikeAfternoonEvening: e.target.value }))} rows={2} />
          </FormField>
          <FormField label="Overnight" className={span.medium}>
            <textarea value={draft.supportsLookLikeOvernight} onChange={(e) => setDraft((d) => ({ ...d, supportsLookLikeOvernight: e.target.value }))} rows={2} />
          </FormField>
        </div>
      ) : (
        <>
          <FactList
            items={[
              ...(p.signsHappyAndSettled ? [{ label: 'Signs I Am Happy and Settled', value: pl(p.signsHappyAndSettled) }] : []),
              ...(p.whatHelpsMeCalmDown ? [{ label: 'What Helps Me Calm Down', value: pl(p.whatHelpsMeCalmDown) }] : []),
              ...(p.bocTriggers ? [{ label: 'BOC — Triggers', value: pl(p.bocTriggers) }] : []),
              ...(p.bocEarlyWarningSigns ? [{ label: 'BOC — Early Warning Signs', value: pl(p.bocEarlyWarningSigns) }] : []),
              ...(p.bocDeEscalationStrategies ? [{ label: 'BOC — De-Escalation Strategies', value: pl(p.bocDeEscalationStrategies) }] : []),
              ...(p.bocWhatNotToDo ? [{ label: 'BOC — What Not To Do', value: pl(p.bocWhatNotToDo) }] : []),
              ...((p.supportsLookLikeMorning || p.supportsLookLikeDay || p.supportsLookLikeAfternoonEvening || p.supportsLookLikeOvernight)
                ? [{
                    label: 'What My Supports Look Like',
                    value: pl([
                      p.supportsLookLikeMorning && `Morning: ${p.supportsLookLikeMorning}`,
                      p.supportsLookLikeDay && `Day: ${p.supportsLookLikeDay}`,
                      p.supportsLookLikeAfternoonEvening && `Afternoon-Evening: ${p.supportsLookLikeAfternoonEvening}`,
                      p.supportsLookLikeOvernight && `Overnight: ${p.supportsLookLikeOvernight}`,
                    ].filter(Boolean).join('\n')),
                  }]
                : []),
            ]}
            emptyMessage={answeredChecklistItems.length > 0 ? 'No behaviour details recorded' : undefined}
          />
          {answeredChecklistItems.length > 0 && (
            <div className="mt-4 space-y-2 text-sm">
              <p className="font-medium text-[var(--color-muted-foreground)]">Community Mobility &amp; Transport Risk / Behaviours of Concern Checklist</p>
              <div className="divide-y divide-[var(--color-border)]">
                {answeredChecklistItems.map((row) => (
                  <div key={row.itemType} className="py-2 flex items-start justify-between gap-4">
                    <span>{CHECKLIST_ITEM_TYPE_LABELS[row.itemType as ChecklistItemType]}</span>
                    <span className="text-right">
                      <Tag label={CHECKLIST_ITEM_VALUE_LABELS[row.value!] ?? row.value!} />
                      {row.notes && <span className="block text-xs text-[var(--color-muted-foreground)] mt-1 max-w-xs">{row.notes}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </SectionEditPanel>
  )
}

export default ParticipantCommunityAccessSection
