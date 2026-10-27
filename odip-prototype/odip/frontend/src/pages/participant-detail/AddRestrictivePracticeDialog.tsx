import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { AxiosError } from 'axios'
import { useBulkCreateRestrictivePractices, useParticipantMedications } from '@/api/hooks'
import { Modal } from '@/components/Modal'
import { FormField } from '@/components/FormField'
import { Dropdown } from '@/components/Dropdown'
import { DataTable, type Column } from '@/components/DataTable'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { plural } from '@/lib/format'
import { RESTRICTIVE_PRACTICE_TYPES, RESTRICTIVE_PRACTICE_TYPE_LABELS, RESTRICTIVE_PRACTICE_TYPE_DESCRIPTIONS } from '@/api/types/restrictive-practices'
import type { RestrictivePracticeDto, RestrictivePracticeType, BulkCreateRestrictivePracticeDto } from '@/api/types/restrictive-practices'

/** One row of the "Add entries" bulk table — client-side draft state before it becomes its own register entry. */
type BulkRowState = {
  id: string
  description: string
  authorisedBy: string
  authorisationDate: string
  reviewDate: string
  /** Only meaningful when the batch type is ChemicalRestraint; ignored otherwise. */
  relatedMedicationId: string
}

function makeBulkRow(description = ''): BulkRowState {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `row-${Date.now()}-${Math.random()}`
  return { id, description, authorisedBy: '', authorisationDate: '', reviewDate: '', relatedMedicationId: '' }
}

/**
 * The bulk endpoint returns `errors: string[]` prefixed `"Row N: message"` for a row-level
 * failure, or an unprefixed string for a whole-request failure (participant missing, no rows).
 * Maps each row-prefixed error back to that row's client-side id (1-based index -> `rows[i-1]`)
 * so DataTable's `rowError` can show it under the right row; anything else becomes the banner.
 */
function parseBulkErrors(err: unknown, rows: BulkRowState[]): { general: string | null; rowErrors: Map<string, string> } {
  const axiosErr = err as AxiosError<{ message?: string; errors?: string[] }>
  const errors = axiosErr?.response?.data?.errors
  const rowErrors = new Map<string, string>()
  let general: string | null = null

  if (errors && errors.length > 0) {
    for (const e of errors) {
      const match = /^Row (\d+):\s*(.*)$/.exec(e)
      const row = match ? rows[Number(match[1]) - 1] : undefined
      if (match && row) {
        rowErrors.set(row.id, match[2])
      } else if (!general) {
        general = e
      }
    }
  } else {
    general = axiosErr?.response?.data?.message ?? null
  }

  if (rowErrors.size === 0 && !general) {
    general = 'Failed to save restrictive practice entries.'
  }
  return { general, rowErrors }
}

export type AddRestrictivePracticeDialogProps = {
  open: boolean
  participantId: string
  onClose: () => void
  /** Called with the entries the server created, after which the caller closes the dialog. */
  onSaved: (created: RestrictivePracticeDto[]) => void
  /**
   * Set when the type is already decided (an incident's "None of these" → "Add to restrictive practice register"). The dialog then adds exactly
   * one entry of that type, prefilled with `defaultDescription`, and asks nothing about its authorisation: the entry is saved active with no
   * "Authorised by" or date, so it reads Not authorised until a coordinator records them on the register.
   */
  defaultType?: RestrictivePracticeType
  defaultDescription?: string
}

/**
 * PD-2 "Add entries", the only way an entry is created on a participant's restrictive practice register: a setup step (the type shared by
 * every entry, and how many) and then an editable table of the rows. The register tab opens it as it is; the incident wizard opens it with
 * `defaultType`, which skips the setup and adds one entry (see the prop). The wizard draws it in a portal on document.body, because the
 * wizard is a form and Enter in one of these fields would otherwise submit the incident.
 */
export function AddRestrictivePracticeDialog(props: AddRestrictivePracticeDialogProps) {
  // Mounted only while open, so every opening starts from the props again.
  return props.open ? <AddRestrictivePracticeDialogBody {...props} /> : null
}

