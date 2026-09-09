import { useState } from 'react'
import { HeartPulse } from 'lucide-react'
import { useParticipantHealthConditions, useUpsertHealthCondition } from '@/api/hooks'
import { Modal } from '@/components/Modal'
import { FormField } from '@/components/FormField'
import { ToggleGroup } from '@/components/ToggleGroup'
import { StatusBadge } from '@/components/StatusBadge'
import { DataTable, type Column } from '@/components/DataTable'
import { usePermissions } from '@/lib/permissions'
import { HEALTH_CONDITION_TYPES } from '@/api/types/enums'
import { HEALTH_CONDITION_TYPE_LABELS } from '@/api/types/health-conditions'
import type { ParticipantHealthConditionDto } from '@/api/types/health-conditions'
import { extractErrorMessage } from '@/lib/utils'

type ConditionFormState = {
  has: 'true' | 'false' | ''
  severity: string
  planProvided: 'true' | 'false' | ''
  trainingRequired: 'true' | 'false' | ''
  notes: string
}

const EMPTY_FORM: ConditionFormState = { has: '', severity: '', planProvided: '', trainingRequired: '', notes: '' }

/** Same status/colour lookup StatusBadge already ships — see ParticipantConsentsSection's identical helper. */
function hasStatus(has: boolean | null): { status: string; label: string } {
  if (has === true) return { status: 'active', label: 'Yes' }
  if (has === false) return { status: 'cancelled', label: 'No' }
  return { status: 'draft', label: 'Not recorded' }
}

/**
 * INTAKE sub-wave C1 — the structured health-condition grid (research spec §4.6/§5), as its own
 * compact section on the participant detail page's Details tab, mirroring
 * ParticipantConsentsSection's placement judgement and edit-via-modal pattern exactly (same fixed-
 * enumerated-set shape — GetForParticipant always returns all ten HealthConditionType entries).
 * Rendered as a DataTable rather than ParticipantConsentsSection's plain status-row list (README's
 * "Picking a picker"/DataTable boundary: 10 rows × several genuinely tabular columns — Condition/
 * Has/Severity/Plan/Training — reads better as a compact status table than 10 stacked cards).
 *
 * RECONCILIATION: this grid is support-planning detail, not a replacement for the Medical card's
 * Primary/Other Diagnoses fields above it on this page — see ParticipantHealthCondition's backend
 * type doc for the full reasoning.
 */
