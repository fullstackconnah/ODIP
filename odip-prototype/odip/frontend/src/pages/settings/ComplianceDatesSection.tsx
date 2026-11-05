import { useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { useComplianceItems, useCreateComplianceItem, useDeleteComplianceItem, useUpdateComplianceItem } from '@/api/hooks'
import { COMPLIANCE_KINDS, COMPLIANCE_KIND_LABELS, type ComplianceItemDto, type ComplianceKind, type SaveComplianceItemDto } from '@/api/types'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DataTable } from '@/components/DataTable'
import { SelectField } from '@/components/SelectField'
import { SlideOver } from '@/components/SlideOver'
import { StatusBadge } from '@/components/StatusBadge'
import { TextAreaField } from '@/components/TextAreaField'
import { TextField } from '@/components/TextField'
import { TAP_AREA } from '@/components/tapArea'
import { usePermissions } from '@/lib/permissions'
import { retryingAfterError } from '@/lib/queryPhase'
import { extractErrorMessage, formatDateAu } from '@/lib/utils'

/** The form's boxes as typed. */
type Form = { kind: ComplianceKind; label: string; expiresOn: string; reference: string; notes: string }
type FieldErrors = Partial<Record<'label' | 'expiresOn', string>>
type Editing = { id?: string; initial: Form }

const NEW_DATE: Form = { kind: 'Registration', label: '', expiresOn: '', reference: '', notes: '' }
const CELL = 'md:py-2'   // the sibling tables' cell padding
const FULL = 'max-md:basis-full'
const HALF = 'max-md:flex-1 max-md:min-w-0'   // two equal columns under the card's full-width name
const KIND_OPTIONS = COMPLIANCE_KINDS.map(value => ({ value, label: COMPLIANCE_KIND_LABELS[value] }))
const PLACEHOLDER: Record<ComplianceKind, string> = {
  Registration: 'e.g. NDIS registration',
  Audit: 'e.g. Certification audit',
  MidTermAudit: 'e.g. Mid-term audit',
  Insurance: 'e.g. Public liability insurance',
  KeyPersonnel: 'e.g. Sam Lee, Chief executive',
}
/** The server opens a task from this many days out (ComplianceDueTasks.LeadDays), so the chip says Due soon exactly while a task is open. */
const LEAD_DAYS = 90

const formOf = (i: ComplianceItemDto): Form => ({ kind: i.kind, label: i.label, expiresOn: i.expiresOn, reference: i.reference ?? '', notes: i.notes ?? '' })

function Status({ daysLeft }: { daysLeft: number }) {
  if (daysLeft < 0) return <StatusBadge tone="danger" label="Overdue" />
  if (daysLeft <= LEAD_DAYS) return <StatusBadge tone="warning" label="Due soon" />
  return <StatusBadge tone="neutral" label="Current" />
}

/** A date the form can send: yyyy-mm-dd that is a real day, in the years the server accepts. */
function dateError(value: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return 'Enter the date it expires.'
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const real = new Date(Date.UTC(y, mo - 1, d))
  if (real.getUTCFullYear() !== y || real.getUTCMonth() !== mo - 1 || real.getUTCDate() !== d) return 'Enter the date it expires.'
  if (y < 2000 || y > 2100) return 'Use a date between 2000 and 2100.'
  return undefined
}

/**
 * Settings > Compliance dates: when the registration, audits, insurance and key personnel checks fall due. The server raises one Admin task per date from
 * 90 days out (the nightly scan), so this list only records the dates. Admin and SuperAdmin write; a Coordinator reads. A delete is a real delete and closes the date's task.
 */
