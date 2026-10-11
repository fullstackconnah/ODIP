import { useState } from 'react'
import { useActivities, useCreateActivity, useUpdateActivity } from '@/api/hooks'
import type { ActivityDto, CreateActivityDto } from '@/api/types'
import { ACTIVITY_CATEGORIES } from '@/api/types/enums'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { DataTable } from '@/components/DataTable'
import { FormField, inputClass, textareaClass } from '@/components/FormField'
import { Modal } from '@/components/Modal'
import { StatusBadge } from '@/components/StatusBadge'
import { modalGrid, modalSpan } from '@/lib/formGrid'
import { usePermissions } from '@/lib/permissions'
import { extractErrorMessage } from '@/lib/utils'

type Form = Required<Omit<CreateActivityDto, 'eventTemplateId'>> & Pick<CreateActivityDto, 'eventTemplateId'>

const blank: Form = { activityName: '', category: 'Leisure', location: '', accessibilityNotes: '', suitabilityNotes: '', notes: '', isActive: true }

const toForm = (a: ActivityDto, isActive = a.isActive): Form => ({
  eventTemplateId: a.eventTemplateId ?? undefined, activityName: a.activityName, category: a.category,
  location: a.location ?? '', accessibilityNotes: a.accessibilityNotes ?? '', suitabilityNotes: a.suitabilityNotes ?? '', notes: a.notes ?? '', isActive,
})

/** Settings > Activity Library. Admin, Coordinator and SuperAdmin write it (the server's roles); everyone else reads the list. */
export default function ActivityLibraryTab() {
  const { data: activities = [] } = useActivities()
  const { isSuperAdmin, isAdmin, isCoordinator } = usePermissions()
  const canEdit = isSuperAdmin || isAdmin || isCoordinator
  const create = useCreateActivity()
  const update = useUpdateActivity()
  // `form` holds the open dialog's values; `editing` is the row being edited (absent when adding).
  const [form, setForm] = useState<Form | null>(null)
  const [editing, setEditing] = useState<ActivityDto | undefined>()
  const [nameError, setNameError] = useState<string>()
  const [error, setError] = useState<string>()

  const open = (a?: ActivityDto) => { setEditing(a); setForm(a ? toForm(a) : blank); setNameError(undefined); setError(undefined) }
  const set = (patch: Partial<Form>) => setForm((f) => f && { ...f, ...patch })

  async function save(id: string | undefined, data: Form, onDone?: () => void) {
    setError(undefined)
    try {
      await (id ? update.mutateAsync({ id, data }) : create.mutateAsync(data))
      onDone?.()
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to save the activity.'))
    }
  }

  function submit() {
    if (!form) return
    if (!form.activityName.trim()) { setNameError('Required'); return }
    setNameError(undefined)
    save(editing?.id, { ...form, activityName: form.activityName.trim() }, () => setForm(null))
  }

  const busy = create.isPending || update.isPending

  return (
    <div className="space-y-4">
      {canEdit && <div className="flex justify-end"><Button size="md" onClick={() => open()}>Add activity</Button></div>}
      {error && !form && <Callout tone="error">{error}</Callout>}
      <DataTable
        data={activities}
        keyField="id"
        sortable
        columns={[
          { key: 'activityName', header: 'Activity', sortable: true, className: 'font-medium' },
          { key: 'category', header: 'Category', sortable: true },
          { key: 'location', header: 'Location', render: (a: ActivityDto) => a.location || '—' },
          { key: 'isActive', header: 'Status', sortable: true, render: (a: ActivityDto) => <StatusBadge status={a.isActive ? 'Active' : 'Inactive'} /> },
          ...(canEdit ? [{
            key: 'actions', header: 'Actions',
            render: (a: ActivityDto) => (
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => open(a)} aria-label={`Edit ${a.activityName}`}>Edit</Button>
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => save(a.id, toForm(a, !a.isActive))} aria-label={`${a.isActive ? 'Deactivate' : 'Reactivate'} ${a.activityName}`}>
                  {a.isActive ? 'Deactivate' : 'Reactivate'}
                </Button>
              </div>
            ),
          }] : []),
        ]}
      />
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={editing ? 'Edit activity' : 'Add activity'}
        closeOnBackdrop={false}
        footer={<><Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button><Button onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button></>}
      >
        {form && (
          <div className={modalGrid}>
            <div className={modalSpan.full}>
              <FormField label="Name" required error={nameError}>
                <input className={inputClass} maxLength={200} value={form.activityName} onChange={(e) => set({ activityName: e.target.value })} />
              </FormField>
            </div>
            <FormField label="Category">
              <select className={inputClass} value={form.category} onChange={(e) => set({ category: e.target.value as Form['category'] })}>
                {ACTIVITY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </FormField>
            <FormField label="Location">
              <input className={inputClass} value={form.location} onChange={(e) => set({ location: e.target.value })} />
            </FormField>
            <div className={modalSpan.full}><FormField label="Accessibility notes"><textarea className={textareaClass} rows={2} value={form.accessibilityNotes} onChange={(e) => set({ accessibilityNotes: e.target.value })} /></FormField></div>
            <div className={modalSpan.full}><FormField label="Suitability notes"><textarea className={textareaClass} rows={2} value={form.suitabilityNotes} onChange={(e) => set({ suitabilityNotes: e.target.value })} /></FormField></div>
            <div className={modalSpan.full}><FormField label="Notes"><textarea className={textareaClass} rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} /></FormField></div>
            {error && <div className={modalSpan.full}><Callout tone="error">{error}</Callout></div>}
          </div>
        )}
      </Modal>
    </div>
  )
}
