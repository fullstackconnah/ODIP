import type { DraftBlock, ServiceAgreementDraftDto, ServiceAgreementDraftLineDto } from '@/api/types'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { DataTable, type Column } from '@/components/DataTable'
import { StatusBadge } from '@/components/StatusBadge'
import { formatServiceDate } from '@/lib/planQuote'
import { matchBlocks, renewalComparison, renewalTotals, type RenewalRow, type RenewalSide } from '@/lib/renewalComparison'
import { formatCurrency } from '@/lib/utils'

interface RenewalReviewProps {
  /** The renewal, in full. */
  renewal: ServiceAgreementDraftDto
  /** The approved revision it renews, as the revisions list has it (a summary: its version and dates). */
  renewedFrom: ServiceAgreementDraftDto
  /** The first day of the agreement term the revision belongs to, when an earlier approved revision of the same term exists (a pattern change covers only the weeks from the change): then it covers only the tail. */
  termStart?: string
  /** That revision's lines, read in full; undefined while they are read. */
  oldLines: ServiceAgreementDraftLineDto[] | undefined
  /** That revision's blocks, read with its lines: the lines are paired by support, not by block id, which a save renumbers. */
  oldBlocks?: DraftBlock[]
  oldFailed: boolean
  onRetry: () => void
}

const money = (side: RenewalSide | null, pick: (side: RenewalSide) => number) => (side ? formatCurrency(pick(side)) : '—')

/**
 * The renewal review (agreement PR 2): the renewal's lines beside those of the agreement it renews, matched line by line (D10), each as it was priced when it was saved. A line the new price list has
 * not got is marked here; the engine's own issue for it is in "To look at" below and keeps approval closed, as for any revision. The budget fit is the Check step's own comparison, below this.
 */
export function RenewalReview({ renewal, renewedFrom, termStart, oldLines, oldBlocks, oldFailed, onRetry }: RenewalReviewProps) {
  const was = `v${renewedFrom.version}`
  const now = `v${renewal.version}`
  const tailOnly = !!termStart && termStart < renewedFrom.agreementStartDate
  const rows = oldLines ? renewalComparison(oldLines, renewal.lines, oldBlocks && matchBlocks(oldBlocks, renewal.blocks)) : []
  const totals = renewalTotals(rows)
  // An old line with no partner is missing from the price list only when the renewal's own pricing says its block has no item; otherwise its days (a public holiday, say) just do not fall in the renewal's dates.
  const withdrawn = new Set((renewal.pricing?.issues ?? []).filter(issue => issue.reason === 'NoItem' || issue.reason === 'CatalogueNotFound').map(issue => issue.blockId))
  const isMissing = (row: RenewalRow) => row.renewal === null && withdrawn.has(row.blockId ?? '')
  const missing = rows.filter(isMissing).length
  const allColumns: Column<RenewalRow>[] = [
    {
      key: 'support', header: 'Support', mobile: 'primary',
      // Two lines in a row of fixed height: the cell carries its own padding so they clear the row rules (fix round 2, finish 5).
      render: row => <div className="py-1.5"><span className="block">{row.serviceType}</span><span className="block text-xs text-[var(--color-muted-foreground)]">{row.itemCode}{row.band ? ` · ${row.band}` : ''}</span></div>,
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
        // One version when the price list did not change; "2025-26 to 2026-27" only when it did (fix round 2).
        : row.old.catalogueVersion === row.renewal.catalogueVersion ? row.renewal.catalogueVersion : `${row.old.catalogueVersion} to ${row.renewal.catalogueVersion}`,
    },
  ]
  const columns = tailOnly ? allColumns.filter(column => column.key !== 'oldTotal') : allColumns

  return (
    <section aria-labelledby="renewal-review" className="flex flex-col gap-2">
      <h3 id="renewal-review" className="text-sm font-semibold">Renewal of {was}</h3>
      <p className="max-w-prose text-sm">
        {now} runs from {formatServiceDate(renewal.agreementStartDate)} to {formatServiceDate(renewal.agreementEndDate)}, priced from the price list as it is now. {tailOnly
          ? `${was} only covers the end of the agreement (${formatServiceDate(renewedFrom.agreementStartDate)} to ${formatServiceDate(renewedFrom.agreementEndDate)}; the agreement began on ${formatServiceDate(termStart)}), so its total is not compared with ${now}'s. The unit prices are.`
          : `${was} ran from ${formatServiceDate(renewedFrom.agreementStartDate)} to ${formatServiceDate(renewedFrom.agreementEndDate)}.`}
      </p>
      {oldFailed ? (
        <Callout tone="error" className="max-w-prose" title={`The lines of ${was} could not be read`} actions={<Button size="sm" variant="secondary" onClick={onRetry}>Try again</Button>}>
          The renewal is saved. Only this comparison is missing.
        </Callout>
      ) : (
        <>
          {missing > 0 && (
            <Callout tone="warning" announce={false} className="max-w-prose">
              {missing === 1 ? '1 line' : `${missing} lines`} of {was} {missing === 1 ? 'is' : 'are'} not in the new price list, so {now} cannot be approved yet: To look at, below, says what to change.
            </Callout>
          )}
          <DataTable data={rows} columns={columns} keyField="key" sortable={false} loading={!oldLines} />
          {oldLines && !tailOnly && <p className="text-sm">{was} came to {formatCurrency(totals.old)}; {now} comes to {formatCurrency(totals.renewal)}.</p>}
        </>
      )}
    </section>
  )
}