export default function ComplianceDatesSection() {
  const listQuery = useComplianceItems()
  const { data: items = [], isLoading, isError, refetch } = listQuery
  const { canEditProviderSettings: canEdit } = usePermissions()
  const create = useCreateComplianceItem()
  const update = useUpdateComplianceItem()
  const remove = useDeleteComplianceItem()
  const [editing, setEditing] = useState<Editing | null>(null)
  const [form, setForm] = useState<Form>(NEW_DATE)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [saveError, setSaveError] = useState<string>()
  const [pageError, setPageError] = useState<string>()
  const [deleting, setDeleting] = useState<ComplianceItemDto | null>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const busy = create.isPending || update.isPending
  const dirty = editing !== null && JSON.stringify(form) !== JSON.stringify(editing.initial)

  const open = (next: Editing) => { setEditing(next); setForm(next.initial); setFieldErrors({}); setSaveError(undefined); setPageError(undefined) }
  const close = () => { setEditing(null); addRef.current?.focus() }
  const edit = (patch: Partial<Form>) => { setForm(cur => ({ ...cur, ...patch })); setSaveError(undefined) }

  async function save() {
    if (!editing) return
    const label = form.label.trim()
    const errors: FieldErrors = {}
    if (!label) errors.label = 'Enter a name.'
    const expiresError = dateError(form.expiresOn)
    if (expiresError) errors.expiresOn = expiresError
    setFieldErrors(errors)
    if (errors.label || errors.expiresOn) return
    const data: SaveComplianceItemDto = { kind: form.kind, label, expiresOn: form.expiresOn, reference: form.reference.trim() || null, notes: form.notes.trim() || null }
    setSaveError(undefined)
    try {
      if (editing.id) await update.mutateAsync({ id: editing.id, data })
      else await create.mutateAsync(data)
      close()
    } catch (err) {
      setSaveError(extractErrorMessage(err, 'Could not save the date. Try again.'))
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setPageError(undefined)
    try {
      await remove.mutateAsync(deleting.id)
    } catch {
      setPageError('Could not delete the date. Try again.')
    }
    setDeleting(null)
  }

  const columns = [
    { key: 'kind', header: 'Kind', className: `${CELL} ${FULL} max-md:text-[13px] max-md:text-[var(--color-muted-foreground)]`, render: (i: ComplianceItemDto) => COMPLIANCE_KIND_LABELS[i.kind] },
    { key: 'label', header: 'Name', className: `font-medium break-words ${CELL} ${FULL}`, wrap: true, width: '34%', render: (i: ComplianceItemDto) => i.label },
    { key: 'expiresOn', header: 'Expires on', className: `${CELL} ${HALF}`, render: (i: ComplianceItemDto) => formatDateAu(i.expiresOn) },
    { key: 'status', header: 'Status', className: `${CELL} ${HALF}`, render: (i: ComplianceItemDto) => <Status daysLeft={i.daysLeft} /> },
    { key: 'reference', header: 'Reference', className: `${CELL} ${FULL} break-words md:whitespace-nowrap`, wrap: true, render: (i: ComplianceItemDto) => i.reference || '—' },
    ...(canEdit ? [{
      key: 'actions', header: 'Actions', className: `${CELL} ${FULL}`, width: '1%',
      render: (i: ComplianceItemDto) => (
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" className={`${TAP_AREA} max-md:flex-1`} onClick={() => open({ id: i.id, initial: formOf(i) })} aria-label={`Edit: ${i.label}`}>Edit</Button>
          <Button variant="ghost" size="sm" className={`${TAP_AREA} max-md:flex-1`} disabled={remove.isPending} onClick={() => setDeleting(i)} aria-label={`Delete: ${i.label}`}>Delete</Button>
        </div>
      ),
    }] : []),
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--color-muted-foreground)]">Soonest first. The status shows Due soon from {LEAD_DAYS} days before the date.</p>
        {canEdit && <Button ref={addRef} size="md" onClick={() => open({ initial: NEW_DATE })}><Plus className="w-4 h-4" /> Add a date</Button>}
      </div>
      {pageError && <Callout tone="error">{pageError}</Callout>}
      <DataTable
        data={items}
        keyField="id"
        loading={isLoading}
        error={isError || retryingAfterError(listQuery)}
        onRetry={() => refetch()}
        emptyMessage={canEdit
          ? "No compliance dates yet. Start with your registration: add the date it expires, and we'll remind your Admins 90 days before."
          : 'No compliance dates yet. An Admin can add them here.'}
        columns={columns}
      />

      <SlideOver
        open={editing !== null}
        onClose={close}
        dirty={dirty}
        title={editing?.id ? 'Edit compliance date' : 'Add a compliance date'}
        description="We'll remind your Admins on the Tasks page 90 days before this date."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" className={TAP_AREA} onClick={close}>Cancel</Button>
            <Button className={TAP_AREA} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          </div>
        }
      >
        <form className="space-y-4" noValidate onSubmit={e => { e.preventDefault(); save() }}>
          {saveError && <Callout tone="error">{saveError}</Callout>}
          <SelectField label="Kind" required options={KIND_OPTIONS} value={form.kind} onChange={e => edit({ kind: e.target.value as ComplianceKind })} />
          <TextField
            label="Name" required maxLength={120} autoComplete="off" placeholder={PLACEHOLDER[form.kind]}
            hint={form.kind === 'KeyPersonnel' ? "The person's name and role." : undefined}
            value={form.label} onChange={e => edit({ label: e.target.value })} error={fieldErrors.label}
          />
          <TextField
            label="Expires on" type="date" required hint="The last day it's valid. For an audit, the day it's due."
            value={form.expiresOn} onChange={e => edit({ expiresOn: e.target.value })} error={fieldErrors.expiresOn}
          />
          <TextField
            label="Reference" maxLength={100} autoComplete="off" hint="A registration, policy or certificate number."
            value={form.reference} onChange={e => edit({ reference: e.target.value })}
          />
          <TextAreaField label="Notes" rows={3} maxLength={1000} value={form.notes} onChange={e => edit({ notes: e.target.value })} />
        </form>
      </SlideOver>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this date?"
        message={deleting ? `Delete ${deleting.label}? Its reminder on the Tasks page closes too. This can't be undone.` : ''}
        confirmLabel="Delete"
        variant="danger"
        loading={remove.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}
