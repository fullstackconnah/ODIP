import type { ServiceAgreementDraftDto, ServiceAgreementDraftLineDto } from '@/api/types'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { DataTable, type Column } from '@/components/DataTable'
import { StatusBadge } from '@/components/StatusBadge'
import { formatServiceDate } from '@/lib/planQuote'
import { renewalComparison, renewalTotals, type RenewalRow, type RenewalSide } from '@/lib/renewalComparison'
import { formatCurrency } from '@/lib/utils'

interface RenewalReviewProps {
  /** The renewal, in full. */
  renewal: ServiceAgreementDraftDto
  /** The approved revision it renews, as the revisions list has it (a summary: its version and dates). */
  renewedFrom: ServiceAgreementDraftDto
  /** That revision's lines, read in full; undefined while they are read. */
  oldLines: ServiceAgreementDraftLineDto[] | undefined
  oldFailed: boolean
  onRetry: () => void
}

const money = (side: RenewalSide | null, pick: (side: RenewalSide) => number) => (side ? formatCurrency(pick(side)) : '—')

/**
 * The renewal review (agreement PR 2): the renewal's lines beside those of the agreement it renews, matched line by line (D10), each as it was priced when it was saved. A line the new price list has
 * not got is marked here; the engine's own issue for it is in "To look at" below and keeps approval closed, as for any revision. The budget fit is the Check step's own comparison, below this.
 */
export function RenewalReview({ renewal, renewedFrom, oldLines, oldFailed, onRetry }: RenewalReviewProps) {
  const was = `v${renewedFrom.version}`
  const now = `v${renewal.version}`
  const rows = oldLines ? renewalComparison(oldLines, renewal.lines) : []
  const totals = renewalTotals(rows)
  // An old line with no partner is missing from the price list only when the renewal's own pricing says its block has no item; otherwise its days (a public holiday, say) just do not fall in the renewal's dates.
  const withdrawn = new Set((renewal.pricing?.issues ?? []).filter(issue => issue.reason === 'NoItem' || issue.reason === 'CatalogueNotFound').map(issue => issue.blockId))
  const isMissing = (row: RenewalRow) => row.renewal === null && withdrawn.has(row.blockId ?? '')
  const missing = rows.filter(isMissing).length
  const columns: Column<RenewalRow>[] = [
    {
      key: 'support', header: 'Support', mobile: 'primary',
      render: row => <><span className="block">{row.serviceType}</span><span className="block text-xs text-[var(--color-muted-foreground)]">{row.itemCode}{row.band ? ` · ${row.band}` : ''}</span></>,
    },
    { key: 'oldPrice', header: `${was} unit price`, align: 'right', render: row => money(row.old, side => side.unitPrice) },
    { key: 'newPrice', header: `${now} unit price`, align: 'right', render: row => money(row.renewal, side => side.unitPrice) },
    { key: 'oldTotal', header: `${was} total`, align: 'right', render: row => money(row.old, side => side.total) },
    { key: 'newTotal', header: `${now} total`, align: 'right', render: row => money(row.renewal, side => side.total) },
    {
      key: 'priceList', header: 'Price list', mobile: 'status',
      render: row => isMissing(row) ? <StatusBadge tone="warning" label="Not in the new price list" />
        : row.renewal === null ? <StatusBadge tone="neutral" label={`Not in ${now}'s dates`} />
        : row.old === null ? <StatusBadge tone="info" label="New" />
        : `${row.old.catalogueVersion} to ${row.renewal.catalogueVersion}`,
    },
  ]

  return (
    <section aria-labelledby="renewal-review" className="flex flex-col gap-2">
      <h3 id="renewal-review" className="text-sm font-semibold">Renewal of {was}</h3>
      <p className="max-w-prose text-sm">
        {now} runs from {formatServiceDate(renewal.agreementStartDate)} to {formatServiceDate(renewal.agreementEndDate)}, priced from the price list as it is now. {was} ran from {formatServiceDate(renewedFrom.agreementStartDate)} to {formatServiceDate(renewedFrom.agreementEndDate)}.
      </p>
      {oldFailed ? (
        <Callout tone="error" className="max-w-prose" title={`The lines of ${was} could not be read`} actions={<Button size="sm" variant="secondary" onClick={onRetry}>Try again</Button>}>
          The renewal is saved. Only this comparison is missing.
        </Callout>
      ) : (
        <>
          {missing > 0 && (
            <Callout tone="warning" announce={false} className="max-w-prose">
              {missing === 1 ? '1 line' : `${missing} lines`} of {was} {missing === 1 ? 'is' : 'are'} not in the new price list, so {now} cannot be approved yet. Change that support on the Week step: To look at, below, names it.
            </Callout>
          )}
          <DataTable data={rows} columns={columns} keyField="key" sortable={false} loading={!oldLines} compact />
          {oldLines && <p className="text-sm">{was} came to {formatCurrency(totals.old)}; {now} comes to {formatCurrency(totals.renewal)}.</p>}
        </>
      )}
    </section>
  )
}