export default function ParticipantHealthConditionsSection({ participantId }: { participantId: string | undefined }) {
  const { canWriteHealthConditions } = usePermissions()
  const { data: conditions = [], isLoading } = useParticipantHealthConditions(participantId)
  const upsertCondition = useUpsertHealthCondition()

  const [editing, setEditing] = useState<ParticipantHealthConditionDto | null>(null)
  const [form, setForm] = useState<ConditionFormState>(EMPTY_FORM)
  const [modalError, setModalError] = useState<string | null>(null)

  // Stable HEALTH_CONDITION_TYPES order regardless of what order the API returned rows in.
  const ordered = HEALTH_CONDITION_TYPES
    .map((type) => conditions.find((c) => c.conditionType === type))
    .filter((c): c is ParticipantHealthConditionDto => !!c)

  function openEdit(condition: ParticipantHealthConditionDto) {
    setForm({
      has: condition.has === true ? 'true' : condition.has === false ? 'false' : '',
      severity: condition.severity ?? '',
      planProvided: condition.planProvided === true ? 'true' : condition.planProvided === false ? 'false' : '',
      trainingRequired: condition.trainingRequired === true ? 'true' : condition.trainingRequired === false ? 'false' : '',
      notes: condition.notes ?? '',
    })
    setModalError(null)
    setEditing(condition)
  }

  function closeModal() {
    setEditing(null)
    setModalError(null)
  }

  async function handleSave() {
    if (!editing || !participantId) return
    setModalError(null)
    const has = form.has === 'true' ? true : form.has === 'false' ? false : null
    try {
      await upsertCondition.mutateAsync({
        participantId,
        conditionType: editing.conditionType,
        data: {
          has,
          severity: has === true ? (form.severity.trim() || null) : null,
          planProvided: has === true ? (form.planProvided === 'true' ? true : form.planProvided === 'false' ? false : null) : null,
          trainingRequired: has === true ? (form.trainingRequired === 'true' ? true : form.trainingRequired === 'false' ? false : null) : null,
          notes: has === true ? (form.notes.trim() || null) : null,
        },
      })
      closeModal()
    } catch (err) {
      setModalError(extractErrorMessage(err, 'Failed to save health condition.'))
    }
  }

  const columns: Column<ParticipantHealthConditionDto>[] = [
    { key: 'conditionType', header: 'Condition', render: (row) => HEALTH_CONDITION_TYPE_LABELS[row.conditionType] },
    {
      key: 'has', header: 'Has',
      render: (row) => {
        const { status, label } = hasStatus(row.has)
        return <StatusBadge status={status} label={label} />
      },
    },
    { key: 'severity', header: 'Severity', render: (row) => row.severity || '—' },
    { key: 'planProvided', header: 'Plan Provided', render: (row) => row.planProvided == null ? '—' : row.planProvided ? 'Yes' : 'No' },
    { key: 'trainingRequired', header: 'Training Required', render: (row) => row.trainingRequired == null ? '—' : row.trainingRequired ? 'Yes' : 'No' },
    {
      key: 'edit', header: '', align: 'right',
      render: (row) => canWriteHealthConditions && (
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

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-[var(--color-foreground)] flex items-center gap-2">
        <HeartPulse className="w-4 h-4" /> Health Conditions
      </h3>

      <DataTable
        data={ordered}
        columns={columns}
        keyField="conditionType"
        loading={isLoading}
        emptyMessage="No health conditions recorded."
        compact
      />

      <Modal
        open={!!editing}
        onClose={closeModal}
        title={editing ? HEALTH_CONDITION_TYPE_LABELS[editing.conditionType] : 'Edit health condition'}
        size="md"
        footer={
          <>
            <button
              type="button"
              onClick={closeModal}
              className="min-h-[44px] px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={upsertCondition.isPending}
              className="min-h-[44px] px-4 py-2 text-sm rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary)]/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 transition-all"
            >
              {upsertCondition.isPending ? 'Saving...' : 'Save condition'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {modalError && (
            <div className="p-3 rounded-lg bg-[var(--color-destructive)]/10 text-[var(--color-destructive)] text-sm border border-[var(--color-destructive)]/20">
              {modalError}
            </div>
          )}
          <FormField label="Has this condition / support need">
            {/* Same tri-state affordance as ParticipantConsentsSection's Granted toggle — this is
                a bool? control (Has), so it must be able to go back to "not recorded". */}
            <ToggleGroup
              options={[{ key: 'true', label: 'Yes' }, { key: 'false', label: 'No' }, { key: '', label: 'Not recorded' }]}
              value={form.has}
              onChange={(v) => setForm((f) => ({ ...f, has: v as 'true' | 'false' | '' }))}
              ariaLabel="Has this condition / support need"
            />
          </FormField>
          {form.has === 'true' && (
            <>
              <FormField label="Severity" hint="Free text — e.g. Mild, Type 2, GrandMal.">
                <input value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))} placeholder="Severity" autoFocus />
              </FormField>
              <FormField label="Plan Provided">
                <ToggleGroup
                  options={[{ key: 'true', label: 'Yes' }, { key: 'false', label: 'No' }, { key: '', label: 'Not recorded' }]}
                  value={form.planProvided}
                  onChange={(v) => setForm((f) => ({ ...f, planProvided: v as 'true' | 'false' | '' }))}
                  ariaLabel="Plan Provided"
                />
              </FormField>
              <FormField label="Training Required">
                <ToggleGroup
                  options={[{ key: 'true', label: 'Yes' }, { key: 'false', label: 'No' }, { key: '', label: 'Not recorded' }]}
                  value={form.trainingRequired}
                  onChange={(v) => setForm((f) => ({ ...f, trainingRequired: v as 'true' | 'false' | '' }))}
                  ariaLabel="Training Required"
                />
              </FormField>
              <FormField label="Notes">
                <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Additional notes..." />
              </FormField>
            </>
          )}
        </div>
      </Modal>
    </div>
  )
}
