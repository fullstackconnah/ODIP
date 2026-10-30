import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { isAxiosError } from 'axios'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { Card } from '@/components/Card'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { CellText, DataTable, type Column } from '@/components/DataTable'
import { DisclosureToggle } from '@/components/DisclosureToggle'
import { Modal } from '@/components/Modal'
import { NumberField } from '@/components/NumberField'
import { PageState } from '@/components/PageState'
import { SlideOver } from '@/components/SlideOver'
import { StatusBadge } from '@/components/StatusBadge'
import { TAP_ICON_SQUARE } from '@/components/tapArea'
import { fetchClaimFile, useClaimBatch, useDiscardBatch, useImportResults, useMarkBatchPaid, useMarkBatchUploaded } from '@/api/hooks/claimHub'
import { useSubmitPreview } from '@/api/hooks/claims'
import { serverSentence } from '@/api/hooks/data-export'
import type { BatchDetailDto, BatchLineDto, ResultsImportDto } from '@/api/types'
import { formatInstantDateAu, plural } from '@/lib/format'
import { formatCurrency } from '@/lib/utils'
import { NEXT_ACTION, ROWS_PER_PAGE, STEP_NUMBER, deliveredText, stepOf, type FileStep } from './claimHubParts'

interface Props {
  batchId: string | null
  onClose: () => void
  announce: (message: string) => void
  /** Needs action, filtered to this file. */
  onReviewRejected: (batchId: string) => void
}

const STEPS = ['File built', 'Uploaded', 'Results in', 'Paid'] as const
// A line waiting on the NDIA is not a time-bound alarm, so Pending is neutral here, not the house warning.
const OUTCOME_TONE = { pending: 'neutral', successful: 'success', rejected: 'danger', withdrawn: 'neutral', paid: 'success' } as const

/** Where the file is, as a read-only list of four steps (SHAPE §10): done steps ticked, the current one marked. */
function BatchProgress({ step }: { step: FileStep }) {
  const current = STEP_NUMBER[step]
  return (
    <ol className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]" aria-label="Progress">
      {STEPS.map((label, i) => {
        const n = i + 1
        const done = n < current || step === 'Paid'
        const now = n === current && step !== 'Paid'
        return (
          <li key={label} aria-current={now ? 'step' : undefined} className={`inline-flex items-center gap-1.5 ${now ? 'font-semibold text-[var(--color-foreground)]' : done ? 'text-[var(--color-foreground)]' : 'text-[var(--color-muted-foreground)]'}`}>
            {done ? <Check className="size-3.5 text-[var(--color-primary)]" aria-hidden="true" /> : <span aria-hidden="true" className={`size-2 rounded-full ${now ? 'bg-[var(--color-primary)]' : 'border border-[var(--color-border)]'}`} />}
            {label}
            {done && <span className="sr-only"> (done)</span>}
          </li>
        )
      })}
    </ol>
  )
}

// The clipboard API needs a secure context, and live is plain HTTP, so a hidden textarea is the fallback.
function copyText(text: string) {
  if (navigator.clipboard?.writeText) return void navigator.clipboard.writeText(text).catch(() => {})
  const area = document.createElement('textarea')
  area.value = text
  document.body.appendChild(area)
  area.select()
  document.execCommand('copy')
  area.remove()
}

