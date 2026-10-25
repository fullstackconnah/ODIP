import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { usePatchParticipant } from '@/api/hooks'
import { FormField } from '@/components/FormField'
import { FactList } from '@/components/FactList'
import { formGrid, span } from '@/lib/formGrid'
import { SectionEditPanel } from './SectionEditPanel'
import { answeredChecklist } from './recorded'
import { CHECKLIST_ITEM_TYPE_LABELS, CHECKLIST_ITEM_VALUE_LABELS } from '@/api/types/enums'
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
 * The old Community Access card covered two CORE-02 groups in one PATCH. Slice 2 splits it by topic:
 * `BehaviourSupportCard` (Health > Behaviour support) owns `communityAccessBehaviour`, `TypicalDayCard` (Daily > Typical day) owns
 * `supportsLookLike`, and `EarlierChecklistFold` shows the legacy checklist read-only. The stream gate (CommunityAccessDailyLiving)
 * is the page's: these cards are only rendered for a participant in that stream.
 *
 * Each save sends ONLY its own group. A present group assigns all its members, so a group is always sent whole, built when the
 * save runs from the latest cached participant overlaid by the draft: `BehaviourSupportCard` carries `overallCommunityAccessRiskRating`
 * (no editor on this page, only in the wizard) because leaving it out nulls it server-side. The save then waits for the refetch.
 */

type BehaviourDraft = {
  signsHappyAndSettled: string; whatHelpsMeCalmDown: string
  bocTriggers: string; bocEarlyWarningSigns: string; bocDeEscalationStrategies: string; bocWhatNotToDo: string
}

function readBehaviour(p: ParticipantDetailDto): BehaviourDraft {
  return {
    signsHappyAndSettled: p.signsHappyAndSettled ?? '', whatHelpsMeCalmDown: p.whatHelpsMeCalmDown ?? '',
    bocTriggers: p.bocTriggers ?? '', bocEarlyWarningSigns: p.bocEarlyWarningSigns ?? '',
    bocDeEscalationStrategies: p.bocDeEscalationStrategies ?? '', bocWhatNotToDo: p.bocWhatNotToDo ?? '',
  }
}

const BEHAVIOUR_FIELDS: { key: keyof BehaviourDraft; label: string }[] = [
  { key: 'signsHappyAndSettled', label: 'Signs I Am Happy and Settled' },
  { key: 'whatHelpsMeCalmDown', label: 'What Helps Me Calm Down' },
  { key: 'bocTriggers', label: 'BOC — Triggers' },
  { key: 'bocEarlyWarningSigns', label: 'BOC — Early Warning Signs' },
  { key: 'bocDeEscalationStrategies', label: 'BOC — De-Escalation Strategies' },
  { key: 'bocWhatNotToDo', label: 'BOC — What Not To Do' },
]

export function BehaviourSupportCard({ p, participantId, canEdit }: { p: ParticipantDetailDto; participantId: string; canEdit: boolean }) {
  const qc = useQueryClient()
  const patchParticipant = usePatchParticipant()
  const saved = readBehaviour(p)
  const [draft, setDraft] = useState<BehaviourDraft>(saved)
  const isDirty = BEHAVIOUR_FIELDS.some(({ key }) => draft[key] !== saved[key])

  async function handleSave() {
    try {
      const latest = qc.getQueryData<ParticipantDetailDto>(['participant', participantId]) ?? p
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
            // Not edited here (wizard-owned), but a present group clears omitted members: echo the latest value.
            overallCommunityAccessRiskRating: latest.overallCommunityAccessRiskRating ?? null,
          },
        },
      })
      await qc.invalidateQueries({ queryKey: ['participant', participantId] })
    } catch (err) {
      throw new Error(extractErrorMessage(err, 'Failed to save Behaviour support.'))
    }
  }

  return (
    <SectionEditPanel title="Behaviour support" canEdit={canEdit} isDirty={isDirty} onEditStart={() => setDraft(saved)} onCancel={() => setDraft(saved)} onSave={handleSave}>
      {(editing, startEdit) => editing ? (
        <div className={formGrid}>
          {BEHAVIOUR_FIELDS.map(({ key, label }) => (
            <FormField key={key} label={label} className={span.medium}>
              <textarea value={draft[key]} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} rows={2} />
            </FormField>
          ))}
        </div>
      ) : (
        <FactList
          hideEmpty
          onAdd={canEdit ? () => startEdit('first-empty') : undefined}
          items={BEHAVIOUR_FIELDS.map(({ key, label }) => ({ label, value: pl(p[key]) }))}
        />
      )}
    </SectionEditPanel>
  )
}

