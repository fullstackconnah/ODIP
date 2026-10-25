import { useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Download, Loader2, ReceiptText } from 'lucide-react'
import { useInvoiceRegister } from '@/api/hooks'
import type { TruncatableList } from '@/api/hooks/pagedList'
import type { InvoiceRegisterRowDto } from '@/api/types'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { CheckboxField } from '@/components/CheckboxField'
import { CellText, DataTable, type Column } from '@/components/DataTable'
import { Dropdown, type DropdownItem } from '@/components/Dropdown'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { SearchInput } from '@/components/SearchInput'
import { StatusBadge } from '@/components/StatusBadge'
import { TextField } from '@/components/TextField'
import { TAP_AREA, TAP_TRUNCATED_LINK } from '@/components/tapArea'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { downloadFile } from '@/lib/downloadFile'
import { usePermissions } from '@/lib/permissions'
import { retryingAfterError } from '@/lib/queryPhase'
import { TONE } from '@/lib/tone'
import { formatCurrency, formatDateAu } from '@/lib/utils'

// Matches ClaimsController.GetInvoiceRegister's default page size, kept in sync by hand as IncidentsPage does.
const INVOICES_PAGE_SIZE = 50
const MUTED_LINE = 'text-xs text-[var(--color-muted-foreground)]'
const FILTER_PILL = 'bg-[var(--color-input)] border border-[var(--color-border)]'

const KIND_ITEMS: DropdownItem[] = [{ value: 'Invoice', label: 'Invoices' }, { value: 'CreditNote', label: 'Credit notes' }]
const STATUS_ITEMS: DropdownItem[] = [{ value: 'Issued', label: 'Issued' }, { value: 'Voided', label: 'Voided' }, { value: 'Credited', label: 'Credited' }]

/** The words after the count: the Type filter narrows what is counted. */
function subtitleFor(total: number, kind: string, allOrganisations: boolean): string {
  const n = total.toLocaleString('en-AU')
  const suffix = allOrganisations ? ' across all organisations' : ''
  if (kind === 'Invoice') return `${n} ${total === 1 ? 'invoice' : 'invoices'}, newest first${suffix}`
  if (kind === 'CreditNote') return `${n} ${total === 1 ? 'credit note' : 'credit notes'}, newest first${suffix}`
  return total === 1 ? `1 invoice or credit note${suffix}` : `${n} invoices and credit notes, newest first${suffix}`
}

