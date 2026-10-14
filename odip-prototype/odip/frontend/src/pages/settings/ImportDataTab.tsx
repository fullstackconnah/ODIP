import { useState } from 'react'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DataTable, type Column } from '@/components/DataTable'
import { StatusBadge } from '@/components/StatusBadge'
import { useDownloadImportTemplate, useImportHistory, useUndoImport } from '@/api/hooks'
import type { ImportBatchDto, ImportKind } from '@/api/types'
import { formatDateTimeAu, plural } from '@/lib/format'
import { extractErrorMessage } from '@/lib/utils'
import ImportInvites, { InviteResults, type InviteResult } from './ImportInvites'
import { undoBlockers } from './importUndoBlockers'

/** What the tab offers to import, in order. Each opens the wizard at /settings/import/{kind}. */
const KINDS: { kind: ImportKind; title: string; text: string; noun: string }[] = [
  {
    kind: 'participants', title: 'Participants', noun: 'participant',
    text: 'Core profile, plan type and dates, contacts and caregivers. Budgets come in with Funding plans; medications and goals are added in ODIP afterwards.',
  },
  {
    kind: 'staff', title: 'Staff', noun: 'staff member',
    text: 'Core profile and the checks ODIP tracks. Pay and employment details stay in your payroll system. Sign-in invites are sent afterwards, when you choose.',
  },
  {
    kind: 'funding-plans', title: 'Funding plans', noun: 'funding plan',
    text: "Each participant's plan dates and budget, one row per support category. Import participants first: each row finds its participant by NDIS number, or by name and date of birth.",
  },
]

/** The history's words for each kind. */
const KIND_LABEL: Record<ImportBatchDto['kind'], string> = { Participants: 'Participants', Staff: 'Staff', FundingPlans: 'Funding plans' }

/** What undoing a batch does, as the confirm says it. Plans block their participants' undo, so the participant message says which goes first. */
const UNDO_MESSAGE: Record<ImportBatchDto['kind'], (b: ImportBatchDto) => string> = {
  Participants: b => `The ${plural(b.createdCount, 'participant')} that ${b.fileName} created ${b.createdCount === 1 ? 'is' : 'are'} archived. This only works while none of them has changed since the import. If a funding plans import added plans for them, undo that first.`,
  Staff: b => `The ${plural(b.createdCount, 'staff member')} it created ${b.createdCount === 1 ? 'is' : 'are'} removed. This only works while none of them has signed in or been rostered. Anyone already sent a sign-in invite will find it no longer works until they are imported again.`,
  FundingPlans: b => `The ${plural(b.createdCount, 'funding plan')} that ${b.fileName} created ${b.createdCount === 1 ? 'is' : 'are'} deleted. This only works while none of them has been changed, or used by a shift or a service agreement, since the import.`,
}

export default function ImportDataTab() {
  const history = useImportHistory()
  const undo = useUndoImport()
  const template = useDownloadImportTemplate()
  const [undoing, setUndoing] = useState<ImportBatchDto | null>(null)
  const [invited, setInvited] = useState<{ batchId: string; fileName: string; result: InviteResult } | null>(null)

  const columns: Column<ImportBatchDto>[] = [
    { key: 'fileName', header: 'File', mobile: 'primary' },
    { key: 'kind', header: 'Type', mobile: 'meta', render: b => KIND_LABEL[b.kind] },
    { key: 'createdByName', header: 'Run by', mobile: 'meta' },
    { key: 'createdAt', header: 'When', mobile: 'meta', render: b => formatDateTimeAu(b.createdAt) },
    // A funding plans batch creates plans from several rows each, so its counts name their unit.
    { key: 'createdCount', header: 'Created', align: 'right', render: b => b.kind === 'FundingPlans' ? plural(b.createdCount, 'plan') : b.createdCount },
    { key: 'skippedCount', header: 'Skipped', align: 'right', render: b => b.kind === 'FundingPlans' ? plural(b.skippedCount, 'row') : b.skippedCount },
    { key: 'failedCount', header: "Couldn't import", align: 'right', render: b => b.kind === 'FundingPlans' ? plural(b.failedCount, 'row') : b.failedCount },
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
        <h2 id="import-kinds" className="text-base font-semibold">Bring your records into ODIP</h2>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Upload a .csv or .xlsx export from your old platform, up to 2,000 rows and 5 MB. Records already in ODIP are skipped and never changed.
        </p>
        {KINDS.map(k => (
          <section key={k.kind} aria-labelledby={`import-kind-${k.kind}`} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-[var(--card-pad)]">
            {/* Grows beside the actions and wraps its own text, so a longer description never pushes the actions under it on a wide screen. */}
            <div className="min-w-0 flex-[1_1_20rem]">
              <h3 id={`import-kind-${k.kind}`} className="text-sm font-semibold">{k.title}</h3>
              <p className="text-sm text-[var(--color-muted-foreground)]">{k.text}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => template.mutate(k.kind)}>Download template</Button>
              <Button to={`/settings/import/${k.kind}`}>Import {k.title.toLowerCase()}</Button>
            </div>
          </section>
        ))}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="import-history">
        <h2 id="import-history" className="text-base font-semibold">Import history</h2>
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
        message={undoing && UNDO_MESSAGE[undoing.kind](undoing)}
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