export function FilePanel({ batchId, onClose, announce, onReviewRejected }: Props) {
  const query = useClaimBatch(batchId ?? undefined)
  const batch = query.data
  const notFound = isAxiosError(query.error) && query.error.response?.status === 404
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [discarding, setDiscarding] = useState(false)
  const discard = useDiscardBatch()

  const redownload = async () => {
    if (!batch) return
    setDownloadError(null)
    try {
      await fetchClaimFile('get', `/claim-batches/${batch.id}/file`, undefined, batch.fileName, "Couldn't download the file. Try again.")
    } catch (err) {
      setDownloadError((err as Error).message)
    }
  }

  const step = batch ? stepOf(batch) : null
  const footer = batch && step !== 'Discarded' ? (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
      <Button variant="secondary" size="md" onClick={redownload}>Download file again</Button>
      {step === 'Built' && <Button variant="ghost-danger" size="md" onClick={() => setDiscarding(true)}>Discard file</Button>}
    </div>
  ) : undefined

  return (
    <SlideOver
      open={!!batchId}
      onClose={onClose}
      size="lg"
      title={<span data-testid="file-panel-title" className="whitespace-nowrap">{batch?.fileName ?? 'File'}</span>}
      description={batch ? `Built ${formatInstantDateAu(batch.createdAt)} by ${batch.createdByName} · ${plural(batch.lineCount, 'line')} · ${formatCurrency(batch.totalAmount)}` : undefined}
      footer={footer}
    >
      <div data-testid="file-panel" className="flex flex-col gap-4">
        {query.isLoading ? <PageState kind="loading" noun="file" />
          : notFound ? <PageState kind="not-found" noun="file" />
          : !batch || query.isError ? <PageState kind="error" noun="file" onRetry={() => query.refetch()} />
          : (
            <>
              <BatchProgress step={step!} />
              {downloadError && <Callout tone="danger">{downloadError}</Callout>}
              <StepCard key={batch.id} batch={batch} step={step!} announce={announce} onReviewRejected={() => onReviewRejected(batch.id)} />
              <FileLines lines={batch.lines} />
            </>
          )}
      </div>
      <ConfirmDialog
        open={discarding}
        variant="danger"
        title={`Discard ${batch?.fileName ?? 'this file'}?`}
        message={<><p>{`Its ${plural(batch?.lineCount ?? 0, 'line')} go back to Ready to send. The NDIA won't accept this file name again, so the next file gets a new one. Only discard a file you haven't uploaded.`}</p>{discard.isError && <ErrorLine error={discard.error} fallback="Couldn't discard the file. Try again." />}</>}
        confirmLabel="Discard file"
        loading={discard.isPending}
        onCancel={() => { setDiscarding(false); discard.reset() }}
        onConfirm={() => batch && discard.mutate(batch.id, {
          onSuccess: () => { setDiscarding(false); announce(`${batch.fileName} discarded.`) },
        })}
      />
    </SlideOver>
  )
}

function ErrorLine({ error, fallback }: { error: unknown; fallback: string }) {
  const [text, setText] = useState(fallback)
  useEffect(() => { serverSentence(isAxiosError(error) ? error.response?.data : undefined, fallback).then(setText) }, [error, fallback])
  return <Callout tone="danger" className="mt-2">{text}</Callout>
}

function StepCard({ batch, step, announce, onReviewRejected }: { batch: BatchDetailDto; step: FileStep; announce: (m: string) => void; onReviewRejected: () => void }) {
  const [summary, setSummary] = useState<ResultsImportDto | null>(null)
  const summaryBlock = summary && <ImportSummary summary={summary} fileName={batch.fileName} onReviewRejected={onReviewRejected} />
  if (step === 'Built') return <UploadStep batch={batch} announce={announce} />
  if (step === 'Uploaded') return <>{summaryBlock}<ImportStep batch={batch} announce={announce} onImported={setSummary} /></>
  if (step === 'Results in') return <>{summaryBlock}<PaidStep batch={batch} announce={announce} onReviewRejected={onReviewRejected} /></>
  if (step === 'Paid') {
    return <>{summaryBlock}<Card title="Paid"><p className="text-sm">{plural(batch.paid, 'line')} paid · {formatCurrency(batch.paidAmount)}</p></Card></>
  }
  return (
    <Card title="Discarded">
      <p className="text-sm">Discarded on {formatInstantDateAu(batch.discardedAt)}. Its lines went back to Ready to send.</p>
    </Card>
  )
}

