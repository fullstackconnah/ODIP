import { useState } from 'react'
import { useIsMutating, useMutationState, type MutationState } from '@tanstack/react-query'
import { Download, Loader2 } from 'lucide-react'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { DATA_EXPORT_KEY, useDataExport, useDataExportLast } from '@/api/hooks'
import type { DataExportFailure, DataExportSaved } from '@/api/types'
import { formatBytes, formatDateTimeAu } from '@/lib/format'

const muted = 'text-[var(--color-muted-foreground)]'

/**
 * Settings → Data export (the shape brief of 2026-10-14, section 3). One button downloads everything the organisation holds as a ZIP.
 * - DataExportController admits an Admin, or a SuperAdmin viewing an organisation: SettingsPage gates the tab with canImportData.
 * - The download is a TanStack mutation keyed DATA_EXPORT_KEY. Leaving the tab and coming back shows it still running, then its outcome, and
 *   only one runs at a time.
 * - The busy button is aria-disabled, not disabled, so focus stays on it instead of falling to the page.
 */
export default function DataExportTab() {
  const last = useDataExportLast()
  const exportData = useDataExport()
  const running = useIsMutating({ mutationKey: DATA_EXPORT_KEY }) > 0
  // The cache types every mutation as <unknown, Error>; this key only ever holds useDataExport's.
  const latest = useMutationState({ filters: { mutationKey: DATA_EXPORT_KEY }, select: (m) => m.state as unknown as MutationState<DataExportSaved, DataExportFailure> }).at(-1)
  const [bytes, setBytes] = useState<number | null>(null)

  const start = () => {
    if (running) return
    setBytes(null)
    exportData.mutate({ onProgress: setBytes })
  }

  // "resumed": running, but started before this tab was last mounted, so its byte figure is gone.
  const phase = !running ? 'idle' : !exportData.isPending ? 'resumed' : bytes ? 'downloading' : 'preparing'
  const saved = !running && latest?.status === 'success' ? latest.data ?? null : null
  const failure = !running && latest?.status === 'error' ? latest.error : null

  const announcement = running ? 'Export started. This can take a few minutes.' : saved ? 'Export saved.' : failure ? `${failure.title}. ${failure.body}` : ''
  const label = phase === 'idle' ? 'Download all data' : phase === 'preparing' ? 'Preparing export…' : 'Downloading…'
  const progress =
    phase === 'preparing' ? 'Building your export. This can take a few minutes for a large organisation.'
    : phase === 'downloading' ? `Downloading… ${formatBytes(bytes ?? 0)} so far. Keep this page open until it's saved.`
    : phase === 'resumed' ? "Still downloading. Keep this page open until it's saved."
    : null
  // No claim before the answer is in: nothing while the last export is loading. The date and time wrap as one, so "04:04" keeps its "pm".
  const when = last.data && <span className="whitespace-nowrap">{formatDateTimeAu(last.data.exportedAt)}</span>
  const lastLine =
    last.isPending ? null
    : last.isError ? "Couldn't check the last export."
    : !last.data ? 'Not exported yet.'
    : last.data.exportedByName ? <>Last exported by {last.data.exportedByName} on {when}</>
    : <>Last exported on {when}</>

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <AnnouncementRegion message={announcement} />
      <section aria-labelledby="data-export-heading" className="flex max-w-2xl flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h3 id="data-export-heading" className="text-base font-semibold">Export all your data</h3>
          <p className={`text-sm ${muted}`}>Download everything your organisation holds in Bunya Support as one ZIP file, at any time.</p>
        </div>
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">What's in the ZIP</h4>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            <li>A CSV file for each kind of record: participants and their plans, staff, shifts, medication, notes, incidents, trips, bookings, claims and your settings.</li>
            <li>Intake PDFs, in a documents folder.</li>
            <li>manifest.csv: each file and how many rows it holds.</li>
            <li>README.txt: what each file is.</li>
          </ul>
        </div>
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">Before you download</h4>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            <li>Times that record when something happened are in UTC and end in Z. Times typed in as a local time, such as a dose slot, are your local time.</li>
            <li>It holds participants' health information and staff details such as worker screening and licence numbers. Store it securely and share it only with people who need it.</li>
            <li>Not included: the change history (audit log), queued notification messages and sign-in accounts.</li>
            <li>Agreements, invoices and other PDFs that we create when you open them aren't files in the ZIP. Their details are in the CSV files.</li>
          </ul>
        </div>
        <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-[var(--card-pad)]">
          <Button size="lg" className="w-full sm:w-auto sm:self-start" onClick={start} aria-disabled={running || undefined} aria-busy={running || undefined}>
            {running ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Download className="w-4 h-4" aria-hidden="true" />}
            {label}
          </Button>
          {lastLine && <p className={`text-[13px] ${muted}`}>{lastLine}</p>}
          {progress && <p className={`text-sm ${muted}`}>{progress}</p>}
          {saved && (
            <Callout tone="success" title="Export saved" announce={false}>
              Saved as {saved.fileName} ({formatBytes(saved.bytes)}). Your browser lists it in its downloads.
            </Callout>
          )}
          {failure && (
            <Callout tone="danger" title={failure.title} announce={false} actions={failure.retry ? <Button variant="secondary" onClick={start}>Try again</Button> : undefined}>
              {failure.body}
            </Callout>
          )}
        </div>
      </section>
    </div>
  )
}
