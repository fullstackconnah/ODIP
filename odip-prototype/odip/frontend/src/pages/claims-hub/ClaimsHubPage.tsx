import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useClaimBatches, useHubLines } from '@/api/hooks/claimHub'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { Button } from '@/components/Button'
import { Modal } from '@/components/Modal'
import { PageHeader } from '@/components/PageHeader'
import { Tabs } from '@/components/Tabs'
import { useTabParam } from '@/hooks/useTabParam'
import { plural } from '@/lib/format'
import { usePermissions } from '@/lib/permissions'
import { FilePanel } from './FilePanel'
import { FilesPanel, FilesStrip } from './FilesPanel'
import { OtherPanel, PaidPanel } from './HistoryPanels'
import { NeedsActionPanel } from './NeedsActionPanel'
import { ReadyPanel } from './ReadyPanel'
import { isUnfinished } from './claimHubSteps'

const TAB_KEYS = ['ready', 'files', 'action', 'paid', 'other'] as const

const HOW_STEPS = [
  "Tick the lines to send. Lines that would be rejected can't be ticked until they're fixed.",
  'Build the file. Bunya Support checks every line and names the file for you.',
  'Upload it in the NDIA portal (Payment Request > Bulk Payment Request Upload), then confirm here.',
  'When the NDIA has processed it, download the results file and import it here. Every line is marked for you.',
  'Fix or decide on any rejected lines, then mark the rest paid when the money arrives.',
]

/** The NDIA claims hub: lines ready to send, the bulk payment request files built from them, and what the NDIA sent back. */
export default function ClaimsHubPage() {
  const { hasOrganisation, canEditProviderSettings } = usePermissions()
  const [tab, setTab] = useTabParam(TAB_KEYS, 'ready')
  const [params, setParams] = useSearchParams()
  const openFile = params.get('file')
  const [how, setHow] = useState(false)
  const [message, setMessage] = useState('')
  const [fileFilter, setFileFilter] = useState<string | undefined>()
  const lines = useHubLines()
  const batches = useClaimBatches()

  // The open file lives in the URL, so a reload or a link lands on its next step; `replace` keeps Back leaving the page.
  const setFile = (id: string | null) => setParams(p => {
    const next = new URLSearchParams(p)
    if (id) next.set('file', id)
    else next.delete('file')
    return next
  }, { replace: true })

  const onBuilt = (batchId: string | undefined, fileName: string, count: number) => {
    setMessage(`${fileName} built with ${plural(count, 'line')}. It's downloading.`)
    if (batchId) setFile(batchId)
  }

  const header = (
    <PageHeader
      title="Claims"
      subtitle="Send NDIA-managed claims as a bulk payment request file, then track what comes back."
      action={<Button variant="secondary" size="md" onClick={() => setHow(true)}>How claiming works</Button>}
    />
  )
  const howModal = (
    <Modal open={how} onClose={() => setHow(false)} title="How claiming works" footer={<Button variant="secondary" size="md" onClick={() => setHow(false)}>Close</Button>}>
      <ol className="list-decimal space-y-2 pl-5 text-sm">{HOW_STEPS.map(s => <li key={s}>{s}</li>)}</ol>
      <p className="mt-3 text-sm text-[var(--color-muted-foreground)]">
        Bunya Support assumes your participants are on the NDIA's new claiming system (PACE), so it doesn't check service bookings. From 1 December 2026 the NDIA rejects claims made more than 90 days after the support was delivered. (We're confirming this rule.)
      </p>
      <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">A Pending line in an uploaded file waits for that file's results import before it can be sent again.</p>
    </Modal>
  )

  if (!hasOrganisation) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <p className="text-sm text-[var(--color-muted-foreground)]">Choose an organisation to see its claims.</p>
        {howModal}
      </div>
    )
  }

  const data = lines.data
  const unfinished = batches.data?.filter(isUnfinished).length
  const badge = (n: number | undefined) => n || undefined
  const tabs = [
    { id: 'ready', label: 'Ready to send', badge: badge(data?.ready.length) },
    { id: 'files', label: 'Files', badge: badge(unfinished) },
    { id: 'action', label: 'Needs action', badge: badge(data?.rejected.length) },
    { id: 'paid', label: 'Paid' },
    { id: 'other', label: 'Plan- and self-managed' },
  ]
  const linesProps = { loading: lines.isLoading, failed: lines.isError, onRetry: () => lines.refetch() }
  const filesProps = { batches: batches.data, loading: batches.isLoading, failed: batches.isError, onRetry: () => batches.refetch(), onOpen: setFile }

  return (
    <div className="flex flex-col gap-4">
      {header}
      <AnnouncementRegion message={message} />
      <FilesStrip {...filesProps} onShowAll={() => setTab('files')} />
      <Tabs tabs={tabs} active={tab} onChange={setTab} ariaLabel="Claims sections" overflow="scroll" />
      {tab === 'ready' && (
        <ReadyPanel lines={data?.ready ?? []} {...linesProps} registrationProblem={data?.registrationProblem} canEditSettings={canEditProviderSettings} onBuilt={onBuilt} />
      )}
      {tab === 'files' && <FilesPanel {...filesProps} onGoToReady={() => setTab('ready')} />}
      {tab === 'action' && (
        <NeedsActionPanel lines={data?.rejected ?? []} {...linesProps} fileFilter={fileFilter} onClearFilter={() => setFileFilter(undefined)}
          onOpenFile={setFile} onBuilt={onBuilt} announce={setMessage} />
      )}
      {tab === 'paid' && <PaidPanel {...filesProps} />}
      {tab === 'other' && <OtherPanel claims={data?.managed ?? []} {...linesProps} />}
      <FilePanel
        batchId={openFile}
        onClose={() => setFile(null)}
        announce={setMessage}
        onReviewRejected={id => { setFileFilter(id); setFile(null); setTab('action') }}
      />
      {howModal}
    </div>
  )
}
