import { useState } from 'react'
import { useFieldArray } from 'react-hook-form'
import type { Control, FieldErrors } from 'react-hook-form'
import { FormField } from '@/components/FormField'
import { Card } from '@/components/Card'
import { DataTable, type Column } from '@/components/DataTable'
import { StatusBadge } from '@/components/StatusBadge'
import { SearchableSelect } from '@/components/SearchableSelect'
import { WITNESS_STATUS_LABELS } from '@/api/types/medications'
import type { StaffListDto } from '@/api/types/staff'
import type { IncidentWitnessDto } from '@/api/types/incidents'
import type { IncidentFormData } from '../incidentFormSchema'
import type { Tone } from '@/lib/tone'
import { X } from 'lucide-react'
import { Button } from '@/components/Button'

export type WitnessesStepProps = {
  control: Control<IncidentFormData>
  errors: FieldErrors<IncidentFormData>
  reportedByStaffId: string | undefined
  staff: StaffListDto[]
  /** Edit mode only — the persisted witness rows, keyed by id, so a row already-submitted rows
   * can show their live approval status without the form itself tracking it (the form never
   * sends WitnessStatus back — see incidentFormSchema's witnesses[] shape). */
  existingWitnesses: IncidentWitnessDto[]
  isEdit: boolean
}

type WitnessRow = { existingId?: string; witnessUserId: string | null; witnessName: string }

// Staff and External are categories of witness, not states: info and neutral.
const WITNESS_TYPE_COLOR_MAP: Record<string, Tone> = { staff: 'info', external: 'neutral' }

/**
 * IN-7 — wizard step "Witnesses". A single `witnesses[]` field array holds both staff (approvable
 * via the same portal witness-approval mechanism the medication flow established) and free-text
 * external witnesses (nothing to approve) — distinguished by whether `witnessUserId` is set, not
 * by two separate lists, so the DataTable's Type column is the only thing telling them apart.
 *
 * No statement field is captured here — per the design, an optional witness statement is
 * something the WITNESS supplies themself when they respond on the portal, never something the
 * reporter fills in at creation/edit time (see PortalWitnessApprovalsPage).
 */
export function WitnessesStep({ control, errors, reportedByStaffId, staff, existingWitnesses, isEdit }: WitnessesStepProps) {
  const { fields, append, remove } = useFieldArray({ control, name: 'witnesses' })

  const [mode, setMode] = useState<'staff' | 'external'>('staff')
  const [staffId, setStaffId] = useState('')
  const [externalName, setExternalName] = useState('')

  // A witness can't approve their own report they filed — exclude the reporter from the picker.
  const staffItems = staff
    .filter((s) => s.id !== reportedByStaffId)
    .map((s) => ({ value: s.id, label: s.fullName }))

  function handleAdd() {
    if (mode === 'staff') {
      const selected = staff.find((s) => s.id === staffId)
      if (!selected) return
      append({ witnessUserId: selected.id, witnessName: selected.fullName })
      setStaffId('')
    } else {
      const name = externalName.trim()
      if (!name) return
      append({ witnessUserId: null, witnessName: name })
      setExternalName('')
    }
  }

  const rows = fields as (WitnessRow & { id: string })[]

  const columns: Column<WitnessRow & { id: string }>[] = [
    {
      key: 'type',
      header: 'Type',
      render: (row) => <StatusBadge status={row.witnessUserId ? 'Staff' : 'External'} colorMap={WITNESS_TYPE_COLOR_MAP} />,
    },
    { key: 'witnessName', header: 'Name' },
    {
      key: 'status',
      header: 'Status',
      render: (row) => {
        if (!row.witnessUserId) return <span className="text-[var(--color-muted-foreground)]">—</span>
        // `row.id` here is useFieldArray's own RHF-generated key, NOT the persisted server id —
        // look the persisted row up by `existingId` instead (see incidentFormSchema's doc comment
        // on why the two are deliberately different fields).
        const persisted = isEdit && row.existingId ? existingWitnesses.find((w) => w.id === row.existingId) : undefined
        if (!persisted) {
          return <span className="text-xs text-[var(--color-muted-foreground)]">Will be asked to approve after this report is submitted</span>
        }
        return (
          <div className="flex flex-col gap-1">
            <StatusBadge status={persisted.witnessStatus} label={WITNESS_STATUS_LABELS[persisted.witnessStatus]} />
            {persisted.statementText && (
              <span className="text-xs text-[var(--color-muted-foreground)]">{persisted.statementText}</span>
            )}
          </div>
        )
      },
    },
    {
      key: 'remove',
      header: '',
      align: 'right',
      render: (_row, rowIndex) => (
        <button
          type="button"
          onClick={() => remove(rowIndex)}
          className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--color-accent)] text-[var(--color-muted-foreground)]"
          aria-label="Remove witness"
        >
          <X className="w-4 h-4" />
        </button>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <Card title="Witnesses">
        {errors.witnesses?.message && (
          <p role="alert" className="text-xs text-[var(--color-destructive)] mb-2">{errors.witnesses.message}</p>
        )}

        <div className="grid md:grid-cols-[1fr_1fr_auto] gap-3 items-end p-[var(--card-pad)] rounded-[var(--radius-md)] bg-[var(--color-accent)]/40 border border-[var(--color-border)] mb-3">
          <FormField label="Witness type">
            <div className="flex gap-2" role="radiogroup" aria-label="Witness type">
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'staff'}
                onClick={() => setMode('staff')}
                className={`h-[var(--control-h)] flex-1 px-3 rounded-[var(--radius-sm)] border text-sm ${mode === 'staff' ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10' : 'border-[var(--color-border)]'}`}
              >
                Staff member
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'external'}
                onClick={() => setMode('external')}
                className={`h-[var(--control-h)] flex-1 px-3 rounded-[var(--radius-sm)] border text-sm ${mode === 'external' ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10' : 'border-[var(--color-border)]'}`}
              >
                Someone else
              </button>
            </div>
          </FormField>

          {mode === 'staff' ? (
            <FormField label="Staff member">
              <SearchableSelect
                items={staffItems}
                value={staffId}
                onChange={setStaffId}
                placeholder="Search staff…"
                emptyMessage="No other staff available"
              />
            </FormField>
          ) : (
            <FormField label="Name">
              <input
                value={externalName}
                onChange={(e) => setExternalName(e.target.value)}
                placeholder="Full name of the witness"
              />
            </FormField>
          )}

          <Button onClick={handleAdd} disabled={mode === 'staff' ? !staffId : !externalName.trim()}>
            Add
          </Button>
        </div>

        <DataTable
          data={rows}
          columns={columns}
          keyField="id"
          emptyMessage="No witnesses added yet"
        />
      </Card>
    </div>
  )
}
