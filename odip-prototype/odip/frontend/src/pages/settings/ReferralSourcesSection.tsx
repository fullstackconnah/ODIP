import { useRef, useState } from 'react'
import { Lock, Plus } from 'lucide-react'
import { useCreateReferralSource, useReferralSources, useUpdateReferralSource } from '@/api/hooks'
import type { ReferralSourceDto } from '@/api/types'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { DataTable } from '@/components/DataTable'
import { inputClass } from '@/components/FormField'
import { usePermissions } from '@/lib/permissions'
import { retryingAfterError } from '@/lib/queryPhase'
import { extractErrorMessage } from '@/lib/utils'

/** The name box being used: a new source (`id` absent) or a rename. */
type Editing = { id?: string; name: string }

/**
 * Settings > Referral sources: the list a coordinator picks "Referred by" from on an enquiry. Admin, Coordinator and SuperAdmin write it (the server's
 * roles); everyone else reads. A source is hidden, never deleted, so an old enquiry keeps its label.
 */
export default function ReferralSourcesSection() {
  const pageQuery = useReferralSources()
  const { data: sources = [], isLoading, isError, refetch } = pageQuery
  const { isSuperAdmin, isAdmin, isCoordinator } = usePermissions()
  const canEdit = isSuperAdmin || isAdmin || isCoordinator
  const create = useCreateReferralSource()
  const update = useUpdateReferralSource()
  const [editing, setEditing] = useState<Editing | null>(null)
  const [error, setError] = useState<string>()
  const addRef = useRef<HTMLButtonElement>(null)
  const busy = create.isPending || update.isPending

  const active = sources.filter(s => s.isActive)
  const hidden = sources.filter(s => !s.isActive)

  const open = (next: Editing) => { setEditing(next); setError(undefined) }
  const close = () => { setEditing(null); setError(undefined); addRef.current?.focus() }

  async function save() {
    if (!editing) return
    const name = editing.name.trim()
    if (!name) { setError('Enter a name.'); return }
    setError(undefined)
    try {
      if (editing.id) await update.mutateAsync({ id: editing.id, data: { name, isActive: sources.find(s => s.id === editing.id)?.isActive ?? true } })
      else await create.mutateAsync({ name })
      close()
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not save the source. Try again.'))
    }
  }

  async function setActive(source: ReferralSourceDto, isActive: boolean) {
    setError(undefined)
    try {
      await update.mutateAsync({ id: source.id, data: { name: source.name, isActive } })
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not change the source. Try again.'))
    }
  }

  // The one name box, on the row being renamed or above the table when adding.
  const nameBox = (
    <div className="flex flex-wrap items-center gap-2">
      <input
        autoFocus
        aria-label="Source name"
        className={`${inputClass} flex-1 min-w-48`}
        maxLength={100}
        value={editing?.name ?? ''}
        onChange={e => { setEditing(cur => cur && { ...cur, name: e.target.value }); setError(undefined) }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save() } else if (e.key === 'Escape') close() }}
      />
      <Button size="sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
      <Button size="sm" variant="secondary" onClick={close}>Cancel</Button>
    </div>
  )

  const columns = (hiddenRows: boolean) => [
    {
      key: 'name', header: 'Name', className: 'font-medium',
      render: (s: ReferralSourceDto) => editing?.id === s.id
        ? nameBox
        : <span className={hiddenRows ? 'text-[var(--color-muted-foreground)]' : undefined}>{s.name}</span>,
    },
    ...(canEdit ? [{
      key: 'actions', header: 'Actions',
      render: (s: ReferralSourceDto) => editing?.id === s.id ? null : (
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => open({ id: s.id, name: s.name })} aria-label={`Rename: ${s.name}`}>Rename</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setActive(s, hiddenRows)} aria-label={`${hiddenRows ? 'Show' : 'Hide'}: ${s.name}`}>{hiddenRows ? 'Show' : 'Hide'}</Button>
        </div>
      ),
    }] : []),
  ]

  return (
    <div className="space-y-4">
      {!canEdit && (
        <Callout tone="info" icon={Lock} announce={false} className="max-w-prose">Only Admins and Coordinators can change this list.</Callout>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--color-muted-foreground)]">Hidden sources stay on the enquiries that have them, but can&apos;t be picked for new ones.</p>
        {canEdit && <Button ref={addRef} size="md" onClick={() => open({ name: '' })}><Plus className="w-4 h-4" /> Add a source</Button>}
      </div>
      {editing && !editing.id && <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-3">{nameBox}</div>}
      {error && <Callout tone="error">{error}</Callout>}
      <DataTable
        data={active}
        keyField="id"
        loading={isLoading}
        error={isError || retryingAfterError(pageQuery)}
        onRetry={() => refetch()}
        emptyMessage="No referral sources yet. Add the places your enquiries come from, like a support coordinator or GP."
        columns={columns(false)}
      />
      {hidden.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-[var(--color-muted-foreground)]">Hidden</h3>
          <DataTable data={hidden} keyField="id" columns={columns(true)} />
        </section>
      )}
    </div>
  )
}
