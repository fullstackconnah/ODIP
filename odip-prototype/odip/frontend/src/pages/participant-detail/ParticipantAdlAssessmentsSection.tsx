import { useState } from 'react'
import { Activity } from 'lucide-react'
import { useParticipantAdlAssessments, useUpsertAdlAssessment } from '@/api/hooks'
import { Modal } from '@/components/Modal'
import { FormField } from '@/components/FormField'
import { ToggleGroup } from '@/components/ToggleGroup'
import { StatusBadge } from '@/components/StatusBadge'
import { DataTable, type Column } from '@/components/DataTable'
import { usePermissions } from '@/lib/permissions'
import { PageState } from '@/components/PageState'
import { queryPhase } from '@/lib/queryPhase'
import { ADL_TYPES, adlCategoryOf } from '@/api/types/enums'
import { ADL_TYPE_LABELS, ADL_LEVEL_LABELS } from '@/api/types/adl-assessments'
import type { ParticipantAdlAssessmentDto } from '@/api/types/adl-assessments'
import type { AdlCategory, AdlLevel } from '@/api/types/enums'
import { extractErrorMessage } from '@/lib/utils'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'

const LEVEL_OPTIONS = [
  { key: 'Independent', label: 'I' },
  { key: 'Supervision', label: 'S' },
  { key: 'Assistance', label: 'A' },
  { key: 'FullSupport', label: 'F' },
  { key: '', label: 'Not assessed' },
]

type AssessmentFormState = {
  level: AdlLevel | ''
  notes: string
}

const EMPTY_FORM: AssessmentFormState = { level: '', notes: '' }

/** Same status/colour lookup StatusBadge already ships — see ParticipantHealthConditionsSection's identical helper. */
function levelStatus(level: AdlLevel | null): { status: string; label: string } {
  if (level === 'Independent') return { status: 'active', label: ADL_LEVEL_LABELS.Independent }
  if (level === 'FullSupport') return { status: 'cancelled', label: ADL_LEVEL_LABELS.FullSupport }
  if (level === 'Supervision' || level === 'Assistance') return { status: 'pending', label: ADL_LEVEL_LABELS[level] }
  return { status: 'draft', label: 'Not assessed' }
}

/**
 * INTAKE sub-wave C2 — the structured ADL rating grid (research spec §4.9/§5), as its own compact
 * section on the participant detail page's Details tab, mirroring
 * ParticipantHealthConditionsSection's placement judgement and edit-via-modal pattern exactly
 * (same fixed-enumerated-set shape — GetForParticipant always returns all twenty AdlType entries).
 * Rendered as TWO grouped DataTables (Personal / Community & Domestic — see the backend's
 * AdlTypeGroups doc for why the grouping is derived, not a stored column) rather than one flat
 * 20-row table, so the two source-form tables the data comes from (§1c-15 vs §1c-17) stay visually
 * distinct — same "Picking a picker"/DataTable boundary judgement as HealthConditions, extended for
 * the extra row count.
 */
