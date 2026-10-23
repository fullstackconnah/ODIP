import { useEffect, useRef, useState, type Ref } from 'react'
import { Download } from 'lucide-react'
import { useClaimInvoices } from '@/api/hooks'
import type { InvoiceSummaryDto, PayerGroupDto, TripClaimDetailDto } from '@/api/types'
import { Button } from '@/components/Button'
import { DataTable, CellText } from '@/components/DataTable'
import { StatusBadge } from '@/components/StatusBadge'
import { VoidInvoiceDialog } from '@/components/VoidInvoiceDialog'
import { ROW_ACTIONS_CARD } from '@/components/tapArea'
import { downloadFile } from '@/lib/downloadFile'
import { formatInstantDateAu, plural } from '@/lib/format'
import { usePermissions } from '@/lib/permissions'
import { retryingAfterError } from '@/lib/queryPhase'
import { TONE } from '@/lib/tone'
import { formatCurrency, formatDateAu } from '@/lib/utils'

/** One row: an issued invoice or credit note, or (preview and legacy) a payer the claim's render is drawn for. */
type InvoiceRow = { id: string; payer: PayerGroupDto; invoice?: InvoiceSummaryDto }

type Correction = { invoice: InvoiceSummaryDto; mode: 'void' | 'credit' }

const MUTED_LINE = 'text-xs text-[var(--color-muted-foreground)]'
const dashed = (name: string) => name.trim().replace(/\s+/g, '-')

/** Only plan- and self-managed payers are invoiced. */
function payerLine(payer: PayerGroupDto) {
  return payer.payerKind === 'PlanManaged' ? `for ${payer.participantName} · Plan managed` : 'Self managed'
}

type InvoicesSectionProps = {
  claim: Pick<TripClaimDetailDto, 'id' | 'claimReference' | 'submittedDate'>
  /** The page's one polite announcement (void and credit outcomes). */
  onAnnounce: (message: string) => void
  /** The card's h2, focused after a submit. */
  headingRef?: Ref<HTMLHeadingElement>
}

/**
 * The claim's invoices (Xero PR1, SHAPE section 2): one row per issued invoice or credit note, or, before submit and for claims submitted before
 * numbering, one per plan- or self-managed payer. What state the claim is in comes from the server; nothing here infers it.
 */
