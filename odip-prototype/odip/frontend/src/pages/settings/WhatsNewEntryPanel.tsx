import { useEffect, useMemo, useRef, useState } from 'react'
import { useCreateWhatsNewEntry, useUpdateWhatsNewEntry } from '@/api/hooks'
import type { AdminWhatsNewEntry, WhatsNewRole } from '@/api/types'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { CheckboxField } from '@/components/CheckboxField'
import { labelClass } from '@/components/FormField'
import { SlideOver } from '@/components/SlideOver'
import { TextAreaField } from '@/components/TextAreaField'
import { TextField } from '@/components/TextField'

export const TITLE_MAX = 80
export const BODY_MAX = 600

/** House order: the order the roles are saved and listed in. */
export const WHATS_NEW_ROLES: { role: WhatsNewRole; label: string }[] = [
  { role: 'Admin', label: 'Admin' },
  { role: 'Coordinator', label: 'Coordinator' },
  { role: 'SupportWorker', label: 'Support worker' },
  { role: 'ReadOnly', label: 'Read-only' },
]

const DISABLED_LOOK = 'aria-disabled:opacity-50 aria-disabled:cursor-not-allowed'

/** `42 / 600`; from 90% of the limit it turns destructive, the same rule as the shift notes counter. */
function CharCount({ id, used, max }: { id: string; used: number; max: number }) {
  const near = used >= max * 0.9
  return (
    <p id={id} className={`mt-1 text-right text-xs tabular-nums ${near ? 'font-medium text-[var(--color-destructive)]' : 'text-[var(--color-muted-foreground)]'}`}>
      {used} / {max}
    </p>
  )
}

type Errors = { title?: string; text?: string; roles?: string }

type FormProps = { entry: AdminWhatsNewEntry | null; onClose: () => void }

/** The form body. It is mounted afresh for every open (the section keys it), so its state starts from the row and survives a refused save. */
function EntryForm({ entry, onClose }: FormProps) {
  const create = useCreateWhatsNewEntry()
  const update = useUpdateWhatsNewEntry()
  const initial = useMemo(() => ({
    title: entry?.title ?? '',
    text: entry?.body ?? '',
    roles: entry ? entry.roles : WHATS_NEW_ROLES.map(r => r.role),
    important: entry?.important ?? false,
  }), [entry])
  const [title, setTitle] = useState(initial.title)
  const [text, setText] = useState(initial.text)
  const [roles, setRoles] = useState<WhatsNewRole[]>(initial.roles)
  const [important, setImportant] = useState(initial.important)
  const [errors, setErrors] = useState<Errors>({})
  const [refused, setRefused] = useState(false)
  const [focusNonce, setFocusNonce] = useState(0)
  const formRef = useRef<HTMLDivElement>(null)
  const pending = create.isPending || update.isPending
  const editing = !!entry

  // After a failed submit, focus goes to the first invalid control, which the fields mark with aria-invalid.
  useEffect(() => {
    if (focusNonce > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [focusNonce])

  const dirty = title !== initial.title || text !== initial.text || important !== initial.important || roles.join() !== initial.roles.join()

  const submit = () => {
    if (pending) return
    const next: Errors = {}
    if (!title.trim()) next.title = 'Enter a title.'
    if (!text.trim()) next.text = 'Enter the text people will read.'
    if (roles.length === 0) next.roles = 'Choose at least one role.'
    setErrors(next)
    setRefused(false)
    if (Object.keys(next).length > 0) {
      setFocusNonce(n => n + 1)
      return
    }
    const dto = { title: title.trim(), body: text.trim(), roles: WHATS_NEW_ROLES.map(r => r.role).filter(r => roles.includes(r)), important }
    const options = { onSuccess: onClose, onError: () => setRefused(true) }
    if (entry) update.mutate({ id: entry.id, ...dto }, options)
    else create.mutate(dto, options)
  }

  const toggleRole = (role: WhatsNewRole) => setRoles(current => (current.includes(role) ? current.filter(r => r !== role) : [...current, role]))
  const rolesHintId = 'whats-new-roles-hint'
  const rolesErrorId = 'whats-new-roles-error'

  return (
    <SlideOver
      open
      onClose={onClose}
      dirty={dirty}
      size="md"
      title={editing ? 'Edit entry' : 'Add entry'}
      footer={(
        <>
          {editing && <p className="mr-auto text-xs text-[var(--color-muted-foreground)]">Edits don't mark it as new again.</p>}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} aria-disabled={pending || undefined} aria-busy={pending || undefined} className={DISABLED_LOOK}>
            {editing ? (pending ? 'Saving…' : 'Save changes') : (pending ? 'Publishing…' : 'Publish')}
          </Button>
        </>
      )}
    >
      <div ref={formRef} className="space-y-4">
        {refused && <Callout tone="danger">Couldn't save the entry. Check the fields and try again.</Callout>}
        <div>
          <TextField label="Title" required value={title} maxLength={TITLE_MAX} error={errors.title} descriptionId="whats-new-title-count" onChange={e => setTitle(e.target.value)} />
          <CharCount id="whats-new-title-count" used={title.length} max={TITLE_MAX} />
        </div>
        <div>
          <TextAreaField label="Text" required rows={8} value={text} maxLength={BODY_MAX} error={errors.text} hint="Plain text. Leave a blank line between paragraphs." descriptionId="whats-new-text-count" onChange={e => setText(e.target.value)} />
          <CharCount id="whats-new-text-count" used={text.length} max={BODY_MAX} />
        </div>
        <fieldset aria-describedby={[rolesHintId, errors.roles && rolesErrorId].filter(Boolean).join(' ')}>
          <legend className={labelClass}>Who sees it</legend>
          <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            {WHATS_NEW_ROLES.map(({ role, label }, i) => (
              <CheckboxField
                key={role}
                label={label}
                checked={roles.includes(role)}
                aria-invalid={i === 0 && errors.roles ? true : undefined}
                onChange={() => toggleRole(role)}
              />
            ))}
          </div>
          {errors.roles && <p id={rolesErrorId} className="mt-1 text-xs text-[var(--color-destructive)]">{errors.roles}</p>}
          <p id={rolesHintId} className="mt-1 text-xs text-[var(--color-muted-foreground)]">SuperAdmins see every entry.</p>
        </fieldset>
        <CheckboxField label="Important" hint="Shows once as a pop-up on each person's next visit." checked={important} onChange={e => setImportant(e.target.checked)} />
      </div>
    </SlideOver>
  )
}

export type WhatsNewEntryPanelProps = {
  open: boolean
  /** The row to edit, or null for a new entry. */
  entry: AdminWhatsNewEntry | null
  /** Changes on every open, so the form starts afresh from the row. */
  formKey: number
  onClose: () => void
}

/** The add / edit form in the house SlideOver (SHAPE section 5). */
export function WhatsNewEntryPanel({ open, entry, formKey, onClose }: WhatsNewEntryPanelProps) {
  return open ? <EntryForm key={formKey} entry={entry} onClose={onClose} /> : null
}