export default function InvoicesPage() {
  const { isSuperAdmin } = usePermissions()
  // The inverse of canCorrectInvoices's SuperAdmin branch: a SuperAdmin who has not chosen an organisation sees all of them.
  const showOrganisation = isSuperAdmin && !localStorage.getItem('odip_viewing_tenant')
  const [searchParams, setSearchParams] = useSearchParams()
  const param = (key: string) => searchParams.get(key) ?? ''
  const search = param('search')
  const kind = param('kind')
  const status = param('status')
  const from = param('from')
  const to = param('to')
  const deletedOnly = param('deletedClaimOnly') === 'true'
  const page = Math.max(1, Number(param('page')) || 1)
  const hasFilters = !!(search || kind || status || from || to || deletedOnly)

  // Filters and page live in the URL (replace, defaults dropped), so Back from a claim lands on the same filtered page. Any filter change drops the page.
  const setFilters = (patch: Record<string, string>) => setSearchParams(prev => {
    const next = new URLSearchParams(prev)
    next.delete('page')
    for (const [key, value] of Object.entries(patch)) { if (value) next.set(key, value); else next.delete(key) }
    return next
  }, { replace: true })
  const setPage = (next: number) => setSearchParams(prev => {
    const copy = new URLSearchParams(prev)
    if (next > 1) copy.set('page', String(next)); else copy.delete('page')
    return copy
  }, { replace: true })

  const term = useDebouncedValue(search.trim(), 300)
  const queryParams: Record<string, string> = { page: String(page), pageSize: String(INVOICES_PAGE_SIZE) }
  if (term) queryParams.search = term
  if (kind) queryParams.kind = kind
  if (status) queryParams.status = status
  if (from) queryParams.from = from
  if (to) queryParams.to = to
  if (deletedOnly) queryParams.deletedClaimOnly = 'true'

  const query = useInvoiceRegister(queryParams)
  const { data: rows = [], isLoading, isError, refetch } = query
  const { totalCount = rows.length } = rows as Partial<TruncatableList<InvoiceRegisterRowDto>>

  // Once drawn, the filter row stays through refetches, errors and filtered-empty, so it never appears and then vanishes.
  const [filtersDrawn, setFiltersDrawn] = useState(false)
  if (!filtersDrawn && (rows.length > 0 || hasFilters)) setFiltersDrawn(true)

  const searchBox = useRef<HTMLDivElement>(null)
  const clearFilters = () => {
    setSearchParams({}, { replace: true })
    searchBox.current?.querySelector('input')?.focus()
  }

  // One download at a time: while one runs the other numbers are aria-disabled, so a click is never silently ignored.
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<{ id: string; message: string } | null>(null)
  const download = async (row: InvoiceRegisterRowDto) => {
    if (downloading) return
    const n = row.displayNumber
    setDownloadError(null)
    setDownloading(row.id)
    try {
      await downloadFile(`/invoices/${row.id}/pdf`, `${n}.pdf`, `Couldn't download ${n}. Try again.`)
    } catch (err) {
      setDownloadError({ id: row.id, message: (err as Error).message })
    } finally {
      setDownloading(null)
    }
  }

  const columns: Column<InvoiceRegisterRowDto>[] = [
    {
      key: 'number',
      header: 'Number',
      mobile: 'primary',
      render: row => {
        const busy = downloading === row.id
        const isCredit = row.kind === 'CreditNote'
        const phrase = `Credit note · credits ${row.creditsDisplayNumber ?? ''}`
        return (
          <div>
            <button
              type="button"
              aria-label={`Download ${row.displayNumber} PDF`}
              title="Download PDF"
              aria-disabled={!!downloading}
              aria-busy={busy}
              onClick={() => download(row)}
              className={`${TAP_AREA} inline-flex items-center gap-1 whitespace-nowrap rounded-sm font-medium tabular-nums text-[var(--color-primary)] hover:underline focus:outline-none focus-visible:underline focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] aria-disabled:cursor-default aria-disabled:opacity-60`}
            >
              {row.displayNumber}
              {busy ? <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden="true" /> : <Download className="size-3.5" aria-hidden="true" />}
            </button>
            {isCredit && (
              <p className={MUTED_LINE} title={phrase}>
                Credit note<span className="max-xl:md:hidden">{` · credits ${row.creditsDisplayNumber ?? ''}`}</span>
              </p>
            )}
          </div>
        )
      },
    },
    ...(showOrganisation ? [{
      key: 'organisationName', header: 'Organisation', mobile: 'meta' as const,
      render: (row: InvoiceRegisterRowDto) => <div className="md:max-w-[10rem]"><CellText>{row.organisationName}</CellText></div>,
    }] : []),
    {
      key: 'issueDate',
      header: 'Issued',
      mobile: 'meta',
      render: row => <span className="whitespace-nowrap tabular-nums before:content-['Issued_'] md:before:hidden">{formatDateAu(row.issueDate)}</span>,
    },
    {
      key: 'participantName',
      header: 'Participant',
      render: row => (
        <div className="md:max-w-[8rem] xl:max-w-[14rem] 2xl:max-w-[18rem]">
          <CellText>{row.participantName}</CellText>
          <CellText className={MUTED_LINE}>
            {row.billToName && row.billToName !== row.participantName ? `Bill to ${row.billToName}` : row.payerKind === 'SelfManaged' ? 'Self managed' : 'Plan managed'}
          </CellText>
        </div>
      ),
    },
    {
      key: 'claimReference',
      header: 'Claim',
      mobile: 'meta',
      render: row => row.tripClaimId ? (
        <Link
          to={`/claims/${row.tripClaimId}`}
          title={row.claimReference}
          className={`block text-[var(--color-primary)] hover:underline md:max-w-[7rem] md:truncate xl:max-w-none ${TAP_TRUNCATED_LINK}`}
        >
          {row.claimReference || '—'}
        </Link>
      ) : (
        <div>
          <CellText className="text-[var(--color-muted-foreground)]" title={row.claimReference}>{row.claimReference || '—'}</CellText>
          <span className={`${MUTED_LINE} block`}>Claim deleted</span>
        </div>
      ),
    },
    { key: 'status', header: 'Status', mobile: 'status', render: row => <StatusBadge status={row.status} /> },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      mobile: 'meta',
      render: row => (
        // A voided invoice no longer stands, so its total is muted and struck through; a credit note shows negative whatever sign the API sends.
        <span className={`whitespace-nowrap font-medium tabular-nums ${row.status === 'Voided' ? 'text-[var(--color-muted-foreground)] line-through' : ''}`}>
          {row.kind === 'CreditNote' ? `-${formatCurrency(Math.abs(row.total))}` : formatCurrency(row.total)}
        </span>
      ),
    },
  ]

  const failed = isError || retryingAfterError(query)
  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <AnnouncementRegion message={downloadError?.message ?? ''} />
      <PageHeader title="Invoices" subtitle={!failed && rows.length > 0 ? subtitleFor(totalCount, kind, showOrganisation) : undefined}>
        {filtersDrawn && (
          <div className="flex w-full flex-wrap items-end gap-2 pointer-coarse:gap-y-3">
            <div ref={searchBox} className="max-md:w-full md:w-80">
              <SearchInput
                value={search}
                onChange={value => setFilters({ search: value })}
                label="Search invoices"
                placeholder="Number, participant, bill to or claim..."
                className="w-full"
              />
            </div>
            <div className="flex gap-2">
              <Dropdown variant="pill" value={kind} onChange={value => setFilters({ kind: value })} label="All Types" items={KIND_ITEMS} colorClass={FILTER_PILL} />
              <Dropdown variant="pill" value={status} onChange={value => setFilters({ status: value })} label="All Statuses" items={STATUS_ITEMS} colorClass={FILTER_PILL} />
            </div>
            <div className="flex flex-wrap gap-2">
              <TextField label="Issued from" type="date" value={from} max={to || undefined} onChange={e => setFilters({ from: e.target.value })} />
              <TextField label="Issued to" type="date" value={to} min={from || undefined} onChange={e => setFilters({ to: e.target.value })} />
            </div>
            <CheckboxField label="Deleted claims only" checked={deletedOnly} onChange={e => setFilters({ deletedClaimOnly: e.target.checked ? 'true' : '' })} />
          </div>
        )}
      </PageHeader>

      {!isLoading && !failed && rows.length === 0 ? (
        hasFilters || page > 1 ? (
          <EmptyState
            icon={ReceiptText}
            title="No invoices match these filters"
            description="Try a different search, type, status or date range, or clear the filters to see every invoice and credit note."
            action={{ label: 'Clear filters', onClick: clearFilters }}
          />
        ) : (
          <EmptyState
            icon={ReceiptText}
            title="No invoices yet"
            description="An invoice is numbered here when a claim is marked as submitted, and stays here even if its claim is later deleted."
          />
        )
      ) : (
        <DataTable
          data={rows}
          columns={columns}
          keyField="id"
          loading={isLoading && !retryingAfterError(query)}
          error={failed}
          onRetry={() => refetch()}
          emptyMessage="No invoices found"
          rowDetail={row => downloadError?.id === row.id
            ? <p className={`text-[13px] ${TONE.danger.ink}`}>{downloadError.message}</p>
            : null}
          pagination={{ page, pageSize: INVOICES_PAGE_SIZE, totalCount, onPageChange: setPage }}
        />
      )}
    </div>
  )
}
