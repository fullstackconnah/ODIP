import { useState } from 'react'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DataTable, type Column } from '@/components/DataTable'
import { StatusBadge } from '@/components/StatusBadge'
import { useDownloadImportTemplate, useImportHistory, useUndoImport } from '@/api/hooks'
import type { ImportBatchDto, ImportKind, ImportUndoBlockerDto } from '@/api/types'
import { formatDateTimeAu, plural } from '@/lib/format'
import { extractErrorMessage } from '@/lib/utils'

/** What the tab offers to import, in order. Each opens the wizard at /settings/import/{kind}. */
const KINDS: { kind: ImportKind; title: string; text: string; noun: string }[] = [
  {
    kind: 'participants', title: 'Participants', noun: 'participant',
    text: 'Core profile, contacts and caregivers. Plans, budgets, medications and goals are added in ODIP afterwards.',
  },
]

/** A 409 from POST /imports/{id}/undo carries the records that changed since the import in its `data`. */
function undoBlockers(err: unknown): ImportUndoBlockerDto[] {
  const data = (err as { response?: { data?: { data?: unknown } } } | null)?.response?.data?.data
  return Array.isArray(data) ? (data as ImportUndoBlockerDto[]) : []
}

export default function ImportDataTab() {
  const history = useImportHistory()
  const undo = useUndoImport()
  const template = useDownloadImportTemplate()
  const [undoing, setUndoing] = useState<ImportBatchDto | null>(null)

  const columns: Column<ImportBatchDto>[] = [
    { key: 'fileName', header: 'File', mobile: 'primary' },
    { key: 'kind', header: 'Type' },
    { key: 'createdByName', header: 'Run by' },
    { key: 'createdAt', header: 'When', render: b => formatDateTimeAu(b.createdAt) },
    { key: 'createdCount', header: 'Created', align: 'right' },
    { key: 'skippedCount', header: 'Skipped', align: 'right' },
    { key: 'failedCount', header: "Couldn't import", align: 'right' },
    {
      key: 'status', header: 'Status', mobile: 'status',
      render: b => b.undoneAt ? <StatusBadge tone="neutral" label="Undone" /> : <StatusBadge tone="success" label="Imported" />,
    },
    {
      key: 'actions', header: '', align: 'right', pin: 'end',
      render: b => !b.undoneAt && <Button variant="secondary" size="sm" onClick={() => setUndoing(b)}>Undo</Button>,
    },
  ]
  const blockers = undoBlockers(undo.error)

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <section className="flex flex-col gap-3" aria-labelledby="import-kinds">
        <h2 id="import-kinds" className="text-base font-semibold">Bring your records into ODIP</h2>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Upload a .csv or .xlsx export from your old platform, up to 2,000 rows and 5 MB. Records already in ODIP are skipped and never changed.
        </p>
        {KINDS.map(k => (
          <div key={k.kind} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-[var(--card-pad)]">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">{k.title}</h3>
              <p className="text-sm text-[var(--color-muted-foreground)]">{k.text}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => template.mutate(k.kind)}>Download template</Button>
              <Button to={`/settings/import/${k.kind}`}>Import {k.title.toLowerCase()}</Button>
            </div>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="import-history">
        <h2 id="import-history" className="text-base font-semibold">Import history</h2>
        {undo.error != null && (
          <Callout tone="danger" title={extractErrorMessage(undo.error, 'The import could not be undone.')}>
            {blockers.length > 0 && (
              <ul className="list-disc pl-5">
                {blockers.map(b => <li key={b.entityId}>{b.name} {b.reason}</li>)}
              </ul>
            )}
          </Callout>
        )}
        <DataTable
          data={history.data ?? []}
          columns={columns}
          keyField="id"
          loading={history.isLoading}
          error={history.isError}
          onRetry={() => history.refetch()}
          emptyMessage="No imports yet. Each import is listed here, with Undo while nothing in it has changed."
        />
      </section>

      <ConfirmDialog
        open={undoing != null}
        title="Undo this import?"
        message={undoing && `The ${plural(undoing.createdCount, KINDS.find(k => k.title === undoing.kind)?.noun ?? 'record')} that ${undoing.fileName} created ${undoing.kind === 'Participants' ? 'are archived' : 'are removed'}. This only works while none of them has changed since the import.`}
        confirmLabel="Undo import"
        variant="danger"
        loading={undo.isPending}
        onCancel={() => setUndoing(null)}
        onConfirm={() => undoing && undo.mutate(undoing.id, { onSettled: () => setUndoing(null) })}
      />
    </div>
  )
}