type TypicalDayDraft = { supportsLookLikeMorning: string; supportsLookLikeDay: string; supportsLookLikeAfternoonEvening: string; supportsLookLikeOvernight: string }

const TYPICAL_DAY_FIELDS: { key: keyof TypicalDayDraft; label: string }[] = [
  { key: 'supportsLookLikeMorning', label: 'Morning' },
  { key: 'supportsLookLikeDay', label: 'Day' },
  { key: 'supportsLookLikeAfternoonEvening', label: 'Afternoon-Evening' },
  { key: 'supportsLookLikeOvernight', label: 'Overnight' },
]

function readTypicalDay(p: ParticipantDetailDto): TypicalDayDraft {
  return {
    supportsLookLikeMorning: p.supportsLookLikeMorning ?? '', supportsLookLikeDay: p.supportsLookLikeDay ?? '',
    supportsLookLikeAfternoonEvening: p.supportsLookLikeAfternoonEvening ?? '', supportsLookLikeOvernight: p.supportsLookLikeOvernight ?? '',
  }
}

export function TypicalDayCard({ p, participantId, canEdit }: { p: ParticipantDetailDto; participantId: string; canEdit: boolean }) {
  const qc = useQueryClient()
  const patchParticipant = usePatchParticipant()
  const saved = readTypicalDay(p)
  const [draft, setDraft] = useState<TypicalDayDraft>(saved)
  const isDirty = TYPICAL_DAY_FIELDS.some(({ key }) => draft[key] !== saved[key])

  async function handleSave() {
    try {
      await patchParticipant.mutateAsync({
        id: participantId,
        data: {
          supportsLookLike: {
            supportsLookLikeMorning: draft.supportsLookLikeMorning.trim() || null,
            supportsLookLikeDay: draft.supportsLookLikeDay.trim() || null,
            supportsLookLikeAfternoonEvening: draft.supportsLookLikeAfternoonEvening.trim() || null,
            supportsLookLikeOvernight: draft.supportsLookLikeOvernight.trim() || null,
          },
        },
      })
      await qc.invalidateQueries({ queryKey: ['participant', participantId] })
    } catch (err) {
      throw new Error(extractErrorMessage(err, 'Failed to save Typical day.'))
    }
  }

  return (
    <SectionEditPanel title="What my supports look like" canEdit={canEdit} isDirty={isDirty} onEditStart={() => setDraft(saved)} onCancel={() => setDraft(saved)} onSave={handleSave}>
      {(editing, startEdit) => editing ? (
        <div className={formGrid}>
          {TYPICAL_DAY_FIELDS.map(({ key, label }) => (
            <FormField key={key} label={label} className={span.medium}>
              <textarea value={draft[key]} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} rows={2} />
            </FormField>
          ))}
        </div>
      ) : (
        <FactList
          hideEmpty
          onAdd={canEdit ? () => startEdit('first-empty') : undefined}
          items={TYPICAL_DAY_FIELDS.map(({ key, label }) => ({ label, value: pl(p[key]) }))}
        />
      )}
    </SectionEditPanel>
  )
}

/** Read-only, closed by default: "Earlier checklist (n)". Renders nothing when no row was answered. */
export function EarlierChecklistFold({ p }: { p: ParticipantDetailDto }) {
  const rows = answeredChecklist(p)
  if (rows.length === 0) return null
  return (
    <details className="group text-sm">
      <summary className="min-h-[var(--control-h)] cursor-pointer select-none py-1.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">
        Earlier checklist ({rows.length})
      </summary>
      <div className="mt-2 divide-y divide-[var(--color-border)]">
        {rows.map((row) => (
          <div key={row.itemType} className="py-2 flex items-start justify-between gap-4">
            <span>{CHECKLIST_ITEM_TYPE_LABELS[row.itemType as ChecklistItemType]}</span>
            <span className="text-right">
              <Tag label={CHECKLIST_ITEM_VALUE_LABELS[row.value!] ?? row.value!} />
              {row.notes && <span className="block text-xs text-[var(--color-muted-foreground)] mt-1 max-w-xs">{row.notes}</span>}
            </span>
          </div>
        ))}
      </div>
    </details>
  )
}
