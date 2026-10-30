import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Banknote, Receipt } from 'lucide-react'
import { Callout } from '@/components/Callout'
import { DataTable, type Column } from '@/components/DataTable'
import { Dropdown, type DropdownItem } from '@/components/Dropdown'
import { EmptyState } from '@/components/EmptyState'
import { PageState } from '@/components/PageState'
import { StatusBadge } from '@/components/StatusBadge'
import type { BatchDto, ManagedClaimDto } from '@/api/types'
import { formatInstantDateAu, plural } from '@/lib/format'
import { TONE } from '@/lib/tone'
import { formatCurrency } from '@/lib/utils'
import { ROWS_PER_PAGE } from './claimHubSteps'

const FILTER_PILL = 'bg-[var(--color-input)] border border-[var(--color-border)]'

/**
 * Paid, per file. shortcut: the contract has no paid-claims list, so this shows each file's paid lines rather than claims at Paid;
 * upgrade when the server lists paid claims.
 */
export function PaidPanel({ batches, loading, failed, onRetry, onOpen }: { batches: BatchDto[] | undefined; loading: boolean; failed: boolean; onRetry: () => void; onOpen: (id: string) => void }) {
  const [page, setPage] = useState(1)
  const rows = useMemo(() => (batches ?? []).filter(b => b.paid > 0).sort((a, b) => (b.resultsImportedAt ?? b.createdAt).localeCompare(a.resultsImportedAt ?? a.createdAt)), [batches])
  const columns: Column<BatchDto>[] = [
    { key: 'file', header: 'File', mobile: 'primary', render: b => <span className="whitespace-nowrap text-sm font-semibold">{b.fileName}</span> },
    { key: 'results', header: 'Results in', mobile: 'meta', render: b => formatInstantDateAu(b.resultsImportedAt) },
    { key: 'lines', header: 'Lines paid', align: 'right', mobile: 'meta', render: b => `${b.paid} of ${plural(b.successful, 'line')}` },
    { key: 'claimed', header: 'Claimed', align: 'right', mobile: 'meta', render: b => formatCurrency(b.totalAmount) },
    { key: 'paid', header: 'Paid', align: 'right', mobile: 'status', render: b => b.paidAmount < b.totalAmount && b.rejected === 0
      ? <span className={TONE.danger.ink} title="Paid less than claimed">{formatCurrency(b.paidAmount)}</span>
      : formatCurrency(b.paidAmount) },
  ]
  if (failed) return <div data-testid="claims-panel-paid"><PageState kind="error" noun="paid claims" onRetry={onRetry} /></div>
  if (!loading && rows.length === 0) {
    return <div data-testid="claims-panel-paid"><EmptyState icon={Banknote} title="Nothing paid yet" description="Claims show here once you mark them paid, from a file or from the claim." /></div>
  }
  return (
    <div data-testid="claims-panel-paid">
      <DataTable data={rows.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE)} columns={columns} keyField="id" loading={loading} onRowClick={b => onOpen(b.id)}
        pagination={{ page, pageSize: ROWS_PER_PAGE, totalCount: rows.length, onPageChange: setPage }} />
    </div>
  )
}

const FUNDING_ITEMS: DropdownItem[] = [{ value: 'plan', label: 'Plan-managed' }, { value: 'self', label: 'Self-managed' }]
const FUNDING_LABEL = { plan: 'Plan-managed', self: 'Self-managed' } as const

export function OtherPanel({ claims, loading, failed, onRetry }: { claims: ManagedClaimDto[]; loading: boolean; failed: boolean; onRetry: () => void }) {
  const navigate = useNavigate()
  const [funding, setFunding] = useState('')
  const [page, setPage] = useState(1)
  const rows = useMemo(() => funding ? claims.filter(c => c.fundingType === funding) : claims, [claims, funding])
  const columns: Column<ManagedClaimDto>[] = [
    { key: 'claim', header: 'Claim', mobile: 'primary', render: c => <Link to={`/claims/${c.claimId}`} className="font-medium hover:underline" onClick={e => e.stopPropagation()}>{c.claimReference}</Link> },
    { key: 'participant', header: 'Participant', mobile: 'meta', render: c => c.participantName },
    { key: 'managed', header: 'Managed', mobile: 'meta', render: c => <StatusBadge status={c.fundingType} tone={c.fundingType === 'plan' ? 'info' : 'neutral'} label={FUNDING_LABEL[c.fundingType]} /> },
    { key: 'invoice', header: 'Invoice', mobile: 'meta', render: c => c.invoices[0]?.number ?? <span className="text-[var(--color-muted-foreground)]">Not issued yet</span> },
    { key: 'invoiceStatus', header: 'Invoice status', mobile: 'hidden', render: c => c.invoices[0] ? <StatusBadge status={c.invoices[0].status} /> : null },
    { key: 'amount', header: 'Amount', align: 'right', mobile: 'meta', render: c => formatCurrency(c.totalAmount) },
    { key: 'status', header: 'Claim status', mobile: 'status', render: c => <StatusBadge status={c.claimStatus} /> },
  ]
  const callout = (
    <Callout tone="info" polite actions={<Link to="/invoices" className="font-medium text-[var(--color-primary)] hover:underline">All invoices</Link>}>
      Plan- and self-managed supports aren't claimed from the NDIA. Bunya Support issues an invoice when the claim is submitted: to the plan manager, or to the participant.
    </Callout>
  )
  if (failed) return <div data-testid="claims-panel-other"><PageState kind="error" noun="claims" onRetry={onRetry} /></div>
  if (!loading && claims.length === 0) {
    return (
      <div data-testid="claims-panel-other">
        <EmptyState icon={Receipt} title="No plan- or self-managed claims" description="Claims for plan- and self-managed participants show here with their invoice." action={{ label: 'All invoices', to: '/invoices' }} />
      </div>
    )
  }
  return (
    <div data-testid="claims-panel-other" className="flex flex-col gap-3">
      {callout}
      <div>
        <Dropdown variant="pill" value={funding} onChange={v => { setFunding(v); setPage(1) }} label="Both" items={FUNDING_ITEMS} colorClass={FILTER_PILL} />
      </div>
      <DataTable data={rows.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE)} columns={columns} keyField="claimId" loading={loading}
        emptyMessage="No claims match. Show both funding types." onRowClick={c => navigate(`/claims/${c.claimId}`)}
        pagination={{ page, pageSize: ROWS_PER_PAGE, totalCount: rows.length, onPageChange: setPage }} />
    </div>
  )
}
