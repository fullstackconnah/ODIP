import { useRef, useState } from 'react'
import { useActivities, useCreateActivity, useUpdateActivity } from '@/api/hooks'
import type { ActivityDto, CreateActivityDto } from '@/api/types'
import { ACTIVITY_CATEGORIES } from '@/api/types/enums'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { DataTable } from '@/components/DataTable'
import { FormField, inputClass, textareaClass } from '@/components/FormField'
import { SlideOver } from '@/components/SlideOver'
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
  const { data: activities = [], isLoading } = useActivities()
  const { isSuperAdmin, isAdmin, isCoordinator } = usePermissions()
  const canEdit = isSuperAdmin || isAdmin || isCoordinator
  const create = useCreateActivity()
  const update = useUpdateActivity()
  // `form` holds the open panel's values; `editing` is the row being edited (absent when adding).
  const [form, setForm] = useState<Form | null>(null)
  const [editing, setEditing] = useState<ActivityDto | undefined>()
  const [nameError, setNameError] = useState<string>()
  const [error, setError] = useState<string>()
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  const open = (a?: ActivityDto) => { setEditing(a); setForm(a ? toForm(a) : blank); setNameError(undefined); setError(undefined); setConfirmingDeactivate(false) }
  const close = () => setForm(null)
  const set = (patch: Partial<Form>) => setForm((f) => f && { ...f, ...patch })

  async function save(id: string | undefined, data: Form) {
    setError(undefined)
    try {
      await (id ? update.mutateAsync({ id, data }) : create.mutateAsync(data))
      close()
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to save the activity.'))
    }
  }

  function submit() {
    if (!form) return
    if (!form.activityName.trim()) { setNameError('Required'); nameRef.current?.focus(); return }
    save(editing?.id, { ...form, activityName: form.activityName.trim() })
  }

  // Deactivating and reactivating save the stored record with only isActive flipped, as the Templates panel's Deactivate does.
  const setActive = (isActive: boolean) => editing && save(editing.id, toForm(editing, isActive))

  const busy = create.isPending || update.isPending
  const dirty = !!form && JSON.stringify(form) !== JSON.stringify(editing ? toForm(editing) : blank)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--color-muted-foreground)]">Inactive activities are hidden from the trip picker.</p>
        {canEdit && <Button size="md" onClick={() => open()}>+ New Activity</Button>}
      </div>
      <DataTable
        data={activities}
        keyField="id"
        sortable
        loading={isLoading}
        emptyMessage="No activities yet. Add one to offer it when planning trips."
        columns={[
          { key: 'activityName', header: 'Activity', sortable: true, className: 'font-medium' },
          { key: 'category', header: 'Category', sortable: true },
          { key: 'location', header: 'Location', render: (a: ActivityDto) => a.location || '—' },
          { key: 'isActive', header: 'Status', sortable: true, render: (a: ActivityDto) => <StatusBadge status={a.isActive ? 'Active' : 'Inactive'} /> },
          ...(canEdit ? [{
            key: 'actions', header: 'Actions',
            render: (a: ActivityDto) => (
              <Button variant="secondary" size="sm" onClick={() => open(a)} aria-label={`Edit ${a.activityName}`}>Edit</Button>
            ),
          }] : []),
        ]}
      />
      <SlideOver
        open={!!form}
        onClose={close}
        title={editing ? 'Edit Activity' : 'New Activity'}
        dirty={dirty}
        footerClassName="py-3 space-y-3"
        footer={
          <>
            {/* Deactivate (with the Templates panel's inline confirm) or Reactivate, edit mode only */}
            {editing && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {!editing.isActive ? (
                  <button type="button" onClick={() => setActive(true)} disabled={busy || dirty} className="text-sm font-medium text-[var(--color-primary)] hover:underline disabled:opacity-50">
                    Reactivate activity
                  </button>
                ) : confirmingDeactivate ? (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-[var(--color-muted-foreground)]">Deactivate this activity?</span>
                    <button type="button" onClick={() => setActive(false)} disabled={busy || dirty} className="text-[var(--color-destructive)] font-medium hover:underline disabled:opacity-50">
                      {busy ? 'Deactivating…' : 'Confirm'}
                    </button>
                    <button type="button" onClick={() => setConfirmingDeactivate(false)} className="text-[var(--color-muted-foreground)] hover:underline">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setConfirmingDeactivate(true)} disabled={dirty} className="text-sm text-[var(--color-destructive)] hover:opacity-80 hover:underline transition-colors disabled:opacity-50">
                    Deactivate activity
                  </button>
                )}
                {dirty && <p className="text-sm text-[var(--color-muted-foreground)]">Save or discard your changes first</p>}
              </div>
            )}
            <div className="flex items-center gap-3 justify-end">
              <Button variant="secondary" onClick={close}>Cancel</Button>
              <Button onClick={submit} disabled={busy}>{busy ? 'Saving…' : editing ? 'Save Changes' : 'Create Activity'}</Button>
            </div>
          </>
        }
      >
        {form && (
          <div className={modalGrid}>
            {editing && !editing.isActive && (
              <div className={modalSpan.full}><Callout tone="info">This activity is inactive, so it does not appear when adding activities to a trip.</Callout></div>
            )}
            <div className={modalSpan.full}>
              <FormField label="Name" required error={nameError}>
                <input ref={nameRef} className={inputClass} maxLength={200} value={form.activityName} onChange={(e) => { set({ activityName: e.target.value }); setNameError(undefined) }} />
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
      </SlideOver>
    </div>
  )
}