export default function ParticipantAdlAssessmentsSection({ participantId }: { participantId: string | undefined }) {
  const { canWriteAdlAssessments } = usePermissions()
  const assessmentsQuery = useParticipantAdlAssessments(participantId)
  const assessments = assessmentsQuery.data ?? []
  // A failed or paused request is not an empty list: "No personal ADLs recorded" is only for one that succeeded and came back empty.
  const phase = queryPhase(assessmentsQuery)
  const upsertAssessment = useUpsertAdlAssessment()

  const [editing, setEditing] = useState<ParticipantAdlAssessmentDto | null>(null)
  const [form, setForm] = useState<AssessmentFormState>(EMPTY_FORM)
  const [modalError, setModalError] = useState<string | null>(null)

  /**
   * Groups by category via adlCategoryOf (the same derivation the backend's AdlTypeGroups.
   * CategoryOf uses) rather than importing PERSONAL_ADL_TYPES/COMMUNITY_DOMESTIC_ADL_TYPES
   * directly — one source of truth for "which category does this row belong to" that the
   * partition-completeness tests (api/types/enums.test.ts) already guard.
   */
  function orderedFor(category: AdlCategory) {
    return ADL_TYPES
      .filter((type) => adlCategoryOf(type) === category)
      .map((type) => assessments.find((a) => a.adlType === type))
      .filter((a): a is ParticipantAdlAssessmentDto => !!a)
  }

  function openEdit(assessment: ParticipantAdlAssessmentDto) {
    setForm({ level: assessment.level ?? '', notes: assessment.notes ?? '' })
    setModalError(null)
    setEditing(assessment)
  }

  function closeModal() {
    setEditing(null)
    setModalError(null)
  }

  async function handleSave() {
    if (!editing || !participantId) return
    setModalError(null)
    const level = form.level === '' ? null : form.level
    try {
      await upsertAssessment.mutateAsync({
        participantId,
        adlType: editing.adlType,
        data: {
          level,
          notes: level ? (form.notes.trim() || null) : null,
        },
      })
      closeModal()
    } catch (err) {
      setModalError(extractErrorMessage(err, 'Failed to save ADL assessment.'))
    }
  }

  function columns(): Column<ParticipantAdlAssessmentDto>[] {
    return [
      { key: 'adlType', header: 'Activity', render: (row) => ADL_TYPE_LABELS[row.adlType] },
      {
        key: 'level', header: 'Level',
        render: (row) => {
          const { status, label } = levelStatus(row.level)
          return <StatusBadge status={status} label={label} />
        },
      },
      { key: 'notes', header: 'Notes', render: (row) => row.notes || '—' },
      // INTAKE-03, CommunityAccessDailyLiving stream-specific — shown as its own column whenever
      // ANY row across the grid has a value, matching this page's whole-card presence-or-relevance
      // idiom (see ParticipantDetailPage.tsx's Community Access card): a participant who no longer
      // has the CA stream but still has saved howToHelpNotes data still gets to see it here.
      ...(assessments.some((a) => a.howToHelpNotes)
        ? [{ key: 'howToHelpNotes', header: 'How To Help Me', render: (row: ParticipantAdlAssessmentDto) => row.howToHelpNotes || '—' }]
        : []),
      {
        key: 'edit', header: '', align: 'right',
        render: (row) => canWriteAdlAssessments && (
          <button
            type="button"
            onClick={() => openEdit(row)}
            className="text-xs font-medium text-[var(--color-primary)] hover:underline px-2 py-1.5 min-h-[44px] rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
          >
            Edit
          </button>
        ),
      },
    ]
  }

  if (phase === 'loading') return <PageState kind="loading" noun="ADL assessment list" />
  if (phase === 'error') return <PageState kind="error" noun="ADL assessment list" onRetry={() => assessmentsQuery.refetch()} />

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="font-semibold text-[var(--color-foreground)] flex items-center gap-2">
          <Activity className="w-4 h-4" /> Personal ADLs
        </h3>
        <DataTable
          data={orderedFor('Personal')}
          columns={columns()}
          keyField="adlType"
          emptyMessage="No personal ADLs recorded."
          compact
        />
      </div>

      <div className="space-y-4">
        <h3 className="font-semibold text-[var(--color-foreground)] flex items-center gap-2">
          <Activity className="w-4 h-4" /> Community &amp; Domestic ADLs
        </h3>
        <DataTable
          data={orderedFor('CommunityDomestic')}
          columns={columns()}
          keyField="adlType"
          emptyMessage="No community/domestic ADLs recorded."
          compact
        />
      </div>

      <Modal
        open={!!editing}
        onClose={closeModal}
        title={editing ? ADL_TYPE_LABELS[editing.adlType] : 'Edit ADL assessment'}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={closeModal}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={upsertAssessment.isPending}>
              {upsertAssessment.isPending ? 'Saving...' : 'Save assessment'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {modalError && (
            <Callout tone="error">{modalError}</Callout>
          )}
          <FormField label="Level" hint="I = Independent, S = Supervision, A = Assistance, F = Full Support.">
            <ToggleGroup
              options={LEVEL_OPTIONS}
              value={form.level}
              onChange={(v) => setForm((f) => ({ ...f, level: v as AdlLevel | '' }))}
              ariaLabel="Level"
            />
          </FormField>
          {form.level !== '' && (
            <FormField label="Notes">
              <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Additional notes..." />
            </FormField>
          )}
        </div>
      </Modal>
    </div>
  )
}