function UploadStep({ batch, announce }: { batch: BatchDetailDto; announce: (m: string) => void }) {
  const [confirming, setConfirming] = useState(false)
  const uploaded = useMarkBatchUploaded()
  const claimIds = useMemo(() => [...new Set(batch.lines.map(l => l.claimId).filter((id): id is string => !!id))], [batch.lines])
  const preview = useSubmitPreview(claimIds, confirming)
  const invoices = preview.data?.invoiceCount ?? 0
  const [copied, setCopied] = useState(false)
  return (
    <Card title="Upload it in the NDIA portal">
      <ol className="list-decimal space-y-1.5 pl-5 text-sm">
        <li>Sign in to the myplace provider portal with PRODA.</li>
        <li>Go to <strong>Payment Request &gt; Bulk Payment Request Upload</strong>.</li>
        <li>
          <span className="inline-flex flex-wrap items-center gap-1">
            Upload <strong data-testid="file-step-name" className="whitespace-nowrap text-sm font-semibold">{batch.fileName}</strong>.
            <button type="button" aria-label="Copy file name" title={copied ? 'Copied' : 'Copy file name'} className={`${TAP_ICON_SQUARE} rounded-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]`} onClick={() => { copyText(batch.fileName); setCopied(true) }}>
              {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
            </button>
          </span>
        </li>
      </ol>
      <Callout tone="warning" polite title="Before you upload" className="mt-3">
        <p>Don't open and save the file in Excel. Excel changes the dates, and the NDIA refuses them.</p>
        <p>The portal takes each file name only once. If it refuses this file, discard it here and build a new one.</p>
      </Callout>
      <div className="mt-3">
        <Button data-testid="file-next-action" variant="primary" size="md" className="max-md:w-full" onClick={() => setConfirming(true)}>{NEXT_ACTION.Built!.label}</Button>
      </div>
      <ConfirmDialog
        open={confirming}
        title={`Confirm the upload of ${batch.fileName}`}
        message={<><p>{`Only confirm once the portal has accepted the file. This marks ${plural(claimIds.length, 'claim')} as submitted${invoices > 0 ? ` and issues ${plural(invoices, 'invoice')} for plan- and self-managed participants on those claims.` : '.'}`}</p>{uploaded.isError && <ErrorLine error={uploaded.error} fallback="Couldn't mark the file as uploaded. Try again." />}</>}
        confirmDisabled={preview.isLoading}
        confirmLabel="I've uploaded it"
        cancelLabel="Not yet"
        loading={uploaded.isPending}
        onCancel={() => { setConfirming(false); uploaded.reset() }}
        onConfirm={() => uploaded.mutate(batch.id, {
          onSuccess: () => { setConfirming(false); announce('Marked as uploaded. Import the results when the NDIA has processed the file.') },
        })}
      />
    </Card>
  )
}

function ImportStep({ batch, announce, onImported }: { batch: BatchDetailDto; announce: (m: string) => void; onImported: (s: ResultsImportDto) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [refusal, setRefusal] = useState<{ title?: string; body: string } | null>(null)
  const importer = useImportResults()
  const inputId = useId()
  const stem = batch.fileName.replace(/\.csv$/i, '')
  const run = () => {
    if (!file || importer.isPending) return
    setRefusal(null)
    importer.mutate({ batchId: batch.id, file }, {
      onSuccess: summary => {
        const matched = summary.successful + summary.rejected + summary.unchanged + summary.leftAlone + summary.conflicts.length
        if (matched === 0 && summary.unknownReferences.length > 0) {
          setRefusal({ body: `None of the lines in this file belong to ${stem}. Check that you downloaded the results for this file.` })
          return
        }
        onImported(summary)
        announce(`Results imported: ${summary.successful} successful, ${summary.rejected} rejected.`)
      },
      onError: async err => {
        const res = isAxiosError(err) ? err.response : undefined
        if (res?.status === 400) {
          const body = await serverSentence(res.data, 'Choose the results file to upload.')
          setRefusal(/columns/i.test(body) ? { title: "This isn't an NDIA results file", body } : { body })
        } else if (res?.status === 409) {
          setRefusal({ body: await serverSentence(res.data, "Couldn't import the results. Check your connection and try again.") })
        } else {
          setRefusal({ body: "Couldn't import the results. Check your connection and try again." })
        }
      },
    })
  }
  return (
    <div data-testid="file-import">
      <Card title="Import the NDIA results">
        <p className="text-sm">
          When the NDIA has processed the file, go to <strong>Payment Request &gt; View Payment Requests</strong>, search for <strong>{stem}</strong>, and download the results file. This can take a business day or more.
        </p>
        {refusal && <Callout tone="danger" title={refusal.title} className="mt-3">{refusal.body}</Callout>}
        <div className="mt-3 flex flex-col gap-1.5">
          <label htmlFor={inputId} className="text-sm font-medium">Results file (.csv)</label>
          <input id={inputId} type="file" accept=".csv" onChange={e => { setFile(e.target.files?.[0] ?? null); setRefusal(null) }} className="block w-full text-sm file:mr-3 file:min-h-[var(--control-h-sm)] file:rounded-[var(--radius-sm)] file:border file:border-[var(--color-border)] file:bg-[var(--color-card)] file:px-3 file:text-sm" />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button data-testid="file-next-action" variant="primary" size="md" className="max-md:w-full aria-disabled:opacity-60" aria-disabled={!file || importer.isPending} aria-describedby={file ? undefined : `${inputId}-hint`} onClick={run}>
            {importer.isPending ? 'Importing…' : 'Import results'}
          </Button>
          {!file && <span id={`${inputId}-hint`} className="text-[13px] text-[var(--color-muted-foreground)]">Choose the results file first</span>}
        </div>
      </Card>
    </div>
  )
}

function ImportSummary({ summary, fileName, onReviewRejected }: { summary: ResultsImportDto; fileName: string; onReviewRejected: () => void }) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const changed = summary.successful + summary.rejected
  if (changed === 0 && summary.conflicts.length === 0) return <Callout tone="info" polite>Nothing changed. These results were already imported.</Callout>
  return (
    <Callout tone="success" polite title="Results imported">
      <p>{summary.successful} successful · {summary.rejected} rejected</p>
      {summary.leftAlone > 0 && <p>{plural(summary.leftAlone, 'line')} already had a result and {summary.leftAlone === 1 ? 'was' : 'were'} left alone.</p>}
      {summary.conflicts.length > 0 && <p>{plural(summary.conflicts.length, 'line')} already had a different result, so {summary.conflicts.length === 1 ? 'it wasn’t' : 'they weren’t'} changed: {summary.conflicts.map(c => c.rowReference).join(', ')}.</p>}
      {summary.unreadRows.length > 0 && <p>{plural(summary.unreadRows.length, 'row')} couldn't be read: {summary.unreadRows.map(r => `row ${r.row} (${r.note})`).join(', ')}.</p>}
      {summary.rejected > 0 && (
        <button type="button" className="mt-1 font-medium text-[var(--color-primary)] hover:underline" onClick={onReviewRejected}>Review {plural(summary.rejected, 'rejected line')}</button>
      )}
      {summary.unknownReferences.length > 0 && (
        <div className="mt-1">
          <DisclosureToggle label={`${plural(summary.unknownReferences.length, 'line')} in the file weren't in ${fileName.replace(/\.csv$/i, '')}`} open={open} onToggle={() => setOpen(o => !o)} controls={listId} />
          {open && (
            <div id={listId} className="mt-1 text-sm">
              <p>These weren't changed. They may belong to another file.</p>
              <ul className="list-disc pl-5">{summary.unknownReferences.map(r => <li key={r}>{r}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </Callout>
  )
}

function PaidStep({ batch, announce, onReviewRejected }: { batch: BatchDetailDto; announce: (m: string) => void; onReviewRejected: () => void }) {
  const [open, setOpen] = useState(false)
  const unpaid = batch.lines.filter(l => l.outcome === 'Successful' && l.paidAmount == null)
  return (
    <Card title="Record the payment">
      <p className="text-sm">The NDIA pays successful lines in its next payment run. When the money is in, record it here.</p>
      {batch.rejected > 0 && (
        <button type="button" className="mt-1 text-sm text-[var(--color-muted-foreground)] hover:underline" onClick={onReviewRejected}>{plural(batch.rejected, 'line')} rejected</button>
      )}
      <div className="mt-3">
        <Button data-testid="file-next-action" variant="secondary" size="md" className="max-md:w-full" onClick={() => setOpen(true)} disabled={unpaid.length === 0}>
          Mark {plural(unpaid.length, 'line')} as paid
        </Button>
      </div>
      {open && <MarkPaidModal batch={batch} lines={unpaid} onClose={() => setOpen(false)} announce={announce} />}
    </Card>
  )
}

function MarkPaidModal({ batch, lines, onClose, announce }: { batch: BatchDetailDto; lines: BatchLineDto[]; onClose: () => void; announce: (m: string) => void }) {
  const [amounts, setAmounts] = useState<Record<string, number>>(() => Object.fromEntries(lines.map(l => [l.batchLineId, l.resultAmount ?? l.amount])))
  const [serverError, setServerError] = useState<string | null>(null)
  const paid = useMarkBatchPaid()
  const overBy = (l: BatchLineDto) => (amounts[l.batchLineId] ?? 0) > (l.resultAmount ?? l.amount)
  const invalid = lines.some(overBy)
  const submit = () => {
    if (invalid) return
    setServerError(null)
    paid.mutate({ batchId: batch.id, lines: lines.map(l => ({ batchLineId: l.batchLineId, amount: amounts[l.batchLineId] })) }, {
      onSuccess: () => { announce(`${plural(lines.length, 'line')} marked as paid.`); onClose() },
      onError: async err => setServerError(await serverSentence(isAxiosError(err) ? err.response?.data : undefined, "Couldn't mark the lines as paid. Try again.")),
    })
  }
  const columns: Column<BatchLineDto>[] = [
    { key: 'participant', header: 'Participant', mobile: 'primary', render: l => l.participantName ?? '—' },
    { key: 'item', header: 'Item', mobile: 'meta', render: l => <CellText>{l.supportNumber}</CellText> },
    { key: 'claimed', header: 'Claimed', align: 'right', mobile: 'meta', render: l => formatCurrency(l.resultAmount ?? l.amount) },
    {
      key: 'paid', header: 'Paid', align: 'right',
      render: l => (
        <NumberField label={`Paid for ${l.participantName ?? l.rowReference}`} className="[&_label]:sr-only" inputMode="decimal" step="0.01" min={0} max={l.resultAmount ?? l.amount}
          value={amounts[l.batchLineId] ?? 0} onChange={v => setAmounts(a => ({ ...a, [l.batchLineId]: Math.round(v * 100) / 100 }))}
          error={overBy(l) ? "Can't be more than the amount claimed." : undefined} />
      ),
    },
  ]
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Mark as paid"
      footer={(
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} aria-disabled={invalid || paid.isPending} className="aria-disabled:opacity-60">{paid.isPending ? 'Saving…' : 'Mark as paid'}</Button>
        </div>
      )}
    >
      <p className="mb-3 text-sm">Each amount starts at what was claimed. Change it if the NDIA paid less, for example a capped price.</p>
      {serverError && <Callout tone="danger" className="mb-3">{serverError}</Callout>}
      <DataTable data={lines} columns={columns} keyField="batchLineId" />
    </Modal>
  )
}

function FileLines({ lines }: { lines: BatchLineDto[] }) {
  const [page, setPage] = useState(1)
  const top = useRef<HTMLDivElement>(null)
  const columns: Column<BatchLineDto>[] = [
    { key: 'participant', header: 'Participant', mobile: 'primary', render: l => <CellText>{l.participantName ?? '—'}</CellText> },
    { key: 'item', header: 'Support item', mobile: 'meta', render: l => <CellText>{l.supportNumber}</CellText> },
    { key: 'delivered', header: 'Delivered', mobile: 'meta', render: l => <span className="whitespace-nowrap">{deliveredText(l.from, l.to)}</span> },
    { key: 'amount', header: 'Amount', align: 'right', mobile: 'meta', render: l => formatCurrency(l.amount) },
    { key: 'outcome', header: 'Outcome', mobile: 'status', render: l => {
      const status = l.paidAmount != null ? 'Paid' : l.outcome
      return <StatusBadge status={status} colorMap={OUTCOME_TONE} />
    } },
    { key: 'code', header: 'Code', render: l => l.rejectCode ?? '' },
  ]
  return (
    <div ref={top} className="scroll-mt-20">
      <h3 className="mb-2 text-sm font-semibold">Lines</h3>
      <DataTable
        data={lines.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE)}
        columns={columns}
        keyField="batchLineId"
        emptyMessage="This file has no lines."
        pagination={{ page, pageSize: ROWS_PER_PAGE, totalCount: lines.length, onPageChange: p => { setPage(p); top.current?.scrollIntoView?.({ block: 'start' }) } }}
      />
    </div>
  )
}
