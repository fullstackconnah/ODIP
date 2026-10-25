import { useState } from 'react'
import { useAdminWhatsNew, useArchiveWhatsNewEntry, useRestoreWhatsNewEntry } from '@/api/hooks'
import type { AdminWhatsNewEntry } from '@/api/types'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DataTable } from '@/components/DataTable'
import { StatusBadge } from '@/components/StatusBadge'
import { WhatsNewEntryPanel } from '@/pages/settings/WhatsNewEntryPanel'
import { WHATS_NEW_ROLES, formatWhatsNewDate } from '@/lib/whatsNew'
import { retryingAfterError } from '@/lib/queryPhase'

const audience = (e: AdminWhatsNewEntry) =>
  WHATS_NEW_ROLES.every(r => e.roles.includes(r.role))
    ? 'Everyone'
    : WHATS_NEW_ROLES.filter(r => e.roles.includes(r.role)).map(r => r.label).join(', ')

/** SuperAdmin's list of What's new entries (SHAPE section 5): add, edit, archive and restore. Newest first, as the server returns them. */
export default function WhatsNewSection() {
  const query = useAdminWhatsNew()
  const archive = useArchiveWhatsNewEntry()
  const restore = useRestoreWhatsNewEntry()
  const [panel, setPanel] = useState<{ entry: AdminWhatsNewEntry | null; key: number } | null>(null)
  const [archiving, setArchiving] = useState<AdminWhatsNewEntry | null>(null)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const openPanel = (entry: AdminWhatsNewEntry | null) => setPanel(p => ({ entry, key: (p?.key ?? 0) + 1 }))
  const [panelOpen, setPanelOpen] = useState(false)
  const show = (entry: AdminWhatsNewEntry | null) => { openPanel(entry); setPanelOpen(true) }

  const doArchive = () => {
    if (!archiving) return
    const target = archiving
    setNotice(null)
    archive.mutate(target.id, {
      onSuccess: () => setArchiving(null),
      onError: () => { setArchiving(null); setNotice(`Couldn't archive "${target.title}". Try again.`) },
    })
  }
  const doRestore = (entry: AdminWhatsNewEntry) => {
    if (restoringId) return
    setNotice(null)
    setRestoringId(entry.id)
    restore.mutate(entry.id, {
      onError: () => setNotice(`Couldn't restore "${entry.title}". Try again.`),
      onSettled: () => setRestoringId(null),
    })
  }

  const muted = (e: AdminWhatsNewEntry) => (e.archivedAtUtc ? 'text-[var(--color-muted-foreground)]' : '')

  return (
    <div className="space-y-4">
      <Callout tone="info" announce={false} className="max-w-prose">
        Every organisation sees these entries. Each person sees only the entries for their role, and SuperAdmins see them all.
      </Callout>
      {notice && <Callout tone="danger">{notice}</Callout>}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="md" onClick={() => show(null)}>Add entry</Button>
      </div>
      <DataTable
        data={query.data ?? []}
        keyField="id"
        columns={[
          { key: 'publishedAtUtc', header: 'Published', mobile: 'meta', className: 'whitespace-nowrap', render: (e: AdminWhatsNewEntry) => <span className={muted(e)}>{formatWhatsNewDate(e.publishedAtUtc)}</span> },
          { key: 'title', header: 'Title', mobile: 'primary', className: 'font-medium', render: (e: AdminWhatsNewEntry) => <span className={muted(e)}>{e.title}</span> },
          { key: 'roles', header: 'Who sees it', mobile: 'meta', render: (e: AdminWhatsNewEntry) => <span className={muted(e)}>{audience(e)}</span> },
          { key: 'important', header: 'Important', mobile: 'meta', render: (e: AdminWhatsNewEntry) => <span className={muted(e)}>{e.important ? 'Yes' : 'No'}</span> },
          {
            key: 'status',
            header: 'Status',
            mobile: 'status',
            render: (e: AdminWhatsNewEntry) => (e.archivedAtUtc ? <StatusBadge tone="neutral" label="Archived" /> : <StatusBadge tone="info" label="Published" />),
          },
          {
            key: 'actions',
            header: '',
            render: (e: AdminWhatsNewEntry) => (
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="sm" onClick={() => show(e)} aria-label={`Edit: ${e.title}`}>Edit</Button>
                {e.archivedAtUtc ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => doRestore(e)}
                    aria-disabled={restoringId === e.id || undefined}
                    aria-busy={restoringId === e.id || undefined}
                    aria-label={`Restore: ${e.title}`}
                  >
                    Restore
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setArchiving(e)} aria-label={`Archive: ${e.title}`}>Archive</Button>
                )}
              </div>
            ),
          },
        ]}
        loading={query.isLoading}
        error={query.isError || retryingAfterError(query)}
        onRetry={() => query.refetch()}
        emptyMessage="No entries yet. Entries also arrive with each release."
      />
      <ConfirmDialog
        open={archiving !== null}
        onCancel={() => setArchiving(null)}
        onConfirm={doArchive}
        title="Archive this entry?"
        message={`"${archiving?.title ?? ''}" will no longer show in What's new for anyone. You can restore it from this list.`}
        confirmLabel="Archive"
        cancelLabel="Cancel"
        loading={archive.isPending}
      />
      <WhatsNewEntryPanel open={panelOpen} entry={panel?.entry ?? null} formKey={panel?.key ?? 0} onClose={() => setPanelOpen(false)} />
    </div>
  )
}
