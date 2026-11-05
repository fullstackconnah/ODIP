import { useEffect, useRef, useState } from 'react'
import { Archive, Download, Loader2 } from 'lucide-react'
import { useParticipantExport, useRetentionDue } from '@/api/hooks'
import type { DataExportSaved, PurgeRecordDto, RetentionDueDto } from '@/api/types'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { PageState, RetryCallout } from '@/components/PageState'
import { StatusBadge } from '@/components/StatusBadge'
import { formatDateAu } from '@/lib/utils'
import { PurgeParticipantDialog } from './PurgeParticipantDialog'
import { recordsText, retentionKinds, retentionTotal } from './retentionKinds'

const muted = 'text-[var(--color-muted-foreground)]'
const ESTIMATED_NOTE = "Estimated: archived before Bunya Support recorded archive dates, so the start comes from the record's change history."

type Purged = { person: string; deleted: number }

/**
 * Settings → Data retention (retention 2b, SHAPE-2b). The archived participants whose 7 years have run out: download their data, then purge.
 * - DataRetentionController admits an Admin only, and a SuperAdmin can't confirm a purge, so settingsSections shows the tab to an Admin who is
 *   not viewing as someone.
 * - One download at a time: the server allows one export per organisation, so the other rows' buttons are aria-disabled while one runs.
 * - A purge removes the row at once (no exit animation, so reduced motion needs nothing) and moves focus to the success note.
 */
export default function DataRetentionTab() {
  const due = useRetentionDue()
  const exporter = useParticipantExport()
  const [purging, setPurging] = useState<RetentionDueDto | null>(null)
  const [purged, setPurged] = useState<Purged | null>(null)
  // The last participant whose data was saved, from a row button or the dialog: the dialog's prompt reads it.
  const [downloaded, setDownloaded] = useState<(DataExportSaved & { participantId: string }) | null>(null)
  const noteRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!purged || !noteRef.current) return
    noteRef.current.tabIndex = -1
    noteRef.current.focus()
  }, [purged])

  const rows = due.data ?? []
  const busyId = exporter.isPending ? exporter.variables?.participantId : undefined
  const download = (participantId: string) => {
    if (exporter.isPending) return
    exporter.mutate({ participantId }, { onSuccess: (saved) => setDownloaded({ ...saved, participantId }) })
  }
  const failedId = exporter.isError ? exporter.variables?.participantId : undefined

  function done(row: RetentionDueDto, record: PurgeRecordDto) {
    setPurging(null)
    setPurged({ person: `${row.firstName} ${row.lastName}`, deleted: Object.values(record.rowCounts).reduce((sum, n) => sum + n, 0) })
  }

  const columns: Column<RetentionDueDto>[] = [
    { key: 'lastName', header: 'Participant', mobile: 'primary', render: (r) => `${r.firstName} ${r.lastName}` },
    {
      key: 'startsOn', header: 'Retention starts', mobile: 'meta',
      render: (r) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          {formatDateAu(r.startsOn)}
          {r.startEstimated && <span title={ESTIMATED_NOTE} aria-describedby="retention-estimated-note"><StatusBadge tone="neutral" label="Estimated" /></span>}
        </span>
      ),
    },
    { key: 'dueOn', header: 'Due for purge', mobile: 'meta', render: (r) => formatDateAu(r.dueOn) },
    {
      key: 'rowCounts', header: 'Records', mobile: 'meta', wrap: true,
      // The card's meta cap and ellipsis would cut the kinds line; this cell takes the card's width and wraps.
      className: 'max-md:!max-w-none max-md:[&>span]:!whitespace-normal max-md:[&>span]:![overflow:visible]',
      render: (r) => {
        const kinds = retentionKinds(r.rowCounts)
        return (
          <span className="flex flex-col">
            <span>{recordsText(retentionTotal(kinds))}</span>
            <span className={`text-xs ${muted}`}>{kinds.slice(0, 3).map((k) => `${k.label} ${k.count.toLocaleString('en-AU')}`).join(' · ')}</span>
          </span>
        )
      },
    },
    {
      key: 'actions', header: '', srHeader: 'Actions',
      render: (r) => {
        const name = `${r.firstName} ${r.lastName}`
        const thisOne = busyId === r.participantId
        return (
          <span className="flex gap-2 max-md:w-full max-md:flex-col">
            <Button
              variant="secondary" size="sm" className="max-md:min-h-11"
              aria-label={`Download ${name}'s data`}
              aria-disabled={exporter.isPending || undefined} aria-busy={thisOne || undefined}
              onClick={() => download(r.participantId)}
            >
              {thisOne ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Download className="w-4 h-4" aria-hidden="true" />}
              {thisOne ? 'Downloading…' : 'Download their data'}
            </Button>
            <Button variant="danger" size="sm" className="max-md:min-h-11" aria-label={`Purge ${name}'s record`} onClick={() => { exporter.reset(); setPurging(r) }}>
              Purge
            </Button>
          </span>
        )
      },
    },
  ]

  return (
    <>
      <AnnouncementRegion message={purged ? 'Record purged.' : ''} />
      <section aria-labelledby="data-retention-heading" className="flex flex-col gap-4">
        {purged && (
          <Callout ref={noteRef} tone="success" title="Record purged" announce={false} className="outline-none">
            {purged.person}'s record and {purged.deleted.toLocaleString('en-AU')} linked records were deleted. A note of the purge, with no personal details, stays in Bunya Support. The task in Tasks updates after the next nightly check.
          </Callout>
        )}
        <div className="flex flex-col gap-1">
          <h3 id="data-retention-heading" className="text-base font-semibold">Due for purge</h3>
          <p className={`text-sm ${muted}`}>Oldest first. A record's 7 years start from the day the participant was archived or their last activity, whichever is later.</p>
        </div>
        {failedId && !purging && exporter.error && (
          <Callout tone="danger" title={exporter.error.title} announce={false} actions={exporter.error.retry ? <Button variant="secondary" onClick={() => download(failedId)}>Try again</Button> : undefined}>
            {exporter.error.body}
          </Callout>
        )}
        {due.isPending ? (
          <PageState kind="loading" noun="records due for purge" />
        ) : due.isError && !due.data ? (
          <RetryCallout onRetry={() => due.refetch()}>
            <p className="font-medium">Couldn't load records due for purge</p>
            <p>Check your connection and try again.</p>
          </RetryCallout>
        ) : rows.length === 0 ? (
          <EmptyState icon={Archive} size="inline" title="No records are due for purge" description="When an archived participant's record has been kept for 7 years, it shows here and you get a task in Tasks." />
        ) : (
          <>
            <DataTable data={rows} columns={columns} keyField="participantId" />
            {rows.some((r) => r.startEstimated) && <p id="retention-estimated-note" className={`text-[13px] ${muted}`}>{ESTIMATED_NOTE}</p>}
          </>
        )}
      </section>
      {purging && (
        <PurgeParticipantDialog
          row={purging}
          downloaded={downloaded?.participantId === purging.participantId ? downloaded : null}
          downloading={busyId === purging.participantId}
          downloadFailure={failedId === purging.participantId ? exporter.error : null}
          onDownload={() => download(purging.participantId)}
          onCancel={() => setPurging(null)}
          onDone={(record) => done(purging, record)}
        />
      )}
    </>
  )
}