export function InvoicesSection({ claim, onAnnounce, headingRef }: InvoicesSectionProps) {
  const query = useClaimInvoices(claim.id)
  const { canCorrectInvoices } = usePermissions()
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [correction, setCorrection] = useState<Correction | null>(null)
  const sectionRef = useRef<HTMLElement>(null)
  // The row whose Download takes focus once the dialog has gone (its own cleanup hands focus back to the opener first).
  // A ref, not state: the setCorrection(null) beside it is the render this waits for (react-hooks/set-state-in-effect).
  const focusAfter = useRef<string | null>(null)
  useEffect(() => {
    const id = focusAfter.current
    if (!id) return
    focusAfter.current = null
    sectionRef.current?.querySelector<HTMLButtonElement>(`[data-download-id="${id}"]`)?.focus()
  })

  const data = query.data
  const state = data?.invoiceState
  const rows: InvoiceRow[] = !data ? []
    : state === 'issued' ? data.invoices.map(invoice => ({ id: invoice.id, payer: invoice, invoice }))
    : state === 'preview' || state === 'legacy' ? data.groups.map(payer => ({ id: payer.groupId, payer }))
    : []
  const anyIssued = rows.some(r => r.invoice?.kind === 'Invoice' && r.invoice.status === 'Issued')

  function file(row: InvoiceRow) {
    const name = row.payer.participantName
    if (row.invoice) {
      const n = row.invoice.displayNumber
      return { url: `/invoices/${row.invoice.id}/pdf`, filename: `${n}.pdf`, label: `Download ${n}`, failed: `Couldn't download ${n}. Try again.` }
    }
    const url = `/claims/${claim.id}/invoices/${row.payer.groupId}`
    return state === 'preview'
      ? { url, filename: `DRAFT-${claim.claimReference}-${dashed(name)}.pdf`, label: `Preview invoice for ${name}`, failed: `Couldn't download the preview for ${name}. Try again.` }
      : { url, filename: `invoice-${dashed(name)}.pdf`, label: `Download invoice for ${name}`, failed: `Couldn't download the invoice for ${name}. Try again.` }
  }

  async function download(row: InvoiceRow) {
    if (downloading) return
    const target = file(row)
    setDownloadError(null)
    setDownloading(row.id)
    try {
      await downloadFile(target.url, target.filename, target.failed)
    } catch (err) {
      setDownloadError((err as Error).message)
    } finally {
      setDownloading(null)
    }
  }

  function corrected(result: InvoiceSummaryDto) {
    if (!correction) return
    const original = correction.invoice
    setCorrection(null)
    onAnnounce(correction.mode === 'void'
      ? `${original.displayNumber} voided.`
      : `${result.displayNumber} issued. ${original.displayNumber} is credited.`)
    // The opener (Void or Issue credit note) goes once the row refetches, so focus goes to the row's Download, which stays.
    focusAfter.current = original.id
  }

  const count = state === 'preview' && rows.length > 0 ? 'Preview' : state === 'issued' ? `${rows.length} issued` : null

  return (
    <section ref={sectionRef} className="bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] overflow-hidden" aria-labelledby="claim-invoices-heading">
      <div className="px-[var(--card-pad)] py-2 bg-[var(--color-surface-container-low)] flex items-center justify-between">
        <h2 id="claim-invoices-heading" ref={headingRef} tabIndex={-1} className="font-semibold text-sm text-[var(--color-muted-foreground)] focus:outline-none">Invoices</h2>
        {count && <span className="text-xs text-[var(--color-muted-foreground)]">{count}</span>}
      </div>

      {query.isLoading && !retryingAfterError(query) ? (
        <p role="status" className="min-h-[60px] flex items-center justify-center text-sm text-[var(--color-muted-foreground)]">Loading invoices…</p>
      ) : !data ? (
        <div className="min-h-[60px] flex flex-wrap items-center justify-center gap-3 px-[var(--card-pad)] py-2 text-sm text-[var(--color-muted-foreground)]">
          <span>Couldn't load the invoices.</span>
          <Button variant="secondary" size="sm" aria-disabled={query.isFetching || undefined} onClick={() => { if (!query.isFetching) query.refetch() }}>Try again</Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="min-h-[60px] flex items-center justify-center px-[var(--card-pad)] py-2 text-center text-sm text-[var(--color-muted-foreground)]">
          No invoices. Everyone on this claim is agency managed, so it's claimed in the BPR CSV.
        </p>
      ) : (
        <>
          {state === 'preview' && <p className={`px-[var(--card-pad)] pt-2 ${MUTED_LINE}`}>Issued when the claim is marked as submitted. Until then, each one is a preview.</p>}
          {state === 'legacy' && <p className={`px-[var(--card-pad)] pt-2 ${MUTED_LINE}`}>Submitted before ODIP numbered its invoices. These keep their old reference and are drawn from the claim each time.</p>}
          <DataTable
            data={rows}
            keyField="id"
            // Held AT the actions column's reserve (not just above it), so a wide table's slack goes to the text columns (SHAPE C4).
            className="overflow-x-auto md:[&_:is(th,td):last-child]:w-[var(--col-min)]"
            columns={[
              {
                key: 'number',
                header: 'Number',
                mobile: 'primary',
                render: (row: InvoiceRow) => row.invoice ? (
                  <div>
                    <span className="whitespace-nowrap tabular-nums font-medium text-[var(--color-foreground)]">{row.invoice.displayNumber}</span>
                    {row.invoice.kind === 'CreditNote' && <p className={MUTED_LINE}>Credit note · credits {row.invoice.creditsDisplayNumber}</p>}
                  </div>
                ) : state === 'preview'
                  ? <span className="whitespace-nowrap text-[var(--color-muted-foreground)]">Not issued</span>
                  : <span className="text-[var(--color-muted-foreground)]">—</span>,
              },
              {
                key: 'billTo',
                header: 'Bill to',
                render: (row: InvoiceRow) => (
                  <div className="md:max-w-[15rem] 2xl:max-w-[24rem]">
                    <CellText className="text-sm text-[var(--color-foreground)]">{row.payer.billToName}</CellText>
                    <p className={MUTED_LINE}>{payerLine(row.payer)}</p>
                  </div>
                ),
              },
              {
                key: 'total',
                header: 'Total',
                align: 'right' as const,
                render: (row: InvoiceRow) => (
                  <span className="whitespace-nowrap tabular-nums font-medium">
                    {row.invoice?.kind === 'CreditNote' ? `-${formatCurrency(Math.abs(row.payer.total))}` : formatCurrency(row.payer.total)}
                  </span>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                mobile: 'status',
                // Wider than the widest pill, so Issued turning Voided or Credited never moves the table (SHAPE C3).
                minWidth: '7rem',
                render: (row: InvoiceRow) => row.invoice
                  ? <StatusBadge status={row.invoice.status} />
                  : state === 'preview' ? <StatusBadge tone="neutral" label="Not issued" /> : <span className="text-[var(--color-muted-foreground)] max-md:hidden">—</span>,
              },
              {
                key: 'issueDate',
                header: 'Issued',
                mobile: 'meta',
                // An absent date is the bare dash string, which DataTable drops from the phone card (a labelled "—" would stay).
                render: (row: InvoiceRow) => !row.invoice && state !== 'legacy' ? '—' : (
                  <span className="whitespace-nowrap tabular-nums before:content-['Issued_'] md:before:hidden">
                    {row.invoice ? formatDateAu(row.invoice.issueDate) : state === 'legacy' ? formatInstantDateAu(claim.submittedDate) : '—'}
                  </span>
                ),
              },
              {
                key: 'dueDate',
                header: 'Due',
                mobile: 'meta',
                render: (row: InvoiceRow) => row.invoice?.dueDate
                  ? <span className="whitespace-nowrap tabular-nums before:content-['·_Due_'] md:before:hidden">{formatDateAu(row.invoice.dueDate)}</span>
                  : '—',
              },
              {
                key: 'actions',
                header: '',
                // Reserved for the widest pair (Download and "Issue credit note") in every state, so the column keeps its width when Void goes.
                minWidth: canCorrectInvoices ? '17.75rem' : undefined,
                className: 'max-md:basis-full',
                render: (row: InvoiceRow) => {
                  const target = file(row)
                  const busy = downloading === row.id
                  const invoice = row.invoice
                  const correctable = canCorrectInvoices && invoice?.kind === 'Invoice' && invoice.status === 'Issued'
                  return (
                    <div className={`flex items-center justify-end md:justify-start gap-1.5 pointer-coarse:gap-2 ${ROW_ACTIONS_CARD}`}>
                      <Button
                        data-download-id={row.id}
                        variant="secondary"
                        size="sm"
                        className="min-w-[8.5rem]!"
                        aria-label={target.label}
                        aria-disabled={busy || undefined}
                        onClick={() => { if (!busy) download(row) }}
                      >
                        <Download className="w-4 h-4" aria-hidden="true" />
                        {busy ? 'Downloading…' : state === 'preview' ? 'Preview' : 'Download'}
                      </Button>
                      {correctable && (invoice.paymentRecorded ? (
                        <Button variant="ghost-danger" size="sm" aria-label={`Issue credit note for ${invoice.displayNumber}`} onClick={() => setCorrection({ invoice, mode: 'credit' })}>
                          Issue credit note
                        </Button>
                      ) : (
                        <Button variant="ghost-danger" size="sm" aria-label={`Void ${invoice.displayNumber}`} onClick={() => setCorrection({ invoice, mode: 'void' })}>
                          Void
                        </Button>
                      ))}
                    </div>
                  )
                },
              },
            ]}
          />
        </>
      )}

      {((data && data.agencyCount > 0 && rows.length > 0) || (anyIssued && !canCorrectInvoices)) && (
        <div className={`flex flex-col gap-1 px-[var(--card-pad)] py-2 ${MUTED_LINE}`}>
          {data && data.agencyCount > 0 && rows.length > 0 && (
            <p>{plural(data.agencyCount, 'agency-managed participant')} {data.agencyCount === 1 ? 'is' : 'are'} claimed in the BPR CSV, not invoiced.</p>
          )}
          {anyIssued && !canCorrectInvoices && <p>Only an Admin can void an invoice or issue a credit note.</p>}
        </div>
      )}
      {downloadError && <p role="alert" className={`px-[var(--card-pad)] py-2 text-[13px] ${TONE.danger.ink}`}>{downloadError}</p>}

      {correction && (
        <VoidInvoiceDialog claimId={claim.id} invoice={correction.invoice} mode={correction.mode} onCancel={() => setCorrection(null)} onDone={corrected} />
      )}
    </section>
  )
}
