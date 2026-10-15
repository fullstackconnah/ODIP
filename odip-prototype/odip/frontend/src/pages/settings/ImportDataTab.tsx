import { useState } from 'react'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DataTable, type Column } from '@/components/DataTable'
import { StatusBadge } from '@/components/StatusBadge'
import { useDownloadImportTemplate, useImportHistory, useProviderSettings, useUndoImport } from '@/api/hooks'
import type { ImportBatchDto, ImportKind } from '@/api/types'
import { formatDateTimeAu, plural } from '@/lib/format'
import { extractErrorMessage } from '@/lib/utils'
import ImportInvites, { InviteResults, type InviteResult } from './ImportInvites'
import { undoBlockers } from './importUndoBlockers'

/** What the tab offers to import, in order. Each opens the wizard at /settings/import/{kind}. */
const KINDS: { kind: ImportKind; title: string; text: string; noun: string }[] = [
  {
    kind: 'participants', title: 'Participants', noun: 'participant',
    text: 'Core profile, contacts and caregivers. Plans, budgets, medications and goals are added in ODIP afterwards.',
  },
  {
    kind: 'staff', title: 'Staff', noun: 'staff member',
    text: 'Core profile and the checks ODIP tracks. Pay and employment details stay in your payroll system. Sign-in invites are sent afterwards, when you choose.',
  },
]

export default function ImportDataTab() {
  const history = useImportHistory()
  const undo = useUndoImport()
  const template = useDownloadImportTemplate()
  const staffFromPayroll = useProviderSettings().data?.employmentHeroConnected === true
  const [undoing, setUndoing] = useState<ImportBatchDto | null>(null)
  const [invited, setInvited] = useState<{ batchId: string; fileName: string; result: InviteResult } | null>(null)

  const columns: Column<ImportBatchDto>[] = [
    { key: 'fileName', header: 'File', mobile: 'primary' },
    { key: 'kind', header: 'Type', mobile: 'meta' },
    { key: 'createdByName', header: 'Run by', mobile: 'meta' },
    { key: 'createdAt', header: 'When', mobile: 'meta', render: b => formatDateTimeAu(b.createdAt) },
    { key: 'createdCount', header: 'Created', align: 'right' },
    { key: 'skippedCount', header: 'Skipped', align: 'right' },
    { key: 'failedCount', header: "Couldn't import", align: 'right' },
    {
      key: 'status', header: 'Status', mobile: 'status',
      render: b => b.undoneAt ? <StatusBadge tone="neutral" label="Undone" /> : <StatusBadge tone="success" label="Imported" />,
    },
    {
      key: 'actions', header: '', align: 'right', pin: 'end',
      render: b => !b.undoneAt && (
        <div className="flex flex-wrap justify-end gap-2">
          {/* The count is the batch's created staff; the server invites only those who have never signed in. */}
          {b.kind === 'Staff' && <ImportInvites batchId={b.id} count={b.createdCount} onResult={result => setInvited({ batchId: b.id, fileName: b.fileName, result })} />}
          <Button variant="secondary" size="sm" onClick={() => setUndoing(b)}>Undo</Button>
        </div>
      ),
    },
  ]
  const blockers = undoBlockers(undo.error)

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <section className="flex flex-col gap-3" aria-labelledby="import-kinds">
        <h3 id="import-kinds" className="text-base font-semibold">Bring your records into ODIP</h3>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Upload a .csv or .xlsx export from your old platform, up to 2,000 rows and 5 MB. Records already in ODIP are skipped and never changed.
        </p>
        {KINDS.map(k => {
          // A connected organisation's staff come from Employment Hero: the staff card stays in its slot and says where they come from instead.
          const fromPayroll = staffFromPayroll && k.kind === 'staff'
          return (
            <section key={k.kind} aria-labelledby={`import-kind-${k.kind}`} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-[var(--card-pad)]">
              {/* Grows beside the actions and wraps its own text, so a longer description never pushes the actions under it on a wide screen. */}
              <div className="min-w-0 flex-[1_1_20rem]">
                <h3 id={`import-kind-${k.kind}`} className="text-sm font-semibold">{k.title}</h3>
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  {fromPayroll ? 'Staff come from Employment Hero for this organisation, so they are not imported here.' : k.text}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {fromPayroll ? <Button variant="secondary" to="/settings?tab=integrations">Open Integrations</Button> : (
                  <>
                    <Button variant="secondary" onClick={() => template.mutate(k.kind)}>Download template</Button>
                    <Button to={`/settings/import/${k.kind}`}>Import {k.title.toLowerCase()}</Button>
                  </>
                )}
              </div>
            </section>
          )
        })}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="import-history">
        <h3 id="import-history" className="text-base font-semibold">Import history</h3>
        {invited && <InviteResults result={invited.result} fileName={invited.fileName} />}
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
        message={undoing && (undoing.kind === 'Participants'
          ? `The ${plural(undoing.createdCount, 'participant')} that ${undoing.fileName} created ${undoing.createdCount === 1 ? 'is' : 'are'} archived. This only works while none of them has changed since the import.`
          : `The ${plural(undoing.createdCount, 'staff member')} it created ${undoing.createdCount === 1 ? 'is' : 'are'} removed. This only works while none of them has signed in or been rostered. Anyone already sent a sign-in invite will find it no longer works until they are imported again.`)}
        confirmLabel="Undo import"
        variant="danger"
        loading={undo.isPending}
        onCancel={() => setUndoing(null)}
        onConfirm={() => undoing && undo.mutate(undoing.id, {
          // Its accounts are gone, so what the invites said about them no longer holds.
          onSuccess: () => setInvited(i => (i?.batchId === undoing.id ? null : i)),
          onSettled: () => setUndoing(null),
        })}
      />
    </div>
  )
}