function AddRestrictivePracticeDialogBody({ participantId, onClose, onSaved, defaultType, defaultDescription }: AddRestrictivePracticeDialogProps) {
  const single = defaultType !== undefined
  const { data: medications = [] } = useParticipantMedications(participantId, false)
  const bulkCreatePractices = useBulkCreateRestrictivePractices()

  // 'setup' picks a type + row count; 'rows' is the editable table. Defaults to a single row, so a one-off entry takes the same number of
  // clicks as the old single-entry form did.
  const [bulkStep, setBulkStep] = useState<'setup' | 'rows'>(single ? 'rows' : 'setup')
  const [bulkType, setBulkType] = useState<RestrictivePracticeType>(defaultType ?? RESTRICTIVE_PRACTICE_TYPES[0])
  const [bulkCountInput, setBulkCountInput] = useState('1')
  const [bulkCountError, setBulkCountError] = useState<string | null>(null)
  const [bulkRows, setBulkRows] = useState<BulkRowState[]>(() => (single ? [makeBulkRow(defaultDescription ?? '')] : []))
  const [bulkRowErrors, setBulkRowErrors] = useState<Map<string, string>>(new Map())
  const [bulkGeneralError, setBulkGeneralError] = useState<string | null>(null)

  function continueToBulkRows() {
    const count = Number(bulkCountInput)
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      setBulkCountError('Enter a whole number between 1 and 50')
      return
    }
    setBulkCountError(null)
    setBulkRows(Array.from({ length: count }, () => makeBulkRow()))
    setBulkRowErrors(new Map())
    setBulkGeneralError(null)
    setBulkStep('rows')
  }

  function addBulkRow() {
    setBulkRows(rows => [...rows, makeBulkRow()])
  }

  function removeBulkRow(id: string) {
    setBulkRows(rows => rows.filter(r => r.id !== id))
    setBulkRowErrors(errs => {
      if (!errs.has(id)) return errs
      const next = new Map(errs)
      next.delete(id)
      return next
    })
  }

  function updateBulkRow(id: string, key: keyof Omit<BulkRowState, 'id'>, value: string) {
    setBulkRows(rows => rows.map(r => (r.id === id ? { ...r, [key]: value } : r)))
  }

  async function saveBulk() {
    const nextErrors = new Map<string, string>()
    for (const row of bulkRows) {
      if (!row.description.trim()) nextErrors.set(row.id, 'Description is required')
    }
    if (nextErrors.size > 0) {
      setBulkRowErrors(nextErrors)
      setBulkGeneralError(null)
      return
    }

    setBulkRowErrors(new Map())
    setBulkGeneralError(null)

    const payload: BulkCreateRestrictivePracticeDto = {
      items: bulkRows.map(row => ({
        type: bulkType,
        description: row.description.trim(),
        authorisedBy: row.authorisedBy.trim() || null,
        authorisationDate: row.authorisationDate || null,
        reviewDate: row.reviewDate || null,
        relatedMedicationId: bulkType === 'ChemicalRestraint' ? (row.relatedMedicationId || null) : null,
        isActive: true,
      })),
    }

    try {
      const res = await bulkCreatePractices.mutateAsync({ participantId, data: payload })
      onSaved(res?.data ?? [])
    } catch (err) {
      const { general, rowErrors } = parseBulkErrors(err, bulkRows)
      setBulkGeneralError(general)
      setBulkRowErrors(rowErrors)
    }
  }

  const inputClass = 'w-full min-h-[44px] px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-sm text-[var(--color-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]'

  const textColumn = (key: 'description' | 'authorisedBy', header: string, placeholder: string, className?: string): Column<BulkRowState> => ({
    key,
    header,
    className,
    editable: {
      render: (row, onChange, ctx) => {
        const rowNumber = bulkRows.findIndex(r => r.id === row.id) + 1
        return (
          <input
            aria-label={`${header}, row ${rowNumber}`}
            aria-invalid={ctx.errorId ? 'true' : undefined}
            aria-describedby={ctx.errorId}
            value={row[key]}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            className={inputClass}
          />
        )
      },
    },
  })

  const dateColumn = (key: 'authorisationDate' | 'reviewDate', header: string): Column<BulkRowState> => ({
    key,
    header,
    editable: {
      render: (row, onChange, ctx) => {
        const rowNumber = bulkRows.findIndex(r => r.id === row.id) + 1
        return (
          <input
            type="date"
            aria-label={`${header}, row ${rowNumber}`}
            aria-invalid={ctx.errorId ? 'true' : undefined}
            aria-describedby={ctx.errorId}
            value={row[key]}
            onChange={e => onChange(e.target.value)}
            className={inputClass}
          />
        )
      },
    },
  })

  const medicationColumn: Column<BulkRowState> = {
    key: 'relatedMedicationId',
    header: 'Linked medication',
    editable: {
      render: (row, onChange, ctx) => {
        const rowNumber = bulkRows.findIndex(r => r.id === row.id) + 1
        const labelId = `bulk-medication-label-${row.id}`
        return (
          <div>
            <span id={labelId} className="sr-only">{`Linked medication, row ${rowNumber}`}</span>
            <Dropdown
              variant="form"
              aria-labelledby={labelId}
              aria-invalid={ctx.errorId ? 'true' : undefined}
              aria-describedby={ctx.errorId}
              value={row.relatedMedicationId}
              onChange={onChange}
              items={[
                { value: '', label: 'None' },
                ...medications.map(m => ({ value: m.id, label: m.strength ? `${m.name} ${m.strength}` : m.name })),
              ]}
            />
          </div>
        )
      },
    },
  }

  const removeColumn: Column<BulkRowState> = {
    key: 'remove',
    header: <span className="sr-only">Remove row</span>,
    align: 'center',
    render: row => {
      const rowNumber = bulkRows.findIndex(r => r.id === row.id) + 1
      return (
        <Button variant="ghost" iconOnly onClick={() => removeBulkRow(row.id)} disabled={bulkRows.length <= 1} aria-label={`Remove row ${rowNumber}`}>
          <Trash2 className="w-4 h-4" aria-hidden />
        </Button>
      )
    },
  }

  // Type is picked once per batch, so a "Linked medication" column only makes sense — and only appears — when the whole batch's type is
  // ChemicalRestraint. Adding a single entry from an incident asks nothing about its authorisation, and has no rows to remove.
  const bulkColumns: Column<BulkRowState>[] = [
    // The full row on a phone card: otherwise the cell shrinks to the input and a prefilled description can't be read.
    textColumn('description', 'Description', 'What the restrictive practice involves...', 'max-md:basis-full'),
    ...(single ? [] : [textColumn('authorisedBy', 'Authorised by', 'e.g. Dr. Chen'), dateColumn('authorisationDate', 'Authorisation date')]),
    dateColumn('reviewDate', 'Review date'),
    ...(bulkType === 'ChemicalRestraint' ? [medicationColumn] : []),
    ...(single ? [] : [removeColumn]),
  ]

  if (bulkStep === 'setup') {
    return (
      <Modal
        open
        onClose={onClose}
        title="Add entries"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={continueToBulkRows}>
              Continue
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Pick the type shared by every entry you're adding and how many, then fill in each row's details.
          </p>
          <FormField label="Restrictive practice type">
            <Dropdown
              variant="form"
              value={bulkType}
              onChange={v => setBulkType(v as RestrictivePracticeType)}
              items={RESTRICTIVE_PRACTICE_TYPES.map(t => ({ value: t, label: RESTRICTIVE_PRACTICE_TYPE_LABELS[t], description: RESTRICTIVE_PRACTICE_TYPE_DESCRIPTIONS[t] }))}
            />
          </FormField>
          <FormField label="Number of entries" error={bulkCountError ?? undefined}>
            <input
              type="number"
              min={1}
              max={50}
              value={bulkCountInput}
              onChange={e => setBulkCountInput(e.target.value)}
              autoFocus
            />
          </FormField>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={single ? `Add to restrictive practice register — ${RESTRICTIVE_PRACTICE_TYPE_LABELS[bulkType]}` : `Add entries — ${RESTRICTIVE_PRACTICE_TYPE_LABELS[bulkType]}`}
      size="xl"
      footer={
        <>
          {single ? (
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => setBulkStep('setup')}>
              Back
            </Button>
          )}
          <Button onClick={saveBulk} disabled={bulkCreatePractices.isPending}>
            {bulkCreatePractices.isPending ? 'Saving...' : `Save ${plural(bulkRows.length, 'entry', 'entries')}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {single && (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            This adds the practice to the participant's register without authorisation details, so it reads Not authorised until a coordinator records who authorised it and when.
          </p>
        )}
        {bulkGeneralError && (
          <Callout tone="error">{bulkGeneralError}</Callout>
        )}
        {bulkType === 'ChemicalRestraint' && medications.length === 0 && (
          <p className="text-xs text-[var(--color-muted-foreground)]">
            This participant has no active medications on record — add one on the Medications tab first, or leave these rows unlinked for now.
          </p>
        )}
        <DataTable
          data={bulkRows}
          columns={bulkColumns}
          keyField="id"
          editingRows={new Set(bulkRows.map(r => r.id))}
          onEditChange={(row, key, value) => updateBulkRow(row.id, key as keyof Omit<BulkRowState, 'id'>, value as string)}
          rowError={row => bulkRowErrors.get(row.id)}
          emptyMessage="No rows yet — add one below."
        />
        {!single && (
          <Button variant="secondary" onClick={addBulkRow}>
            <Plus className="w-4 h-4" aria-hidden /> Add row
          </Button>
        )}
      </div>
    </Modal>
  )
}
